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
  latestOpinionatedReviews: { nodes: ReviewNode[] };
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

function statusOf(
  node: PullRequestNode,
  viewer: string,
  checkedAt: string,
): PullRequestStatus {
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
  };
}

/**
 * Reads what GitHub says about every tracked pull request and stores it on the
 * record, so a merged one or one another reviewer has already approved is visible
 * on the inbox row rather than only after opening it. AC-M1, AC-M2.
 *
 * It only ever writes `record.pr`. Nothing here dismisses, archives or advances a
 * stage: what to do about a settled row stays James' press. AC-M6.
 */
export async function refreshStatuses(): Promise<void> {
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
    found.set(record.key, statusOf(node, viewer, checkedAt));
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
