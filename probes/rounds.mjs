import "./guard.mjs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { STATE_DIR, statePath, loadState } from "../server/state.ts";
import { setStageStatus } from "../server/stages.ts";
import {
  emptyDraft,
  postedRounds,
  reopened,
  roundsOf,
} from "../shared/feedback.ts";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`,
  );
};

const round = (id, anchors = [], event = "COMMENT") => ({
  id,
  url: `https://github.com/o/r/pull/1#pullrequestreview-${id}`,
  event,
  submittedAt: `2026-10-2${id}T09:00:00.000Z`,
  comments: anchors.length,
  anchors,
});

// AP1. The history is a list, oldest first, and it is what every reader asks
// for rather than reaching into the record.
check("AP1 no feedback at all is no rounds", roundsOf(undefined), []);
check(
  "AP1 a draft with nothing sent is no rounds",
  roundsOf({ draft: emptyDraft() }),
  [],
);
check(
  "AP1 the list comes back in order",
  roundsOf({ draft: emptyDraft(), rounds: [round(1), round(2)] }).map(
    (r) => r.id,
  ),
  [1, 2],
);

// AP2. The shape every record written before group AP holds. One `submitted`
// object reads as a one round history, with no migration pass over the state
// file: the next write of that record replaces it with `rounds`.
{
  const legacy = { draft: emptyDraft(), submitted: round(7, ["a"]) };
  check(
    "AP2 a legacy submission is one round",
    roundsOf(legacy).map((r) => r.id),
    [7],
  );
  // Written before `anchors` existed, so the field is absent. The state file is
  // read as raw JSON rather than through the schema, so the default never fires
  // and an undefined here would crash every reader that iterates it.
  const older = {
    draft: emptyDraft(),
    submitted: { ...round(8), anchors: undefined },
  };
  check(
    "AP2 a round with no anchors field reads as none",
    roundsOf(older)[0].anchors,
    [],
  );
  check(
    "AP2 and rounds wins over submitted when both are stored",
    roundsOf({
      draft: emptyDraft(),
      rounds: [round(9)],
      submitted: round(7),
    }).map((r) => r.id),
    [9],
  );
}

// AP3. Which findings have already gone out, and in which round. The first
// round an anchor appears in, because that is when the thing was first said.
{
  const posted = postedRounds([round(1, ["a", "b"]), round(2, ["b", "c"])]);
  check("AP3 first round", posted.get("a"), 1);
  check(
    "AP3 a repeat keeps the round it was first raised in",
    posted.get("b"),
    1,
  );
  check("AP3 second round", posted.get("c"), 2);
  check("AP3 a finding never posted is not in the map", posted.has("d"), false);
  check("AP3 no rounds marks nothing", postedRounds([]).size, 0);
}

// AP4. Reopening keeps the history and decides the draft on one question: did a
// round actually go out. A reopen with nothing sent is James coming back to a
// review he was part way through, and emptying it there would be the loss.
{
  const typed = { ...emptyDraft(), body: "half written", step: 2 };
  const fresh = reopened({ draft: typed });
  check("AP4 nothing sent keeps the typing", fresh.draft, typed);
  check("AP4 and opens an empty history", fresh.rounds, []);

  const after = reopened({ draft: typed, rounds: [round(1, ["a"])] });
  check("AP4 a round sent empties the draft", after.draft, emptyDraft());
  check(
    "AP4 keeping the round that went out",
    after.rounds.map((r) => r.id),
    [1],
  );

  const legacy = reopened({ draft: typed, submitted: round(7) });
  check(
    "AP4 the legacy shape is folded on the way",
    legacy.rounds.map((r) => r.id),
    [7],
  );
  check("AP4 and the legacy key is dropped", legacy.submitted, undefined);
}

// AP4, AP5. The same transition through the RPC the map and the wizard both
// press. One `updateState` body, so no reader sees the stage pending with the
// last round's draft still under it.
await rm(STATE_DIR, { recursive: true, force: true });
await mkdir(STATE_DIR, { recursive: true });

