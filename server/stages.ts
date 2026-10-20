import type { IntakeRecord } from "../shared/inbox";
import { inspectAgent } from "./agent";
import { loadState, updateState } from "./state";
import {
  AGENT_STAGES,
  REVIEW_STAGES,
  SKIPPABLE_STAGES,
  STAGE_LABELS,
  reviewOf,
  type ReviewStage,
} from "../shared/review";
import { keyUrl, note as ledger } from "./ledger";
import { log } from "./log";
import { inLane, isLaneCancelled } from "./queue";

/**
 * Stages this process is running or holding a press for.
 *
 * In memory on purpose. It is a fact about right now, so a restart clearing it is
 * the truth rather than a loss: the lane it describes went with the process, and
 * `reconcileStages` returns anything it was holding to pending.
 *
 * Two readers. `reconcileStages` must not fail a stage this process is running,
 * which is the whole of defect 2: the agent reads `idle` throughout the prep
 * window between the claim and the turn, and failing it there handed the node a
 * Run control for work already under way, so a second press claimed the stage and
 * two turns landed on one agent. `setStageStatus` reads it to cancel a press that
 * has not been sent yet.
 */
interface InFlight {
  controller: AbortController;
  /** Set synchronously at promotion. Once true, cancelling is too late. */
  started: boolean;
  /** Resolves once the outcome is on disk, so a cancel can wait for the write. */
  settled: Promise<void>;
}

const inFlight = new Map<string, InFlight>();

const stageKey = (key: string, stage: ReviewStage): string =>
  `${key}\u0000${stage}`;

export function stageInFlight(key: string, stage: ReviewStage): boolean {
  return inFlight.has(stageKey(key, stage));
}

/** How long a cancel waits for the settle before answering anyway. */
const CANCEL_SETTLE_MS = 2_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

/**
 * Unsticks stages left `running` by a daemon restart. It never advances anything:
 * a stage only reaches `done` through the action that performed it. AC-C5, AC-C7.
 */
export async function reconcileStages(): Promise<void> {
  const snapshot = await loadState();

  // Decide first. An inspect can take 30 seconds and must not run under the lock. R2.
  const decisions: { key: string; stage: ReviewStage; error?: string }[] = [];
  for (const record of snapshot.intake) {
    const review = reviewOf(record);
    for (const name of REVIEW_STAGES) {
      if (review[name].status !== "running") continue;

      // This process is running it. The agent is idle for the whole prep window
      // between the claim and the turn, so an inspect here is not evidence the
      // stage died, and acting on it would start a second turn on the same agent.
      if (stageInFlight(record.key, name)) continue;

      // A press that was queued when the process ended. The queue was memory, so
      // nothing is left to promote it. Pending rather than failed, and with no
      // error, because the turn was never sent. AC-AF20.
      if (review[name].queuedAt) {
        decisions.push({ key: record.key, stage: name });
        continue;
      }

      if (!AGENT_STAGES.includes(name)) {
        // Acknowledge and Feedback run inside one RPC call, so a restart means it
        // never committed. Back to pending rather than failed.
        decisions.push({ key: record.key, stage: name });
        continue;
      }

      // Only an agent can finish these, so a stopped agent means the stage died with it.
      if (!record.agentId) {
        decisions.push({
          key: record.key,
          stage: name,
          error: "the record has no agent",
        });
        continue;
      }

      // An unreadable agent leaves the stage running. The next tick asks again. R9.
      const facts = await inspectAgent(record.agentId);
      if (facts?.liveness !== "stopped") continue;
      decisions.push({
        key: record.key,
        stage: name,
        error: "the agent stopped before the stage reported",
      });
    }
  }

  if (decisions.length === 0) return;

  await updateState((state) => {
    for (const decision of decisions) {
      const record = state.intake.find(
        (candidate) => candidate.key === decision.key,
      );
      if (!record) continue;

      const review = reviewOf(record);
      // A press may have moved the stage on while the inspects ran, or claimed it
      // afresh. Both checks are the ones made above, repeated against the state
      // this write is about to change.
      if (review[decision.stage].status !== "running") continue;
      if (stageInFlight(decision.key, decision.stage)) continue;

      review[decision.stage] = decision.error
        ? {
            ...review[decision.stage],
            status: "failed",
            endedAt: new Date().toISOString(),
            error: decision.error,
          }
        : { status: "pending" };
      record.review = review;
      log(
        `unstuck ${record.key} stage ${decision.stage} as ${review[decision.stage].status}`,
      );
    }
  });
}

export interface StageResult {
  ok: boolean;
  error?: string;
}

/**
 * The two transitions with no side effects: skipping a stage and clearing one back
 * to pending. Everything that touches GitHub or an agent lives in its own action.
 */
