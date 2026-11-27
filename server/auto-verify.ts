import type { IntakeRecord } from "../shared/inbox";
import { reviewOf } from "../shared/review";
import { keyUrl, note as ledger } from "./ledger";
import { log } from "./log";
import { loadState, updateState } from "./state";
import type { Paseo } from "./turn";
import { runVerification } from "./verification";

/** What the summary's verification decision does to the stage, or nothing. */
export type VerificationDecision = "run" | "skip" | null;

/** What the map says on a stage the summary passed over. */
export const NOT_REQUIRED_NOTE = "not required, per the summary";

/**
 * Verification exactly as intake left it: never pressed, never queued, never
 * run, never skipped. Anything else is a decision James has already made, and
 * the summary's opinion does not outrank it.
 */
function untouched(record: IntakeRecord): boolean {
  const stage = reviewOf(record).verification;
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
  /** The `autoVerify` setting. */
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
  if (!live(record) || !untouched(record)) return null;
  return decision.required ? "run" : "skip";
}

/**
 * Writes a decision onto the record, inside the caller's `updateState`.
 *
 * A skip is carried out here and now, because it is one field and needs no
 * agent. A run is only recorded: sending its turn needs a Paseo handle, which
 * the floor pass does not have, so `startDecidedVerifications` sends it from
 * whichever path next holds one.
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

/** Decided runs whose turn has not been asked for yet. */
function waiting(record: IntakeRecord): boolean {
  const mark = record.autoVerification;
  return Boolean(mark?.required && !mark.actedAt);
}

/**
 * Sends every decided run that has not been sent, once each.
 *
 * The decision is spent at the claim, whether or not it still applies by then:
 * a record James dismissed or verified by hand in the meantime is marked and
 * left alone, so nothing is waiting to fire the next time it changes. AC-AY4.
 *
 * Goes through `runVerification`, which is the press's own path: it queues
 * behind a busy agent, it can be cancelled from the map, and it carries no
 * `onClaim`, so nothing here writes to GitHub. QA is never started from here.
 * AC-I2.
 *
 * Read first and written only when something is waiting, because this runs on
 * every settle pass and `updateState` rewrites the file whether or not it
 * changed anything.
 */
export async function startDecidedVerifications(paseo: Paseo): Promise<number> {
  const { intake } = await loadState();
  if (!intake.some(waiting)) return 0;

  const now = new Date().toISOString();
  const due = await updateState((state) => {
    const keys: string[] = [];
    for (const record of state.intake) {
      if (!waiting(record)) continue;
      record.autoVerification = { ...record.autoVerification!, actedAt: now };
      if (live(record) && untouched(record)) keys.push(record.key);
    }
    return keys;
  });

  for (const key of due) {
    const result = await runVerification(key, paseo);
    const what = result.ok
      ? "verification queued: the summary says it is required"
      : `verification not started automatically: ${result.error ?? "refused"}`;
    log(`${key} ${what}`);
    ledger({ source: "github", subject: key, what, url: keyUrl(key) });
  }
  return due.length;
}
