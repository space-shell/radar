import "./guard.mjs";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * A tick that keeps going, and a failed launch that is tried again. Group AS.
 *
 * Two of the five faults behind `acme/web#9990` are here. One tick ran
 * every stage behind a single unguarded await, so an aborted notification poll
 * cost that tick its sweep, its reap and its Linear poll as well. And a launch
 * that failed was terminal: `intake` writes the key into `seenPullRequests`
 * whether or not the launch worked, so nothing but a press ever tried again.
 */
const HOME = process.env.HOME;
const FIX = join(HOME, "tick-fixtures");
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
const { stage } = await import("../server/tick.ts");
const { relaunchFailed } = await import("../server/actions.ts");

await rm(STATE_DIR, { recursive: true, force: true });
await mkdir(STATE_DIR, { recursive: true });
__setSettingsForTest(
  radarSettings.schema.parse({
    dryRun: false,
    paseoPath: join(BIN, "fake-paseo"),
    ghPath: join(BIN, "fake-gh"),
    gitPath: "git",
  }),
);

let failures = 0;
const check = (ok, name, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "pass" : "FAIL", name, ok ? "" : detail);
};

const real = console.log;
let lines = [];
const capture = () => {
  lines = [];
  console.log = (message) => lines.push(String(message));
};
const release = () => {
  console.log = real;
};
const said = (fragment) => lines.some((line) => line.includes(fragment));

// ---- AS4. One stage cannot take the rest of the tick down. ------------------
const ran = [];
capture();
await stage("the search", async () => {
  ran.push("search");
  throw new Error("AbortError: the operation was aborted");
});
await stage("the reap", async () => {
  ran.push("reap");
});
release();
check(
  ran.join(",") === "search,reap",
  "AS4 the stage after a failure still runs",
  ran.join(","),
);
check(
  said("the search failed: Error: AbortError: the operation was aborted"),
  "AS4 and the failure is named rather than swallowed",
  lines.join(" | "),
);
check(
  lines.length === 1,
  "AS4 a stage that works says nothing",
  lines.join(" | "),
);

capture();
let returned = "untouched";
returned = await stage("the Linear poll", async () => {
  throw new Error("boom");
});
release();
check(
  returned === undefined,
  "AS4 a failed stage resolves rather than rejecting",
  String(returned),
);

// ---- AS2. A failed launch is tried again. -----------------------------------
const HOURS_AGO = new Date(Date.now() - 3 * 3_600_000).toISOString();
const MINUTES_AGO = new Date(Date.now() - 60_000).toISOString();

const failed = (number, extra = {}) => ({
  key: `o/r#${number}`,
  repo: "o/r",
  number,
  title: `probe ${number}`,
  firstSeen: HOURS_AGO,
  state: "failed",
  lastError: "the git fetch did not answer",
  ...extra,
});

const seed = async (records) =>
  writeAtomic(
    statePath,
    JSON.stringify(
      {
        seenPullRequests: records.map((record) => record.key),
        intake: records,
      },
      null,
      2,
    ),
  );
const rowOf = async (number) =>
  (await loadState()).intake.find((record) => record.number === number);

// An agent is already running for #1, which is the path a relaunch should take:
// adopt what an earlier attempt left behind rather than build a second worktree.
await writeFile(
  join(FIX, "agents.json"),
  JSON.stringify([{ id: "adopted", cwd: "/w/one", status: "idle" }]),
);
await writeFile(
  join(FIX, "workspaces.json"),
  JSON.stringify([{ workspaceId: "ws-one", cwd: "/w/one" }]),
);