export async function setStageStatus(
  key: string,
  stage: ReviewStage,
  status: "pending" | "skipped",
): Promise<StageResult> {
  /*
   * Cancelling a queued press. It is the same transition as reopening, "put this
   * stage back to pending", so it reuses this call rather than adding an RPC.
   *
   * Nothing is awaited between reading `started` and aborting, so the two cannot
   * interleave: promotion sets `started` synchronously, and a lane ignores an
   * abort once the body is running. AC-AF15, AC-AF16, AC-AF17.
   */
  const queued = inFlight.get(stageKey(key, stage));
  if (queued && !queued.started) {
    if (status === "skipped") {
      return {
        ok: false,
        error: `${STAGE_LABELS[stage]} is queued. Cancel it first`,
      };
    }
    queued.controller.abort();
    // The settle is the only writer of this stage, so this waits for its write
    // rather than racing it with one of our own. Bounded, because the host
    // abandons the call at thirty seconds and a wedged settle must not take it
    // there; the write still lands, a beat after the answer.
    await Promise.race([queued.settled, wait(CANCEL_SETTLE_MS)]);
    return { ok: true };
  }
  if (queued && status === "pending") {
    return { ok: false, error: "the turn has already started" };
  }

  const result = await updateState<StageResult>((state) => {
    const record = state.intake.find((candidate) => candidate.key === key);
    if (!record) return { ok: false, error: "no such record" };

    const review = reviewOf(record);
    if (review[stage].status === "running") {
      return { ok: false, error: `${stage} is running` };
    }
    // The map builds no Skip for a stage outside SKIPPABLE_STAGES, and this is the
    // same rule on the other side of the RPC, so a call that bypassed the screen
    // gets the same answer the screen would have given. AC-O2.
    if (status === "skipped" && !SKIPPABLE_STAGES.includes(stage)) {
      return {
        ok: false,
        error: `${STAGE_LABELS[stage]} cannot be skipped`,
      };
    }

    review[stage] =
      status === "skipped"
        ? { status, endedAt: new Date().toISOString() }
        : { status };
    record.review = review;
    return { ok: true };
  });

  if (result.ok) {
    log(`${key} stage ${stage} set to ${status}`);
    ledger({
      source: "github",
      subject: key,
      what: `${stage} ${status === "skipped" ? "skipped" : "reopened"}`,
      url: keyUrl(key),
    });
  }
  return result;
}

export interface StageRunOptions {
  /** Where the stage lands on success. An undo action lands back on pending. */
  settleAs?: "done" | "pending";
  /**
   * A reason to refuse, or null to proceed. Checked while the claim lock is held,
   * so the answer cannot go stale between the check and the side effect.
   */
  allow?(record: IntakeRecord): string | null;
  /**
   * Answers the press once the stage is claimed, leaving the work running.
   *
   * For stages that send an agent a turn. The plugin host abandons any RPC at 30
   * seconds, so a handler that waited out a twenty minute turn reported a
   * transport failure every time while the turn carried on and settled the stage
   * behind it. The claim is already on disk by then, so the map shows `running`
   * and the stage's own outcome is what reports the result. AC-Q1, AC-Q2.
   */
  background?: boolean;
  /**
   * The agent this stage's work will send a turn to, so the press can wait for
   * that agent instead of being refused.
   *
   * It gates the whole stage body, not the turn inside it. Gating the turn would
   * be destructive: QA clears its findings file before asking, so a press on a
   * busy agent would destroy the findings and then wait, and verification reads
   * the preview URL before asking, so it would hold one across the wait and name a
   * deployment built from code the worktree no longer has. AC-F3, AC-F5.
   *
   * A null `agentId` means the work will make its own agent, so nothing can be
   * queued on it and it never waits.
   */
  gate?(record: IntakeRecord): Promise<{
    agentId: string | null;
    ready: () => Promise<boolean>;
  }>;
}

/**
 * Promotion: the turn is about to be sent, so the stage stops being queued.
 *
 * `startedAt` dates from here rather than from the press. The twenty minute turn
 * timeout counts from it, and `qa.ts` uses it to decide whether a findings file on
 * disk belongs to this run, and both of those mean the turn rather than the press.
 * The old `error` goes with it, so a re-run never shows the last run's fault under
 * a running node. AC-AF12.
 */
async function markStarted(key: string, stage: ReviewStage): Promise<void> {
  await updateState((state) => {
    const record = state.intake.find((candidate) => candidate.key === key);
    if (!record) return;
    const review = reviewOf(record);
    if (review[stage].status !== "running") return;
    review[stage] = { status: "running", startedAt: new Date().toISOString() };
    record.review = review;
  });
  log(`${key} stage ${stage} running`);
}

