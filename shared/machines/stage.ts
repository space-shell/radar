import { and, setup } from "../vendor/xstate.mjs";
import {
  RUNNABLE_STAGES,
  SKIPPABLE_STAGES,
  UNDOABLE_STAGES,
  laterStagesStarted,
  nodeStatus,
  type Reviewable,
  type ReviewStage,
} from "../review";

export interface StageContext {
  stage: ReviewStage;
  /** The first node the pipeline has not settled. Only it can be moved on. AC-J4. */
  isCurrent: boolean;
  /** Anything after this stage has left pending, which withdraws Undo. AC-D6. */
  laterMoved: boolean;
}

export type StageEvent =
  { type: "RUN" } | { type: "SKIP" } | { type: "REOPEN" } | { type: "UNDO" };

/**
 * The order controls are offered in, which is also the order they were built in
 * before this was a machine. Asking the machine which of these it will accept
 * reproduces every row of the table below, including the order within a row.
 */
export const STAGE_EVENTS: readonly StageEvent["type"][] = [
  "RUN",
  "UNDO",
  "REOPEN",
  "SKIP",
];

/**
 * What a stage will accept right now.
 *
 * This was six rows of a table written as a conditional cascade in the detail
 * view, in three different syntactic shapes, with the availability of Skip and
 * Undo decided by two `includes` calls forty lines further up. The rows:
 *
 * | status  | current | offered                |
 * | ------- | ------- | ---------------------- |
 * | running | any     | nothing                |
 * | done    | any     | Undo, else Reopen      |
 * | skipped | any     | Run, Reopen            |
 * | failed  | any     | Run, Reopen, Skip      |
 * | pending | yes     | Run, Skip              |
 * | pending | no      | nothing                |
 *
 * The machine does not own the status: the server does, and a stage reaches
 * `done` through the action that performed it, never through a press on this
 * screen. So it is resolved at the stored status and asked what it will accept,
 * rather than started and driven. `machine.resolveState` is the whole binding.
 *
 * The one rule worth naming, because the cascade could not: Reopen on a settled
 * stage is guarded by the negation of Undo's guard. A completed stage offers one
 * control, and which one it is depends on whether a stage further down the map
 * has moved. The two guards being each other's negation is what keeps that from
 * being an accident.
 */
export const stageMachine = setup({
  types: {} as {
    context: StageContext;
    events: StageEvent;
    input: StageContext;
  },
  guards: {
    /** Something is wired behind it, so Run would not answer "not built yet". */
    runnable: ({ context }) => RUNNABLE_STAGES.includes(context.stage),
    /** Acknowledge is absent: it is where the pull request is read. AC-O1, AC-O2. */
    skippable: ({ context }) => SKIPPABLE_STAGES.includes(context.stage),
    /** Undo is offered while its effect can still be taken back cleanly. AC-D6. */
    undoable: ({ context }) =>
      UNDOABLE_STAGES.includes(context.stage) && !context.laterMoved,
    notUndoable: ({ context }) =>
      !UNDOABLE_STAGES.includes(context.stage) || context.laterMoved,
    reached: ({ context }) => context.isCurrent,
  },
}).createMachine({
  id: "stage",
  context: ({ input }) => input,
  initial: "pending",
  states: {
    // Only the stage the pipeline has actually reached can be moved on, so an
    // untouched stage further down offers nothing rather than a control that
    // would be refused.
    pending: {
      on: {
        RUN: { target: "running", guard: and(["runnable", "reached"]) },
        SKIP: { target: "skipped", guard: and(["skippable", "reached"]) },
      },
    },
    /** A turn is in flight. Nothing on this screen can interrupt it. */
    running: {},
    done: {
      on: {
        UNDO: { target: "pending", guard: "undoable" },
        REOPEN: { target: "pending", guard: "notUndoable" },
      },
    },
    skipped: {
      on: {
        RUN: { target: "running", guard: "runnable" },
        REOPEN: { target: "pending" },
      },
    },
    failed: {
      on: {
        RUN: { target: "running", guard: "runnable" },
        REOPEN: { target: "pending" },
        SKIP: { target: "skipped", guard: "skippable" },
      },
    },
  },
});

/**
 * Which events the stage will accept, in the order their controls are drawn.
 *
 * The currency check is a guard on `pending`'s own transitions rather than an
 * `always` into a waiting state: `resolveState` resolves the value it is given
 * and runs no microsteps, so an eventless transition would never fire here.
 */
export function stageEvents(
  record: Reviewable,
  stage: ReviewStage,
  isCurrent: boolean,
): StageEvent["type"][] {
  const context: StageContext = {
    stage,
    isCurrent,
    laterMoved: laterStagesStarted(record, stage),
  };
  const snapshot = stageMachine.resolveState({
    value: nodeStatus(record, stage),
    context,
  });
  return STAGE_EVENTS.filter((type) => snapshot.can({ type }));
}
