import "./guard.mjs";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { STATE_DIR, statePath, loadState } from "../server/state.ts";
import { runStage } from "../server/stages.ts";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

await rm(STATE_DIR, { recursive: true, force: true });
await mkdir(STATE_DIR, { recursive: true });
const seed = async () => {
  await writeFile(statePath, JSON.stringify({
    seenPullRequests: ["o/r#1"],
    intake: [{ key: "o/r#1", repo: "o/r", number: 1, title: "t", firstSeen: new Date().toISOString(), state: "created",
      review: { acknowledge: { status: "done" }, qa: { status: "pending" }, verification: { status: "pending" }, feedback: { status: "pending" } } }],
  }, null, 2));
};
const qa = async () => (await loadState()).intake[0].review?.qa;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Q1. A background stage answers the press long before the work ends.
await seed();
let released;
const gate = new Promise((r) => { released = r; });
const started = Date.now();
const answer = await runStage("o/r#1", "qa", async () => { await gate; return "3 findings"; }, { background: true });
const elapsed = Date.now() - started;
check("Q1 the press is answered ok", answer, { ok: true });
check("Q1 answered inside 500ms", elapsed < 500, true);

// Q2. The claim is on disk while the work runs, so the map says running.
check("Q2 the stage reads running mid-work", (await qa())?.status, "running");

// The work finishing settles the stage with no caller present.
released();
await sleep(150);
const settled = await qa();
check("Q2 the stage settles done", settled?.status, "done");
check("Q2 the note survives", settled?.note, "3 findings");

// A background failure lands on the stage, which is the only place left to put it.
await seed();
await runStage("o/r#1", "qa", async () => { throw new Error("the agent is mid-turn"); }, { background: true });
await sleep(150);
const failed = await qa();
check("Q2 a failure lands on the stage", failed?.status, "failed");
check("Q2 with its reason", failed?.error, "the agent is mid-turn");

// A second press while one is running is still refused, by the claim, not the caller.
await seed();
let hold;
const held = new Promise((r) => { hold = r; });
await runStage("o/r#1", "qa", async () => { await held; }, { background: true });
check("Q2 a second press is refused", await runStage("o/r#1", "qa", async () => "x", { background: true }), { ok: false, error: "qa is running" });
hold();
await sleep(100);

// Foreground mode is untouched: it still waits and still reports.
await seed();
check("Q2 foreground still waits", await runStage("o/r#1", "qa", async () => "1 finding"), { ok: true });
check("Q2 foreground settled before returning", (await qa())?.status, "done");

// AR7. A settle that cannot be written must not take the daemon with it.
//
// `work`'s own faults are caught inside `perform` and turned into a failed
// stage, but the settle that follows is not: `updateState`, `log` and `ledger`
// all sit outside that catch. Nothing holds a background promise, so a rejected
// settle was an unhandled rejection, and an unhandled rejection ends the plugin
// subprocess rather than the one stage. The state directory is made unwritable
// from inside the work, which is the one window where the claim is already on
// disk and the settle has not been written yet.
await seed();
let unhandled = null;
process.on("unhandledRejection", (reason) => {
  unhandled = String(reason);
});

const refused = await runStage(
  "o/r#1",
  "qa",
  async () => {
    await chmod(STATE_DIR, 0o555);
    return "3 findings";
  },
  { background: true },
);
await sleep(300);
await chmod(STATE_DIR, 0o755);

check("AR7 the press is still answered", refused, { ok: true });
check("AR7 and nothing is left unhandled", unhandled, null);
// The settle never ran, so the claim is the last thing written. That is the
// condition `reconcileStages` exists to unstick, on the tick.
check("AR7 the stage is left running", (await qa())?.status, "running");

console.log(failures === 0 ? "all clear" : `${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
