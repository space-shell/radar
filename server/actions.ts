import {
  briefPaths,
  launchIntake,
  resolveLaunch,
  type LaunchTarget,
} from "./intake";
import { reviewOf } from "../shared/review";
import { withdrawAcknowledgement } from "./acknowledge";
import { discoverCheckouts } from "./repos";
import { keyUrl, note as ledger } from "./ledger";
import { loadState, updateState } from "./state";
import { pullRequestUrl, type IntakeRecord } from "../shared/inbox";
import { log } from "./log";
import { setupCommand } from "./setup";

/** Keys with a retry in flight, so a double press cannot launch twice. AC-A5. */
const inFlight = new Set<string>();

/** States a retry can start from. `created` and `archived` already have an agent. */
const RETRYABLE: ReadonlySet<IntakeRecord["state"]> = new Set([
  "failed",
  "unmapped",
  "orphaned",
]);

/** Applies one change to one record inside the write lock. */
async function mutateRecord(
  key: string,
  mutate: (record: IntakeRecord) => void,
): Promise<boolean> {
  return updateState((state) => {
    const record = state.intake.find((candidate) => candidate.key === key);
    if (!record) return false;
    mutate(record);
    return true;
  });
}

function launchTarget(record: IntakeRecord): LaunchTarget {
  return {
    repo: record.repo,
    number: record.number,
    title: record.title,
    url: pullRequestUrl(record),
  };
}

export interface RetryResult {
  ok: boolean;
  adopted: boolean;
  error?: string;
}

/**
 * Relaunches a record that never produced an agent. Deliberately ignores
 * seenPullRequests: that list suppresses fresh intake, never an explicit retry. AC-A6.
 */
export async function retryRecord(key: string): Promise<RetryResult> {
  // Claimed before the first await, or two presses both pass the check. R4.
  if (inFlight.has(key))
    return { ok: false, adopted: false, error: "retry already running" };
  inFlight.add(key);

  try {
    const state = await loadState();
    const record = state.intake.find((candidate) => candidate.key === key);
    if (!record) return { ok: false, adopted: false, error: "no such record" };
    if (!RETRYABLE.has(record.state)) {
      return {
        ok: false,
        adopted: false,
        error: `cannot retry a ${record.state} record`,
      };
    }

    const existing = await resolveLaunch(record);
    if (existing.agentId) {
      await mutateRecord(key, (fresh) => {
        fresh.state = "created";
        fresh.agentId = existing.agentId;
        fresh.workspaceId = existing.workspaceId;
        delete fresh.lastError;
      });
      log(`retry adopted existing agent ${existing.agentId} for ${key}`);
      ledger({
        source: "github",
        subject: key,
        what: "retried, adopted the agent already running",
        url: keyUrl(key),
      });
      return { ok: true, adopted: true };
    }

    const checkout = (await discoverCheckouts()).get(record.repo);
    if (!checkout) {
      const error = `no local checkout for ${record.repo}`;
      await mutateRecord(key, (fresh) => {
        fresh.state = "unmapped";
        fresh.lastError = error;
      });
      return { ok: false, adopted: false, error };
    }

    const { agentId, workspaceId } = await launchIntake(
      launchTarget(record),
      checkout,
      await briefPaths(),
      await setupCommand(),
    );

    if (!agentId) {
      const error = "launch produced no agent";
      await mutateRecord(key, (fresh) => {
        fresh.state = "failed";
        fresh.lastError = error;
      });
      return { ok: false, adopted: false, error };
    }

    await mutateRecord(key, (fresh) => {
      fresh.state = "created";
      fresh.agentId = agentId;
      fresh.workspaceId = workspaceId;
      // A new launch is a new workspace, and the per-task agents lived in the
      // old one. Keeping their ids would point the next QA run at an agent in a
      // worktree that no longer holds this pull request.
      delete fresh.taskAgents;
      delete fresh.lastError;
    });
    log(`retry launched ${key} as agent ${agentId}`);
    ledger({
      source: "github",
      subject: key,
      what: "retried, launched a new agent",
      url: keyUrl(key),
    });
    return { ok: true, adopted: false };
  } catch (caught) {
    const error = String(caught);
    await mutateRecord(key, (fresh) => {
      fresh.state = "failed";
      fresh.lastError = error;
    });
    log(`retry failed for ${key}: ${error}`);
    return { ok: false, adopted: false, error };
  } finally {
    inFlight.delete(key);
  }
}

export interface DismissResult {
  ok: boolean;
  /** The row moved, but something behind it did not. Raised, never swallowed. */
  warning?: string;
}

/**
 * Takes the eyes reaction back before the row goes down, so no pull request is
 * left marked as watched by something James has put aside. AC-H2.
 *
 * A failure here does not block the dismissal. The row is local housekeeping and
 * GitHub being unreachable is not a reason to refuse it. `runStage` has already
 * recorded the reason on the stage, so it survives on the record; the caller
 * raises it as a warning so the press does not look wholly clean.
 *
 * Restore does not re-add the reaction. The stage is back at pending, so
 * re-acknowledging is a press away, and no GitHub write happens that James did
 * not ask for.
 */
async function withdrawEyes(key: string): Promise<string | undefined> {
  const state = await loadState();
  const record = state.intake.find((candidate) => candidate.key === key);
  // Nothing to take back unless this record carries an acknowledgement.
  if (!record || reviewOf(record).acknowledge.status !== "done")
    return undefined;

  const result = await withdrawAcknowledgement(key);
  return result.ok
    ? undefined
    : `the eyes reaction could not be removed: ${result.error ?? "no reason given"}`;
}

/**
 * Hides or restores a row. The acknowledgement is the one thing a dismissal takes
 * with it, per AC-H2. Every other stage survives untouched, so a restored record
 * comes back where it left off. AC-A9.
 */
export async function dismissRecord(
  key: string,
  dismissed: boolean,
): Promise<DismissResult> {
  const warning = dismissed ? await withdrawEyes(key) : undefined;
  const ok = await mutateRecord(key, (record) => {
    record.dismissedAt = dismissed ? new Date().toISOString() : null;
  });
  if (ok) {
    log(`${dismissed ? "dismissed" : "restored"} ${key}`);
    ledger({
      source: "github",
      subject: key,
      what: dismissed ? "dismissed" : "restored",
      url: keyUrl(key),
    });
  }
  return warning ? { ok, warning } : { ok };
}
