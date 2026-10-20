import "./guard.mjs";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * A press on a busy agent waits instead of being refused, and nothing a stage
 * does happens before the agent is free. Group AF.
 *
 * The fake daemon here has one property the other probes' fakes do not: a
 * mutable `activeTurn` per agent id. That is the whole subject. James typing
 * into the agent is an active turn, and every row below is about what the press
 * he makes while it is open does and does not do.
 *
 * It drives the real `runQa` rather than a stand-in body, because the thing
 * being protected is QA's own prefix: it clears the findings file before it
 * asks, so a gate around the turn rather than around the body would destroy a
 * review and then wait an hour. AC-F5, AC-AF13.
 */
const HOME = process.env.HOME;
const FIX = join(HOME, "queued-fixtures");
process.env.PROBE_FIXTURES = FIX;

const BIN = join(import.meta.dirname, "bin");
const PLUGIN_DIR = join(import.meta.dirname, "..");

await rm(FIX, { recursive: true, force: true });
await mkdir(FIX, { recursive: true });
await writeFile(
  join(FIX, "plugins.json"),
  JSON.stringify([{ id: "radar", path: PLUGIN_DIR }]),
);

const { STATE_DIR, statePath, loadState } = await import("../server/state.ts");
const { writeAtomic } = await import("../server/atomic.ts");
const { __setSettingsForTest } = await import("../server/settings.ts");
const { radarSettings } = await import("../shared/settings.ts");
const { reconcileStages, setStageStatus } = await import("../server/stages.ts");
const { adoptFindings, runQa } = await import("../server/qa.ts");
const { findingsPath } = await import("../server/findings.ts");
const { ledgerPath } = await import("../server/ledger.ts");
const { lanesBlocked, stopLanes } = await import("../server/queue.ts");

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

await rm(STATE_DIR, { recursive: true, force: true });
await mkdir(STATE_DIR, { recursive: true });
__setSettingsForTest(radarSettings.schema.parse({
  dryRun: false,
  paseoPath: join(BIN, "fake-paseo"),
  ghPath: join(BIN, "fake-gh"),
  gitPath: "git",
}));

const KEY = "o/r#1";
const OUT = findingsPath("o/r", 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qa = async () => (await loadState()).intake[0].review?.qa;

/** Waits for something the lane's own timer will bring about. Nothing pokes it. */
const until = async (predicate, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await predicate()) return true;
    await sleep(40);
  }
  return false;
};

const seed = async (stage = { status: "pending" }) => {
  await writeAtomic(statePath, JSON.stringify({
    seenPullRequests: [KEY],
    intake: [{
      key: KEY, repo: "o/r", number: 1, title: "t", firstSeen: "2026-10-20T07:00:00Z",
      state: "created", agentId: "a1", workspaceId: "ws-1",
      review: { acknowledge: { status: "done" }, qa: stage, verification: { status: "pending" }, feedback: { status: "pending" } },
    }],
  }, null, 2));
};

const findings = async (count, generatedAt = new Date().toISOString()) => {
  await mkdir(dirname(OUT), { recursive: true });
  await writeAtomic(OUT, JSON.stringify({
    version: 1, key: KEY, generatedAt,
    findings: Array.from({ length: count }, (_, i) => ({ path: "a.ts", line: i + 1, side: "RIGHT", severity: "concern", body: "x".repeat(40) })),
    verification: [],
  }));
};
const fileOnDisk = async () => JSON.parse(await readFile(OUT, "utf8").catch(() => "null"));

// The daemon, as far as the plugin can tell. `world` is mutable, so a turn can
// open and close under a press that is already waiting.
const world = new Map();
const agent = (id, patch) =>
  world.set(id, { status: "idle", archivedAt: null, activeTurn: false, refreshFails: false, ...world.get(id), ...patch });
let sent = [];
let hold = null;
let writes = 3;
const paseo = {
  agents: {
    ref: (id) => ({
      get archivedAt() { return world.get(id)?.archivedAt ?? null; },
      get status() { return world.get(id)?.status ?? "idle"; },
      get activeTurn() { return world.get(id)?.activeTurn ? { id: "turn" } : null; },
      refresh: async () => {
        const live = world.get(id);
        if (!live) return null;
        if (live.refreshFails) throw new Error("the daemon did not answer");
        return {};
      },
      run: async (prompt) => {
        sent.push({ id, prompt });
        if (hold) await hold;
        await findings(writes);
        return { status: "idle", lastMessage: "ok" };
      },
    }),
  },
};

