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
import { AGENT_GONE, NO_AGENT } from "../shared/review";
import { reviveAgent } from "./agent";
import { log } from "./log";
import { loadConfig } from "./settings";
import { updateState } from "./state";

/** The SDK handle the RPC context carries. Not exported from the plugin root. */
export type Paseo = PluginHandlerContext["paseo"];

/** Twenty minutes. A review turn that has not reported by then has gone wrong. */
export const TURN_TIMEOUT_MS = 20 * 60_000;

/** Why the record was orphaned, which is the footer's half of the same fact. */
const GONE_REASON = "the agent is gone: archived, or it would not restart";

/** A read that failed is not a record that lost its session, so it says so. */
const UNREADABLE = "the agent could not be read just now. Press again";

/** How long a just-restarted agent is given to finish starting. */
const SETTLE_MS = 20_000;
const SETTLE_STEP_MS = 1_000;

/**
 * Deliberately not `.unref()`'d, unlike the one in `server/stages.ts`. That one
 * is always the losing half of a `Promise.race`, so something else is holding
 * the loop open; this one is awaited alone. An unref'd timer that is the only
 * thing left lets the process exit mid-wait, and the press that was waiting on
 * it never settles at all: a hang rather than a failure. One second of held
 * event loop during shutdown is the cheaper side of that trade.
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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

/** The handle `paseo.agents.ref` answers with. The SDK exports no name for it. */
type AgentHandle = ReturnType<Paseo["agents"]["ref"]>;

/**
 * What one look at an agent establishes.
 *
 * Three outcomes rather than two, because "the daemon did not answer" and
 * "this agent is past use" have to part company everywhere, not just in the
 * lane. The first is no evidence of anything and a record must survive it; the
 * second will never become true. R6, R9.
 */
type Reading =
  | { kind: "live"; handle: AgentHandle }
  | { kind: "unreadable" }
  | { kind: "gone" };

interface AgentFacts {
  archived: boolean;
  status: string | null;
  handle: AgentHandle;
}

/** One refresh, or null when the daemon said nothing. */
async function readAgent(
  paseo: Paseo,
  agentId: string,
): Promise<AgentFacts | null> {
  const handle = paseo.agents.ref(agentId);
  // A `ref` handle reads null for everything until something delivers a snapshot.
  const refreshed = await handle.refresh().catch(() => null);
  if (!refreshed) return null;
  return { archived: handle.archivedAt != null, status: handle.status, handle };
}

/**
 * The agent this id names, restarted first if Paseo had closed its process.
 *
 * `closed` is the resting state of a Paseo agent, not its death: the daemon
 * ends the provider process when an agent goes quiet and keeps the session, so
 * most agents on a machine read `closed` while still holding their whole
 * timeline. Reading that as "gone" is what turned the ordinary second round on
 * a pull request into an orphaned record, and then into a Retry that adopted
 * the same closed agent and orphaned it again on the next press, with nothing
 * on any screen able to break the circle.
 *
 * Reviving from inside what the queue treats as a predicate is deliberate. The
 * lane's whole job is to get the turn sent, and a restart is what the turn
 * needs; the alternative is a screen that says "gone" and means "asleep". It is
 * attempted once per look, deduplicated and rate limited inside `reviveAgent`,
 * so a lane asking every few seconds cannot become a reload every few seconds.
 */
async function liveAgent(paseo: Paseo, agentId: string): Promise<Reading> {
  const facts = await readAgent(paseo, agentId);
  if (!facts) return { kind: "unreadable" };
  if (facts.archived) return { kind: "gone" };
  if (facts.status !== "closed") return { kind: "live", handle: facts.handle };

  log(`${agentId} is closed, restarting it`);
  if (!(await reviveAgent(agentId))) return { kind: "gone" };

  // `initializing` is an agent that has started and cannot take a prompt yet,
  // so the wait lives here rather than at the three call sites, every one of
  // which wants a handle it can send to.
  const deadline = Date.now() + SETTLE_MS;
  for (;;) {
    const back = await readAgent(paseo, agentId);
    if (!back) return { kind: "unreadable" };
    if (back.archived || back.status === "closed") return { kind: "gone" };
    if (back.status !== "initializing")
      return { kind: "live", handle: back.handle };
    if (Date.now() >= deadline) return { kind: "unreadable" };
    await wait(SETTLE_STEP_MS);
  }
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
 * An unreadable agent waits rather than failing: the daemon not answering is
 * no evidence of anything, and the stage must not be failed on it. R6, R9.
 *
 * It reports rather than throws, because what to do about a gone agent is not
 * the same question for every lane and the caller is the only one holding the
 * record. AC-AF18.
 */
async function agentFree(
  paseo: Paseo,
  agentId: string,
): Promise<"free" | "wait" | "gone"> {
  const reading = await liveAgent(paseo, agentId);
  if (reading.kind === "unreadable") return "wait";
  if (reading.kind === "gone") return "gone";
  return reading.handle.activeTurn ? "wait" : "free";
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
    ready: async () => {
      if (!agentId) return true;
      const free = await agentFree(paseo, agentId);
      if (free !== "gone") return free === "free";

      // A task agent that has gone is not a record that has lost its session:
      // `handleFor` makes another one on the spot, exactly as it does when the
      // id was never there. Failing the press here would send James to a Retry
      // he does not need, and Retry rebuilds the whole workspace.
      if (own) return true;

      // The shared agent is the record's session, and losing it is the record
      // losing its own. Marked here as well as thrown: `orphaned` is what puts
      // the Retry control on the row, and the sentence below is an instruction
      // to press it. Without the mark the row offers nothing and the only way
      // out of the message is to edit the state file. AC-E2, AC-AF18.
      await orphan(record.key, GONE_REASON);
      throw new Error(AGENT_GONE);
    },
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
 *
 * Neither half orphans on an unreadable agent. A daemon that did not answer is
 * not a record that lost its session, and nor is it grounds for a second task
 * agent in the same workspace: both are undone by pressing again.
 */
async function agentForTurn(paseo: Paseo, record: IntakeRecord, task: Task) {
  const settings = await loadConfig();

  if (needsOwnAgent(settings, task) && record.workspaceId) {
    const spec = agentFor(settings, task);
    const existing = record.taskAgents?.[task];
    if (existing) {
      const reading = await liveAgent(paseo, existing);
      if (reading.kind === "live") return reading.handle;
      if (reading.kind === "unreadable") throw new Error(UNREADABLE);
      log(`${record.key}: the ${task} agent is gone, making another`);
    }

    const created = await createTaskAgent(paseo, record, task, spec);
    const fresh = await liveAgent(paseo, created);
    if (fresh.kind !== "live")
      throw new Error(`the new ${task} agent could not be read`);
    return fresh.handle;
  }

  const agentId = record.agentId;
  if (!agentId) {
    await orphan(record.key, "the record has no agent");
    throw new Error(NO_AGENT);
  }

  const reading = await liveAgent(paseo, agentId);
  if (reading.kind === "unreadable") throw new Error(UNREADABLE);
  if (reading.kind === "gone") {
    await orphan(record.key, GONE_REASON);
    throw new Error(AGENT_GONE);
  }
  return reading.handle;
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
