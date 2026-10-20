import type { IntakeRecord } from "../shared/inbox";
import { agentStatuses } from "./intake";
import { keyUrl, note } from "./ledger";
import { log } from "./log";
import { pullRequestState } from "./reap";
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
 * A green row must mean a live agent. An agent archived or deleted by hand leaves
 * the record claiming a session that no longer opens, so it moves to `orphaned`
 * and becomes retryable. R3.
 *
 * A finished pull request is the exception. Paseo archives the worktree workspace
 * on merge and the agent goes with it, so the session is gone for the ordinary
 * reason rather than a broken one. That row reads `archived`, carries no fault,
 * and stays visible until James dismisses it. AC-V1.
 */
export async function reconcileAgents(): Promise<void> {
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

  const keys = new Set([...lost, ...late].map((record) => record.key));
  if (keys.size === 0) return;

  const ledgerLines: Array<{ key: string; ending: string }> = [];

  await updateState((state) => {
    for (const record of state.intake) {
      if (!keys.has(record.key)) continue;
      const ending = finished.get(record.key);

      if (!ending) {
        if (record.state !== "created") continue;
        record.state = "orphaned";
        record.lastError = "the agent was archived or deleted";
        log(`${record.key} lost its agent, marking orphaned`);
        continue;
      }

      const was = record.state;
      if (was !== "created" && was !== "orphaned") continue;
      record.state = "archived";
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
  for (const line of ledgerLines) {
    note({
      source: "github",
      subject: line.key,
      what: `the session closed, the pull request is ${line.ending}`,
      url: keyUrl(line.key),
    });
  }
}
