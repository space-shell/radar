import { z } from "zod";

export const stageStatusSchema = z.enum([
  "pending",
  "running",
  "done",
  "skipped",
  "failed",
]);
export type StageStatus = z.infer<typeof stageStatusSchema>;

/** Stages holding their own stored lifecycle. Dismiss is derived from dismissedAt. */
export const REVIEW_STAGES = [
  "acknowledge",
  "qa",
  "verification",
  "feedback",
] as const;
export type ReviewStage = (typeof REVIEW_STAGES)[number];

/** Stages that run through the intake agent, so a daemon restart can strand them. */
export const AGENT_STAGES: readonly ReviewStage[] = ["qa", "verification"];

/**
 * Stages with an action wired behind them. The map offers Run only for these, so a
 * button never appears for something that would answer "not built yet". Feedback
 * joins them with group G.
 */
export const RUNNABLE_STAGES: readonly ReviewStage[] = [
  "acknowledge",
  "qa",
  "verification",
];

/** Stages whose effect can be taken back. Acknowledge removes its reaction. AC-D6. */
export const UNDOABLE_STAGES: readonly ReviewStage[] = ["acknowledge"];

/**
 * Stages that may be passed over. Two are absent deliberately.
 *
 * Acknowledge is where the pull request and its summary are read, and the eyes
 * reaction it posts is the one outward signal that the review is under way.
 * Skipping it would claim the review started without anyone having looked.
 *
 * Feedback is where the review is written, which is the whole point of the
 * pipeline. A record that can be marked finished with nothing said is a record
 * whose map lies about what was done, and "this one needs nothing from me" is
 * already Dismiss. AC-AG7.
 *
 * The map and the server both read this, so what is offered and what is allowed
 * cannot disagree.
 */
export const SKIPPABLE_STAGES: readonly ReviewStage[] = ["qa", "verification"];

/** What the run control says. The label is the verb, not the noun on the node. */
export const STAGE_ACTIONS: Record<ReviewStage, string> = {
  acknowledge: "Acknowledge",
  qa: "Run QA",
  verification: "Run verification",
  feedback: "Write feedback",
};

export const stageSchema = z.object({
  status: stageStatusSchema,
  /**
   * When the press landed, for a stage waiting on a busy agent.
   *
   * A sub-state of `running` rather than a sixth status, because a queued stage is
   * claimed: it holds the claim that stops a second press, and every rule that
   * tests `status === "running"` already means the right thing for it. A new enum
   * member would also blank the record for any reader on an older copy of this
   * schema, since zod rejects an unknown member where it merely strips an unknown
   * key. Cleared at promotion, when `startedAt` is written. AC-AF11.
   */
  queuedAt: z.string().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  error: z.string().optional(),
  /** What the stage produced, in a few words. "7 findings". Shown on the map. */
  note: z.string().optional(),
});
export type Stage = z.infer<typeof stageSchema>;

export const reviewSchema = z.object({
  acknowledge: stageSchema,
  qa: stageSchema,
  verification: stageSchema,
  feedback: stageSchema,
});
export type Review = z.infer<typeof reviewSchema>;

export function emptyReview(): Review {
  return {
    acknowledge: { status: "pending" },
    qa: { status: "pending" },
    verification: { status: "pending" },
    feedback: { status: "pending" },
  };
}

/** Fills gaps so a record written by an older schema reads without a migration. AC-I9. */
export function reviewOf(record: { review?: Partial<Review> }): Review {
  return { ...emptyReview(), ...record.review };
}

/** The five nodes the map draws. Dismiss is last and derived. */
export const MAP_NODES = [...REVIEW_STAGES, "dismiss"] as const;
export type MapNode = (typeof MAP_NODES)[number];

export const STAGE_LABELS: Record<MapNode, string> = {
  acknowledge: "Acknowledge",
  qa: "QA",
  verification: "Verification",
  feedback: "Feedback",
  dismiss: "Dismiss",
};

/** What a record looks like to the map. Both the row and the detail screen pass one. */
export interface Reviewable {
  dismissedAt?: string | null;
  review?: Partial<Review>;
}

/**
 * Whether the press has landed but the turn has not been sent.
 *
 * `status` stays `running` throughout, so this is the one place that distinguishes
 * the two. Dismiss has no stored stage and so can never be queued.
 */
export function isQueued(record: Reviewable, node: MapNode): boolean {
  if (node === "dismiss") return false;
  const stage = reviewOf(record)[node];
  return stage.status === "running" && stage.queuedAt != null;
}

/** Dismiss has no stored stage: it reads straight off dismissedAt, so there is one truth. */
export function nodeStatus(record: Reviewable, node: MapNode): StageStatus {
  if (node === "dismiss") return record.dismissedAt ? "done" : "pending";
  return reviewOf(record)[node].status;
}

/**
 * What the screen shows, which is one value wider than what is stored.
 *
 * `nodeStatus` stays five valued because the stage machine resolves at it, and a
 * sixth state there would need transitions duplicating `running`'s. The split
 * happens at the edge instead, where the only thing it changes is a glyph, a
 * border and a word.
 */
export type DisplayStatus = StageStatus | "queued";

export function displayStatus(
  record: Reviewable,
  node: MapNode,
): DisplayStatus {
  return isQueued(record, node) ? "queued" : nodeStatus(record, node);
}

/**
 * Whether anything after this stage has moved off pending. Undo is only offered
 * while the answer is no, so taking back an acknowledgement cannot leave a later
 * stage resting on something that is no longer true. The server and the map read
 * this same rule, so what is offered and what is allowed cannot disagree. AC-D6.
 */
export function laterStagesStarted(
  record: Reviewable,
  stage: ReviewStage,
): boolean {
  const review = reviewOf(record);
  return REVIEW_STAGES.slice(REVIEW_STAGES.indexOf(stage) + 1).some(
    (later) => review[later].status !== "pending",
  );
}

/**
 * Whether a stage before this one has still to leave pending.
 *
 * What makes a stage inert, replacing "is it the current node". The two agree
 * everywhere the old rule allowed anything, because a current node has every
 * earlier stage done or skipped, which is a stricter claim than having left
 * pending. Where they part is the case the queue created: QA running or queued
 * leaves verification out of turn forever, and verification is exactly the press
 * worth queueing behind it. The server never had the currency rule, so this is
 * the map catching up with what the claim already allowed. AC-AG1, AC-AG2.
 *
 * Dismiss sits after every stage and is never blocked: it is how a record is put
 * down at any point, including before anything has been done to it.
 */
export function stageBlocked(record: Reviewable, node: MapNode): boolean {
  if (node === "dismiss") return false;
  const review = reviewOf(record);
  return REVIEW_STAGES.slice(0, REVIEW_STAGES.indexOf(node)).some(
    (earlier) => review[earlier].status === "pending",
  );
}

/** The first node still outstanding, or null once the whole pipeline is settled. AC-J4. */
export function currentNode(record: Reviewable): MapNode | null {
  return (
    MAP_NODES.find((node) => {
      const status = nodeStatus(record, node);
      return status !== "done" && status !== "skipped";
    }) ?? null
  );
}
