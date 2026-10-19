import { homedir } from "node:os";
import { join } from "node:path";
import { execCommand } from "@getpaseo/plugin/server";
import { clearArtifact, prepareArtifact } from "./artifact";
import { briefPath } from "./briefs";
import { summaryPath } from "./summary";
import { baseAgent, providerString, type AgentSpec } from "../shared/settings";
import { loadConfig } from "./settings";
import { setupLines } from "./setup";
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
 * Every agent the daemon still holds. Archived agents are absent, which is what
 * makes this the cheap liveness check: one call covers every record. R3.
 */
export async function liveAgentIds(): Promise<Set<string>> {
  const agents = await lookupJson<{ id?: string }>([
    "ls",
    "--global",
    "--json",
  ]);
  return new Set(
    agents.map((agent) => agent.id).filter((id): id is string => Boolean(id)),
  );
}
