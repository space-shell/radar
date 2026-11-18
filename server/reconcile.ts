import type { IntakeRecord } from "../shared/inbox";
import { agentStatuses } from "./intake";
import { keyUrl, note } from "./ledger";
import { log } from "./log";
import { pullRequestState } from "./reap";
import { coalesce } from "./single-flight";
import { loadState, updateState } from "./state";

/**
 * Whether the pull request itself has finished. Asked of GitHub rather than read
 * off `record.pr`, because the stored status is only as fresh as the last search
 * tick and a merge is the very thing that takes the agent away. An unreadable
 * answer falls back to the stored status, and an absent one reads as unfinished,
 * so the fault is the one that can be retried. AC-V2.
 */
export async function settled(
  record: IntakeRecord,
): Promise<"merged" | "closed" | null> {
  try {
    const state = await pullRequestState(record);
    if (state === "MERGED") return "merged";
    if (state === "CLOSED") return "closed";
    if (state === "OPEN") return null;
  } catch (error) {
    log(`cannot read ${record.key} state: ${String(error)}`);
  }
  if (record.pr?.state === "merged") return "merged";
  if (record.pr?.state === "closed") return "closed";
  return null;
}

/**
 * Statuses from which more output is still to come. The same rule `inspectAgent`
 * applies to one agent, applied here to the whole list in one call.
 */
const WORKING_STATUSES: ReadonlySet<string> = new Set([
  "running",
  "initializing",
]);

/**
 * Agents with a turn in flight, as of the last reconcile.
 *
 * In memory because it is a fact about right now: a restart clearing it is the
 * truth, not a loss. Refreshed on the tick rather than on demand, so the screen
 * asking costs nothing and reads at most one tick behind. The two things it
 * gates both settle on the same tick, so a stale answer cannot contradict what
 * is on screen. AC-AD3.
 */
let working: ReadonlySet<string> = new Set();

export function workingAgents(): ReadonlySet<string> {
  return working;
}

/**
 * Takes an agent out of the working set the moment its turn ends, rather than
 * waiting for the next list.
 *
 * The daemon says so a tick before a list would, and the one place the set is
 * read is a card that says a summary is coming. A turn that ended having written
 * nothing is the case this covers: no summary arrives to replace the indicator,
 * so without this the card would claim one was still being written for up to a
 * whole tick after the agent had stopped. AC-AE3.
 *
 * Replaced rather than mutated, so a reader holding the set it was given reads a
 * consistent answer rather than one changing underneath it.
 */
export function agentSettled(agentId: string): void {
  if (!working.has(agentId)) return;
  const next = new Set(working);
  next.delete(agentId);
  working = next;
}

/**
 * Whether the stored status was read after the record was archived.
 *
 * The archive decision asks GitHub live; `record.pr` is as old as the last
 * search tick. For a pull request that merges between two sweeps the two
 * disagree for exactly one window, and without this the wake branch believed
 * the stale half: `#9983` was archived as merged at 06:42:23.060 and brought
 * back as an orphan at 06:42:23.283 by a second pass reading the same stale
 * `pr.state: open`, with `the pull request was reopened` written about a pull
 * request that had merged four hours earlier.
 *
 * A record archived before this stamp existed has no `archivedAt`, so its
 * archive is older than anything now on disk and the stored status is taken at
 * face value, which is today's behaviour and what keeps AC-AR2 true for the 87
 * rows already settled. AC-AS5.
 */
function statusOutlivesArchive(record: IntakeRecord): boolean {
  if (!record.archivedAt) return true;
  const archived = Date.parse(record.archivedAt);
  if (!Number.isFinite(archived)) return true;
  const checked = Date.parse(record.pr?.checkedAt ?? "");
  return Number.isFinite(checked) && checked > archived;
}

/**
 * A green row must mean a live agent. An agent archived or deleted by hand leaves
 * the record claiming a session that no longer opens, so it moves to `orphaned`
 * and becomes retryable. R3.
 *
 * A finished pull request is the exception. Paseo archives the worktree workspace
 * on merge and the agent goes with it, so the session is gone for the ordinary
 * reason rather than a broken one. That row reads `archived`, carries no fault,
 * and stays visible until James dismisses it. AC-V1.
 */
