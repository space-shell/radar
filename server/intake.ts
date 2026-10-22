import { homedir } from "node:os";
import { join } from "node:path";
import { execCommand } from "@getpaseo/plugin/server";
import { clearArtifact, prepareArtifact } from "./artifact";
import { briefPath } from "./briefs";
import type { ReviewRequest } from "./github";
import { note } from "./ledger";
import { linearRef, type LinearNaming } from "./linear-ref";
import { log } from "./log";
import { discoverCheckouts } from "./repos";
import { summaryPath } from "./summary";
import { pullRequestUrl, type IntakeRecord } from "../shared/inbox";
import { baseAgent, providerString, type AgentSpec } from "../shared/settings";
import { loadConfig } from "./settings";
import { setupCommand, setupLines } from "./setup";
import { updateState } from "./state";
import { paseoBin } from "./binaries";

/** Everything a launch needs. Both a live ReviewRequest and a stored record satisfy it. */
export interface LaunchTarget {
  repo: string;
  number: number;
  title: string;
  url: string;
}

export interface LaunchResult {
  agentId?: string;
  workspaceId?: string;
}

export interface Briefs {
  /** The operating brief: what the one message has to say. */
  intake: string;
  /**
   * The summary brief, carried so the same turn can write the detail view's
   * file. It is the file the Summarise press uses, named here rather than
   * restated, so an edited brief governs both paths and the schema is written
   * down once. AC-AB2.
   */
  summary: string;
}

function prompt(
  target: LaunchTarget,
  briefs: Briefs,
  setup: string | null,
): string {
  return [
    `Read ${briefs.intake} and follow it exactly.`,
    `Pull request: ${target.repo} #${target.number}, "${target.title}".`,
    `URL: ${target.url}`,
    "",
    // The second write, in the turn that has already read the diff. Asking for
    // it later costs a whole turn to read the same diff again, which is what
    // the press-only arrangement charged for every record James opened. AC-AB1.
    `Then write the summary file described in ${briefs.summary}.`,
    `Record key: ${target.repo}#${target.number}`,
    `Write it to: ${summaryPath(target.repo, target.number)}`,
    ...setupLines(setup),
  ].join("\n");
}

export function launchArgs(
  target: LaunchTarget,
  checkout: string,
  briefs: Briefs,
  setup: string | null,
  agent: AgentSpec,
): string[] {
  return [
    "run",
    "--background",
    "--cwd",
    checkout,
    "--new-workspace",
    "worktree",
    "--worktree-mode",
    "checkout-pr",
    "--pr-number",
    String(target.number),
    "--forge",
    "github",
    "--title",
    `PR #${target.number} ${target.title}`,
    "--provider",
    providerString(agent),
    // Empty means the model's or provider's own default, which is said by
    // leaving the flag off rather than by passing a blank value.
    ...(agent.thinking ? ["--thinking", agent.thinking] : []),
    ...(agent.mode ? ["--mode", agent.mode] : []),
    "--label",
    "inbox=pr",
    "--label",
    `pr=${target.number}`,
    "--label",
    `repo=${target.repo}`,
    "--json",
    prompt(target, briefs, setup),
  ];
}

export async function briefPaths(): Promise<Briefs> {
  const [intake, summary] = await Promise.all([
    briefPath("intake"),
    briefPath("summary"),
  ]);
  return { intake, summary };
}

const absolute = (path: string) =>
  path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;

