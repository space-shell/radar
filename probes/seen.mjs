import "./guard.mjs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { STATE_DIR, statePath, loadState } from "../server/state.ts";
import { markRecordSeen } from "../server/inbox.ts";
import { activityAt, unseen } from "../shared/inbox.ts";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const pending = () => ({
  acknowledge: { status: "pending" },
  qa: { status: "pending" },
  verification: { status: "pending" },
  feedback: { status: "pending" },
});
const record = (fields) => ({
  key: "o/r#1",
  repo: "o/r",
  number: 1,
  title: "t",
  firstSeen: at(60),
  state: "created",
  review: pending(),
  ...fields,
});

await rm(STATE_DIR, { recursive: true, force: true });
await mkdir(STATE_DIR, { recursive: true });
const seed = async (fields) => {
  await writeFile(statePath, JSON.stringify({ seenPullRequests: ["o/r#1"], intake: [record(fields)] }, null, 2));
};

// AC-AC5. What counts as activity, and what deliberately does not.
check("AC5 arriving counts", activityAt(record({})) > 0, true);
check(
  "AC5 a settled stage counts, and is the later of the two",
  activityAt(record({ review: { ...pending(), qa: { status: "done", startedAt: at(40), endedAt: at(30) } } })) >
    activityAt(record({})),
  true,
);
check(
  "AC5 a failed stage counts too",
  activityAt(record({ review: { ...pending(), qa: { status: "failed", endedAt: at(10) } } })) >
    activityAt(record({})),
  true,
);
check(
  "AC5 a skip does not: it was James' own press",
  activityAt(record({ review: { ...pending(), qa: { status: "skipped", endedAt: at(1) } } })),
  activityAt(record({})),
);
check(
  "AC5 a stage merely starting does not",
  activityAt(record({ review: { ...pending(), qa: { status: "running", startedAt: at(1) } } })),
  activityAt(record({})),
);
check(
  "AC5 a sweep does not, or every record would stay lit",
  activityAt(record({ pr: { state: "open", isDraft: false, decision: null, approvedBy: [], blockedBy: [], mine: null, checkedAt: at(0) } })),
  activityAt(record({})),
);
check(
  "AC5 the summary landing does",
  activityAt(record({ summary: { headline: "h", changes: ["c"], risk: "r", scope: "s", generatedAt: at(5) } })) >
    activityAt(record({})),
  true,
);
check(
  "AC5 an unparseable generatedAt is ignored, not guessed at",
  activityAt(record({ summary: { headline: "h", changes: ["c"], risk: "r", scope: "s", generatedAt: "soon" } })),
  activityAt(record({})),
);

// AC-AC6. What the dot reads off.
check("AC6 never opened is unseen", unseen(record({})), true);
check("AC6 opened after it arrived is seen", unseen(record({ seenAt: at(30) })), false);
check(
  "AC6 a stage settling after the look is unseen again",
  unseen(record({ seenAt: at(30), review: { ...pending(), qa: { status: "done", endedAt: at(5) } } })),
  true,
);
check(
  "AC6 a stage settling before the look is not",
  unseen(record({ seenAt: at(5), review: { ...pending(), qa: { status: "done", endedAt: at(30) } } })),
  false,
);
check("AC6 dismissed never lights", unseen(record({ dismissedAt: at(1) })), false);
check("AC6 archived never lights", unseen(record({ state: "archived" })), false);
check(
  "AC6 a dismissed record stays dark even when a stage settles",
  unseen(record({ dismissedAt: at(10), review: { ...pending(), qa: { status: "done", endedAt: at(1) } } })),
  false,
);

// AC-AC7. The stamp, and the write loop it has to refuse.
await seed({});
check("AC7 marking an absent record is refused", await markRecordSeen("o/r#404"), { ok: false, error: "no such record" });
check("AC7 marking the record reports ok", await markRecordSeen("o/r#1"), { ok: true });
const marked = (await loadState()).intake[0];
check("AC7 and the record is no longer unseen", unseen(marked), false);

// A clock a minute fast on the agent that wrote the summary. The stamp must
// still settle it, or the screen asks to be marked seen on every refetch.
const ahead = new Date(Date.now() + 60_000).toISOString();
await seed({ summary: { headline: "h", changes: ["c"], risk: "r", scope: "s", generatedAt: ahead } });
await markRecordSeen("o/r#1");
const future = (await loadState()).intake[0];
check("AC7 a summary stamped in the future still settles in one write", unseen(future), false);
check("AC7 and the stamp reached it rather than stopping at now", Date.parse(future.seenAt) >= Date.parse(ahead), true);

console.log(failures === 0 ? "all clear" : `${failures} failures`);