async function agentPass(): Promise<void> {
  const snapshot = await loadState();
  const watched = snapshot.intake.filter(
    (record) => record.state === "created" && record.agentId,
  );

  const lost: IntakeRecord[] = [];
  if (watched.length === 0) {
    // Nothing is being watched, so nothing can be mid-turn. Clearing rather than
    // leaving the last answer standing: a stale set would outlive its agents.
    working = new Set();
  } else {
    try {
      const statuses = await agentStatuses();
      lost.push(...watched.filter((record) => !statuses.has(record.agentId!)));
      const live = new Set<string>();
      for (const [id, status] of statuses) {
        if (WORKING_STATUSES.has(status)) live.add(id);
      }
      working = live;
    } catch (error) {
      // Fail closed. An unreadable agent list is not evidence that every agent died.
      log(`cannot list agents: ${String(error)}`);
    }
  }

  // One request per lost agent, and an agent is lost at most once in its life.
  const finished = new Map<string, "merged" | "closed">();
  for (const record of lost) {
    const ending = await settled(record);
    if (ending) finished.set(record.key, ending);
  }

  /*
   * An orphan can settle later: the pull request merges days after the agent has
   * gone, and the fault stops being one anybody can act on. Read off the stored
   * status rather than asked of GitHub, because nothing is waiting on this and
   * the search tick refreshes it anyway. AC-V9.
   */
  const late = snapshot.intake.filter(
    (record) =>
      record.state === "orphaned" &&
      (record.pr?.state === "merged" || record.pr?.state === "closed"),
  );
  for (const record of late) {
    finished.set(record.key, record.pr!.state as "merged" | "closed");
  }

  /*
   * And an archive can come undone. The author reopens the pull request and asks
   * again, and nothing anywhere moved a record out of `archived`: every signal
   * that would have said so is suppressed for an archived record on purpose, so
   * `unseen`, `rereviewDue` and `rerequested` all answer false and the row sits
   * there with Dismiss as its only control. The record is returned to `orphaned`,
   * which is retryable, so the one control that can rebuild the session appears
   * on the row and the stamp lights the dot. Read off the stored status like
   * `late`, and for the same reason: the search tick refreshes it anyway. AC-AR2.
   */
  const woken = snapshot.intake.filter(
    (record) =>
      record.state === "archived" &&
      record.pr?.state === "open" &&
      statusOutlivesArchive(record),
  );
  const backFromArchive = new Set(woken.map((record) => record.key));

  const keys = new Set(
    [...lost, ...late, ...woken].map((record) => record.key),
  );
  if (keys.size === 0) return;

  const ledgerLines: Array<{ key: string; ending: string }> = [];
  const wokenLines: string[] = [];

  await updateState((state) => {
    for (const record of state.intake) {
      if (!keys.has(record.key)) continue;

      if (backFromArchive.has(record.key)) {
        // Re-checked inside the lock, as every other branch here is.
        if (record.state !== "archived") continue;
        record.state = "orphaned";
        record.lastError = "the pull request was reopened";
        record.reopenedAt = new Date().toISOString();
        delete record.archivedAt;
        wokenLines.push(record.key);
        log(`${record.key} was reopened, bringing it back as an orphan`);
        continue;
      }

      const ending = finished.get(record.key);

      if (!ending) {
        if (record.state !== "created") continue;
        record.state = "orphaned";
        /*
         * A dismissal takes the workspace with it, and the agent goes with the
         * workspace. That is the row doing what it was told, not a session
         * breaking, so it must not read as a fault: `orphaned` is still right
         * because the session really is gone and `orphaned` is retryable,
         * which is the only route back to a workspace. AC-AT6.
         */
        const dismissed = Boolean(record.workspaceArchivedAt);
        record.lastError = dismissed
          ? "the workspace was archived when the row was dismissed"
          : "the agent was archived or deleted";
        log(
          dismissed
            ? `${record.key} lost its agent with its archived workspace`
            : `${record.key} lost its agent, marking orphaned`,
        );
        continue;
      }

      const was = record.state;
      if (was !== "created" && was !== "orphaned") continue;
      record.state = "archived";
      record.archivedAt = new Date().toISOString();
      delete record.lastError;
      ledgerLines.push({ key: record.key, ending });
      log(
        was === "orphaned"
          ? `${record.key} is ${ending}, settling the orphan as archived`
          : `${record.key} is ${ending} and its agent is gone, marking archived`,
      );
    }
  });

  // After the write, so the ledger never claims a transition the state refused.
  for (const key of wokenLines) {
    note({
      source: "github",
      subject: key,
      what: "the pull request was reopened, so the record is back",
      url: keyUrl(key),
    });
  }
  for (const line of ledgerLines) {
    note({
      source: "github",
      subject: line.key,
      what: `the session closed, the pull request is ${line.ending}`,
      url: keyUrl(line.key),
    });
  }
}

/**
 * The pass, run one at a time, and once more if anything asked while it ran.
 *
 * The gate is here rather than at each caller because there are three of them:
 * the tick, and the `agent.archived` and `agent.closed` hooks. Each used to
 * guard itself, which guards nothing: a hook pass and a tick pass 480ms apart
 * both read the ledger before either wrote, and the second wrote its decision
 * over the first's. That is how `#9983` was archived and then un-archived
 * inside a quarter of a second. Coalesced rather than single-flighted because
 * two of the three callers are events: an event says something changed now, and
 * a pass half way through has already read the half that covers it. AC-AS5.
 */
const agentGate = coalesce(agentPass);

export async function reconcileAgents(): Promise<void> {
  await agentGate();
}
