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
 * Stages that may be passed over. Acknowledge is absent deliberately: it is where
 * the pull request and its summary are read, and the eyes reaction it posts is the
 * one outward signal that the review is under way. Skipping it would claim the
 * review started without anyone having looked. The map and the server both read
 * this, so what is offered and what is allowed cannot disagree.
 */
export const SKIPPABLE_STAGES: readonly ReviewStage[] = [
  "qa",
  "verification",
  "feedback",
];

/** What the run control says. The label is the verb, not the noun on the node. */
export const STAGE_ACTIONS: Record<ReviewStage, string> = {
  acknowledge: "Acknowledge",
  qa: "Run QA",
  verification: "Run verification",
  feedback: "Write feedback",
};

export const stageSchema = z.object({
  status: stageStatusSchema,
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

/** Dismiss has no stored stage: it reads straight off dismissedAt, so there is one truth. */
export function nodeStatus(record: Reviewable, node: MapNode): StageStatus {
  if (node === "dismiss") return record.dismissedAt ? "done" : "pending";
  return reviewOf(record)[node].status;
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

/** The first node still outstanding, or null once the whole pipeline is settled. AC-J4. */
export function currentNode(record: Reviewable): MapNode | null {
  return (
    MAP_NODES.find((node) => {
      const status = nodeStatus(record, node);
      return status !== "done" && status !== "skipped";
    }) ?? null
  );
}
