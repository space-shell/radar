import "./guard.mjs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { STATE_DIR, statePath, loadState } from "../server/state.ts";
import { collectSummaries, runSummary, summarising, summaryPath } from "../server/summary.ts";
import { intakeRecordSchema } from "../shared/inbox.ts";
import { summaryFileSchema } from "../shared/summary.ts";

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
  verification: { required: true, steps: "Open the report list for an account with 40 reports and confirm one query in the network panel." },
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

// AB. The collector, which is how a summary the intake turn wrote gets in.
const put = async (contents) => {
  const out = summaryPath("o/r", 1);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, typeof contents === "string" ? contents : JSON.stringify(contents));
  return out;
};
const there = async (path) => readFile(path, "utf8").then(() => true, () => false);

// A record with no summary and a valid file waiting takes it in, and the file
// goes, so the next sweep does no work for it.
await seed();
const landed = await put(file);
check("AB1 the file is collected", await collectSummaries(), 1);
check("AB1 and stored on the record", (await record()).summary?.headline, file.headline);
check("AB1 the file is cleared once it is in", await there(landed), false);
check("AB1 a second sweep finds nothing to do", await collectSummaries(), 0);

// A record that already has a summary is not overwritten by a file left behind.
// The press is the only thing that replaces one.
await seed({ summary: { ...file, headline: "The one already stored." } });
const loser = await put({ ...file, headline: "A later file that must not win." });
check("AB2 a record with a summary is skipped", await collectSummaries(), 0);
check("AB2 and keeps the one it had", (await record()).summary?.headline, "The one already stored.");
// Discarded, not left on disk. Left there it would be taken in by whichever
// sweep next found the record without a summary, landing a reading of an old
// diff on a record that had moved on.
check("AB2 and the file it ignored is gone", await there(loser), false);

// No file is the ordinary case: the turn has not finished. It is not an error
// and it must not be recorded as one.
await seed();
check("AB3 no file is no event", await collectSummaries(), 0);
check("AB3 and no error is invented", (await record()).summaryError, undefined);

// A file breaching the diction rules is discarded with its reason named, and
// cleared, so a bad file is reported once rather than on every tick.
await seed();
const bad = await put({ ...file, risk: "A significant risk to the cache." });
check("AB4 a breach is not stored", await collectSummaries(), 0);
check("AB4 and leaves no summary", (await record()).summary, undefined);
check("AB4 the reason names the word", /significant/.test((await record()).summaryError ?? ""), true);
check("AB4 the bad file is cleared", await there(bad), false);
check("AB4 so it is not reported twice", (await collectSummaries(), (await record()).summaryError !== undefined), true);

// Malformed JSON is the writer breaking, which is a different event from a turn
// that has not written yet. Both are met, neither throws.
await seed();
await put("{ not json");
check("AB5 malformed is not a crash", await collectSummaries(), 0);
check("AB5 and says so", /valid JSON/.test((await record()).summaryError ?? ""), true);

// A press holds the key while its own turn runs. Collecting underneath it would
// race the write that press is about to make.
await seed();
let unblock;
const pressing = new Promise((r) => { unblock = r; });
await runSummary("o/r#1", paseoWith(async () => { await pressing; return { status: "idle" }; }));
await put(file);
check("AB6 a key with a press in flight is left alone", await collectSummaries(), 0);
check("AB6 and nothing was stored under it", (await record()).summary, undefined);
unblock();
await settled();

// AN. The judgment call the card is there to support. Whether a change needs a
// person at a browser is the one thing read before deciding to spend a
// verification run, so it has to survive the write and it has to be demanded of
// the agent, without breaking a record summarised before it existed.
await seed();
await put(file);
await collectSummaries();
check("AN1 the verdict is stored, not dropped by the write", (await record()).summary?.verification, file.verification);

const without = { ...file };
delete without.verification;
check("AN2 the agent may not omit it", summaryFileSchema.safeParse(without).success, false);
check("AN3 but a record stored before it existed still parses", intakeRecordSchema.safeParse({
  key: "o/r#1", repo: "o/r", number: 1, title: "t",
  firstSeen: "2026-10-16T08:00:00Z", state: "created",
  summary: { headline: file.headline, changes: file.changes, risk: file.risk, scope: file.scope, generatedAt: file.generatedAt },
}).success, true);

const refused = summaryFileSchema.safeParse({ ...file, verification: { required: false, steps: "  " } });
check("AN4 not required still has to say why", refused.success, false);
check("AN5 and the diction rules reach inside it", summaryFileSchema.safeParse({ ...file, verification: { required: true, steps: "Check your own dashboard." } }).success, false);

console.log(failures === 0 ? "all clear" : `${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
