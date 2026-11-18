import { run } from "./exec";
import type { IntakeRecord } from "../shared/inbox";
import { archiveRecordWorkspace } from "./archive";
import { inspectAgent } from "./agent";
import { loadState } from "./state";
import { log } from "./log";
import { ghBin } from "./binaries";

const GRACE_MS = 24 * 60 * 60 * 1000;

export type PullRequestState = "OPEN" | "MERGED" | "CLOSED";

/** Asked of GitHub rather than of `record.pr`, which is one search tick stale. */
export async function pullRequestState(
  record: IntakeRecord,
): Promise<PullRequestState | undefined> {
  const { stdout } = await run(
    await ghBin(),
    [
      "pr",
      "view",
      String(record.number),
      "--repo",
      record.repo,
      "--json",
      "state",
    ],
    { timeout: 30_000 },
  );
  const parsed = JSON.parse(stdout) as { state?: string };
  return parsed.state === "OPEN" ||
    parsed.state === "MERGED" ||
    parsed.state === "CLOSED"
    ? parsed.state
    : undefined;
}

/** Archiving is irreversible from here, so every uncertainty has to stop it. R6. */
type Verdict = { archive: true } | { archive: false; because: string };

async function verdict(record: IntakeRecord): Promise<Verdict> {
  // No agent means no turn to interrupt, so the record's own age is the clock.
  if (!record.agentId) return aged(record.firstSeen, "firstSeen");

  const facts = await inspectAgent(record.agentId);
  // An inspect that timed out used to read as a stopped agent, which archived a
  // workspace mid-turn. Unknown now waits for the next sweep instead.
  if (!facts)
    return { archive: false, because: "the agent could not be inspected" };
  if (facts.liveness === "working")
    return { archive: false, because: "the agent is working" };
  if (!facts.updatedAt) {
    return { archive: false, because: "the agent reported no last activity" };
  }

  return aged(facts.updatedAt, "the agent's last activity");
}

/** The 24h grace window. An unparseable timestamp is no evidence, so it holds. */
function aged(timestamp: string, source: string): Verdict {
  const age = Date.now() - Date.parse(timestamp);
  if (Number.isNaN(age))
    return { archive: false, because: `${source} is not a readable date` };
  return age >= GRACE_MS
    ? { archive: true }
    : { archive: false, because: "inside the grace window" };
}

export async function reap(dryRun: boolean): Promise<void> {
  // A snapshot to decide from. Each archive writes its own short transaction. R2.
  const snapshot = await loadState();

  for (const record of snapshot.intake) {
    const { workspaceId } = record;
    /*
     * Nothing to archive, or nothing left to archive. `state === "archived"`
     * carries the second case for the 87 rows settled before the workspace
     * stamp existed: their workspaces went with the archive that settled them,
     * and without this they would each draw one refused `paseo workspace
     * archive` a tick for ever. AC-AT2.
     */
    if (!workspaceId) continue;
    if (record.workspaceArchivedAt || record.state === "archived") continue;

    /*
     * A dismissal archives the workspace at the press, so this is only the
     * backstop for one that did not land: the daemon was busy, or the plugin
     * stopped between the row write and the archive. Neither the pull
     * request's state nor the grace window is asked again, because the press
     * already decided and a dismissed row is one James is done with. AC-AT3.
     */
    if (record.dismissedAt) {
      /*
       * Dismissed before a dismissal archived anything, so there is no archive
       * to finish. Checked here rather than beside the stamp above because it
       * is a statement about the press, not about the workspace, and the
       * merged-or-closed route below still settles the row normally. AC-AT8.
       */
      if (record.keptWorkspace) continue;
      if (dryRun) {
        log(`reap: would archive ${workspaceId} for ${record.key} (dismissed)`);
        continue;
      }
      await archiveRecordWorkspace(record, "the row was dismissed");
      continue;
    }

    if (record.state !== "created") continue;

    let prState: PullRequestState | undefined;
    try {
      prState = await pullRequestState(record);
    } catch (error) {
      log(`reap: cannot read ${record.key} state: ${String(error)}`);
      continue;
    }

    if (prState === undefined || prState === "OPEN") continue;

    const decision = await verdict(record);
    if (!decision.archive) {
      log(`reap: holding ${record.key}, ${decision.because}`);
      continue;
    }

    if (dryRun) {
      log(`reap: would archive ${workspaceId} for ${record.key} (${prState})`);
      continue;
    }

    // One write for both: the workspace is gone and the record has settled.
    await archiveRecordWorkspace(
      record,
      `the pull request is ${prState.toLowerCase()}`,
      (fresh) => {
        fresh.state = "archived";
        fresh.archivedAt = new Date().toISOString();
      },
    );
  }
}
