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

/**
 * The rows written to be accepted. Every other case in the table carries a
 * sentence the brief forbids, so being refused is the correct outcome for it.
 */
const ACCEPTED = new Set(["clean", "verification not required"]);

for (const [name, value] of cases) {
  const result = summaryFileSchema.safeParse(value);
  const detail = result.success
    ? "accepted"
    : result.error.issues
        .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
        .join("; ");
  /*
   * The verdict leads the line, and `FAIL` means failure.
   *
   * This printed `FAIL` for a refusal the table wanted, and put the case name
   * first either way. `probes/run.mjs:123` tests `line.startsWith("FAIL")`, so
   * this whole file counted as a probe that asserts nothing and reports: every
   * one of its fifty checks could break without the suite going red, which is
   * precisely what happened to the first write of the AR9 checks below.
   */
  const ok = result.success === ACCEPTED.has(name);
  console.log(`${ok ? "pass" : "FAIL"}  ${name.padEnd(22)} ${detail}`);
}

// The state file is the other schema, and it is read from disk rather than
// written by an agent. Every record already on James' machine predates the
// re-review fields, so the three new ones are optional and a record carrying
// none of them must still parse. A record dropped here is a blank row with no
// explanation, which is why `readInboxState` counts the drops. R10.
const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { forgetUnreadableRecord, readInboxState } =
  await import("../server/inbox.ts");

const STATE = join(process.env.HOME, ".local", "state", "radar");
mkdirSync(STATE, { recursive: true });

const seed = (intake, seenPullRequests = []) =>
  writeFileSync(
    join(STATE, "seen.json"),
    JSON.stringify({ intake, seenPullRequests }, null, 1),
  );
const stored = () => JSON.parse(readFileSync(join(STATE, "seen.json"), "utf8"));
const skeleton = (number, extra) => ({
  key: `o/r#${number}`,
  repo: "o/r",
  number,
  title: `probe ${number}`,
  firstSeen: "2026-10-01T09:00:00.000Z",
  state: "created",
  ...extra,
});
const say = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    `${ok ? "pass" : "FAIL"}  ${name.padEnd(22)} ${ok ? "" : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`,
  );
};

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
say("legacy state", legacy.unreadable, []);
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
seed([oldPr, skeleton(4, { state: "rereviewing" })], ["o/r#1", "o/r#4"]);
const broken = await readInboxState();
say("unknown member", broken.unreadable.length, 1);
say("the rest survive", broken.records.length, 1);

// AR9. A counted drop was a report of something James could neither see nor act
// on: no row, so no Retry and no Dismiss, and the key already in
// `seenPullRequests`, so no sweep would ever bring it back either.
say("the drop is named", broken.unreadable[0].key, "o/r#4");
say(
  "the reason names the field",
  broken.unreadable[0].reason.startsWith("state:"),
  true,
);

say("a readable record is refused", await forgetUnreadableRecord("o/r#1"), {
  ok: false,
  error: "that record reads fine now, leaving it",
});
say("and is still there", (await readInboxState()).records.length, 1);

say("the unreadable one goes", await forgetUnreadableRecord("o/r#4"), {
  ok: true,
});
say("nothing is left unreadable", (await readInboxState()).unreadable, []);
// Both halves, or the row never comes back: the key is what stops a sweep
// taking the same pull request in twice.
say("the key is forgotten too", stored().seenPullRequests, ["o/r#1"]);
say("a second forget finds nothing", await forgetUnreadableRecord("o/r#4"), {
  ok: false,
  error: "no such record",
});
