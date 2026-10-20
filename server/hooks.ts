import type { PluginServerContext } from "@getpaseo/plugin/server";
import { log } from "./log";
import { agentSettled, reconcileAgents } from "./reconcile";
import { coalesce } from "./single-flight";
import { reconcileStages } from "./stages";
import { loadState } from "./state";
import { collectSummaries } from "./summary";

/**
 * How long the tick may go without running the settle pass itself.
 *
 * The hooks are the timely path and this is only the floor beneath them, because
 * they are documented as live and best effort: no replay, no persistence, no
 * retry. A daemon that was not running when a turn ended is never told, and
 * nothing else would ever notice.
 *
 * Ten minutes rather than every tick because what the pass does is no longer
 * urgent. It used to spend up to thirty seconds inspecting an agent on every
 * tick for as long as a stage ran, which is a subprocess a minute spent asking
 * what the daemon now says for nothing. AC-AE4.
 */
const SETTLE_FLOOR_SECONDS = 600;

/**
 * When the settle pass last ran, hook or floor. Epoch zero at start, so the
 * first tick after a restart runs it: a restart is the one moment an event is
 * certain to have been missed. In memory for the same reason it is zero there,
 * which is that it is a fact about this process. AC-AE5.
 */
let lastSettleAt = 0;

/**
 * What a finished turn can have changed: a stage that was waiting on it, and a
 * summary file it may have written.
 *
 * The whole ledger rather than the one record, because both passes already sweep
 * it and the ledger is tens of records. A scoped variant would be a second path
 * saying the same thing, and two paths that must agree eventually do not.
 */
const settle = coalesce(async () => {
  lastSettleAt = Date.now();
  await reconcileStages();
  await collectSummaries();
});

/** What a vanished agent can have changed: a record that claimed it. */
const liveness = coalesce(async () => {
  await reconcileAgents();
});

/** The floor, called by the tick. Does nothing when a hook has been doing the work. */
export async function settleDue(): Promise<void> {
  if ((Date.now() - lastSettleAt) / 1000 < SETTLE_FLOOR_SECONDS) return;
  await settle();
}

/**
 * Every agent id the ledger holds: a record's own, and any a task was given of
 * its own when the settings named it a different model.
 *
 * Read from disk on each event rather than cached, because the event that matters
 * most is the first turn of an agent launched a moment ago, and a cache refreshed
 * on the tick would not know it yet. One small read against an event that fires
 * when a human finishes a turn is not a cost worth optimising. AC-AE6.
 */
async function radarAgents(): Promise<Set<string>> {
  const { intake } = await loadState();
  const ids = new Set<string>();
  for (const record of intake) {
    if (record.agentId) ids.add(record.agentId);
    for (const id of Object.values(record.taskAgents ?? {})) ids.add(id);
  }
  return ids;
}

/** Whether this agent is one of radar's. Every handler asks first: the daemon
 *  fires these for every agent on the machine, and radar owns a handful. AC-AE1. */
async function ours(agentId: string): Promise<boolean> {
  try {
    return (await radarAgents()).has(agentId);
  } catch (error) {
    log(`cannot tell whose agent ${agentId} is: ${String(error)}`);
    return false;
  }
}

/**
 * Runs the reaction without the hook waiting for it.
 *
 * A hook is abandoned at thirty seconds and a settle pass can inspect an agent
 * for that long on its own, so a handler that awaited its own work would report
 * a timeout on the very events that had the most to do. Nothing is waiting on
 * the answer: the result is a ledger write the screen refetches. The floor is
 * what covers a pass abandoned by a shutdown. AC-AE7.
 */
function detach(what: string, work: () => Promise<void>): void {
  void work().catch((error) => log(`${what} failed: ${String(error)}`));
}

/**
 * The daemon telling radar what it used to go and ask.
 *
 * Three events, each replacing a poll. `agent.turn_ended` is the one that earns
 * the most: it is exactly when a stage can have finished and when a summary file
 * can have appeared, which were two separate sweeps on a sixty second clock.
 * `agent.archived` and `agent.closed` are when a record can have lost its agent.
 *
 * None of them is trusted on its own. Hooks have no replay and no retry, so the
 * tick keeps running both passes as a floor: the agent list every tick, which is
 * one cheap call and is what keeps the summary indicator honest, and the settle
 * pass every ten minutes. AC-AE4.
 */
export function attachHooks(server: PluginServerContext): () => void {
  const off = [
    server.on("agent.turn_ended", (event) => {
      const id = event.agent.id;
      // Before the ownership read, and whether or not it is ours: the set only
      // ever holds radar's agents, so removing one that is not in it is a no-op.
      agentSettled(id);
      detach("turn_ended", async () => {
        if (!(await ours(id))) return;
        log(`${id} ended a turn, settling stages and summaries`);
        await settle();
      });
    }),

    server.on("agent.archived", (event) => {
      const id = event.agent.id;
      agentSettled(id);
      detach("archived", async () => {
        if (!(await ours(id))) return;
        log(`${id} was archived, rechecking the records that claim it`);
        await liveness();
      });
    }),

    /*
     * Closed is both: the session is gone, so a record that claimed it has lost
     * its agent, and a stage that was waiting on a turn will never get one.
     */
    server.on("agent.closed", (event) => {
      const id = event.agent.id;
      agentSettled(id);
      detach("closed", async () => {
        if (!(await ours(id))) return;
        log(`${id} closed, rechecking its records and their stages`);
        await liveness();
        await settle();
      });
    }),
  ];

  return () => {
    for (const remove of off) remove();
  };
}