const key = "o/r#1";
const seed = async (feedback, status) => {
  await writeFile(
    statePath,
    JSON.stringify(
      {
        seenPullRequests: [key],
        intake: [
          {
            key,
            repo: "o/r",
            number: 1,
            title: "t",
            firstSeen: new Date().toISOString(),
            state: "created",
            review: {
              acknowledge: { status: "done" },
              qa: { status: "done" },
              verification: { status: "done" },
              feedback: { status },
            },
            feedback,
          },
        ],
      },
      null,
      2,
    ),
  );
};
const stored = async () => (await loadState()).intake[0];
const ledgerLines = async () => {
  const dir = `${STATE_DIR}/ledger`;
  const names = await readdir(dir).catch(() => []);
  const bodies = await Promise.all(
    names.map((name) => readFile(`${dir}/${name}`, "utf8")),
  );
  return bodies
    .join("")
    .split("\n")
    .filter((line) => line.includes(key));
};

{
  const typed = { ...emptyDraft(), body: "half written" };
  await seed({ draft: typed, rounds: [round(1, ["a"])] }, "done");
  check(
    "AP5 reopening the feedback stage is allowed",
    (await setStageStatus(key, "feedback", "pending")).ok,
    true,
  );
  const live = await stored();
  check("AP5 the stage landed pending", live.review.feedback, {
    status: "pending",
  });
  check("AP4 and the draft went with it", live.feedback.draft, emptyDraft());
  check(
    "AP4 the round that went out is kept",
    live.feedback.rounds.map((r) => r.id),
    [1],
  );
  const lines = await ledgerLines();
  check(
    "AP5 the ledger names the round rather than an undo",
    lines.some((line) => line.includes("feedback round 2 opened")),
    true,
  );
  check(
    "AP5 and says nothing about reopening",
    lines.some((line) => line.includes("feedback reopened")),
    false,
  );
}

{
  const typed = { ...emptyDraft(), body: "half written" };
  await rm(`${STATE_DIR}/ledger`, { recursive: true, force: true });
  await seed({ draft: typed }, "done");
  check(
    "AP4 reopening with nothing sent is allowed",
    (await setStageStatus(key, "feedback", "pending")).ok,
    true,
  );
  check(
    "AP4 and the typing survived it",
    (await stored()).feedback.draft,
    typed,
  );
  const lines = await ledgerLines();
  check(
    "AP5 the ledger says reopened, because no round went out",
    lines.some((line) => line.includes("feedback reopened")),
    true,
  );
}

// AP5. The other stages are untouched by any of this: their note is the one it
// always was, and nothing clears a draft they do not own.
{
  await rm(`${STATE_DIR}/ledger`, { recursive: true, force: true });
  const typed = { ...emptyDraft(), body: "half written" };
  await seed({ draft: typed, rounds: [round(1, ["a"])] }, "done");
  check(
    "AP5 reopening qa is allowed",
    (await setStageStatus(key, "qa", "pending")).ok,
    true,
  );
  check(
    "AP5 and the feedback draft is untouched",
    (await stored()).feedback.draft,
    typed,
  );
  check(
    "AP5 the ledger says qa reopened",
    (await ledgerLines()).some((line) => line.includes("qa reopened")),
    true,
  );
}

// AP5. A record with no stored feedback at all. Reopening must not invent one:
// an empty draft written here would be indistinguishable from one James typed.
{
  await seed(undefined, "done");
  check(
    "AP5 reopening a record with no draft is allowed",
    (await setStageStatus(key, "feedback", "pending")).ok,
    true,
  );
  check(
    "AP5 and no feedback was invented",
    (await stored()).feedback,
    undefined,
  );
}

// Not torn down here. `note()` is fire and forget, so a `rm` of the state
// directory races the ledger write this file's own checks just triggered. The
// harness gives each probe a throwaway HOME and takes it away afterwards.
console.log(failures === 0 ? "\nall pass" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
