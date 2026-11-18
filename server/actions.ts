import {
  briefPaths,
  launchIntake,
  resolveLaunch,
  type LaunchTarget,
} from "./intake";
import { archiveRecordWorkspace } from "./archive";
import { forgetLostTurns, reviewOf } from "../shared/review";
import { causeOf } from "./exec";
import { withdrawAcknowledgement } from "./acknowledge";
import { discoverCheckouts } from "./repos";
import { keyUrl, note as ledger } from "./ledger";
import { loadState, updateState } from "./state";
import { pullRequestUrl, type IntakeRecord } from "../shared/inbox";
import { log } from "./log";
import { setupCommand } from "./setup";

/** Keys with a retry in flight, so a double press cannot launch twice. AC-A5. */
const inFlight = new Set<string>();

/**
 * States a retry can start from.
 *
 * `dry-run` is here because it is otherwise terminal. Nothing else ever moves a
 * record out of it: `intake` is the only writer of that state and the key is in
 * `seenPullRequests` by then, so turning dry run off changes nothing for the
 * records already taken, and `addByLink` answers `already: "present"`. Without
 * this the only escape was to provoke a failure, orphaning the record on purpose
 * to reach the control that was wanted. A dry-run record has no agent and no
 * workspace, which is the launch path's ordinary case. AC-AR1.
 *
 * `created` already has an agent, and `archived` is a record James is done with:
 * a reopened pull request is returned to `orphaned` by the reconciler rather
 * than by a Retry control standing on every finished row. AC-AR2.
 */
const RETRYABLE: ReadonlySet<IntakeRecord["state"]> = new Set([
  "failed",
  "unmapped",
  "orphaned",
  "dry-run",
]);

/**
 * Drops the stage failures that were only ever about the agent this retry has
 * just replaced, so the node stops instructing a Retry that has happened.
 *
 * The press is the thing that made those sentences untrue, and nothing else
 * ever rewrites a failed stage: without this the message stands on the record
 * for good. Observed on `acme/web#9813`.
 */
function clearLostTurns(record: IntakeRecord): void {
  const review = reviewOf(record);
  const spent = forgetLostTurns(review);
  if (spent.length === 0) return;
  record.review = review;
  log(
    `${record.key}: ${spent.join(" and ")} lost the old agent, back to ready`,
  );
}

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
 * Forgets the automatic relaunch budget. A record that is running again has no
 * spent attempts to carry into whatever fails next. AC-AS2.
 */
