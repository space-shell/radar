import "./guard.mjs";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// Whether taking a pull request in adopts the agent already running for it, as
// Retry has always done, rather than building a second worktree beside the
// first. `seenPullRequests` is the ordinary guard against a second intake, but
// it lives in the same file as the records, so a state file lost or rolled back
// loses both at once. Group AR.
const HOME = process.env.HOME;
const STATE = join(HOME, ".local", "state", "radar");
const FIX = join(HOME, "adopt-fixtures");
const CLONES = join(HOME, "clones");
const WORKTREE = join(HOME, "worktrees", "web-42");
const BIN = join(import.meta.dirname, "bin");
const PLUGIN_DIR = join(import.meta.dirname, "..");
process.env.PROBE_FIXTURES = FIX;

for (const dir of [FIX, STATE, CLONES, WORKTREE]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

// A real clone, because `discoverCheckouts` keys on what git reports rather
// than on the directory name.
const clone = join(CLONES, "web");
mkdirSync(clone, { recursive: true });
const git = (...args) =>
  execFileSync("git", ["-C", clone, ...args], { stdio: "ignore" });
git("init", "-q");
git("remote", "add", "origin", "https://github.com/owner/web.git");

writeFileSync(
  join(FIX, "plugins.json"),
  JSON.stringify([{ id: "radar", path: PLUGIN_DIR }]),
);
writeFileSync(
  join(FIX, "workspaces.json"),
  JSON.stringify([{ workspaceId: "wks_live", cwd: WORKTREE }]),
);

const seed = (intake = [], seenPullRequests = []) =>
  writeFileSync(
    join(STATE, "seen.json"),
    JSON.stringify({ intake, seenPullRequests }, null, 1),
  );
writeFileSync(
  join(STATE, "config.json"),
  JSON.stringify(
    {
      ghPath: join(BIN, "fake-gh"),
      paseoPath: join(BIN, "fake-paseo"),
      gitPath: "git",
      checkoutRoots: [CLONES],
    },
    null,
    1,
  ),
);

const { intake, intakeEnvironment } = await import("../server/intake.ts");

let fails = 0;
const check = (ok, name, detail = "") => {
  if (!ok) fails++;
  console.log(ok ? "pass" : "FAIL", name, ok ? "" : detail);
};
const rowOf = (n) =>
  JSON.parse(readFileSync(join(STATE, "seen.json"), "utf8")).intake.find(
    (r) => r.number === n,
  );
const launched = () =>
  existsSync(join(FIX, "launched.log"))
    ? readFileSync(join(FIX, "launched.log"), "utf8").trim().split("\n")
    : [];

const request = {
  key: "owner/web#42",
  repo: "owner/web",
  number: 42,
  title: "Cache the lookup",
  url: "https://github.com/owner/web/pull/42",
  body: "",
};

// ---- AR8. The state file was lost; the agent was not. -----------------------
// The record and the key went together, so the next sweep reads this as a new
// review request while the first agent is still working in its worktree.
writeFileSync(
  join(FIX, "agents.json"),
  JSON.stringify([{ id: "agt_live", cwd: WORKTREE }]),
);
seed();
await intake(request, await intakeEnvironment(false));

check(
  launched().length === 0,
  "AR8 nothing is launched",
  launched().join(" | "),
);
check(
  rowOf(42)?.agentId === "agt_live",
  "AR8b the agent already running is adopted",
  String(rowOf(42)?.agentId),
);
check(
  rowOf(42)?.workspaceId === "wks_live",
  "AR8c with the workspace holding it, so Reap can still find it",
  String(rowOf(42)?.workspaceId),
);
check(
  rowOf(42)?.state === "created",
  "AR8d and the row is green rather than failed",
  String(rowOf(42)?.state),
);
check(
  rowOf(42)?.lastError === undefined,
  "AR8e with no fault on it",
  String(rowOf(42)?.lastError),
);

// ---- And with no agent to adopt, it still launches. -------------------------
// The fallback is the whole of the old behaviour: one `paseo run` with the argv
// `probes/intake.mjs` checks field by field.
rmSync(join(FIX, "agents.json"), { force: true });
rmSync(join(FIX, "launched.log"), { force: true });
seed();
await intake(request, await intakeEnvironment(false));

const argv = launched();
check(argv.length === 1, "AR8f one launch, not two", String(argv.length));
check(
  argv[0]?.includes("--pr-number 42") &&
    argv[0]?.includes("--worktree-mode checkout-pr"),
  "AR8g checked out at the pull request",
  argv[0] ?? "",
);
// The fake launches nothing, so the resolve that follows finds no agent. That
// is the named failure, and it is the one a Retry press can act on.
check(
  rowOf(42)?.state === "failed",
  "AR8h a launch that produced no agent is a named failure",
  String(rowOf(42)?.state),
);
check(
  rowOf(42)?.lastError === "launch produced no agent",
  "AR8i with the reason on the record",
  String(rowOf(42)?.lastError),
);

// ---- Dry run does not adopt, and does not launch. ---------------------------
// It is the one mode whose whole promise is that it touches nothing.
writeFileSync(
  join(FIX, "agents.json"),
  JSON.stringify([{ id: "agt_live", cwd: WORKTREE }]),
);
rmSync(join(FIX, "launched.log"), { force: true });
seed();
await intake(request, await intakeEnvironment(true));
check(launched().length === 0, "AR8j a dry run launches nothing");
check(
  rowOf(42)?.agentId === undefined,
  "AR8k and adopts nothing either",
  String(rowOf(42)?.agentId),
);
check(rowOf(42)?.state === "dry-run", "AR8l leaving the record where it was");

rmSync(FIX, { recursive: true, force: true });
console.log(fails === 0 ? "\nall clear" : `\n${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