const inspected = async () => (await readFile(join(FIX, "inspected.log"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
const forgetInspects = async () => { await rm(join(FIX, "inspected.log"), { force: true }); };
const ledgerSays = async (fragment) =>
  until(async () => (await readFile(ledgerPath(new Date()), "utf8").catch(() => "")).includes(fragment), 4000);

// ---- AF11 to AF14. The press lands, waits, and nothing of the body runs. ----
await seed();
agent("a1", { activeTurn: true });
await findings(2, "2026-10-20T07:10:00Z");
sent = [];
let release;
hold = new Promise((r) => { release = r; });

check("AF11 the press is answered ok", await runQa(KEY, paseo), { ok: true });
await sleep(300);
const queued = await qa();
check("AF11 the claim reads running", queued.status, "running");
check("AF11 with a queuedAt and no startedAt", [typeof queued.queuedAt, queued.startedAt], ["string", undefined]);
check("AF11 one lane is blocked", lanesBlocked(), 1);
check("AF13 no turn has been sent", sent.length, 0);
check("AF13 the previous findings file is untouched", (await fileOnDisk())?.generatedAt, "2026-10-20T07:10:00Z");
check("AF14 a second press is refused by the claim", await runQa(KEY, paseo), { ok: false, error: "qa is running" });
check("AF14 and queued nothing behind the first", lanesBlocked(), 1);

// The turn James was typing ends. Nothing is told: the lane's own timer finds it.
agent("a1", { activeTurn: false });
check("AF12 the lane promoted it on its own", await until(async () => (await qa()).startedAt != null), true);
const started = await qa();
check("AF12 the stage is still running", started.status, "running");
check("AF12 queuedAt is gone", started.queuedAt, undefined);
check("AF12 the start dates from the promotion, not the press", Date.parse(started.startedAt) > Date.parse(queued.queuedAt), true);
// Promotion is the write, and the turn is what follows it, in that order.
check("AF12 and the turn follows it", await until(async () => sent.length === 1, 2000), true);

release();
check("AF12 the stage settles done", await until(async () => (await qa()).status === "done"), true);
check("AF12 with what the turn produced", (await qa()).note, "3 findings");
check("AF12 no lane is left blocked", lanesBlocked(), 0);

// ---- AF15. Cancel, before the turn is sent. ---------------------------------
await seed();
agent("a1", { activeTurn: true });
await findings(2, "2026-10-20T07:10:00Z");
sent = [];
await runQa(KEY, paseo);
await sleep(300);
check("AF15 the cancel is accepted", await setStageStatus(KEY, "qa", "pending"), { ok: true });
check("AF15 the stage is back to pending, carrying nothing", await qa(), { status: "pending" });
check("AF15 no turn was sent", sent.length, 0);
check("AF15 the findings survived it", (await fileOnDisk())?.generatedAt, "2026-10-20T07:10:00Z");
check("AF15 the ledger records the cancel", await ledgerSays("qa cancelled before it started"), true);
check("AF15 the lane is empty", lanesBlocked(), 0);

// The promise a cancel makes is about the future: the agent going free later
// must not start the turn after all. Past the lane's first wait of two seconds.
agent("a1", { activeTurn: false });
await sleep(2600);
check("AF15 a freed agent does not revive a cancelled press", [sent.length, (await qa()).status], [0, "pending"]);

// ---- AF16. Once it has started, it is too late. -----------------------------
await seed();
agent("a1", { activeTurn: false });
sent = [];
hold = new Promise((r) => { release = r; });
await runQa(KEY, paseo);
check("AF16 a free agent starts at once", await until(async () => sent.length === 1, 2000), true);
check("AF16 cancel is refused once the turn is away", await setStageStatus(KEY, "qa", "pending"), { ok: false, error: "the turn has already started" });
check("AF16 and the stage is left running", (await qa()).status, "running");
release();
await until(async () => (await qa()).status === "done");

// ---- AF17. Skip is not a cancel, and does not pretend to be. ----------------
await seed();
agent("a1", { activeTurn: true });
sent = [];
await runQa(KEY, paseo);
await sleep(300);
check("AF17 skipping a queued stage is refused", await setStageStatus(KEY, "qa", "skipped"), { ok: false, error: "QA is queued. Cancel it first" });
check("AF17 the stage is untouched", (await qa()).status, "running");
await setStageStatus(KEY, "qa", "pending");

// ---- AF18. The two ways an agent can stop answering. ------------------------
// Gone for good. Waiting forever for an agent that will never be free is the
// one case where the press has to fail rather than wait.
await seed();
agent("a1", { activeTurn: true, status: "closed" });
sent = [];
await runQa(KEY, paseo);
check("AF18 a closed agent fails the queued stage", await until(async () => (await qa()).status === "failed"), true);
check("AF18 with the wording Retry answers", (await qa()).error, "the agent is gone. Retry the record to make a new one");
check("AF18 and no turn was sent", sent.length, 0);

// Unreadable is not gone. A daemon that did not answer is no evidence at all,
// so the press keeps its place. R6, R9.
await seed();
agent("a1", { activeTurn: true, status: "idle", refreshFails: true });
sent = [];
await runQa(KEY, paseo);
await sleep(2600);
const waiting = await qa();
check("AF18 an unreadable agent leaves the press queued", [waiting.status, typeof waiting.queuedAt], ["running", "string"]);
check("AF18 and still sends nothing", sent.length, 0);
await setStageStatus(KEY, "qa", "pending");
agent("a1", { refreshFails: false });

// ---- AF19 to AF21. The reconciler, which must not act on any of this. -------
await seed();
await writeFile(join(FIX, "agent-a1.json"), JSON.stringify({ Status: "idle" }));
agent("a1", { activeTurn: true });
sent = [];
await runQa(KEY, paseo);
await sleep(300);
await forgetInspects();
await reconcileStages();
const survived = await qa();
check("AF19 a live queued stage is left alone", [survived.status, typeof survived.queuedAt], ["running", "string"]);
check("AF19 and cost no inspect", await inspected(), []);
await setStageStatus(KEY, "qa", "pending");

// The restart case. The queue was memory, so nothing is left to promote this.
await seed({ status: "running", queuedAt: "2026-10-20T07:30:00Z" });
await forgetInspects();
await reconcileStages();
check("AF20 a queued stage with nothing holding it returns to pending", await qa(), { status: "pending" });
check("AF20 with no inspect, which a stopped agent would have cost", await inspected(), []);

// Defect 2. The agent is idle for the whole prep window, and an inspect in it
// used to write `failed` over work that was running, which handed the node a
// Run control and let a second press claim the stage.
await seed();
agent("a1", { activeTurn: false });
sent = [];
hold = new Promise((r) => { release = r; });
await runQa(KEY, paseo);
await until(async () => sent.length === 1, 2000);
await forgetInspects();
await reconcileStages();
const inprogress = await qa();
check("AF21 a stage this process is running is not failed by an idle agent", inprogress.status, "running");
check("AF21 nor given a reason it does not have", inprogress.error, undefined);
check("AF21 and cost no inspect either", await inspected(), []);
release();
check("AF21 it settles on its own terms", await until(async () => (await qa()).status === "done"), true);

// The same reading, with nothing in flight, is the case the rule is for.
await seed({ status: "running", startedAt: "2026-10-20T07:30:00Z" });
await forgetInspects();
await reconcileStages();
check("AF21 a stranded stage is still failed", (await qa()).status, "failed");
check("AF21 by the reason it was always given", (await qa()).error, "the agent stopped before the stage reported");
check("AF21 and that one did take an inspect", await inspected(), ["a1"]);

// ---- AF22. Adoption still dates from the turn, not from the press. ----------
// `startedAt` is written at promotion precisely so this comparison means the
// turn. A file older than the turn belongs to an earlier run.
await seed({ status: "failed", startedAt: "2026-10-20T08:05:00Z", endedAt: "2026-10-20T08:20:00Z", error: "Daemon client closed" });
await findings(4, "2026-10-20T08:02:00Z");
await adoptFindings();
check("AF22 a file written between the press and the turn is not adopted", (await qa()).status, "failed");

await findings(4, "2026-10-20T08:06:00Z");
await adoptFindings();
check("AF22 one written after the turn began is", (await qa()).status, "done");
check("AF22 with its count", (await qa()).note, "4 findings");

stopLanes("the probe ended");
__setSettingsForTest(null);
await rm(FIX, { recursive: true, force: true });
console.log(failures === 0 ? "\nall clear" : `\n${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
