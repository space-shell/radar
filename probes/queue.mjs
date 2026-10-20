import "./guard.mjs";
import { inLane, isLaneCancelled, lanesBlocked, stopLanes } from "../server/queue.ts";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

const defer = () => {
  let settle, fail;
  const promise = new Promise((resolve, reject) => { settle = resolve; fail = reject; });
  return { promise, settle, fail };
};
// Attached when the promise is made, read later, so nothing is ever an unhandled
// rejection and "still waiting" is observable without racing a timer.
const peek = (promise) => {
  let state = "pending";
  let value;
  promise.then((v) => { state = "fulfilled"; value = v; }, (e) => { state = "rejected"; value = e; });
  return { at: () => state, value: () => value };
};
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
// The lane's own timers are unreferenced, deliberately, so they cannot hold the
// daemon open. That means they also cannot hold this probe open: without a
// referenced timer of our own, node exits mid wait.
const keepalive = setInterval(() => undefined, 500);
const free = async () => true;
const busy = async () => false;

// AF1. A free lane runs at once, and the head is marked running before `start` is
// entered, so a wake landing inside `start` cannot promote it a second time.
let blockedInside = -1;
const first = await inLane("a1", free, async () => { blockedInside = lanesBlocked(); return "ran"; });
check("AF1 a free lane runs immediately", first, "ran");
check("AF1b the head is already running when start is entered", blockedInside, 0);

// AF2. FIFO, and the next entry waits for the whole body rather than the turn.
const order = [];
const bodies = [defer(), defer(), defer()];
const queued = bodies.map((body, i) =>
  inLane("a2", free, async () => { order.push(i); return body.promise; }));
queued.forEach((promise) => peek(promise));
await tick(20);
check("AF2 only the head runs", order, [0]);
check("AF2b the other two are waiting", lanesBlocked(), 2);
bodies[0].settle("x");
await tick(20);
check("AF2c the second starts when the first body settles, not before", order, [0, 1]);
bodies[1].settle("x");
await tick(20);
bodies[2].settle("x");
await Promise.all(queued);
check("AF2d three entries run in press order", order, [0, 1, 2]);

// AF3. A body that throws still releases the lane.
const thrown = inLane("a3", free, async () => { throw new Error("body broke"); });
const after3 = inLane("a3", free, async () => "next ran");
const broke = peek(thrown);
await tick(20);
check("AF3 the thrown error reaches its own caller", [broke.at(), String(broke.value())], ["rejected", "Error: body broke"]);
check("AF3b the entry behind it still runs", await after3, "next ran");

// AF4. Two agents are two lanes.
const held = defer();
const lane4a = inLane("a4", free, async () => held.promise);
peek(lane4a);
await tick(10);
check("AF4 a second agent is not blocked by the first", await inLane("a4b", free, async () => "independent"), "independent");
held.settle("done");
await lane4a;

// AF5. A blocked head is promoted by the lane's own timer, with nothing else poked.
let gate5 = false;
const began = Date.now();
const lane5 = inLane("a5", async () => gate5, async () => Date.now() - began);
setTimeout(() => { gate5 = true; }, 100);
const waited = await lane5;
check("AF5 the lane's own timer promotes it, at the first backoff step", [waited >= 1900, waited < 4000], [true, true]);

// AF6. Two wakes arriving together promote the head once.
const starts = [];
const held6 = defer();
const lane6 = inLane("a6", free, async () => { starts.push("head"); return held6.promise; });
const lane6b = inLane("a6", free, async () => { starts.push("behind"); return "b"; });
peek(lane6); peek(lane6b);
await tick(30);
check("AF6 two concurrent wakes promote the head exactly once", starts, ["head"]);
held6.settle("a");
await Promise.all([lane6, lane6b]);
check("AF6b and the one behind it follows", starts, ["head", "behind"]);

// AF7. `ready` throwing gives up on that entry alone.
const gone = inLane("a7", async () => { throw new Error("the agent is gone"); }, async () => "never");
const behind7 = inLane("a7", free, async () => "behind ran");
const lost = peek(gone);
await tick(20);
check("AF7 the entry whose ready threw rejects with its own error", [lost.at(), String(lost.value()), isLaneCancelled(lost.value())], ["rejected", "Error: the agent is gone", false]);
check("AF7b the next entry is promoted", await behind7, "behind ran");

// AF8. Waiting forever is waiting, not failing. No timeout exists to fire.
const patient = inLane("a8", busy, async () => "started");
const still = peek(patient);
await tick(2600);
check("AF8 a lane whose agent never frees keeps waiting past two backoff steps", [still.at(), lanesBlocked()], ["pending", 1]);

// AF9. An abort takes a waiter out of the middle and leaves the order behind it.
const order9 = [];
const head9 = defer();
const lane9 = inLane("a9", free, async () => { order9.push("head"); return head9.promise; });
await tick(10);
const canceller = new AbortController();
const a = inLane("a9", free, async () => { order9.push("a"); return "a"; });
const cancelled = inLane("a9", free, async () => { order9.push("cancelled"); return "c"; }, canceller.signal);
const c = inLane("a9", free, async () => { order9.push("c"); return "c"; });
const dropped = peek(cancelled);
peek(lane9);
canceller.abort();
await tick(10);
check("AF9 the aborted waiter rejects as cancelled", [dropped.at(), isLaneCancelled(dropped.value())], ["rejected", true]);
head9.settle("h");
await Promise.all([lane9, a, c]);
check("AF9b the entries behind it keep their order, and the aborted body never ran", order9, ["head", "a", "c"]);

// AF10. Cleanup drops every waiter and leaves no timer behind.
const stuck = [inLane("x1", busy, async () => "no"), inLane("x1", busy, async () => "no"), inLane("x2", busy, async () => "no")];
const watchers = [...stuck.map(peek), still];
await tick(20);
check("AF10 four waiters across three lanes", lanesBlocked(), 4);
stopLanes("the plugin stopped");
await tick(20);
check("AF10b every waiter is rejected as cancelled", watchers.map((w) => [w.at(), isLaneCancelled(w.value())]), [["rejected", true], ["rejected", true], ["rejected", true], ["rejected", true]]);
check("AF10c no lane is left holding anything", lanesBlocked(), 0);

clearInterval(keepalive);
console.log(failures === 0 ? "\nall clear" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
