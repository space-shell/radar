import "./guard.mjs";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The daemon now tells radar what the tick used to go and ask. Three lifecycle
// events replace two polls, and the tick keeps both passes as a floor because a
// hook that fires while the daemon is down is never replayed. This probe drives
// the coalescing, the floor, and each of the three handlers. Group AE.
const STATE = join(process.env.HOME, ".local", "state", "radar");
const BIN = join(import.meta.dirname, "bin");
const FIX = join(process.env.HOME, "events-fixtures");
process.env.PROBE_FIXTURES = FIX;

rmSync(FIX, { recursive: true, force: true });
rmSync(STATE, { recursive: true, force: true });
mkdirSync(FIX, { recursive: true });
mkdirSync(join(STATE, "summaries", "o"), { recursive: true });

writeFileSync(
  join(STATE, "config.json"),
  JSON.stringify({ ghPath: join(BIN, "fake-gh"), paseoPath: join(BIN, "fake-paseo"), gitPath: "git" }, null, 1),
);

const record = (n, extra = {}) => ({
  key: `o/r#${n}`,
  repo: "o/r",
  number: n,
  title: `probe ${n}`,
  firstSeen: new Date(Date.now() - 3_600_000).toISOString(),
  state: "created",
  agentId: `a${n}`,
  ...extra,
});

const write = (records) =>
  writeFileSync(
    join(STATE, "seen.json"),
    JSON.stringify({ intake: records, seenPullRequests: [], githubLastModified: null, lastSearchAt: null, linearSweptAt: null, linearSeen: [], linearOpen: [] }, null, 1),
  );

/** A summary file of the shape the intake turn writes, waiting to be collected. */
const drop = (n) =>
  writeFileSync(
    join(STATE, "summaries", `o/r#${n}.json`),
    JSON.stringify({
      version: 1, key: `o/r#${n}`,
      headline: `what pull request ${n} does`,
      changes: ["one file, nine lines"],
      risk: "nothing breaks below 10k rows",
      scope: "the ticket and the diff agree",
      generatedAt: "2026-10-20T08:00:00Z",
    }),
  );

const stored = (n) => {
  const { intake } = JSON.parse(readFileSync(join(STATE, "seen.json"), "utf8"));
  return intake.find((candidate) => candidate.key === `o/r#${n}`);
};

const agents = (list) => writeFileSync(join(FIX, "agents.json"), JSON.stringify(list));

write([
  record(1),
  record(2),
  record(3),
  record(4),
  // No agent of its own, only one a task was given when the settings named it a
  // different model. The ledger holds that id, so an event about it is radar's
  // business though no record calls it its agent.
  record(5, { agentId: undefined, taskAgents: { qa: "q5" } }),
]);
agents([
  { id: "a1", status: "running" },
  { id: "a2", status: "running" },
  { id: "a3", status: "idle" },
  { id: "a4", status: "idle" },
  { id: "q5", status: "running" },
]);

const { coalesce } = await import("../server/single-flight.ts");
const { attachHooks, settleDue } = await import("../server/hooks.ts");
const { agentSettled, reconcileAgents, workingAgents } = await import("../server/reconcile.ts");

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

const rest = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Waits for a detached handler's effect, or gives up and lets the check fail. */
const until = async (holds) => {
  for (let i = 0; i < 200 && !holds(); i++) await rest(25);
};

// ---- A. Coalescing, which is what makes an event safe to act on at once. ----
{
  let runs = 0;
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  const ask = coalesce(async () => { runs++; await gate; });

  const first = ask();
  await rest(0);
  check("AE-A1 the first ask starts a pass", runs, 1);

  // Five events during one pass. Each says something changed after the pass had
  // begun reading, so one more pass is owed, and one is enough for all five.
  const during = [ask(), ask(), ask(), ask(), ask()];
  open();
  await Promise.all([first, ...during]);
  check("AE-A2 a burst during a pass collapses into one trailing pass", runs, 2);
  check("AE-A3 and a caller that arrived mid pass waits for the trailing one", runs, 2);
}

{
  let runs = 0;
  const ask = coalesce(async () => { runs++; throw new Error("no"); });
  let caught = null;
  await ask().catch((error) => { caught = error.message; });
  check("AE-A4 a failure reaches the caller", caught, "no");
  await ask().catch(() => {});
  check("AE-A5 and clears the slot, so the next ask runs rather than inheriting it", runs, 2);
}

{
  let runs = 0;
  const ask = coalesce(async () => { runs++; });
  await ask();
  await ask();
  check("AE-A6 asks that do not overlap each run", runs, 2);
}

// ---- B. The floor, which is what a missed event falls back to. -------------
drop(1);
await settleDue();
check("AE-B1 the first tick after a start runs the pass", stored(1).summary?.headline, "what pull request 1 does");

drop(2);
await settleDue();
check("AE-B2 a second tick inside the floor does not", stored(2).summary, undefined);

// ---- C. The working set, sharpened by the event rather than the list. ------
await reconcileAgents();
check("AE-C1 the list says a2 is mid turn", workingAgents().has("a2"), true);
agentSettled("a2");
check("AE-C2 and a settled turn takes it out at once, without waiting for a list", workingAgents().has("a2"), false);
agentSettled("nobody");
check("AE-C3 an agent that was never working is a no-op", workingAgents().has("a1"), true);

// ---- D. The three handlers. ------------------------------------------------
const fired = new Map();
const server = {
  on(name, handler) {
    fired.set(name, handler);
    return () => fired.delete(name);
  },
};
const detach = attachHooks(server);
check("AE-D1 three events are registered", [...fired.keys()].sort(), ["agent.archived", "agent.closed", "agent.turn_ended"]);

const agent = (id) => ({ agent: { id, workspaceId: "w", parentAgentId: null, provider: "p", cwd: "/", title: null }, turnId: "t", outcome: { kind: "completed" }, timeline: [] });
const emit = (name, id) => fired.get(name)(agent(id), { paseo: null, signal: new AbortController().signal });

// An agent nobody here owns. The daemon fires these for every agent on the
// machine, and radar owns a handful.
drop(3);
emit("agent.turn_ended", "stranger");
await rest(200);
check("AE-D2 a turn ending on an agent radar does not own changes nothing", stored(3).summary, undefined);

// The record whose file the floor refused. The hook is what makes it timely.
emit("agent.turn_ended", "a2");
await until(() => stored(2).summary);
check("AE-D3 a turn ending collects the summary the floor was still holding", stored(2).summary?.headline, "what pull request 2 does");

// Alone, so that nothing but the event about its own task agent can explain it.
drop(5);
emit("agent.turn_ended", "q5");
await until(() => stored(5).summary);
check("AE-D4 an agent a task was given of its own counts as radar's", stored(5).summary?.headline, "what pull request 5 does");

await reconcileAgents();
check("AE-D5 a1 is mid turn before the event", workingAgents().has("a1"), true);
emit("agent.closed", "a1");
check("AE-D6 a closed agent leaves the working set in the same tick", workingAgents().has("a1"), false);

// a4 leaves the daemon's list now rather than at the start, so nothing but the
// event can be what noticed.
agents([{ id: "a1", status: "running" }, { id: "a2", status: "idle" }, { id: "a3", status: "idle" }, { id: "q5", status: "idle" }]);
check("AE-D7 the record is whole before the event", stored(4).state, "created");
emit("agent.archived", "a4");
await until(() => stored(4).state === "orphaned");
check("AE-D8 an archived agent orphans the record that claimed it", stored(4).state, "orphaned");

detach();
check("AE-D9 cleanup removes every handler", fired.size, 0);

console.log(failures === 0 ? "\nall clear" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
