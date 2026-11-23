import "./guard.mjs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  verificationAppearance,
  verificationSummary,
} from "../shared/appearance.ts";
import {
  verificationFileSchema,
  verificationStepSchema,
} from "../shared/findings.ts";
import { findingsPath } from "../server/findings.ts";
import { readFeedbackState } from "../server/feedback.ts";
import { STATE_DIR, statePath } from "../server/state.ts";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`,
  );
};

const theme = {
  colors: {
    accent: "#3b82f6",
    accentForeground: "#ffffff",
    surface2: "#1f2937",
    statusSuccess: "#22c55e",
    statusWarning: "#f59e0b",
    statusDanger: "#ef4444",
    foregroundMuted: "#9ca3af",
    border: "#374151",
  },
};

// AV1. A step that could not be run must not look like a step that passed.
// That is the whole defect: the screen drew both in the same neutral grey, so a
// run where six of seven steps were never attempted read as a run that went
// fine.
{
  const outcomes = ["passed", "failed", "not runnable"];
  const look = (outcome) => verificationAppearance(outcome, theme);
  const fields = [
    "glyph",
    "glyphColor",
    "background",
    "borderColor",
    "borderStyle",
  ];

  check(
    "AV1 no two outcomes share a glyph",
    new Set(outcomes.map((outcome) => look(outcome).glyph)).size,
    3,
  );
  const pairs = [];
  for (let i = 0; i < outcomes.length; i++) {
    for (let j = i + 1; j < outcomes.length; j++) {
      const left = look(outcomes[i]);
      const right = look(outcomes[j]);
      pairs.push(fields.filter((field) => left[field] !== right[field]).length);
    }
  }
  check("AV1 three pairs", pairs.length, 3);
  check(
    "AV1 and every one differs in at least three of the five fields",
    pairs.every((differing) => differing >= 3),
    true,
  );
  check(
    "AV1 not runnable is hollow and dashed, which neither of the others is",
    [
      look("not runnable").background,
      look("not runnable").borderStyle,
      look("passed").borderStyle,
      look("failed").borderStyle,
    ],
    ["transparent", "dashed", "solid", "solid"],
  );
  check(
    "AV1 and it is warning coloured, not danger and not success",
    look("not runnable").borderColor,
    theme.colors.statusWarning,
  );
  check(
    "AV1 an outcome this does not know still draws as unanswered",
    verificationAppearance("something else", theme).glyph,
    "?",
  );
}

// AV2. The one line above the list, which says how many were never attempted
// before a single card is read.
{
  const step = (outcome) => ({ outcome });
  check(
    "AV2 all passed",
    verificationSummary([step("passed"), step("passed")]),
    "2 steps, all passed.",
  );
  check(
    "AV2 one step is singular",
    verificationSummary([step("passed")]),
    "1 step, all passed.",
  );
  check(
    "AV2 the unattempted are counted",
    verificationSummary([
      step("passed"),
      step("not runnable"),
      step("not runnable"),
    ]),
    "3 steps, 2 could not be run.",
  );
  check(
    "AV2 failures are counted first",
    verificationSummary([
      step("failed"),
      step("not runnable"),
      step("passed"),
      step("passed"),
    ]),
    "4 steps, 1 failed, 1 could not be run.",
  );
  check(
    "AV2 an empty list says nothing about failures",
    verificationSummary([]),
    "0 steps, all passed.",
  );
}

// AV3. The reason is not optional in the data, which is what lets the screen
// promise one. A step that did not pass and says nothing is rejected at the
// schema, so the agent is the one made to answer rather than the reader.
{
  check(
    "AV3 a passing step needs no detail",
    verificationStepSchema.safeParse({ step: "Load it", outcome: "passed" })
      .success,
    true,
  );
  check(
    "AV3 an unattempted step with no reason is refused",
    verificationStepSchema.safeParse({
      step: "Load it",
      outcome: "not runnable",
      detail: "",
    }).success,
    false,
  );
  check(
    "AV3 whitespace is not a reason either",
    verificationStepSchema.safeParse({
      step: "Load it",
      outcome: "not runnable",
      detail: "   ",
    }).success,
    false,
  );
  check(
    "AV3 a failing step with no reason is refused the same way",
    verificationStepSchema.safeParse({
      step: "Load it",
      outcome: "failed",
      detail: "",
    }).success,
    false,
  );
  check(
    "AV3 and one that says why is accepted",
    verificationStepSchema.safeParse({
      step: "Load it",
      outcome: "not runnable",
      detail: "The preview runs the PR's web code against the production API.",
    }).success,
    true,
  );
  check(
    "AV3 the file refuses to be empty, because no steps says nothing",
    verificationFileSchema.safeParse({
      version: 1,
      key: "o/r#1",
      generatedAt: "2026-11-01T09:00:00.000Z",
      verification: [],
    }).success,
    false,
  );
  check(
    "AV3 an invented outcome is refused rather than drawn as unanswered",
    verificationStepSchema.safeParse({
      step: "Load it",
      outcome: "blocked",
      detail: "why",
    }).success,
    false,
  );
}

// AV4. Why the list is empty reaches the screen, which it never did: a stage
// that was skipped or that failed before writing a file left the wizard saying
// only that no steps were recorded.
{
  const key = "radar-probe/none#2";
  await rm(STATE_DIR, { recursive: true, force: true });
  await mkdir(STATE_DIR, { recursive: true });

  const write = async (review) =>
    writeFile(
      statePath,
      JSON.stringify({
        githubLastModified: null,
        lastSearchAt: null,
        seenPullRequests: [],
        intake: [
          {
            key,
            repo: "radar-probe/none",
            number: 2,
            title: "probe",
            firstSeen: "2026-11-01T09:00:00.000Z",
            state: "created",
            review,
          },
        ],
      }),
    );

  await write({ verification: { status: "skipped" } });
  check(
    "AV4 a skipped stage says so",
    (await readFeedbackState(key)).verificationStage,
    { status: "skipped" },
  );

  await write({
    verification: {
      status: "failed",
      error: "the agent is gone. Retry the record to make a new one",
    },
  });
  check(
    "AV4 a failed stage carries its error",
    (await readFeedbackState(key)).verificationStage,
    {
      status: "failed",
      error: "the agent is gone. Retry the record to make a new one",
    },
  );

  await write({ verification: { status: "pending" } });
  check(
    "AV4 a stage that never ran is pending rather than absent",
    (await readFeedbackState(key)).verificationStage.status,
    "pending",
  );

  await write({ verification: { status: "done", note: "7 steps" } });
  check(
    "AV4 a note rides along with the status",
    (await readFeedbackState(key)).verificationStage,
    { status: "done", note: "7 steps" },
  );

  // A record with no review at all is the pre-stages shape still on disk.
  await write(undefined);
  check(
    "AV4 a record written before stages existed reads as pending",
    (await readFeedbackState(key)).verificationStage.status,
    "pending",
  );

  // And the steps themselves still arrive, reason intact, when there are some.
  await write({ verification: { status: "done" } });
  const path = findingsPath("radar-probe/none", 2);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      key,
      generatedAt: "2026-11-01T09:00:00.000Z",
      findings: [],
      verification: [
        {
          step: "Open the preview and filter by date",
          outcome: "not runnable",
          detail:
            "The change is in apps/workflows, which the Vercel preview does not deploy.",
        },
      ],
    }),
  );
  const read = await readFeedbackState(key);
  check(
    "AV4 the reason survives the read whole",
    read.verification[0]?.detail,
    "The change is in apps/workflows, which the Vercel preview does not deploy.",
  );
  check(
    "AV4 and the stage status rides beside it",
    read.verificationStage.status,
    "done",
  );

  await rm(STATE_DIR, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nall pass" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
