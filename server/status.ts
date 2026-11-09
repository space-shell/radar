import { roundsOf } from "../shared/feedback";
import type { IntakeRecord, PullRequestStatus } from "../shared/inbox";
import { graphql } from "./api";
import { log } from "./log";
import { loadState, updateState } from "./state";

/** One query covers the whole inbox. The cap is what stops it growing past that. */
const MAX_RECORDS = 40;
/** A pull request with more opinionated reviewers than this does not need a badge. */
const MAX_REVIEWS = 20;

interface ReviewNode {
  state: string;
  author: { login: string } | null;
}

interface PullRequestNode {
  state: string;
  isDraft: boolean;
  reviewDecision: string | null;
  /**
   * The head commit. A scalar on `pullRequest`, so it costs zero extra nodes on
   * a forty way document, which is what rules out `commits(last: 1)`.
   */
  headRefOid: string;
  latestOpinionatedReviews: { nodes: ReviewNode[] };
}

/**
 * What the sweep knows about a record that the query does not answer.
 *
 * Both stamps below need it: a change is only a change against what was stored
 * last time, and both are measured against the last round rather than against
 * the previous tick.
 */
interface Carry {
  /** The status this record carried into the sweep, if it had one. */
  previous: PullRequestStatus | undefined;
  /** When the last round went out, or undefined when none has. */
  lastRoundAt: string | undefined;
  /** Whether GitHub still lists James as a requested reviewer. */
  requested: boolean;
}

type Payload = {
  viewer: { login: string };
} & Record<string, { pullRequest: PullRequestNode | null } | undefined>;

/**
 * Which records are worth a status. Archived ones are finished by definition, and
 * dismissed ones sort last so a long dismissed list cannot crowd the active rows
 * out of the cap.
 */
function subjects(records: IntakeRecord[]): IntakeRecord[] {
  return records
    .filter((record) => record.state !== "archived")
    .sort(
      (left, right) =>
        Number(Boolean(left.dismissedAt)) - Number(Boolean(right.dismissedAt)),
    )
    .slice(0, MAX_RECORDS);
}

/**
 * Aliased one repository block per record, so the whole inbox costs one request
 * rather than two per row. `latestOpinionatedReviews` is the field that answers
 * the question: it carries one APPROVED or CHANGES_REQUESTED per reviewer, with
 * superseded reviews already dropped.
 */
function document(records: IntakeRecord[]): string {
  const blocks = records.map((record, index) => {
    const [owner, name] = record.repo.split("/");
    return `  r${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
    pullRequest(number: ${record.number}) {
      state
      isDraft
      reviewDecision
      headRefOid
      latestOpinionatedReviews(first: ${MAX_REVIEWS}) {
        nodes { state author { login } }
      }
    }
  }`;
  });
  return `query {\n  viewer { login }\n${blocks.join("\n")}\n}\n`;
}

function stateOf(raw: string): PullRequestStatus["state"] {
  if (raw === "MERGED") return "merged";
  if (raw === "CLOSED") return "closed";
  return "open";
}

function decisionOf(raw: string | null): PullRequestStatus["decision"] {
  if (raw === "APPROVED") return "approved";
  if (raw === "CHANGES_REQUESTED") return "changes_requested";
  if (raw === "REVIEW_REQUIRED") return "review_required";
  return null;
}

/**
 * When to stamp `headMovedAt`: the head differs from a sha this plugin had
 * already stored, and a round has gone out. No stored sha means the first
 * observation, which records the sha and says nothing: a record that has been on
 * disk since before `headSha` existed has not moved, it has merely been read.
 */
function movedAt(
  node: PullRequestNode,
  { previous, lastRoundAt }: Carry,
  now: string,
): string | undefined {
  if (!lastRoundAt || !previous?.headSha) return previous?.headMovedAt;
  if (previous.headSha === node.headRefOid) return previous.headMovedAt;
  return now;
}

/**
 * When to stamp `rerequestedAt`: James is on the request list, a round has gone
 * out, and the stamp already held is older than that round.
 *
 * The last clause is the latch. A request list that never clears, which is what
 * happens if submitting a review does not retire GitHub's pending request, then
 * costs one mark per round rather than one per minute, and opening the record
 * clears it because `rerequested` tests against the round too.
 */
