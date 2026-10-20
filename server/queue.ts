import { log } from "./log";

/**
 * One queue per agent, so a press that lands while the agent is mid-turn waits for
 * the turn instead of being refused.
 *
 * Under default settings every task on a record shares one agent, and James types
 * into that same agent, so "the agent is busy" is the ordinary case rather than the
 * exceptional one. Refusing was the old behaviour and it lost the press: QA and
 * verification run in the background, so the refusal arrived long after the screen
 * had already said the press was accepted.
 *
 * Keyed by agent id rather than by record, because a record whose settings give a
 * task its own model has two agents that genuinely do run at the same time.
 *
 * Head of line blocking is intended. Every entry is a press, so FIFO is press
 * order, and depth is capped at three by the single claim each of QA, verification
 * and summary already holds.
 */

/** How long a blocked lane waits before asking again, and how that grows. */
const FIRST_WAIT_MS = 2_000;
const WAIT_FACTOR = 1.5;
const MAX_WAIT_MS = 10_000;

const CANCELLED = "radar.lane.cancelled";

/**
 * A rejection meaning the turn was never sent, as opposed to one meaning it was
 * sent and went wrong. The caller settles those two differently: nothing happened
 * is `pending`, something happened and failed is `failed`.
 */
export function laneCancelled(reason: string): Error {
  const error = new Error(reason) as Error & { code?: string };
  error.code = CANCELLED;
  return error;
}

export function isLaneCancelled(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return (error as { code?: string }).code === CANCELLED;
}

interface Entry {
  ready: () => Promise<boolean>;
  start: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  /**
   * Set synchronously at promotion, before `start` is called, so anything that
   * wakes the lane in between sees an occupied head rather than promoting it twice.
   */
  running: boolean;
  detach: () => void;
}

interface Poll {
  handle: ReturnType<typeof setTimeout>;
  wait: number;
}

const lanes = new Map<string, Entry[]>();
const polls = new Map<string, Poll>();

/**
 * Lanes with an `ready()` in flight. Without this, two wakes arriving together
 * would both ask, and both would act on the answer.
 */
const asking = new Set<string>();

/**
 * Queues the work behind anything already queued for this agent.
 *
 * `ready` answers whether the agent can take a turn now. `false` waits. Throwing
 * gives up on this entry alone and lets the next one through, which is the right
 * shape for "the agent is gone": waiting forever for an agent that will never come
 * back is worse than failing the stage.
 *
 * `start` is called synchronously the moment the lane is free, so a caller can set
 * a flag in its synchronous prefix and have every other reader see it.
 *
 * The lane is released in a `finally` here rather than by discipline at the call
 * site, so a body that throws cannot wedge the queue.
 */
export function inLane<T>(
  agentId: string,
  ready: () => Promise<boolean>,
  start: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const entry: Entry = {
      ready,
      start: start as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
      running: false,
      detach: () => undefined,
    };

    const lane = lanes.get(agentId);
    if (lane) lane.push(entry);
    else lanes.set(agentId, [entry]);

    if (signal) {
      const onAbort = (): void => abort(agentId, entry);
      signal.addEventListener("abort", onAbort);
      entry.detach = () => signal.removeEventListener("abort", onAbort);
    }

    // A listener on an already aborted signal never fires, so that case is driven
    // by hand rather than left queued forever.
    if (signal?.aborted) abort(agentId, entry);
    else void evaluate(agentId);
  });
}

/** Entries waiting for an agent, across every lane. For probes and logging. */
export function lanesBlocked(): number {
  let waiting = 0;
  for (const lane of lanes.values()) {
    for (const entry of lane) if (!entry.running) waiting++;
  }
  return waiting;
}

/**
 * Drops every waiting entry and stops every timer, for plugin cleanup.
 *
 * A body already running keeps its lane, because its `finally` still has to find
 * the array it will shift itself from. Its turn is with the agent and cannot be
 * recalled; what this guarantees is that nothing new is sent and nothing holds the
 * daemon open.
 */
