import { execCommand } from "@getpaseo/plugin/server";
import type { IntakeRecord } from "../shared/inbox";
import { inspectAgent } from "./agent";
import { keyUrl, note as ledger } from "./ledger";
import { loadState, updateState } from "./state";
import { log } from "./log";
import { ghBin, paseoBin } from "./binaries";

const GRACE_MS = 24 * 60 * 60 * 1000;

export type PullRequestState = "OPEN" | "MERGED" | "CLOSED";

/** Asked of GitHub rather than of `record.pr`, which is one search tick stale. */
export async function pullRequestState(
  record: IntakeRecord,
): Promise<PullRequestState | undefined> {
  const { stdout } = await execCommand(
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

async function archiveWorkspace(workspaceId: string): Promise<void> {
  await execCommand(await paseoBin(), ["workspace", "archive", workspaceId], {
    timeout: 60_000,
  });
}

export async function reap(dryRun: boolean): Promise<void> {
  // A snapshot to decide from. Each archive writes its own short transaction. R2.
  const snapshot = await loadState();

  for (const record of snapshot.intake) {
    const { workspaceId } = record;
    if (record.state !== "created" || !workspaceId) continue;

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

    try {
      await archiveWorkspace(workspaceId);
      await updateState((fresh) => {
        const current = fresh.intake.find(
          (candidate) => candidate.key === record.key,
        );
        if (current) current.state = "archived";
      });
      log(`reap: archived ${workspaceId} for ${record.key} (${prState})`);
      ledger({
        source: "github",
        subject: record.key,
        what: `archived, the pull request is ${prState.toLowerCase()}`,
        url: keyUrl(record.key),
      });
    } catch (error) {
      log(`reap: archive failed for ${record.key}: ${String(error)}`);
    }
  }
}
