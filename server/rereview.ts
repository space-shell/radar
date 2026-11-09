import { shownState } from "../shared/appearance";
import {
  anchorKey,
  parseAnchor,
  placeOf,
  roundsOf,
  type SubmittedReview,
} from "../shared/feedback";
import type { FindingState, FindingsFile, Severity } from "../shared/findings";
import type { IntakeRecord } from "../shared/inbox";
import type { PostedFinding } from "../shared/threads";
import { call, githubError } from "./api";
import { compareAnchors, type Anchors, type CommitRange } from "./diff";
import { log } from "./log";
import { loadState, updateState } from "./state";

/** One inline comment, as the review's own comment list returns it. */
interface ReviewCommentRow {
  id: number;
}

/**
 * The ids GitHub gave one review's inline comments, in the order it holds them.
 *
 * `POST /pulls/{n}/reviews` answers with the review and not with its comments,
 * so this is a second read. The order it returns is the order the comments were
 * sent in, which is the order `anchors` holds, and the id it gives each one is
 * the `databaseId` that review thread's first comment carries. That pairing is
 * what lets a later round say which finding a thread belongs to.
 */
async function fetchCommentIds(
  repo: string,
  number: number,
  reviewId: number,
): Promise<number[]> {
  const { status, body } = await call<ReviewCommentRow[]>(
    `/repos/${repo}/pulls/${number}/reviews/${reviewId}/comments?per_page=100`,
    "GET",
  );
  if (status !== 200 || !Array.isArray(body)) {
    throw new Error(githubError(body) ?? `GitHub returned ${status}`);
  }
  return body.map((row) => row.id);
}

/**
 * Pairs each inline comment GitHub created with the finding it came from, and
 * stores the pairing on the round.
 *
 * Written only when the two lists are the same length. A short answer means the
 * assumption about order or count does not hold, and a mispaired id would report
 * one finding resolved when it was a different one. The round keeps its anchors
 * either way and falls back to matching on path, side and line. AC-AQ6.
 */
export async function recordCommentIds(
  key: string,
  repo: string,
  number: number,
  reviewId: number,
  anchors: string[],
): Promise<boolean> {
  const ids = await fetchCommentIds(repo, number, reviewId);
  if (ids.length !== anchors.length) {
    log(
      `${key}: review ${reviewId} returned ${ids.length} comments for ${anchors.length} anchors, so the ids were not stored`,
    );
    return false;
  }

  const posted = anchors.map((anchor, index) => ({
    id: ids[index] ?? 0,
    anchor,
  }));
  await updateState((live) => {
    const stored = live.intake.find((candidate) => candidate.key === key);
    if (!stored?.feedback) return;
    const rounds = roundsOf(stored.feedback);
    const target = rounds.find((round) => round.id === reviewId);
    if (!target) return;
    target.posted = posted;
    // Written back whole, and the legacy `submitted` key dropped with it, the
    // same way the submit path writes: `roundsOf` reads one or the other.
    stored.feedback = { draft: stored.feedback.draft, rounds };
  });
  return true;
}

/** A round that went out but has no ids to pair its anchors with. */
function needsIds(round: SubmittedReview): boolean {
  return round.anchors.length > 0 && (round.posted ?? []).length === 0;
}

/**
 * The one-off repair for every round stored before the ids were captured.
 *
 * Thirty one of them at the time of writing, each one GET. Without it those
 * rounds live on the position fallback forever, which cannot tell two findings
 * at one line apart and reports both `unknown`.
 *
 * Runs at most once: the flag is set only after a clean pass, so a run that died
 * partway resumes on the next start, and a round it already finished is skipped
 * because it now has ids. A round GitHub no longer answers for is logged and
 * left on the fallback rather than retried forever.
 */
