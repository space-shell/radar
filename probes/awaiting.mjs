import "./guard.mjs";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// A record now arrives with its summary written by the intake turn, so the card
// has to tell apart a summary that has not arrived from one that is not coming.
// The only evidence is the agent's own status, read off the list the liveness
// check already fetches. This probe drives that read and the rule built on it.
// Group AD.
const STATE = join(process.env.HOME, ".local", "state", "radar");
const BIN = join(import.meta.dirname, "bin");
const FIX = join(process.env.HOME, "awaiting-fixtures");
process.env.PROBE_FIXTURES = FIX;

rmSync(FIX, { recursive: true, force: true });
rmSync(STATE, { recursive: true, force: true });
mkdirSync(FIX, { recursive: true });
mkdirSync(STATE, { recursive: true });

writeFileSync(
  join(STATE, "config.json"),
  JSON.stringify({ ghPath: join(BIN, "fake-gh"), paseoPath: join(BIN, "fake-paseo"), gitPath: "git" }, null, 1),
);

const summary = {
  headline: "h", changes: ["c"], risk: "r", scope: "s",
  generatedAt: "2026-10-16T08:00:00Z",
};

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

const agents = (list) => writeFileSync(join(FIX, "agents.json"), JSON.stringify(list));

const intake = [
  // Mid-turn with nothing written: the ordinary case this exists for.
  record(1),
  // `initializing` has not started yet but will, so it is still going to report.
  record(2),
  // Stopped with nothing written. A summary that is not coming.
  record(3),
  // Mid-turn, but the summary is already here. Nothing is awaited.
  record(4, { summary }),
  // Mid-turn on a QA run, not a summary. One agent runs both when the settings
  // give QA no model of its own, so the status alone would say the wrong thing.
  record(5, { review: { qa: { status: "running", startedAt: new Date().toISOString() } } }),
  // No agent at all, so no turn to be waiting on.
  record(6, { agentId: undefined }),
  // Its agent is gone. Orphaned rather than created, so the reconciler leaves
  // it where it is and the question is only whether it reads as awaiting.
  record(7, { agentId: "gone", state: "orphaned" }),
];

write(intake);
agents([
  { id: "a1", status: "running" },
  { id: "a2", status: "initializing" },
  { id: "a3", status: "idle" },
  { id: "a4", status: "running" },
  { id: "a5", status: "running" },
]);

const { reconcileAgents, workingAgents } = await import("../server/reconcile.ts");
const { readInboxState } = await import("../server/inbox.ts");
const { runSummary } = await import("../server/summary.ts");

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

const real = console.log;
let lines = [];
const capture = () => { lines = []; console.log = (m) => lines.push(String(m)); };
const release = () => { console.log = real; };
const said = (fragment) => lines.some((line) => line.includes(fragment));

const awaiting = async () => (await readInboxState()).summarising.sort();

// ---- A. The working set, read off the one list the tick already fetches. ----
capture();
await reconcileAgents();
release();

check("AD-A1 a running agent is working", workingAgents().has("a1"), true);
check("AD-A2 initializing is working, because it is still going to report", workingAgents().has("a2"), true);
check("AD-A3 idle is not", workingAgents().has("a3"), false);
check("AD-A4 an agent absent from the list is not", workingAgents().has("gone"), false);

// ---- B. What the screen is told is on its way. ------------------------------
check("AD-B1 only the records whose summary is still being written", await awaiting(), ["o/r#1", "o/r#2"]);

const got = await awaiting();
check("AD-B2 a stopped agent with nothing written is not awaited", got.includes("o/r#3"), false);
check("AD-B3 a summary already here is not awaited", got.includes("o/r#4"), false);
check("AD-B4 a running review stage is not a summary arriving", got.includes("o/r#5"), false);
check("AD-B5 a record with no agent is not awaited", got.includes("o/r#6"), false);
check("AD-B6 a record whose agent is gone is not awaited", got.includes("o/r#7"), false);

// ---- C. The press, which the agent's status cannot see on its own. ---------
/** A stand-in agent whose turn runs until the gate opens. */
const paseoWith = (gate) => ({
  agents: { ref: () => ({ refresh: async () => ({}), archivedAt: null, status: "idle", activeTurn: null, run: async () => { await gate; return { status: "idle" }; } }) },
});

let openGate;
const gate = new Promise((resolve) => { openGate = resolve; });
check("AD-C1 the press is accepted on a record whose agent has stopped", await runSummary("o/r#3", paseoWith(gate)), { ok: true });
check("AD-C2 and the screen is told, though no agent reads as working", (await awaiting()).includes("o/r#3"), true);

const second = new Promise(() => {});
await runSummary("o/r#1", paseoWith(second));
const both = await awaiting();
check("AD-C3 a press on a record already awaited is not listed twice", both.filter((key) => key === "o/r#1").length, 1);

openGate();
for (let i = 0; i < 200 && (await awaiting()).includes("o/r#3"); i++) {
  await new Promise((resolve) => setTimeout(resolve, 25));
}
check("AD-C4 the key leaves the list when the turn settles", (await awaiting()).includes("o/r#3"), false);

// ---- D. Where the answer must not be guessed at. ---------------------------
writeFileSync(join(FIX, "ls-fails"), "");
capture();
await reconcileAgents();
release();
check("AD-D1 an unreadable agent list is logged", said("cannot list agents"), true);
check("AD-D2 and leaves the last answer standing rather than claiming every agent died", workingAgents().has("a1"), true);
rmSync(join(FIX, "ls-fails"));

// Nothing watched: no record can be mid-turn, so a set left standing would be
// a claim about agents that are no longer anybody's.
write([record(8, { state: "archived" })]);
capture();
await reconcileAgents();
release();
check("AD-D3 with nothing watched the working set clears", workingAgents().size, 0);

console.log(failures === 0 ? "\nall clear" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
