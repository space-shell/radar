import "./guard.mjs";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { STATE_DIR, statePath, loadState } from "../server/state.ts";
import { setStageStatus } from "../server/stages.ts";
import { SKIPPABLE_STAGES, REVIEW_STAGES } from "../shared/review.ts";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

await rm(STATE_DIR, { recursive: true, force: true });
await mkdir(STATE_DIR, { recursive: true });

const seed = async (review) => {
  await writeFile(statePath, JSON.stringify({
    seenPullRequests: ["o/r#1"],
    intake: [{ key: "o/r#1", repo: "o/r", number: 1, title: "t", firstSeen: new Date().toISOString(), state: "created", review }],
  }, null, 2));
};
const stageOf = async (name) => (await loadState()).intake[0].review?.[name];

// O1. The constant itself. Two stages are absent, at the two ends of the
// pipeline: acknowledge, which is where the pull request is read, and feedback,
// which is where the review is written. AC-AG7.
const UNSKIPPABLE = ["acknowledge", "feedback"];
check("O1 acknowledge is not skippable", SKIPPABLE_STAGES.includes("acknowledge"), false);
check("O1 nor is feedback", SKIPPABLE_STAGES.includes("feedback"), false);
check("O1 the work in the middle is", REVIEW_STAGES.filter((s) => !UNSKIPPABLE.includes(s)).every((s) => SKIPPABLE_STAGES.includes(s)), true);
check("O1 and that is every stage accounted for", [...SKIPPABLE_STAGES].sort(), ["qa", "verification"]);

// O2. The server refuses the skip, and changes nothing.
await seed({ acknowledge: { status: "pending" }, qa: { status: "pending" }, verification: { status: "pending" }, feedback: { status: "pending" } });
check("O2 skipping acknowledge is refused", await setStageStatus("o/r#1", "acknowledge", "skipped"), { ok: false, error: "Acknowledge cannot be skipped" });
check("O2 the stage is untouched", await stageOf("acknowledge"), { status: "pending" });

// O3. A refusal writes no ledger line.
const week = await readFile(new URL("file://" + STATE_DIR + "/ledger").pathname, "utf8").catch(() => null);
check("O3 no ledger directory was created by the refusal", week, null);

// O4. The two in the middle still skip.
for (const stage of ["qa", "verification"]) {
  check(`O4 ${stage} skips`, (await setStageStatus("o/r#1", stage, "skipped")).ok, true);
  check(`O4 ${stage} landed skipped`, (await stageOf(stage)).status, "skipped");
}

// O4b. Feedback refuses in the same words acknowledge does, and leaves the
// stage alone. A record marked finished with nothing written is a map that lies
// about what was done, and "this one needs nothing from me" is Dismiss. AC-AG7.
check("O4b skipping feedback is refused", await setStageStatus("o/r#1", "feedback", "skipped"), { ok: false, error: "Feedback cannot be skipped" });
check("O4b the stage is untouched", await stageOf("feedback"), { status: "pending" });

// O5. Acknowledge can still be reopened: the refusal is about skipped, not the RPC.
await seed({ acknowledge: { status: "done", endedAt: "x" }, qa: { status: "pending" }, verification: { status: "pending" }, feedback: { status: "pending" } });
check("O5 reopening acknowledge is allowed", (await setStageStatus("o/r#1", "acknowledge", "pending")).ok, true);
check("O5 it landed pending", await stageOf("acknowledge"), { status: "pending" });

// O6. Running still wins: a running acknowledge refuses for the older reason.
await seed({ acknowledge: { status: "running", startedAt: "x" }, qa: { status: "pending" }, verification: { status: "pending" }, feedback: { status: "pending" } });
check("O6 a running stage refuses first", await setStageStatus("o/r#1", "acknowledge", "skipped"), { ok: false, error: "acknowledge is running" });

// O7. A record that does not exist still answers that, not the skip rule.
check("O7 unknown record", await setStageStatus("nope", "acknowledge", "skipped"), { ok: false, error: "no such record" });

console.log(failures === 0 ? "\nall pass" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