export function stopLanes(reason: string): void {
  const waiting = lanesBlocked();

  for (const [agentId, lane] of lanes) {
    clearWait(agentId);
    const running = lane.filter((entry) => entry.running);
    for (const entry of lane) {
      if (entry.running) continue;
      entry.detach();
      entry.reject(laneCancelled(reason));
    }
    if (running.length === 0) lanes.delete(agentId);
    else lanes.set(agentId, running);
  }

  if (waiting > 0) {
    log(
      `dropped ${waiting} queued ${waiting === 1 ? "turn" : "turns"}: ${reason}`,
    );
  }
}

/**
 * Promotes the head if the agent will take it, and otherwise arms the lane's own
 * timer. Nothing outside this module decides when a queued turn starts.
 */
async function evaluate(agentId: string): Promise<void> {
  const lane = lanes.get(agentId);
  if (!lane || lane.length === 0) {
    lanes.delete(agentId);
    clearWait(agentId);
    return;
  }

  const head = lane[0];
  // The body owns the lane until its `finally`, which evaluates again.
  if (head.running) return;
  // Whoever is already asking will promote, reject or arm, so the lane is never
  // left idle by returning here.
  if (asking.has(agentId)) return;
  asking.add(agentId);

  let free: boolean;
  try {
    free = await head.ready();
  } catch (error) {
    asking.delete(agentId);
    const current = lanes.get(agentId);
    if (current && current[0] === head) current.shift();
    head.detach();
    head.reject(error);
    clearWait(agentId);
    void evaluate(agentId);
    return;
  }
  asking.delete(agentId);

  // `ready` was awaited, so the lane may have moved underneath: the head can have
  // been aborted and spliced out while the answer was coming back. Re-read it
  // rather than trusting the capture.
  if (lanes.get(agentId)?.[0] !== head) {
    void evaluate(agentId);
    return;
  }

  if (!free) {
    arm(agentId);
    return;
  }

  // Synchronous from here into `start`, so nothing can land in between.
  head.running = true;
  head.detach();
  clearWait(agentId);
  run(agentId, head);
}

function run(agentId: string, entry: Entry): void {
  void (async () => {
    try {
      entry.resolve(await entry.start());
    } catch (error) {
      entry.reject(error);
    } finally {
      // The body is the only thing that shifts a running head. An evaluation can
      // resolve the head but never remove it, so the two cannot race.
      const lane = lanes.get(agentId);
      if (lane && lane[0] === entry) lane.shift();
      clearWait(agentId);
      void evaluate(agentId);
    }
  })();
}

/**
 * Takes a waiter out from wherever it sits, not just from the front.
 *
 * Aborting the running head is ignored on purpose: the turn is already with the
 * agent, and the body owns its own outcome. Cancel is a promise not to send a turn,
 * not a way to take one back.
 */
function abort(agentId: string, entry: Entry): void {
  if (entry.running) return;
  const lane = lanes.get(agentId);
  if (!lane) return;
  const at = lane.indexOf(entry);
  if (at < 0) return;

  lane.splice(at, 1);
  entry.detach();
  entry.reject(laneCancelled("cancelled before it started"));

  if (lane.length === 0) {
    lanes.delete(agentId);
    clearWait(agentId);
    return;
  }
  // Only the front changing is worth a new look, and the backoff starts again
  // because the entry now at the front has not asked yet.
  if (at === 0) {
    clearWait(agentId);
    void evaluate(agentId);
  }
}

/**
 * The lane's own clock. Polling rather than being told, because the two things
 * that could tell it are both worse: the turn ended hook has no documented
 * ordering against the daemon clearing `activeTurn`, and the reconcile pass's
 * working set is up to a tick stale, is cleared to empty when nothing is watched,
 * and is deliberately left standing when the agent list cannot be read.
 *
 * Unreferenced, so a press queued behind an agent nobody will ever return to
 * cannot be the reason the daemon will not exit.
 */
function arm(agentId: string): void {
  const current = polls.get(agentId);
  const wait = current
    ? Math.min(current.wait * WAIT_FACTOR, MAX_WAIT_MS)
    : FIRST_WAIT_MS;
  if (current) clearTimeout(current.handle);

  const handle = setTimeout(() => {
    void evaluate(agentId);
  }, wait);
  handle.unref();
  polls.set(agentId, { handle, wait });
}

/** Stops the timer and forgets the backoff, so the next wait starts short again. */
function clearWait(agentId: string): void {
  const current = polls.get(agentId);
  if (!current) return;
  clearTimeout(current.handle);
  polls.delete(agentId);
}