export async function backfillCommentIds(): Promise<void> {
  const state = await loadState();
  if (state.backfill?.commentIds === 1) return;

  const work: {
    key: string;
    repo: string;
    number: number;
    round: SubmittedReview;
  }[] = [];
  for (const record of state.intake) {
    for (const round of roundsOf(record.feedback)) {
      if (needsIds(round)) {
        work.push({
          key: record.key,
          repo: record.repo,
          number: record.number,
          round,
        });
      }
    }
  }

  if (work.length === 0) {
    await updateState((live) => {
      live.backfill = { ...live.backfill, commentIds: 1 };
    });
    return;
  }

  log(`backfilling comment ids for ${work.length} rounds`);
  let paired = 0;
  let failed = 0;
  for (const item of work) {
    try {
      const ok = await recordCommentIds(
        item.key,
        item.repo,
        item.number,
        item.round.id,
        item.round.anchors,
      );
      if (ok) paired++;
    } catch (error) {
      failed++;
      log(
        `${item.key}: review ${item.round.id} could not be paired: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Set even when some rounds could not be paired. A review GitHub will not
  // answer for today will not answer tomorrow either, and retrying it on every
  // start would spend a request a tick forever to learn the same thing.
  await updateState((live) => {
    live.backfill = { ...live.backfill, commentIds: 1 };
  });
  log(`comment ids backfilled: ${paired} paired, ${failed} unreadable`);
}

/** One file the new commits touched, and which of its lines they wrote. */
export interface ScopedFile {
  path: string;
  /** The RIGHT side lines, compacted. Empty on a file the range only deletes from. */
  lines: string;
}

/**
 * How much of the pull request the next QA run should read, and why.
 *
 * `whole` is the answer whenever the three facts a narrowed read needs do not
 * all hold, and it always carries a reason: a review that quietly narrows to the
 * wrong range is worse than one that reads everything, so every fallback says
 * out loud what it fell back from. AC-AQ7.
 */
export interface QaScope {
  mode: "whole" | "commits";
  /** The sentence the node and the ledger carry. */
  reason: string;
  /** The round the scope is measured from, 1-based, as `postedRounds` counts. */
  round: number;
  /** The round's head commit, or null when it recorded none. */
  base: string | null;
  /** The head as the last sweep read it, or null when no sweep has. */
  head: string | null;
  commits: number;
  files: ScopedFile[];
}

/** `12-18, 44`. A set of line numbers as a person would write it. */
function ranges(lines: Set<number>): string {
  const sorted = [...lines].sort((left, right) => left - right);
  const out: string[] = [];
  let start: number | null = null;
  let last: number | null = null;
  for (const line of sorted) {
    if (start === null || last === null) {
      start = line;
      last = line;
      continue;
    }
    if (line === last + 1) {
      last = line;
      continue;
    }
    out.push(start === last ? `${start}` : `${start}-${last}`);
    start = line;
    last = line;
  }
  if (start !== null && last !== null) {
    out.push(start === last ? `${start}` : `${start}-${last}`);
  }
  return out.join(", ");
}

function scopedFiles(range: CommitRange): ScopedFile[] {
  return range.files.map((path) => {
    const anchors: Anchors | undefined = range.anchors.get(path);
    return { path, lines: anchors ? ranges(anchors.RIGHT) : "" };
  });
}

/** Injected by the probes, which have no network and no business having one. */
export type Comparer = (
  repo: string,
  base: string,
  head: string,
) => Promise<CommitRange>;

/**
 * What the next QA run should read.
 *
 * Null before the first round, which is the ordinary case: there is nothing to
 * re-review, no guide file is written, and the run is byte identical to what it
 * was before any of this existed.
 *
 * A base is never dated from `submittedAt` and a commit list. Two pushes in one
 * minute picks the wrong one, and the whole point of storing `headSha` on the
 * round is that the base is a fact rather than an inference. A round without one
 * reads the whole diff and says so. AC-AQ7.
 *
 * Never throws. A comparer that cannot reach GitHub is one more reason to read
 * the whole diff, not a reason to fail the stage.
 */
export async function scopeFor(
  record: IntakeRecord,
  compare: Comparer = compareAnchors,
): Promise<QaScope | null> {
  const rounds = roundsOf(record.feedback);
  const last = rounds[rounds.length - 1];
  if (!last) return null;

  const round = rounds.length;
  const base = last.headSha ?? null;
  const head = record.pr?.headSha ?? null;
  const whole = (reason: string): QaScope => ({
    mode: "whole",
    reason,
    round,
    base,
    head,
    commits: 0,
    files: [],
  });

  if (!base) return whole(`round ${round} recorded no head commit`);
  if (!head) return whole("the head commit has not been read yet");
  if (base === head)
    return whole(`the head has not moved since round ${round}`);

  let range: CommitRange;
  try {
    range = await compare(record.repo, base, head);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return whole(`the two commits could not be compared: ${detail}`);
  }
  if (range.fault) return whole(range.fault);
  // Behind rather than ahead, which is a force push backwards: there is no new
  // work to narrow to, and narrowing to nothing would review nothing.
  if (range.commits === 0 || range.files.length === 0) {
    return whole(`no new commits since round ${round}`);
  }

  const commits = range.commits;
  return {
    mode: "commits",
    reason: `${commits} commit${commits === 1 ? "" : "s"} since round ${round}`,
    round,
    base,
    head,
    commits,
    files: scopedFiles(range),
  };
}

/**
 * One finding an earlier round posted, as the next run is told about it.
 *
 * The body is the thread's first comment, not the finding's: `commentBody` posts
 * James' typed replacement when he wrote one, so the thread holds what the author
 * actually read and the findings file may hold something else entirely.
 */
export interface CarriedFinding {
  path: string;
  /** Where the thread sits now. Null once the line has left the diff. */
  line: number | null;
  side: string;
  /** From the findings file, when it still holds the finding. Null otherwise. */
  severity: Severity | null;
  body: string;
  round: number;
  /** `unknown` is reported as `untouched`: both mean judge it again. AC-AQ5. */
  outcome: Exclude<FindingState, "unknown">;
  reply: string;
  replier: string | null;
  threadUrl: string;
}

/**
 * The previous rounds, as the agent needs them.
 *
 * Only anchors that actually went out are here, because `posted` is built from
 * the rounds. A finding James switched off was a decision not to say it, and
 * handing it back to the next run would re-raise something he declined once.
 *
 * An entry with no body anywhere is dropped rather than carried empty. A row
 * saying only "something was said at line 40" tells the agent to leave a finding
 * alone without saying which, which is worse than not mentioning it.
 *
 * The same anchor posted twice keeps the later posting: both name the same place,
 * and the live thread is the one the second round opened.
 */
export function carryFor(
  posted: PostedFinding[],
  previous: FindingsFile | null,
): CarriedFinding[] {
  const byKey = new Map<string, { severity: Severity; body: string }>();
  for (const finding of previous?.findings ?? []) {
    byKey.set(anchorKey(finding), {
      severity: finding.severity,
      body: finding.body,
    });
  }

  const carried = new Map<string, CarriedFinding>();
  for (const finding of posted) {
    const known = byKey.get(finding.anchor);
    const body = finding.body.trim() || (known?.body ?? "");
    if (body.length === 0) continue;
    carried.set(finding.anchor, {
      path: finding.path,
      line: finding.line,
      side: parseAnchor(finding.anchor)?.side ?? "RIGHT",
      severity: known?.severity ?? null,
      body,
      round: finding.round,
      outcome: shownState(finding.state),
      reply: finding.reply,
      replier: finding.replier,
      threadUrl: finding.url,
    });
  }
  return [...carried.values()];
}

/**
 * What binding needs from a review thread.
 *
 * Structural on purpose. `server/threads.ts` hands over its own nodes and this
 * module never imports it back, so the two do not form a cycle and the binding
 * can be probed with a literal rather than a GraphQL response.
 */
export interface BindableThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  /** GitHub's own LEFT or RIGHT, which is the vocabulary an anchor key uses. */
  diffSide: string;
  /** The line it was opened at, kept even after the thread goes outdated. */
  originalLine: number | null;
  line: number | null;
  comments: {
    /** The REST comment id. The first comment's is what a round stores. */
    databaseId: number | null;
    author: string | null;
    body: string;
    url: string;
    createdAt: string;
    /** The review that opened the thread, which equals the stored round id. */
    reviewId: number | null;
  }[];
}

/**
 * What became of one thread, in the fixed order two readers cannot disagree on.
 *
 * `resolved` first: somebody ticked it, and that outranks an argument still
 * running in the thread. `replied` next: a human answered, and what was said is
 * more use than the diff having shifted underneath it. `outdated` only then, and
 * `untouched` when none of the three holds.
 *
 * A reply is a comment after the first by somebody other than whoever opened the
 * thread. James answering his own comment is not the author addressing it.
 */
export function outcomeOf(thread: BindableThread): {
  state: FindingState;
  reply: string;
  replier: string | null;
} {
  const opener = thread.comments[0]?.author ?? null;
  const answer = thread.comments
    .slice(1)
    .find((comment) => comment.author && comment.author !== opener);
  const state: FindingState = thread.isResolved
    ? "resolved"
    : answer
      ? "replied"
      : thread.isOutdated
        ? "outdated"
        : "untouched";
  return { state, reply: answer?.body ?? "", replier: answer?.author ?? null };
}

/** The anchor an unbound finding reports as, so the screen still has a row. */
function unbound(anchor: string, round: number): PostedFinding {
  const parsed = parseAnchor(anchor);
  return {
    anchor,
    round,
    state: "unknown",
    path: parsed?.path ?? "",
    line: parsed?.line ?? null,
    threadId: null,
    resolved: false,
    url: "",
    body: "",
    reply: "",
    replier: null,
  };
}

function bound(
  anchor: string,
  round: number,
  thread: BindableThread,
): PostedFinding {
  const { state, reply, replier } = outcomeOf(thread);
  const first = thread.comments[0];
  return {
    anchor,
    round,
    state,
    path: thread.path,
    line: thread.line ?? thread.originalLine,
    threadId: thread.id,
    resolved: thread.isResolved,
    url: first?.url ?? "",
    body: first?.body ?? "",
    reply,
    replier,
  };
}

/**
 * Binds one round's anchors to the threads it opened, by comment id.
 *
 * Exact and self-validating: the id a round stored is the `databaseId` of the
 * thread's first comment, so a match is a match and a miss is reported rather
 * than guessed. Used only when the round stored an id for every anchor it sent,
 * because a short list means the order assumption did not hold. AC-AQ6.
 */
function bindById(
  round: SubmittedReview,
  number: number,
  threads: BindableThread[],
): PostedFinding[] {
  const byId = new Map<number, BindableThread>();
  for (const thread of threads) {
    const id = thread.comments[0]?.databaseId;
    if (id != null) byId.set(id, thread);
  }
  return (round.posted ?? []).map((comment) => {
    const thread = byId.get(comment.id);
    return thread
      ? bound(comment.anchor, number, thread)
      : unbound(comment.anchor, number);
  });
}

/**
 * Binds by where the comment sits: side, line and path, against the round's own
 * threads only.
 *
 * The fallback for every round stored before the ids were captured. It cannot
 * use the digest in the anchor key, because `commentBody` posts James' typed
 * replacement when he wrote one, so the posted text and the finding text
 * routinely differ: all three anchors on Quartr-App/web#9813 missed on digest
 * while matching exactly on the triple.
 *
 * A place holding more than one of either side binds neither, and both report
 * `unknown`. Three findings at one line is a real case, and naming the wrong one
 * resolved is worse than saying it could not be told. AC-AQ6.
 */
function bindByPosition(
  round: SubmittedReview,
  number: number,
  threads: BindableThread[],
): PostedFinding[] {
  const mine = threads.filter(
    (thread) => thread.comments[0]?.reviewId === round.id,
  );
  const byPlace = new Map<string, BindableThread[]>();
  for (const thread of mine) {
    const place = `${thread.diffSide}:${thread.originalLine}:${thread.path}`;
    byPlace.set(place, [...(byPlace.get(place) ?? []), thread]);
  }
  const anchorsAt = new Map<string, number>();
  for (const anchor of round.anchors) {
    const place = placeOf(anchor);
    if (place) anchorsAt.set(place, (anchorsAt.get(place) ?? 0) + 1);
  }

  return round.anchors.map((anchor) => {
    const place = placeOf(anchor);
    const candidates = place ? (byPlace.get(place) ?? []) : [];
    const ours = place ? (anchorsAt.get(place) ?? 0) : 0;
    const thread =
      candidates.length === 1 && ours === 1 ? candidates[0] : undefined;
    return thread ? bound(anchor, number, thread) : unbound(anchor, number);
  });
}

/**
 * Every finding radar posted, oldest round first, with what became of it.
 *
 * Rounds are numbered by their place in the submit order, which is the number
 * the wizard and the ledger already use.
 */
export function bindRounds(
  rounds: SubmittedReview[],
  threads: BindableThread[],
): PostedFinding[] {
  return rounds.flatMap((round, index) => {
    const posted = round.posted ?? [];
    const exact = posted.length > 0 && posted.length === round.anchors.length;
    return exact
      ? bindById(round, index + 1, threads)
      : bindByPosition(round, index + 1, threads);
  });
}