function requestedAt(
  { previous, lastRoundAt, requested }: Carry,
  now: string,
): string | undefined {
  const held = previous?.rerequestedAt;
  if (!requested || !lastRoundAt) return held;
  if (held && Date.parse(held) > Date.parse(lastRoundAt)) return held;
  return now;
}

function statusOf(
  node: PullRequestNode,
  viewer: string,
  checkedAt: string,
  carry: Carry,
): PullRequestStatus {
  const moved = movedAt(node, carry, checkedAt);
  const asked = requestedAt(carry, checkedAt);
  const reviews = node.latestOpinionatedReviews.nodes;
  const others = reviews.filter(
    (review) => review.author && review.author.login !== viewer,
  );
  const own = reviews.find((review) => review.author?.login === viewer);

  return {
    state: stateOf(node.state),
    isDraft: node.isDraft,
    decision: decisionOf(node.reviewDecision),
    approvedBy: others
      .filter((review) => review.state === "APPROVED")
      .map((review) => review.author!.login),
    blockedBy: others
      .filter((review) => review.state === "CHANGES_REQUESTED")
      .map((review) => review.author!.login),
    mine:
      own?.state === "APPROVED"
        ? "approved"
        : own?.state === "CHANGES_REQUESTED"
          ? "changes_requested"
          : null,
    checkedAt,
    headSha: node.headRefOid,
    // Written as absent rather than as a key holding undefined, so a record that
    // has never moved does not grow a null in `seen.json`.
    ...(moved ? { headMovedAt: moved } : {}),
    ...(asked ? { rerequestedAt: asked } : {}),
  };
}

/** When the last round went out, which is what both stamps latch against. */
function lastRoundAt(record: IntakeRecord): string | undefined {
  const rounds = roundsOf(record.feedback);
  return rounds[rounds.length - 1]?.submittedAt;
}

/**
 * Reads what GitHub says about every tracked pull request and stores it on the
 * record, so a merged one or one another reviewer has already approved is visible
 * on the inbox row rather than only after opening it. AC-M1, AC-M2.
 *
 * It only ever writes `record.pr`. Nothing here dismisses, archives or advances a
 * stage: what to do about a settled row stays James' press. AC-M6. The two
 * re-review stamps live inside `record.pr` for that reason, and a head that has
 * moved starts no stage of its own: it marks the row and waits. AC-AQ1.
 *
 * `requested` is the key set `searchReviewRequests` already produced on this
 * tick, passed in rather than fetched, so the latch costs no extra request. It
 * defaults to empty, which stamps nothing: a caller that does not know cannot
 * claim the author asked again.
 */
export async function refreshStatuses(
  requested: ReadonlySet<string> = new Set(),
): Promise<void> {
  const snapshot = await loadState();
  const wanted = subjects(snapshot.intake);
  if (wanted.length === 0) return;

  const { data, errors } = await graphql<Payload>(document(wanted));
  // A per-alias failure nulls that one record and leaves the rest readable, so it
  // is logged rather than thrown. A whole query that failed has no data at all.
  for (const error of errors) log(`status: ${error.message}`);
  if (!data?.viewer?.login) {
    log("status: GitHub returned no data");
    return;
  }

  const viewer = data.viewer.login;
  const checkedAt = new Date().toISOString();
  const found = new Map<string, PullRequestStatus>();
  for (const [index, record] of wanted.entries()) {
    const node = data[`r${index}`]?.pullRequest;
    if (!node) continue;
    found.set(
      record.key,
      statusOf(node, viewer, checkedAt, {
        previous: record.pr,
        lastRoundAt: lastRoundAt(record),
        requested: requested.has(record.key),
      }),
    );
  }
  if (found.size === 0) return;

  await updateState((state) => {
    for (const record of state.intake) {
      const status = found.get(record.key);
      if (status) record.pr = status;
    }
  });

  const settled = [...found.values()].filter(
    (status) => status.state !== "open" || status.approvedBy.length > 0,
  ).length;
  log(`status: ${found.size} read, ${settled} need nothing further`);
}