/**
 * Claims a stage, does the work with the lock released, then records the outcome.
 *
 * The claim is what stops two presses running the same side effect twice, and it is
 * taken under the lock so both cannot see `pending` at once. The work itself runs
 * outside the lock because it reaches GitHub, and a held lock would block every
 * other press for the length of that call. R2.
 *
 * Reachable only from an RPC handler, which is reachable only from a press. No tick
 * calls this, which is what keeps every GitHub write attended. AC-I2.
 */
export async function runStage(
  key: string,
  stage: ReviewStage,
  work: (record: IntakeRecord) => Promise<string | void>,
  options: StageRunOptions = {},
): Promise<StageResult> {
  const settleAs = options.settleAs ?? "done";

  const claim = await updateState<{ record: IntakeRecord } | StageResult>(
    (state) => {
      const record = state.intake.find((candidate) => candidate.key === key);
      if (!record) return { ok: false, error: "no such record" };

      const review = reviewOf(record);
      if (review[stage].status === "running")
        return { ok: false, error: `${stage} is running` };

      const refusal = options.allow?.(record);
      if (refusal) return { ok: false, error: refusal };

      // Built rather than spread, so a re-run cannot carry the last run's error or
      // note forward under a running node. A gated stage is queued until the lane
      // promotes it, and the two fields are exclusive: exactly one is ever set.
      const at = new Date().toISOString();
      review[stage] = options.gate
        ? { status: "running", queuedAt: at }
        : { status: "running", startedAt: at };
      record.review = review;
      return { record: structuredClone(record) };
    },
  );

  if (!("record" in claim)) return claim;
  const claimed = claim.record;
  log(`${key} stage ${stage} ${options.gate ? "queued" : "running"}`);

  // Registered with no await since the claim landed, so the first thing that can
  // read the state this claim wrote also finds the stage here.
  let release = (): void => undefined;
  const token: InFlight = {
    controller: new AbortController(),
    started: false,
    settled: new Promise<void>((resolve) => {
      release = resolve;
    }),
  };
  inFlight.set(stageKey(key, stage), token);

  const perform = async (): Promise<StageResult> => {
    let failure: string | null = null;
    let cancelled = false;
    let note: string | undefined;

    try {
      /*
       * `started` is set in the synchronous prefix, before the first await, so the
       * lane invoking this is the same tick in which every other reader learns the
       * press can no longer be cancelled.
       */
      const begin = async (): Promise<string | void> => {
        token.started = true;
        if (options.gate) await markStarted(key, stage);
        return work(claimed);
      };

      try {
        const gate = options.gate ? await options.gate(claimed) : null;
        note =
          (await (gate?.agentId
            ? inLane(gate.agentId, gate.ready, begin, token.controller.signal)
            : begin())) || undefined;
      } catch (error) {
        if (!token.started && isLaneCancelled(error)) cancelled = true;
        else failure = error instanceof Error ? error.message : String(error);
      }

      await updateState((state) => {
        const record = state.intake.find((candidate) => candidate.key === key);
        if (!record) return;

        const review = reviewOf(record);
        // The reconciler may have unstuck this stage while the work ran. Its verdict
        // is older than ours, so ours wins, but only for the stage we claimed.
        const endedAt = new Date().toISOString();
        const startedAt = review[stage].startedAt;
        // Built rather than spread, so a previous run's error cannot survive into a
        // successful one, nor its note into a failure. A cancelled press leaves
        // nothing behind at all: no turn was sent, so there is nothing to report.
        review[stage] = cancelled
          ? { status: "pending" }
          : failure
            ? { status: "failed", startedAt, endedAt, error: failure }
            : settleAs === "done"
              ? { status: "done", startedAt, endedAt, note }
              : { status: "pending" };
        record.review = review;
      });

      const outcome = cancelled
        ? "cancelled before it started"
        : failure
          ? `failed: ${failure}`
          : settleAs;
      log(`${key} stage ${stage} ${outcome}`);
      // What the stage produced, not that a control was pressed: "qa done, 7 findings"
      // is the line worth reading back in a week.
      ledger({
        source: "github",
        subject: key,
        what: cancelled
          ? `${stage} cancelled before it started`
          : failure
            ? `${stage} failed: ${failure}`
            : settleAs === "pending"
              ? `${stage} undone`
              : `${stage} done${note ? `, ${note}` : ""}`,
        url: keyUrl(key),
      });
      return failure ? { ok: false, error: failure } : { ok: true };
    } finally {
      // After the settle, so a cancel waiting on `settled` reads the write it asked
      // for, and so nothing can find the stage in flight once it is not.
      inFlight.delete(stageKey(key, stage));
      release();
    }
  };

  if (!options.background) return perform();
  // Nothing is waiting on this one. The stage's own status carries the outcome.
  void perform();
  return { ok: true };
}
