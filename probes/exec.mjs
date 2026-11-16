import "./guard.mjs";

/**
 * A command with a timeout stops at it, and a failure is one sentence. Group AS.
 *
 * `execCommand`'s own `timeout` only sends SIGTERM and never escalates, so a
 * child that traps it runs for as long as it likes. The plugin's ticks are
 * serial, so one such child held every sweep, reap and Linear poll behind it
 * for 956 seconds against a declared 120. The trapping child here is the live
 * reproduction of that, in one second rather than sixteen minutes.
 */
const { run, causeOf } = await import("../server/exec.ts");

let fails = 0;
const check = (ok, name, detail = "") => {
  if (!ok) fails++;
  console.log(ok ? "pass" : "FAIL", name, ok ? "" : detail);
};

const refused = (promise) =>
  promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );

// ---- AS1. The bound is a bound. ---------------------------------------------
// The defect, first, through the SDK call the plugin used to make directly: a
// child that traps SIGTERM runs to its own end, and `execCommand` reports
// success at 2000ms against a declared timeout of 300.
const { execCommand } = await import("@getpaseo/plugin/server");
const loose = Date.now();
const unbounded = await refused(
  execCommand("bash", ["-c", 'trap "" TERM; sleep 2'], { timeout: 300 }),
);
const ran = Date.now() - loose;
check(
  unbounded.ok && ran > 1_500,
  "AS1 the SDK timeout alone is decorative: SIGTERM is a request",
  `${unbounded.ok ? "resolved" : "rejected"} after ${ran}ms`,
);

// The same child through `run`. SIGKILL cannot be trapped, so it lands.
const started = Date.now();
const trapped = await refused(
  run("bash", ["-c", 'trap "" TERM; sleep 2'], { timeout: 300 }),
);
const elapsed = Date.now() - started;
check(!trapped.ok, "AS1 wrapped, the same child fails the call");
check(
  elapsed < 1_500,
  "AS1 at the declared timeout rather than at the child's leisure",
  `${elapsed}ms`,
);

// And with a grandchild holding the inherited stdout pipe open, which is the
// shape that kept the real launch pending: still bounded.
const held = Date.now();
const orphaned = await refused(
  run("bash", ["-c", 'sleep 2 & trap "" TERM; sleep 2'], { timeout: 300 }),
);
const waited = Date.now() - held;
check(
  !orphaned.ok && waited < 1_500,
  "AS1 a grandchild holding the pipe does not extend the call",
  `${orphaned.ok ? "resolved" : "rejected"} after ${waited}ms`,
);

// The timer in `run` is the backstop under that, for a kill that does not land
// at all: a child wedged in an uninterruptible call cannot be reproduced here,
// which is exactly why the bound cannot rest on the signal alone.

// A command that finishes inside its timeout is untouched.
const fine = await run("bash", ["-c", "echo hello"], { timeout: 5_000 });
check(
  fine.stdout.trim() === "hello",
  "AS1 a prompt command is unaffected",
  fine.stdout,
);

// A command that fails on its own merits still rejects with its own output.
const failed = await refused(
  run("bash", ["-c", "echo nope >&2; exit 3"], { timeout: 5_000 }),
);
check(!failed.ok, "AS1 a non-zero exit is still a failure");
check(
  causeOf(failed.error) === "nope",
  "AS1 and its stderr survives the wrapper",
  causeOf(failed.error),
);

// ---- AS3. The cause, not the command. ---------------------------------------
// Shaped on the real one: 1250 characters of argv and brief prompt with the
// sentence that matters at character 1062.
const launch = Object.assign(
  new Error(`Command failed: paseo run --background ${"x".repeat(900)}`),
  {
    stderr: `Warning: --background is deprecated\n{"error":{"message":"failed to create worktree: fetch timed out"}}\n`,
  },
);
check(
  causeOf(launch) === "failed to create worktree: fetch timed out",
  "AS3 a JSON error message is lifted out of the noise",
  causeOf(launch),
);

const plain = Object.assign(new Error("Command failed: gh pr view 9990"), {
  stderr: "gh: Not Found (HTTP 404)\n",
});
check(
  causeOf(plain) === "gh: Not Found (HTTP 404)",
  "AS3 stderr with no JSON gives its last sentence",
  causeOf(plain),
);

const braced = Object.assign(new Error("Command failed"), {
  stderr:
    '{\n  "error": {\n    "message": "the daemon is not running"\n  }\n}\n',
});
check(
  causeOf(braced) === "the daemon is not running",
  "AS3 a pretty-printed error is read the same way",
  causeOf(braced),
);

const long = Object.assign(new Error("Command failed"), {
  stderr: `${"a".repeat(400)} boom`,
});
check(
  causeOf(long).length === 240 && causeOf(long).endsWith("…"),
  "AS3 a long one is clamped to a phone's worth and says it was",
  `${causeOf(long).length}`,
);

check(
  causeOf(new Error("the agent is gone")) === "the agent is gone",
  "AS3 an ordinary error with no stderr keeps its own message",
  causeOf(new Error("the agent is gone")),
);
check(
  causeOf("a bare string") === "a bare string",
  "AS3 and a bare string survives",
);
check(
  causeOf(Object.assign(new Error("Command failed"), { stderr: "{}\n}\n" })) ===
    "Command failed",
  "AS3 stderr that says nothing falls back to the message",
  causeOf(Object.assign(new Error("Command failed"), { stderr: "{}\n}\n" })),
);

// ---- AS3. The row's spoken label, which has no lines to wrap into. ----------
// The glyph's accessibility label is read aloud in full. 1250 characters of
// argv is a minute of speech before the reason, which sits at character 1062.
const { faultSummary } = await import("../shared/inbox.ts");

check(
  faultSummary("  no local checkout for o/r  ") === "no local checkout for o/r",
  "AS3 a short fault is spoken as written",
);
check(
  faultSummary("the git fetch\n  did not answer") ===
    "the git fetch did not answer",
  "AS3 a fault spanning lines is flattened, because speech has none",
  faultSummary("the git fetch\n  did not answer"),
);
const argv = `Command failed: paseo run --background ${"--label x ".repeat(200)}`;
check(
  faultSummary(argv).length === 120 && faultSummary(argv).endsWith("…"),
  "AS3 and a long one is cut to a sentence rather than read out whole",
  String(faultSummary(argv).length),
);

console.log(fails === 0 ? "\nall clear" : `\n${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
