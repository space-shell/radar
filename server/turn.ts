import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { IntakeRecord } from "../shared/inbox";
import {
  agentFor,
  needsOwnAgent,
  providerString,
  TASK_LABELS,
  type AgentSpec,
  type Task,
} from "../shared/settings";
import { log } from "./log";
import { loadConfig } from "./settings";
import { updateState } from "./state";

/** The SDK handle the RPC context carries. Not exported from the plugin root. */
export type Paseo = PluginHandlerContext["paseo"];

/** Twenty minutes. A review turn that has not reported by then has gone wrong. */
export const TURN_TIMEOUT_MS = 20 * 60_000;

/**
 * Marks the record as having lost its agent. `orphaned` is retryable, so the row
 * offers Retry, which is the only control allowed to make a new agent. AC-E2.
 */
async function orphan(key: string, reason: string): Promise<void> {
  await updateState((state) => {
    const record = state.intake.find((candidate) => candidate.key === key);
    if (!record) return;
    record.state = "orphaned";
    record.lastError = reason;
  });
  log(`${key} marked orphaned: ${reason}`);
}

/** An agent that can still be sent a turn, or null if this one is past use. */
async function usable(paseo: Paseo, agentId: string) {
  const handle = paseo.agents.ref(agentId);
  // A `ref` handle reads null for everything until something delivers a snapshot.
  const refreshed = await handle.refresh().catch(() => null);
  if (!refreshed) return null;
  if (handle.archivedAt || handle.status === "closed") return null;
  return handle;
}

/** What `runStage` needs to queue a stage behind whatever the agent is doing. */
export interface StageGate {
  /** The lane to wait in, or null for work that will make its own agent. */
  agentId: string | null;
  ready(): Promise<boolean>;
}

/**
 * Whether the agent would take a turn right now.
 *
 * Deliberately not `usable()`. That answers null for both "the daemon did not
 * reply" and "the agent is gone", and those have to part company here: the first
 * is no evidence of anything and the wait continues, while the second will never
 * become true and the stage has to fail rather than sit in a lane forever. R6, R9.
 */
async function agentFree(paseo: Paseo, agentId: string): Promise<boolean> {
  const handle = paseo.agents.ref(agentId);
  const refreshed = await handle.refresh().catch(() => null);
  if (!refreshed) return false;
  if (handle.archivedAt || handle.status === "closed") {
    throw new Error("the agent is gone. Retry the record to make a new one");
  }
  return !handle.activeTurn;
}

/**
 * The lane a task's turn will wait in, worked out from the record alone.
 *
 * No SDK call, because this runs under the claim and has to answer before the
 * stage is written. A task running intake's own model queues on intake's agent,
 * which is the same agent James types into, and that is the whole reason the queue
 * exists. A task whose agent does not exist yet answers null: nothing can be
 * queued on an agent nobody shares, so it never waits.
 */
export async function gateFor(
  paseo: Paseo,
  record: IntakeRecord,
  task: Task,
): Promise<StageGate> {
  const settings = await loadConfig();
  const own = needsOwnAgent(settings, task) && record.workspaceId;
  const agentId = own
    ? (record.taskAgents?.[task] ?? null)
    : (record.agentId ?? null);

  return {
    agentId,
    ready: async () => (agentId ? agentFree(paseo, agentId) : true),
  };
}

/**
 * The agent for a task the settings gave a model of its own, created on first
 * use in the workspace intake already made.
 *
 * It is made here rather than at intake time because most records never reach
 * QA or verification, and an agent made for a turn nobody asks for is exactly
 * the kind of object this pipeline was built to stop accumulating.
 */
