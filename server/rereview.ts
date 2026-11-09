import {
  parseAnchor,
  placeOf,
  roundsOf,
  type SubmittedReview,
} from "../shared/feedback";
import type { FindingState } from "../shared/findings";
import type { PostedFinding } from "../shared/threads";
import { call, githubError } from "./api";
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
