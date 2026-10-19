import { execCommand } from "@getpaseo/plugin/server";
import { log } from "./log";
import { paseoBin } from "./binaries";

/** `paseo inspect --json` capitalises its keys, unlike `paseo ls --json`. */
interface InspectSnapshot {
  Status?: string;
  Archived?: boolean;
  UpdatedAt?: string;
}

/** Statuses after which no further agent output arrives. Verified against the CLI. */
const STOPPED_STATUSES: ReadonlySet<string> = new Set([
  "idle",
  "error",
  "closed",
]);

export interface AgentFacts {
  /** `working` means a turn is still in flight, so a stage or a review can still report. */
  liveness: "working" | "stopped";
  /** Last activity as the CLI reported it, or null when it reported none. */
  updatedAt: string | null;
}

/** A failed inspect prints its reason as JSON on stderr. Verified against the CLI. */
function notFound(error: unknown): boolean {
  const { stderr } = error as { stderr?: string };
  if (!stderr) return false;
  try {
    return (
      (JSON.parse(stderr) as { error?: { code?: string } }).error?.code ===
      "AGENT_NOT_FOUND"
    );
  } catch {
    return false;
  }
}

/**
 * What one inspect can establish about an agent, or null when it establishes nothing.
 *
 * Null is the whole point. A timed-out inspect is not evidence that an agent died,
 * and both callers do something destructive on that evidence: the reaper archives a
 * workspace mid-turn, the stage reconciler writes a false cause onto a record. R6, R9.
 */
export async function inspectAgent(
  agentId: string,
): Promise<AgentFacts | null> {
  let stdout: string;
  try {
    ({ stdout } = await execCommand(
      await paseoBin(),
      ["inspect", agentId, "--json"],
      {
        timeout: 30_000,
      },
    ));
  } catch (error) {
    // A deleted agent is gone for good. A timeout or a daemon hiccup is not.
    if (notFound(error)) return { liveness: "stopped", updatedAt: null };
    log(`cannot inspect ${agentId}: ${String(error)}`);
    return null;
  }

  let snapshot: InspectSnapshot;
  try {
    snapshot = JSON.parse(stdout) as InspectSnapshot;
  } catch (error) {
    log(`cannot parse inspect output for ${agentId}: ${String(error)}`);
    return null;
  }

  const updatedAt = snapshot.UpdatedAt ?? null;
  if (snapshot.Archived === true) return { liveness: "stopped", updatedAt };
  // `initializing` has not started yet but will, so it is still going to report.
  if (snapshot.Status === "running" || snapshot.Status === "initializing") {
    return { liveness: "working", updatedAt };
  }
  if (snapshot.Status && STOPPED_STATUSES.has(snapshot.Status)) {
    return { liveness: "stopped", updatedAt };
  }

  log(`unrecognised status ${String(snapshot.Status)} for ${agentId}`);
  return null;
}
