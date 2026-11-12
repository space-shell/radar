import "./guard.mjs";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * A closed agent is asleep, not dead, and the plugin wakes it. Group AR.
 *
 * `closed` is the resting state of a Paseo agent: the daemon ends the provider
 * process when an agent goes quiet and keeps the session, so most agents on a
 * machine read `closed` while still holding their whole timeline. The plugin
 * used to read that as death, which made the second round on a pull request
 * unreachable: Run QA orphaned the record, Retry adopted the same closed agent
 * and wrote `created`, and the next Run orphaned it again, with nothing on any
 * screen able to break the circle.
 *
 * The fake daemon's one interesting property is that a reload lands. `refresh`
 * reads the log `fake-paseo` writes, so an agent whose process was restarted
 * comes back on the next read exactly as it does in life.
 */
const HOME = process.env.HOME;
const FIX = join(HOME, "revive-fixtures");
process.env.PROBE_FIXTURES = FIX;

const BIN = join(import.meta.dirname, "bin");
const PLUGIN_DIR = join(import.meta.dirname, "..");
const LOG = join(FIX, "reloaded.log");

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
const { askAgent } = await import("../server/turn.ts");
const { resolveLaunch } = await import("../server/intake.ts");
const { forgetRevivals } = await import("../server/agent.ts");
const { AGENT_GONE } = await import("../shared/review.ts");

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`,
  );
};

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

const KEY = "o/r#1";

const seed = async (agentId, extra = {}) => {
  await writeAtomic(
    statePath,
    JSON.stringify(
      {
        seenPullRequests: [KEY],
        intake: [
          {
            key: KEY,
            repo: "o/r",
            number: 1,
            title: "t",
            firstSeen: "2026-11-01T07:00:00Z",
            state: "created",
            agentId,
            workspaceId: "ws-1",
            ...extra,
          },
        ],
      },
      null,
      2,
    ),
  );
  return (await loadState()).intake[0];
};
const stored = async () => (await loadState()).intake[0];

/** Every reload `fake-paseo` was asked for, in order. */
const reloads = () =>
  existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter(Boolean) : [];
const reloadsOf = (id) => reloads().filter((line) => line === id).length;
/** The log records attempts, so a landed restart is an attempt the fixture allowed. */
const restarted = (id) =>
  reloadsOf(id) > 0 && !existsSync(join(FIX, `reload-fails-${id}`));

const world = new Map();
const agent = (id, patch) =>
  world.set(id, {
    status: "idle",
    archivedAt: null,
    refreshFails: false,
    /** Statuses handed out on successive reads once a reload has landed. */
    after: [],
    ...world.get(id),
    ...patch,
  });

const sent = [];
const paseo = {
  agents: {
    ref: (id) => ({
      get archivedAt() {
        return world.get(id)?.archivedAt ?? null;
      },
      get status() {
        return world.get(id)?.status ?? "idle";
      },
      activeTurn: null,
      refresh: async () => {
        const live = world.get(id);
        if (!live) return null;
        if (live.refreshFails) throw new Error("the daemon did not answer");
        // The restart the CLI performed, seen where the plugin would see it.
        if (live.after.length > 0 && restarted(id))
          live.status = live.after.shift();
        return {};
      },
      run: async (prompt) => {
        sent.push({ id, prompt });
        return { status: "idle", lastMessage: "ok" };
      },
    }),
  },
};

const refused = (promise) =>
  promise.then(
    () => null,
    (error) => String(error.message),
  );

// ---- AR10. A closed agent is woken, and the turn goes through. --------------
agent("a1", { status: "closed", after: ["idle"] });
await seed("a1");
await askAgent(paseo, await stored(), "qa", "run qa");
check("AR10 the closed agent was reloaded", reloadsOf("a1"), 1);
check(
  "AR10 and then took the turn",
  sent.map((turn) => turn.id),
  ["a1"],
);
const kept = await stored();
check(
  "AR10 the record keeps its session",
  [kept.state, kept.lastError],
  ["created", undefined],
);

// ---- AR15. A woken agent that is still starting is waited for. --------------
// `initializing` is started and cannot take a prompt yet. Sending into it is
// the one thing worse than waiting, because the turn is lost rather than late.
sent.length = 0;
agent("a2", { status: "closed", after: ["initializing", "idle"] });
await seed("a2");
await askAgent(paseo, await stored(), "qa", "run qa");
check("AR15 one reload, not one per read", reloadsOf("a2"), 1);
check(
  "AR15 the turn waited for it to finish starting",
  [sent.length, world.get("a2").status],
  [1, "idle"],
);

// ---- AR12. A restart that is refused is tried once, then believed. ----------
// The press has to fail: an agent that will not come back will never be free.
// The second press must not pay for another reload, because the lane asks this
// same question every few seconds and a reload is a process.
sent.length = 0;
await writeFile(join(FIX, "reload-fails-a3"), "");
agent("a3", { status: "closed", after: ["idle"] });
await seed("a3");
check(
  "AR12 the press is refused with the wording Retry answers",
  await refused(askAgent(paseo, await stored(), "qa", "run qa")),
  AGENT_GONE,
);
const lost = await stored();
check(
  "AR12 and the record is orphaned, which is what offers Retry",
  [lost.state, lost.lastError],
  ["orphaned", "the agent is gone: archived, or it would not restart"],
);
check("AR12 the reload was attempted", reloadsOf("a3"), 1);

await seed("a3");
check(
  "AR12 a second press is refused the same way",
  await refused(askAgent(paseo, await stored(), "qa", "run qa")),
  AGENT_GONE,
);
check("AR12 but costs no second reload", reloadsOf("a3"), 1);
check("AR12 and still sent nothing", sent.length, 0);
await rm(join(FIX, "reload-fails-a3"), { force: true });
forgetRevivals();

// ---- AR12. Two looks at one closed agent make one reload. -------------------
// Two stages queued on the same agent both ask at once. One restart, or the
// second kills the process the first just started.
sent.length = 0;
agent("a4", { status: "closed", after: ["idle"] });
const record = await seed("a4");
await Promise.all([
  askAgent(paseo, record, "qa", "run qa"),
  askAgent(paseo, record, "verification", "run verification"),
]);
check("AR12 concurrent looks share one reload", reloadsOf("a4"), 1);
check("AR12 and both turns went through", sent.length, 2);

// ---- AR13. An archived agent is gone, and no reload is attempted. -----------
// Archiving is a decision someone made. Restarting it would undo it.
sent.length = 0;
agent("a5", { status: "closed", archivedAt: "2026-11-01T00:00:00Z" });
await seed("a5");
check(
  "AR13 an archived agent is refused",
  await refused(askAgent(paseo, await stored(), "qa", "run qa")),
  AGENT_GONE,
);
check("AR13 without a reload", reloadsOf("a5"), 0);
check("AR13 and the record is orphaned", (await stored()).state, "orphaned");

// ---- AR14. What a launch adopts. --------------------------------------------
// `paseo ls` excludes archived agents and not closed ones, so every candidate
// here is one the old code would have taken without looking at its status.
const launch = async (agents, workspaces = []) => {
  await writeFile(join(FIX, "agents.json"), JSON.stringify(agents));
  await writeFile(join(FIX, "workspaces.json"), JSON.stringify(workspaces));
  return resolveLaunch({ repo: "o/r", number: 1 });
};

check(
  "AR14 a running agent beats a closed one, whichever is newer",
  await launch(
    [
      { id: "up", cwd: "/w/up", status: "idle" },
      { id: "down", cwd: "/w/down", status: "closed" },
    ],
    [{ workspaceId: "ws-up", cwd: "/w/up" }],
  ),
  { agentId: "up", workspaceId: "ws-up" },
);
check("AR14 and nothing was reloaded for it", reloadsOf("down"), 0);

check(
  "AR14 a closed agent is adopted once it has been woken",
  await launch(
    [{ id: "asleep", cwd: "/w/asleep", status: "closed" }],
    [{ workspaceId: "ws-asleep", cwd: "/w/asleep" }],
  ),
  { agentId: "asleep", workspaceId: "ws-asleep" },
);
check("AR14 which took a reload", reloadsOf("asleep"), 1);

// The circle this group exists to break. Adopting an id that cannot take a
// turn writes `created` onto the record and the next press writes `orphaned`,
// for as long as James is willing to keep pressing Retry.
await writeFile(join(FIX, "reload-fails-dead"), "");
check(
  "AR14 an agent that will not restart is not adopted",
  await launch(
    [{ id: "dead", cwd: "/w/dead", status: "closed" }],
    [{ workspaceId: "ws-dead", cwd: "/w/dead" }],
  ),
  {},
);
check("AR14 after one attempt to wake it", reloadsOf("dead"), 1);
await rm(join(FIX, "reload-fails-dead"), { force: true });
forgetRevivals();

// A CLI that reports no status at all is an older one, and its answer is the
// answer this code gave before the status existed: take the last agent.
check(
  "AR14 an agent list without statuses is adopted as before",
  await launch(
    [
      { id: "first", cwd: "/w/first" },
      { id: "last", cwd: "/w/last" },
    ],
    [{ workspaceId: "ws-last", cwd: "/w/last" }],
  ),
  { agentId: "last", workspaceId: "ws-last" },
);

check(
  "AR14 an agent with no cwd cannot be paired with a workspace, so it is skipped",
  await launch([{ id: "bare" }]),
  {},
);

console.log(failures === 0 ? "\nall clear" : `\n${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
