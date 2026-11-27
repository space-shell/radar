import type { IntakeRecord } from "../shared/inbox";
import { reviewOf } from "../shared/review";
import { keyUrl, note as ledger } from "./ledger";
import { log } from "./log";
import { runQa } from "./qa";
import { loadState, updateState } from "./state";
import type { Paseo } from "./turn";
import { runVerification } from "./verification";

/**
 * What a record's first summary starts on its own, once: QA when `autoQa` is on,
 * and verification as the summary decides when `autoVerify` is on.
 *
 * Both go through the press's own path, so both queue behind a busy agent and
 * both can be cancelled from the map. Neither writes to GitHub: QA is started
 * without its eyes reaction and verification has no claim side effect. AC-I2.
 */
type AutoStage = "qa" | "verification";

/** QA first, so that on a shared agent its turn is queued ahead. AC-AZ4. */
const AUTO_STAGES: readonly AutoStage[] = ["qa", "verification"];

/** What the summary's verification decision does to the stage, or nothing. */
export type VerificationDecision = "run" | "skip" | null;

/** What the map says on a stage the summary passed over. */
export const NOT_REQUIRED_NOTE = "not required, per the summary";

/**
 * The stage exactly as intake left it: never pressed, never queued, never run,
 * never skipped. Anything else is a decision James has already made, and
 * nothing automatic outranks it.
 */
function untouched(record: IntakeRecord, name: AutoStage): boolean {
  const stage = reviewOf(record)[name];
  return (
    stage.status === "pending" &&
    !stage.queuedAt &&
    !stage.startedAt &&
    !stage.endedAt
  );
}

/** A record that can still take a turn and that James has not put down. */
function live(record: IntakeRecord): boolean {
  return (
    !record.dismissedAt && record.state === "created" && Boolean(record.agentId)
  );
}

export interface DecisionContext {
  /** The stage's switch: `autoQa` or `autoVerify`. */
  enabled: boolean;
  /** The summary just stored is the record's first. */
  first: boolean;
}

/**
 * The whole rule for what a summary does to verification, read off the record
 * after the summary is stored.
 *
 * Only the first summary acts. A re-summary is what follows a push or a press,
 * and a verification turn can hold a browser for a quarter of an hour, so a
 * pull request that moves must not buy another one on its own. The marker is the
 * second lock on the same door: a record that was ever decided is never decided
 * again, whatever later clears or replaces its summary. AC-AY1, AC-AY2.
 *
 * No decision in the summary is no action: the stage stays a press, as it was
 * before this existed. AC-AY3.
 */
export function verificationDecision(
  record: IntakeRecord,
  context: DecisionContext,
): VerificationDecision {
  if (!context.enabled || !context.first) return null;
  if (record.autoVerification) return null;
  const decision = record.summary?.verification;
  if (!decision) return null;
  if (!live(record) || !untouched(record, "verification")) return null;
  return decision.required ? "run" : "skip";
}

/**
 * Whether the first summary starts QA. Nothing in the summary is read: its
 * landing is the moment the record is known to be worth a turn, and QA is where
 * every review starts. The rest is the verification rule's: the first summary
 * only, once only, and never over a stage James has already touched. AC-AZ1.
 */
export function qaDecision(
  record: IntakeRecord,
  context: DecisionContext,
): boolean {
  if (!context.enabled || !context.first) return false;
  if (record.automaticQa) return false;
  return live(record) && untouched(record, "qa");
}

/** Records a QA decision, inside the caller's `updateState`. Only ever a run. */
export function applyQaDecision(
  record: IntakeRecord,
  decision: boolean,
  now: string,
): void {
  if (decision) record.automaticQa = { decidedAt: now };
}

/**
 * Writes a decision onto the record, inside the caller's `updateState`.
 *
 * A skip is carried out here and now, because it is one field and needs no
 * agent. A run is only recorded: sending its turn needs a Paseo handle, which
 * the floor pass does not have, so `startDecidedStages` sends it from whichever
 * path next holds one.
 */
export function applyVerificationDecision(
  record: IntakeRecord,
  decision: VerificationDecision,
  now: string,
): void {
  if (!decision) return;
  if (decision === "run") {
    record.autoVerification = { decidedAt: now, required: true };
    return;
  }
  record.autoVerification = { decidedAt: now, required: false, actedAt: now };
  const review = reviewOf(record);
  review.verification = {
    status: "skipped",
    endedAt: now,
    note: NOT_REQUIRED_NOTE,
  };
  record.review = review;
}

/** The ledger line for a skip the summary made. Written by the caller, after the lock. */
export function noteSkipped(key: string): void {
  log(`${key} verification skipped: the summary says it is not required`);
  ledger({
    source: "github",
    subject: key,
    what: "verification skipped: the summary says it is not required",
    url: keyUrl(key),
  });
}

/** A run decided and not yet asked for. */
function waiting(record: IntakeRecord, stage: AutoStage): boolean {
  if (stage === "qa")
    return Boolean(record.automaticQa && !record.automaticQa.actedAt);
  const mark = record.autoVerification;
  return Boolean(mark?.required && !mark.actedAt);
}

/** Marks a decision used, inside the caller's `updateState`. */
function spend(record: IntakeRecord, stage: AutoStage, now: string): void {
  if (stage === "qa")
    record.automaticQa = { ...record.automaticQa!, actedAt: now };
  else record.autoVerification = { ...record.autoVerification!, actedAt: now };
}

/** The press's own entry point for each stage, QA without its eyes. */
function start(stage: AutoStage, key: string, paseo: Paseo) {
  return stage === "qa"
    ? runQa(key, paseo, { automatic: true })
    : runVerification(key, paseo);
}

const QUEUED: Record<AutoStage, string> = {
  qa: "QA queued automatically: the first summary landed",
  verification: "verification queued: the summary says it is required",
};

const NAME: Record<AutoStage, string> = {
  qa: "QA",
  verification: "verification",
};

/**
 * Sends every decided run that has not been sent, once each.
 *
 * The decision is spent at the claim, whether or not it still applies by then:
 * a record James dismissed or ran by hand in the meantime is marked and left
 * alone, so nothing is waiting to fire the next time it changes. AC-AY4.
 *
 * One record's QA is sent before its verification, and each call returns only
 * once its stage holds a place in the agent's lane, so on a shared agent QA's
 * turn is queued first. AC-AZ4.
 *
 * Read first and written only when something is waiting, because this runs on
 * every settle pass and `updateState` rewrites the file whether or not it
 * changed anything.
 */
export async function startDecidedStages(paseo: Paseo): Promise<number> {
  const due = (record: IntakeRecord) =>
    AUTO_STAGES.some((stage) => waiting(record, stage));
  const { intake } = await loadState();
  if (!intake.some(due)) return 0;

  const now = new Date().toISOString();
  const runs = await updateState((state) => {
    const found: { key: string; stage: AutoStage }[] = [];
    for (const record of state.intake) {
      for (const stage of AUTO_STAGES) {
        if (!waiting(record, stage)) continue;
        spend(record, stage, now);
        if (live(record) && untouched(record, stage))
          found.push({ key: record.key, stage });
      }
    }
    return found;
  });

  for (const { key, stage } of runs) {
    const result = await start(stage, key, paseo);
    const what = result.ok
      ? QUEUED[stage]
      : `${NAME[stage]} not started automatically: ${result.error ?? "refused"}`;
    log(`${key} ${what}`);
    ledger({ source: "github", subject: key, what, url: keyUrl(key) });
  }
  return runs.length;
}
