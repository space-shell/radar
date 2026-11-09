import "./guard.mjs";
import { summaryFileSchema } from "../shared/summary.ts";

const base = {
  version: 1,
  key: "owner/web#9999",
  generatedAt: "2026-10-16T09:00:00.000Z",
  headline:
    "Caches the company lookup, cutting the dashboard query count from 340 to 6.",
  changes: ["12 files, +310 / -88, all under apps/web/src/features/dashboard."],
  risk: "The map has no eviction, so a request touching 10k companies holds 10k entries.",
  scope:
    "ENG-1182 asked for the dashboard only. The change also touches the settings header.",
  verification: {
    required: true,
    steps:
      "Open the dashboard for a company with 50 holdings and confirm the rows render once.",
  },
};

const cases = [
  ["clean", base],
  ["em dash", { ...base, headline: "Caches the lookup — cutting queries." }],
  ["vague", { ...base, risk: "A significant improvement to throughput." }],
  [
    "vague -ly",
    { ...base, risk: "Throughput improves substantially under load." },
  ],
  ["hedge", { ...base, scope: "It's possible that the ticket covers this." }],
  ["just", { ...base, scope: "The ticket just covers the dashboard." }],
  [
    "second person",
    { ...base, risk: "Check your own callers before merging." },
  ],
  ["empty changes", { ...base, changes: [] }],
  [
    "seven changes",
    { ...base, changes: Array.from({ length: 7 }, (_, i) => `line ${i}`) },
  ],
  ["blank risk", { ...base, risk: "   " }],
  ["over length", { ...base, headline: "x".repeat(201) }],
  [
    "banned in a change",
    { ...base, changes: ["A notable refactor of the loader."] },
  ],
  ["no verification", { ...base, verification: undefined }],
  [
    "verification not required",
    {
      ...base,
      verification: {
        required: false,
        steps: "Covered by report-list.spec.ts, which asserts the query count.",
      },
    },
  ],
  [
    "required not a boolean",
    {
      ...base,
      verification: { required: "yes", steps: "Open the dashboard." },
    },
  ],
  ["blank steps", { ...base, verification: { required: false, steps: "   " } }],
  [
    "banned in steps",
    {
      ...base,
      verification: { required: true, steps: "Check your own dashboard." },
    },
  ],
];

for (const [name, value] of cases) {
  const result = summaryFileSchema.safeParse(value);
  const detail = result.success
    ? "accepted"
    : result.error.issues
        .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
        .join("; ");
  console.log(
    `${name.padEnd(20)} ${result.success ? "PASS" : "FAIL"}  ${detail}`,
  );
}

// The state file is the other schema, and it is read from disk rather than
// written by an agent. Every record already on James' machine predates the
// re-review fields, so the three new ones are optional and a record carrying
// none of them must still parse. A record dropped here is a blank row with no
// explanation, which is why `readInboxState` counts the drops. R10.
const { mkdirSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { readInboxState } = await import("../server/inbox.ts");

const STATE = join(process.env.HOME, ".local", "state", "radar");
mkdirSync(STATE, { recursive: true });

const seed = (intake) =>
  writeFileSync(
    join(STATE, "seen.json"),
    JSON.stringify({ intake, seenPullRequests: [] }, null, 1),
  );
const skeleton = (number, extra) => ({
  key: `o/r#${number}`,
  repo: "o/r",
  number,
  title: `probe ${number}`,
  firstSeen: "2026-10-01T09:00:00.000Z",
  state: "created",
  ...extra,
});
const say = (name, got, want) =>
  console.log(
    `${name.padEnd(20)} ${JSON.stringify(got) === JSON.stringify(want) ? "PASS" : `FAIL  got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`,
  );

// The `pr` shape as `refreshStatuses` wrote it before this round existed: no
// `headSha`, so no sha to compare and no stamp to read.
const oldPr = skeleton(1, {
  pr: {
    state: "open",
    isDraft: false,
    decision: "approved",
    approvedBy: ["someone"],
    blockedBy: [],
    mine: null,
    checkedAt: "2026-10-20T09:00:00.000Z",
  },
});
// A round from before the head and the comment ids were captured, and the
// `submitted` shape from before there was a list of them at all.
const legacyRounds = skeleton(2, {
  feedback: {
    draft: { comments: {}, body: "", approve: true, step: 0 },
    rounds: [
      {
        id: 41,
        url: "https://github.com/o/r/pull/2#pullrequestreview-41",
        event: "COMMENT",
        submittedAt: "2026-10-20T09:00:00.000Z",
        comments: 3,
      },
    ],
  },
});
const legacySubmitted = skeleton(3, {
  feedback: {
    draft: { comments: {}, body: "", approve: true, step: 0 },
    submitted: {
      id: 40,
      url: "https://github.com/o/r/pull/3#pullrequestreview-40",
      event: "APPROVE",
      submittedAt: "2026-10-19T09:00:00.000Z",
      comments: 0,
    },
  },
});

seed([oldPr, legacyRounds, legacySubmitted]);
const legacy = await readInboxState();
say("legacy state", legacy.unreadable, 0);
say("legacy records", legacy.records.length, 3);
// Read back in reverse, which is what the inbox draws.
const read = Object.fromEntries(legacy.records.map((r) => [r.key, r]));
say("old pr kept", read["o/r#1"].pr.decision, "approved");
say("old pr has no sha", read["o/r#1"].pr.headSha, undefined);
say("legacy round kept", read["o/r#2"].feedback.rounds[0].id, 41);
say("legacy round anchors", read["o/r#2"].feedback.rounds[0].anchors, []);
say("legacy round posted", read["o/r#2"].feedback.rounds[0].posted, undefined);
say("legacy submitted kept", read["o/r#3"].feedback.submitted.id, 40);

// The counter still works, and this is the reason every delta in this round is
// an optional field rather than a new enum member: a reader on an older copy of
// the shared schema drops the whole record for one unknown member, and the row
// goes blank with no way to tell why from the screen.
seed([oldPr, skeleton(4, { state: "rereviewing" })]);
const broken = await readInboxState();
say("unknown member", broken.unreadable, 1);
say("the rest survive", broken.records.length, 1);