async function createTaskAgent(
  paseo: Paseo,
  record: IntakeRecord,
  task: Task,
  spec: AgentSpec,
): Promise<string> {
  const workspaceId = record.workspaceId;
  if (!workspaceId) throw new Error("the record has no workspace");

  const handle = await paseo.workspaces.ref(workspaceId).agents.create({
    config: {
      provider: providerString(spec),
      // Empty means the provider's own default, which is said by sending nothing.
      modeId: spec.mode || undefined,
      thinkingOptionId: spec.thinking || undefined,
    },
    title: `${TASK_LABELS[task]} PR #${record.number}`,
    labels: {
      inbox: "pr",
      pr: String(record.number),
      repo: record.repo,
      "radar-task": task,
    },
  });

  const id = handle.id;
  await updateState((state) => {
    const fresh = state.intake.find(
      (candidate) => candidate.key === record.key,
    );
    if (!fresh) return;
    fresh.taskAgents = { ...fresh.taskAgents, [task]: id };
  });
  log(
    `${record.key}: ${task} got its own agent ${id}, ${providerString(spec)}`,
  );
  return id;
}

/**
 * The live agent this task's turn should go to.
 *
 * A task running intake's own model is answered by intake's agent, so the usual
 * case creates nothing. A task given a different model gets an agent of its own,
 * reused across re-runs.
 *
 * The two halves fail differently on purpose. Intake's agent going missing is
 * the record losing its session, so the record is orphaned and only Retry may
 * make another. A task agent going missing costs nothing but the turn it was
 * holding: it is replaced in place and the record is left alone.
 */
async function agentForTurn(paseo: Paseo, record: IntakeRecord, task: Task) {
  const settings = await loadConfig();

  if (needsOwnAgent(settings, task) && record.workspaceId) {
    const spec = agentFor(settings, task);
    const existing = record.taskAgents?.[task];
    const live = existing ? await usable(paseo, existing) : null;
    if (live) return live;
    if (existing)
      log(`${record.key}: the ${task} agent is gone, making another`);

    const created = await createTaskAgent(paseo, record, task, spec);
    const handle = await usable(paseo, created);
    if (!handle) throw new Error(`the new ${task} agent could not be read`);
    return handle;
  }

  const agentId = record.agentId;
  if (!agentId) {
    await orphan(record.key, "the record has no agent");
    throw new Error("this record has no agent. Retry it to make one");
  }

  const handle = await usable(paseo, agentId);
  if (!handle) {
    await orphan(record.key, "the agent is gone, archived or closed");
    throw new Error("the agent is gone. Retry the record to make a new one");
  }
  return handle;
}

/**
 * Sends one prompt to the agent this task runs on and waits for that turn.
 *
 * It creates an agent only where the settings asked for a model intake is not
 * running, which is what keeps the agent count flat under the defaults. AC-E1,
 * AC-I6.
 *
 * Returns the agent's closing message, which is logged rather than trusted: the
 * findings file is the real output, and it is read separately.
 */
export async function askAgent(
  paseo: Paseo,
  record: IntakeRecord,
  task: Task,
  prompt: string,
  timeoutMs: number = TURN_TIMEOUT_MS,
): Promise<string> {
  const handle = await agentForTurn(paseo, record, task);

  // Sending into an open turn interrupts it, and that turn may be James talking to
  // the agent himself. The lane in `runStage` is what stops this being reached:
  // a press on a busy agent waits rather than being refused. This stays as the
  // backstop for any caller that queued on the wrong lane, and is logged loudly
  // because reaching it means the gate named an agent the turn did not go to.
  if (handle.activeTurn) {
    log(`${record.key}: ${task} reached a mid-turn agent despite the queue`);
    throw new Error("the agent is mid-turn. Let it finish, then press again");
  }

  const result = await handle.run(prompt, { timeoutMs });
  switch (result.status) {
    case "idle":
      return result.lastMessage ?? "";
    case "permission":
      throw new Error(
        "the agent is waiting on a permission. Open it, answer, then press again",
      );
    case "timeout": {
      const minutes = Math.max(1, Math.round(timeoutMs / 60_000));
      throw new Error(
        `the agent did not finish within ${minutes} minute${minutes === 1 ? "" : "s"}`,
      );
    }
    default:
      throw new Error(result.error ?? "the agent stopped with an error");
  }
}
