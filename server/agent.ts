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

/**
 * How long a refused revival is believed for.
 *
 * A queued stage asks whether its agent can take a turn every few seconds, and
 * for a closed agent that question now runs `paseo agent reload`. Without a
 * cooldown, one agent the daemon cannot restart would mean one subprocess per
 * poll for as long as the lane waits.
 */
const REVIVE_COOLDOWN_MS = 5 * 60_000;

/** Revivals already in flight, so two presses on one record make one attempt. */
const reviving = new Map<string, Promise<boolean>>();

/** When a revival last failed, per agent. A success leaves no entry behind. */
const refused = new Map<string, number>();

/** A reload restarts a provider process, which is slower than an inspect. */
const RELOAD_TIMEOUT_MS = 120_000;

async function reload(agentId: string): Promise<boolean> {
  try {
    await execCommand(await paseoBin(), ["agent", "reload", agentId], {
      timeout: RELOAD_TIMEOUT_MS,
    });
  } catch (error) {
    refused.set(agentId, Date.now());
    log(`cannot reload ${agentId}: ${String(error)}`);
    return false;
  }
  refused.delete(agentId);
  log(`reloaded ${agentId}`);
  return true;
}

/**
 * Restarts the process behind a closed agent, answering whether it came back.
 *
 * `closed` is the resting state of a Paseo agent, not its death. The daemon
 * ends the provider process when an agent goes quiet and keeps the session, so
 * most agents on a machine read `closed` while every one of them still holds
 * its whole timeline, and `paseo agent reload` returns one to `idle` with that
 * timeline intact.
 *
 * There is no SDK call for this. `PaseoAgentHandle` carries no reload and the
 * daemon client exposes only `reloadDaemonConfig` and `reloadPlugin`, so the
 * CLI is the only surface, reached the same way `inspectAgent` reaches it.
 */
export async function reviveAgent(agentId: string): Promise<boolean> {
  const failed = refused.get(agentId);
  if (failed != null && Date.now() - failed < REVIVE_COOLDOWN_MS) {
    log(`not reloading ${agentId} again yet: the last attempt failed`);
    return false;
  }

  const running = reviving.get(agentId);
  if (running) return running;

  const attempt = reload(agentId).finally(() => reviving.delete(agentId));
  reviving.set(agentId, attempt);
  return attempt;
}

/** Drops the cooldown and the in-flight map. Probes only. */
export function forgetRevivals(): void {
  reviving.clear();
  refused.clear();
}
