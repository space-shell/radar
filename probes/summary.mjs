import "./guard.mjs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { STATE_DIR, statePath, loadState } from "../server/state.ts";
import { runSummary, summarising, summaryPath } from "../server/summary.ts";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Waits for the detached turn to settle rather than guessing how long it takes. */
const settled = async () => { for (let i = 0; i < 200; i++) { if (summarising().length === 0) return; await sleep(25); } throw new Error("the turn never settled"); };

await rm(STATE_DIR, { recursive: true, force: true });
await mkdir(STATE_DIR, { recursive: true });
const seed = async (extra = {}) => {
  await writeFile(statePath, JSON.stringify({
    seenPullRequests: ["o/r#1"],
    intake: [{ key: "o/r#1", repo: "o/r", number: 1, title: "t", firstSeen: new Date().toISOString(), state: "created", agentId: "agent-1", ...extra }],
  }, null, 2));
};
const record = async () => (await loadState()).intake[0];

const file = {
  version: 1, key: "o/r#1",
  headline: "Adds a cached lookup for the report list, cutting the page to one query.",
  changes: ["report-list.ts replaces 40 per-row queries with one join, +12 / -31."],
  risk: "A stale cache serves a deleted report for up to 60 seconds.",
  scope: "ENG-1 asks for pagination as well. The diff adds none.",
  generatedAt: "2026-10-16T08:00:00Z",
};

/** A stand-in agent. `behave` decides what the turn does. */
const paseoWith = (behave) => ({
  agents: {
    ref: () => ({
      refresh: async () => ({}),
      archivedAt: null,
      status: "idle",
      activeTurn: null,
      run: behave,
    }),
  },
});

// Q1. The press returns before the turn does.
await seed();
let release;
const gate = new Promise((r) => { release = r; });
const started = Date.now();
const answer = await runSummary("o/r#1", paseoWith(async () => {
  await gate;
  const out = summaryPath("o/r", 1);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(file));
  return { status: "idle", lastMessage: "done" };
}));
check("Q1 the press is answered ok", answer, { ok: true });
check("Q1 answered inside 500ms", Date.now() - started < 500, true);

// Q3. The daemon says the turn is running while it runs.
check("Q3 summarising lists the key", summarising(), ["o/r#1"]);
check("Q3 a second press is refused", await runSummary("o/r#1", paseoWith(async () => ({ status: "idle" }))), { ok: false, error: "a summary is already running" });

release();
await settled();
check("Q3 the list empties when it settles", summarising(), []);
check("Q3 the summary landed", (await record()).summary?.headline, file.headline);
check("Q3 no error alongside a summary", (await record()).summaryError, undefined);

// Q4. A failure with no caller left is written to the record.
await seed({ summary: { headline: file.headline, changes: file.changes, risk: file.risk, scope: file.scope, generatedAt: file.generatedAt } });
await runSummary("o/r#1", paseoWith(async () => ({ status: "permission" })));
await settled();
check("Q4 the reason is on the record", (await record()).summaryError, "the agent is waiting on a permission. Open it, answer, then press again");
check("Q4 the old summary is left alone", (await record()).summary?.headline, file.headline);

// Q4. The next run clears the last reason before it starts.
let held;
const hold = new Promise((r) => { held = r; });
await runSummary("o/r#1", paseoWith(async () => { await hold; return { status: "idle" }; }));
check("Q4 the stale reason is gone at once", (await record()).summaryError, undefined);
held();
await settled();

// An unknown key is refused by the press itself, which still has a caller.
check("Q4 an unknown key is refused", await runSummary("o/r#9", paseoWith(async () => ({ status: "idle" }))), { ok: false, error: "no such record" });
check("Q4 a refused press leaves nothing claimed", summarising(), []);

console.log(failures === 0 ? "all clear" : `${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