await seed([failed(1)]);
capture();
await relaunchFailed();
release();
const relaunched = await rowOf(1);
check(
  relaunched.state === "created",
  "AS2 a launch that failed hours ago is tried again",
  relaunched.state,
);
check(
  relaunched.agentId === "adopted",
  "AS2 and adopts the agent the failed attempt left behind",
  String(relaunched.agentId),
);
check(
  relaunched.lastError === undefined,
  "AS2 the fault is dropped once it is untrue",
  String(relaunched.lastError),
);
check(
  relaunched.launchAttempts === undefined &&
    relaunched.lastAttemptAt === undefined,
  "AS2 and the budget is forgotten, so the next failure starts fresh",
  JSON.stringify([relaunched.launchAttempts, relaunched.lastAttemptAt]),
);
check(
  said("o/r#1: relaunching, attempt 1 of 2"),
  "AS2 the log says which attempt this is",
  lines.join(" | "),
);
check(
  !existsSync(join(FIX, "launched.log")),
  "AS2 and no second worktree was built",
);

// Every reason a record is left alone, in one pass, so the find cannot pick
// one of them by accident.
await seed([
  failed(2, { firstSeen: MINUTES_AGO }),
  failed(3, { dismissedAt: new Date().toISOString() }),
  failed(4, {
    pr: {
      state: "merged",
      isDraft: false,
      decision: null,
      approvedBy: [],
      blockedBy: [],
      mine: null,
      checkedAt: new Date().toISOString(),
    },
  }),
  failed(5, { launchAttempts: 2, lastAttemptAt: HOURS_AGO }),
  failed(6, { state: "orphaned" }),
]);
capture();
await relaunchFailed();
release();
check(
  (await rowOf(2)).state === "failed",
  "AS2 a launch that failed a minute ago is left to settle",
);
check(
  (await rowOf(3)).state === "failed",
  "AS2 a dismissed record is not relaunched behind his back",
);
check(
  (await rowOf(4)).state === "failed",
  "AS2 nor is one whose pull request has since merged",
);
check(
  (await rowOf(5)).state === "failed",
  "AS2 nor one that has spent both its attempts",
);
check(
  (await rowOf(6)).state === "orphaned",
  "AS2 and only a failed launch is in scope at all",
);
check(
  lines.length === 0,
  "AS2 a pass with nothing due says nothing",
  lines.join(" | "),
);

// One per sweep: three launches are three timeouts, and a tick is serial.
await seed([failed(7), failed(8), failed(9)]);
capture();
await relaunchFailed();
release();
const moved = (await loadState()).intake.filter(
  (record) => record.state === "created",
);
check(
  moved.length === 1,
  "AS2 one record per sweep, so a tick cannot spend three launch timeouts",
  String(moved.length),
);
check(
  moved[0]?.number === 7,
  "AS2 and it is the oldest of them",
  String(moved[0]?.number),
);

// A relaunch that fails spends its attempt anyway, or the next tick spends it
// again, and again, for as long as the cause lasts.
await writeFile(join(FIX, "ls-fails"), "");
await seed([failed(10)]);
capture();
await relaunchFailed();
release();
const spent = await rowOf(10);
check(
  spent.state === "failed",
  "AS2 a relaunch that fails leaves the record failed",
  spent.state,
);
check(
  spent.launchAttempts === 1,
  "AS2 and the attempt is counted rather than repeated forever",
  String(spent.launchAttempts),
);
check(
  typeof spent.lastAttemptAt === "string",
  "AS2 dated, so the next attempt waits its quarter hour",
);
check(
  spent.lastError === "daemon unreachable",
  "AS2 and the stored fault is the cause, not the argv. AC-AS3",
  String(spent.lastError),
);
check(
  said("o/r#10: relaunch failed:"),
  "AS2 the failure is logged",
  lines.join(" | "),
);

// The second attempt, which is the last one.
await seed([failed(10, { launchAttempts: 1, lastAttemptAt: HOURS_AGO })]);
capture();
await relaunchFailed();
release();
check(
  (await rowOf(10)).launchAttempts === 2,
  "AS2 the second attempt is the last",
  String((await rowOf(10)).launchAttempts),
);
capture();
await relaunchFailed();
release();
check(
  lines.length === 0,
  "AS2 and after it the record waits for a press",
  lines.join(" | "),
);
await rm(join(FIX, "ls-fails"), { force: true });

await rm(FIX, { recursive: true, force: true });
console.log(failures === 0 ? "\nall clear" : `\n${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
