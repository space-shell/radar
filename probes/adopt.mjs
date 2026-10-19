import "./guard.mjs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { STATE_DIR, statePath, loadState } from "../server/state.ts";
import { adoptFindings } from "../server/qa.ts";
import { findingsPath } from "../server/findings.ts";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

await rm(STATE_DIR, { recursive: true, force: true });
await mkdir(STATE_DIR, { recursive: true });

const START = "2026-10-16T07:22:50Z";
const seed = async (qa) => {
  await writeFile(statePath, JSON.stringify({
    seenPullRequests: ["o/r#1"],
    intake: [{ key: "o/r#1", repo: "o/r", number: 1, title: "t", firstSeen: START, state: "created", agentId: "a",
      review: { acknowledge: { status: "done" }, qa, verification: { status: "pending" }, feedback: { status: "pending" } } }],
  }, null, 2));
};
const findings = async (generatedAt, count) => {
  const out = findingsPath("o/r", 1);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ version: 1, key: "o/r#1", generatedAt,
    findings: Array.from({ length: count }, (_, i) => ({ path: "a.ts", line: i + 1, side: "RIGHT", severity: "concern", body: "x".repeat(40) })),
    verification: [] }));
};
const qaOf = async () => (await loadState()).intake[0].review?.qa;

// Q8. The 9462 shape: the stage failed when the daemon died, the agent wrote later.
await seed({ status: "failed", startedAt: START, endedAt: "2026-10-16T07:26:08Z", error: "Daemon client closed" });
await findings("2026-10-16T07:30:23Z", 5);
await adoptFindings();
const adopted = await qaOf();
check("Q8 the stage is adopted as done", adopted?.status, "done");
check("Q8 with the same wording a waited run uses", adopted?.note, "5 findings");
check("Q8 the start is kept", adopted?.startedAt, START);
check("Q8 the failure reason is gone", adopted?.error, undefined);

// A file older than the attempt belongs to an earlier run and is left alone.
await seed({ status: "failed", startedAt: START, endedAt: "2026-10-16T07:26:08Z", error: "Daemon client closed" });
await findings("2026-10-15T09:00:00Z", 2);
await adoptFindings();
check("Q8 a stale file is not adopted", (await qaOf())?.status, "failed");

// Reopen is a decision to run it again. Skip is a decision not to. Neither is undone.
await findings("2026-10-16T07:30:23Z", 5);
await seed({ status: "pending" });
await adoptFindings();
check("Q8 a reopened stage is left pending", (await qaOf())?.status, "pending");

await seed({ status: "skipped", endedAt: "2026-10-16T07:40:00Z" });
await adoptFindings();
check("Q8 a skipped stage stays skipped", (await qaOf())?.status, "skipped");

// A running stage owns its own file. Adoption must not race the turn that is writing it.
await seed({ status: "running", startedAt: START });
await adoptFindings();
check("Q8 a running stage is left alone", (await qaOf())?.status, "running");

// Nothing on disk, nothing to adopt.
await rm(findingsPath("o/r", 1), { force: true });
await seed({ status: "failed", startedAt: START, endedAt: "2026-10-16T07:26:08Z", error: "the agent stopped" });
await adoptFindings();
check("Q8 no file leaves the failure standing", (await qaOf())?.error, "the agent stopped");

console.log(failures === 0 ? "all clear" : `${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
