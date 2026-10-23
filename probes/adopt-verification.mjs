import "./guard.mjs";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { verificationFileSchema } from "../shared/findings.ts";
import { STATE_DIR, statePath, loadState } from "../server/state.ts";
import { adoptVerification } from "../server/verification.ts";
import { findingsPath, readFindings, verificationPath } from "../server/findings.ts";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

await rm(STATE_DIR, { recursive: true, force: true });
await mkdir(STATE_DIR, { recursive: true });

// AO1. The 9649 shape exactly: a passing step with no detail key at all.
const nine649 = { version: 1, key: "o/r#1", generatedAt: "2026-10-23T11:49:49Z", verification: [
  { step: "Set Run mode to Trigger and pick the document type.", outcome: "failed", detail: "No run-count request is sent at all." },
  { step: "Add a watchlist and confirm the estimate mounts.", outcome: "passed" },
] };
const parsed = verificationFileSchema.safeParse(nine649);
check("AO1 a passing step with no detail is accepted", parsed.success, true);
check("AO1 and reads as an empty detail", parsed.data?.verification[1].detail, "");
check("AO1 the failing step beside it survives", parsed.data?.verification[0].detail, "No run-count request is sent at all.");
check("AO2 a failing step with no detail is still refused",
  verificationFileSchema.safeParse({ ...nine649, verification: [{ step: "s", outcome: "failed" }] }).success, false);
check("AO2 so is one not runnable with nothing but spaces",
  verificationFileSchema.safeParse({ ...nine649, verification: [{ step: "s", outcome: "not runnable", detail: "   " }] }).success, false);

const START = "2026-10-23T11:13:29Z";
const seed = async (verification) => {
  await writeFile(statePath, JSON.stringify({
    seenPullRequests: ["o/r#1"],
    intake: [{ key: "o/r#1", repo: "o/r", number: 1, title: "t", firstSeen: START, state: "created", agentId: "a",
      review: { acknowledge: { status: "done" }, qa: { status: "done", note: "3 findings" }, verification, feedback: { status: "pending" } } }],
  }, null, 2));
};
const scratch = async (generatedAt, steps) => {
  const out = verificationPath("o/r", 1);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ version: 1, key: "o/r#1", generatedAt, verification: steps }));
};
const merged = async (findings) => {
  const out = findingsPath("o/r", 1);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ version: 1, key: "o/r#1", generatedAt: "2026-10-23T10:00:00Z",
    findings: Array.from({ length: findings }, (_, i) => ({ path: "a.ts", line: i + 1, side: "RIGHT", severity: "concern", body: "x".repeat(40) })),
    verification: [] }));
};
const stageOf = async () => (await loadState()).intake[0].review?.verification;
const exists = async (path) => access(path).then(() => true, () => false);
const FAILED = { status: "failed", startedAt: START, endedAt: "2026-10-23T11:30:34Z", error: "the verification file does not match the schema. verification.1.detail: Invalid input" };

// AO3. The 9649 timeline: the stage failed at 11:30:34, the agent rewrote at 11:49:49.
await seed(FAILED);
await merged(3);
await scratch("2026-10-23T11:49:49Z", nine649.verification);
await adoptVerification();
const adopted = await stageOf();
check("AO3 the stage is adopted as done", adopted?.status, "done");
check("AO3 with the same wording a waited run uses", adopted?.note, "2 steps, 1 failed");
check("AO3 the start is kept", adopted?.startedAt, START);
check("AO3 the schema failure is gone", adopted?.error, undefined);
const file = await readFindings(findingsPath("o/r", 1));
check("AO3 the steps reach the file the wizard reads", file.verification.length, 2);
check("AO3 and the code findings beside them are untouched", file.findings.length, 3);
check("AO3 the scratch file is cleared once merged", await exists(verificationPath("o/r", 1)), false);

// A file older than the attempt belongs to an earlier run and is left alone.
await seed(FAILED);
await merged(3);
await scratch("2026-10-23T09:00:00Z", nine649.verification);
await adoptVerification();
check("AO4 a stale file is not adopted", (await stageOf())?.status, "failed");
check("AO4 and is left on disk rather than cleared", await exists(verificationPath("o/r", 1)), true);

// Reopen is a decision to run it again. Skip is a decision not to. Neither is undone.
await scratch("2026-10-23T11:49:49Z", nine649.verification);
await seed({ status: "pending" });
await adoptVerification();
check("AO4 a reopened stage is left pending", (await stageOf())?.status, "pending");

await seed({ status: "skipped", endedAt: "2026-10-23T11:40:00Z" });
await adoptVerification();
check("AO4 a skipped stage stays skipped", (await stageOf())?.status, "skipped");

// A running stage owns its own file. Adoption must not race the turn writing it.
await seed({ status: "running", startedAt: START });
await adoptVerification();
check("AO4 a running stage is left alone", (await stageOf())?.status, "running");

// The 9633 shape: it stopped on a permission, and the file landed after the answer.
await rm(verificationPath("o/r", 1), { force: true });
await seed({ ...FAILED, error: "the agent is waiting on a permission. Open it, answer, then press again" });
await adoptVerification();
check("AO4 no file leaves the failure standing", (await stageOf())?.error, "the agent is waiting on a permission. Open it, answer, then press again");
await merged(3);
await scratch("2026-10-23T11:58:29Z", [
  { step: "a", outcome: "not runnable", detail: "no preview" },
  { step: "b", outcome: "not runnable", detail: "no preview" },
  { step: "c", outcome: "not runnable", detail: "no preview" },
]);
await adoptVerification();
check("AO4 a permission failure adopts once its file lands", (await stageOf())?.note, "3 steps, 3 not runnable");

console.log(failures === 0 ? "all clear" : `${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