async function lookupJson<T>(args: string[]): Promise<T[]> {
  const { stdout } = await execCommand(await paseoBin(), args, {
    timeout: 30_000,
  });
  const parsed: unknown = JSON.parse(stdout);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export async function resolveLaunch(target: {
  repo: string;
  number: number;
}): Promise<LaunchResult> {
  const agents = await lookupJson<{ id?: string; cwd?: string }>([
    "ls",
    "--global",
    "--label",
    `pr=${target.number}`,
    "--label",
    `repo=${target.repo}`,
    "--json",
  ]);
  const agent = agents.at(-1);
  if (!agent?.id || !agent.cwd) return {};

  const cwd = absolute(agent.cwd);
  const workspaces = await lookupJson<{ workspaceId?: string; cwd?: string }>([
    "workspace",
    "ls",
    "--json",
  ]);
  return {
    agentId: agent.id,
    workspaceId: workspaces.find((workspace) => workspace.cwd === cwd)
      ?.workspaceId,
  };
}

export async function launchIntake(
  target: LaunchTarget,
  checkout: string,
  briefs: Briefs,
  setup: string | null,
): Promise<LaunchResult> {
  const agent = baseAgent(await loadConfig());

  // The agent has no write tool pointed outside the worktree until the tree is
  // there, and a file left by an earlier launch for this same pull request must
  // not be collected as this one's output. AC-AB4.
  const output = summaryPath(target.repo, target.number);
  await prepareArtifact(output);
  await clearArtifact(output);

  await execCommand(
    await paseoBin(),
    launchArgs(target, checkout, briefs, setup, agent),
    { timeout: 120_000 },
  );
  return resolveLaunch(target);
}

/**
 * Every agent the daemon still holds, each with the status the CLI reports.
 * Archived agents are absent, which is what makes this the cheap liveness check:
 * one call covers every record. R3.
 *
 * The status rides along because the one call already carries it. Knowing which
 * agents are mid-turn is what lets the detail view say a summary is coming
 * rather than show an empty card for the minutes an intake turn takes, and it
 * costs nothing on top of a check the tick already makes. AC-AD3.
 */
export async function agentStatuses(): Promise<Map<string, string>> {
  const agents = await lookupJson<{ id?: string; status?: string }>([
    "ls",
    "--global",
    "--json",
  ]);
  const statuses = new Map<string, string>();
  for (const agent of agents) {
    if (agent.id) statuses.set(agent.id, agent.status ?? "");
  }
  return statuses;
}

/** Every agent the daemon still holds, without their statuses. R3. */
export async function liveAgentIds(): Promise<Set<string>> {
  return new Set((await agentStatuses()).keys());
}

/** How this machine names Linear issues. Read per sweep, so an edit takes effect. */
export async function linearNaming(): Promise<LinearNaming> {
  const { linearWorkspace, linearTeamKeys } = await loadConfig();
  return { workspace: linearWorkspace, teamKeys: linearTeamKeys };
}

/** Where a record came from. Only the ledger line reads it. */
export type IntakeOrigin = "search" | "manual";

/** What a launch needs that is the same for every pull request taken in. */
export interface IntakeEnvironment {
  checkouts: Map<string, string>;
  briefs: Briefs;
  naming: LinearNaming;
  setup: string | null;
  dryRun: boolean;
}

/**
 * Gathered once, not once per pull request: the checkout map walks every clone
 * under every root asking git for its origin, which is far too much work to
 * repeat for each row of one sweep.
 */
export async function intakeEnvironment(
  dryRun: boolean,
): Promise<IntakeEnvironment> {
  const [checkouts, briefs, naming, setup] = await Promise.all([
    discoverCheckouts(),
    briefPaths(),
    linearNaming(),
    setupCommand(),
  ]);
  return { checkouts, briefs, naming, setup, dryRun };
}

/**
 * Takes in one pull request. The launch runs outside the write lock because it
 * can take two minutes; only the resulting record is written under it. R2.
 *
 * One function for both ways in. A pull request James pasted is reviewed the
 * same way as one GitHub asked him to review: same worktree, same brief, same
 * summary, same record. Only the ledger line differs, because "review
 * requested" would be untrue of a record nobody requested. AC-AK7.
 */
export async function intake(
  request: ReviewRequest,
  { checkouts, briefs, naming, setup, dryRun }: IntakeEnvironment,
  origin: IntakeOrigin = "search",
): Promise<void> {
  const checkout = checkouts.get(request.repo);
  const record: IntakeRecord = {
    key: request.key,
    repo: request.repo,
    number: request.number,
    title: request.title,
    firstSeen: new Date().toISOString(),
    state: "created",
    linearUrl: linearRef(request.body, naming),
  };

  if (!checkout) {
    record.state = "unmapped";
    log(`unmapped repo ${request.repo} for PR #${request.number}, skipping`);
  } else if (dryRun) {
    record.state = "dry-run";
    log(
      `would launch: paseo ${launchArgs(
        request,
        checkout,
        briefs,
        setup,
        baseAgent(await loadConfig()),
      )
        .slice(0, -1)
        .join(" ")}`,
    );
  } else {
    try {
      const { agentId, workspaceId } = await launchIntake(
        request,
        checkout,
        briefs,
        setup,
      );
      if (agentId) {
        record.agentId = agentId;
        record.workspaceId = workspaceId;
        log(`launched ${request.key} as agent ${agentId}`);
      } else {
        record.state = "failed";
        log(`launch for ${request.key} produced no agent`);
      }
    } catch (error) {
      record.state = "failed";
      log(`launch failed for ${request.key}: ${String(error)}`);
    }
  }

  const taken = await updateState((state) => {
    // Re-check inside the lock: another path may have taken this one in meanwhile.
    if (state.intake.some((existing) => existing.key === record.key))
      return false;
    state.intake.push(record);
    if (!state.seenPullRequests.includes(record.key))
      state.seenPullRequests.push(record.key);
    return true;
  });

  // One line per arrival, and only for the arrival that actually landed, so a
  // record taken in twice cannot read as two review requests.
  if (taken) {
    const arrival =
      origin === "manual"
        ? `added by hand, ${record.title}`
        : `review requested, ${record.title}`;
    note({
      source: "github",
      subject: record.key,
      what:
        record.state === "created" ? arrival : `${arrival} (${record.state})`,
      url: pullRequestUrl(record),
    });
  }
}