function clearRelaunch(record: IntakeRecord): void {
  delete record.launchAttempts;
  delete record.lastAttemptAt;
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
        delete fresh.workspaceArchivedAt;
        delete fresh.lastError;
        clearRelaunch(fresh);
        clearLostTurns(fresh);
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
      // A new workspace exists, so the stamp saying the old one is gone is
      // spent. Without this the row keeps reading "workspace archived" over a
      // live worktree, and the footer keeps hiding the link to it. AC-AT6.
      delete fresh.workspaceArchivedAt;
      delete fresh.lastError;
      clearRelaunch(fresh);
      clearLostTurns(fresh);
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
    // Both the stored line and the toast, so neither is a page of argv. AC-AS3.
    const error = causeOf(caught);
    await mutateRecord(key, (fresh) => {
      fresh.state = "failed";
      fresh.lastError = error;
    });
    log(`retry failed for ${key}: ${String(caught)}`);
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
 * Archives the workspace behind a row that has just gone down.
 *
 * Read fresh rather than passed in, because the dismissal wrote in between and
 * the archive has to see its own stamp. A record with no workspace, which is
 * every `dry-run` and `unmapped` row, costs nothing here.
 */
async function releaseWorkspace(key: string): Promise<string | undefined> {
  const state = await loadState();
  const record = state.intake.find((candidate) => candidate.key === key);
  if (!record) return undefined;

  const result = await archiveRecordWorkspace(record, "the row was dismissed");
  return result.ok
    ? undefined
    : `the workspace could not be archived: ${result.error ?? "no reason given"}`;
}

/**
 * Hides or restores a row. The acknowledgement is the one thing a dismissal takes
 * with it, per AC-H2. Every other stage survives untouched, so a restored record
 * comes back where it left off. AC-A9.
 *
 * A dismissal also archives the workspace, which is the one part of this that
 * does not come back. There is no unarchive on any surface a plugin can reach,
 * so Restore returns the row and not the workspace, and the screens say so
 * rather than letting the control imply otherwise. AC-AT1, AC-AT4.
 *
 * Order matters and is the point: the row is written first, so a daemon that
 * will not answer cannot cost James the press, and the ledger line is the
 * dismissal's rather than the archive's. The archive then runs bounded, its
 * failure raised as a warning and retried by the next reap. AC-AT3.
 */
export async function dismissRecord(
  key: string,
  dismissed: boolean,
): Promise<DismissResult> {
  const warning = dismissed ? await withdrawEyes(key) : undefined;
  const ok = await mutateRecord(key, (record) => {
    record.dismissedAt = dismissed ? new Date().toISOString() : null;
  });
  if (!ok) return warning ? { ok, warning } : { ok };

  log(`${dismissed ? "dismissed" : "restored"} ${key}`);
  ledger({
    source: "github",
    subject: key,
    what: dismissed ? "dismissed" : "restored",
    url: keyUrl(key),
  });

  const refused = dismissed ? await releaseWorkspace(key) : undefined;
  // Both raised rather than the first of the two: they are separate failures
  // and reporting one would hide the other. AC-AT5.
  const raised = [warning, refused].filter(Boolean).join("; ");
  return raised ? { ok, warning: raised } : { ok };
}

/**
 * How long a failed launch is left alone before it is tried again, and how many
 * times. Two attempts, a quarter of an hour apart, then it waits for a press.
 */
const RELAUNCH_AFTER_MS = 15 * 60_000;
const RELAUNCH_LIMIT = 2;

/** When the last launch for this record was attempted, however it was started. */
function lastAttempt(record: IntakeRecord): number {
  const when = Date.parse(record.lastAttemptAt ?? record.firstSeen);
  return Number.isFinite(when) ? when : 0;
}

/**
 * One failed launch, tried again.
 *
 * A failed launch is terminal today, and that is the defect: `intake` writes the
 * key into `seenPullRequests` whether or not the launch worked, so the sweep
 * that would take it in again filters it out for good, and the row sits at
 * `failed` until James presses Retry. The cause is usually transient: `#9990`
 * failed on a `git fetch` that the plugin then re-ran by hand in 0.844s.
 *
 * Deliberately not done by withholding the key from `seenPullRequests`:
 * `intake`'s write re-checks for an existing record under the lock and returns
 * false, so a second successful launch would be discarded and its agent
 * orphaned. `retryRecord` is the path that updates the record in place, and it
 * adopts an agent an earlier attempt left behind rather than building a second
 * worktree. AC-AS2.
 *
 * One record per sweep, and only after the wait, so a tick cannot spend three
 * launch timeouts in a row. Attempts are counted on the record, so a launch
 * that fails for a structural reason stops asking rather than retrying forever;
 * Retry stays the escape hatch and clears the count on success.
 */
export async function relaunchFailed(): Promise<void> {
  const snapshot = await loadState();
  const now = Date.now();
  const due = snapshot.intake.find(
    (record) =>
      record.state === "failed" &&
      !record.dismissedAt &&
      // An unread status reads as open: the first sweep after intake is what
      // writes `pr`, and a launch that failed before it has one is the case
      // this exists for.
      (record.pr?.state ?? "open") === "open" &&
      (record.launchAttempts ?? 0) < RELAUNCH_LIMIT &&
      now - lastAttempt(record) >= RELAUNCH_AFTER_MS,
  );
  if (!due) return;

  const attempt = (due.launchAttempts ?? 0) + 1;
  // Counted before the attempt, not after: a launch that takes the tick down
  // with it must still have spent its attempt, or the next tick spends it again.
  const claimed = await updateState((state) => {
    const record = state.intake.find((candidate) => candidate.key === due.key);
    if (!record || record.state !== "failed") return false;
    record.launchAttempts = attempt;
    record.lastAttemptAt = new Date().toISOString();
    return true;
  });
  if (!claimed) return;

  log(`${due.key}: relaunching, attempt ${attempt} of ${RELAUNCH_LIMIT}`);
  const result = await retryRecord(due.key);
  if (!result.ok) log(`${due.key}: relaunch failed: ${result.error}`);
}
