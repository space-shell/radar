import "./guard.mjs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { STATE_DIR, statePath, loadState } from "../server/state.ts";
import { markRecordSeen } from "../server/inbox.ts";
import {
  activityAt,
  rereviewDue,
  rereviewNote,
  rerequested,
  unseen,
} from "../shared/inbox.ts";
import {
  anchorKey,
  carriedSchema,
  emptyDraft,
  parseAnchor,
  placeOf,
  postedPlaces,
  postedRounds,
  reopened,
  roundsOf,
} from "../shared/feedback.ts";
import { findingAppearance, shownState } from "../shared/appearance.ts";
import { nodeAppearance } from "../shared/appearance.ts";
import {
  bindRounds,
  carriedOf,
  carryFor,
  outcomeOf,
  scopeFor,
  unanchoredNote,
} from "../server/rereview.ts";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`,
  );
};

const AT = {
  round: "2026-11-01T09:00:00.000Z",
  before: "2026-11-01T08:00:00.000Z",
  after: "2026-11-01T10:00:00.000Z",
};

const round = (id, anchors = [], headSha, submittedAt = AT.round) => ({
  id,
  url: `https://github.com/o/r/pull/1#pullrequestreview-${id}`,
  event: "COMMENT",
  submittedAt,
  comments: anchors.length,
  anchors,
  ...(headSha ? { headSha } : {}),
});

const record = (pr, rounds = [], extra = {}) => ({
  key: "o/r#1",
  repo: "o/r",
  number: 1,
  title: "t",
  firstSeen: "2026-10-01T09:00:00.000Z",
  state: "created",
  ...(rounds.length > 0 ? { feedback: { draft: emptyDraft(), rounds } } : {}),
  ...(pr ? { pr: { state: "open", mine: false, ...pr } } : {}),
  ...extra,
});

// AQ1. The marker fires on a push that landed after the round went out, and on
// nothing else. The two false positives are the whole reason it takes two facts
// rather than one: `headMovedAt` alone fires for the first sweep after every
// submit, because `pr.headSha` is a sweep old and submitting does not refresh
// it; `headSha` alone fires for a push GitHub had already folded into the round.
{
  check(
    "AQ1 a push after the round is due",
    rereviewDue(
      record({ headSha: "bbb", headMovedAt: AT.after }, [
        round(1, ["a"], "aaa"),
      ]),
    ),
    true,
  );
  check(
    "AQ1 no round out is never due",
    rereviewDue(record({ headSha: "bbb", headMovedAt: AT.after })),
    false,
  );
  check(
    "AQ1 no push recorded is not due",
    rereviewDue(record({ headSha: "bbb" }, [round(1, ["a"], "aaa")])),
    false,
  );
  check(
    "AQ1 a push the round already folded in is not due",
    rereviewDue(
      record({ headSha: "bbb", headMovedAt: AT.before }, [
        round(1, ["a"], "aaa"),
      ]),
    ),
    false,
  );
  // The sweep right after a submit: the stamp is newer than the round, but the
  // head the sweep last read is the very commit the round went out against.
  check(
    "AQ1 the sweep after a submit, with the head still the round's own, is not due",
    rereviewDue(
      record({ headSha: "aaa", headMovedAt: AT.after }, [
        round(1, ["a"], "aaa"),
      ]),
    ),
    false,
  );
  check(
    "AQ1 a closed pull request is never due",
    rereviewDue(
      record({ state: "closed", headSha: "bbb", headMovedAt: AT.after }, [
        round(1, ["a"], "aaa"),
      ]),
    ),
    false,
  );
  check(
    "AQ1 a dismissed record is never due",
    rereviewDue(
      record(
        { headSha: "bbb", headMovedAt: AT.after },
        [round(1, ["a"], "aaa")],
        {
          dismissedAt: AT.after,
        },
      ),
    ),
    false,
  );
  // A round that recorded no head is every round written before this existed.
  // The timestamp is then the only fact there is, and it is enough to mark.
  check(
    "AQ1 a legacy round with no head still marks on the stamp alone",
    rereviewDue(
      record({ headSha: "bbb", headMovedAt: AT.after }, [round(1, ["a"])]),
    ),
    true,
  );

  check(
    "AQ1 a re-request after the round is a re-request",
    rerequested(
      record({ headSha: "aaa", rerequestedAt: AT.after }, [
        round(1, ["a"], "aaa"),
      ]),
    ),
    true,
  );
  check(
    "AQ1 and one latched before it is not",
    rerequested(
      record({ headSha: "aaa", rerequestedAt: AT.before }, [
        round(1, ["a"], "aaa"),
      ]),
    ),
    false,
  );
  // The note is the row's one sentence, and the re-request outranks the push:
  // being asked is a stronger fact than having noticed.
  check(
    "AQ1 the note leads with the re-request",
    rereviewNote(
      record(
        { headSha: "bbb", headMovedAt: AT.after, rerequestedAt: AT.after },
        [round(1, ["a"], "aaa")],
      ),
    ),
    "re-review requested, round 1 sent",
  );
  check(
    "AQ1 and falls back to the push",
    rereviewNote(
      record({ headSha: "bbb", headMovedAt: AT.after }, [
        round(1, ["a"], "aaa"),
      ]),
    ),
    "pushed since round 1",
  );
  check(
    "AQ1 a quiet record has no note",
    rereviewNote(record({ headSha: "aaa" }, [round(1, ["a"], "aaa")])),
    null,
  );
}

// AQ2. Both stamps are activity, which is what puts the dot on the row. They
// are admissible only because they are written on a transition: `pr.checkedAt`
// moves every sweep, and folding that in would leave every record permanently
// unread. Opening the record must therefore clear the dot and keep it clear
// across the sweeps that follow.
{
  const quiet = record({ headSha: "aaa" }, [round(1, ["a"], "aaa")]);
  const pushed = record({ headSha: "bbb", headMovedAt: AT.after }, [
    round(1, ["a"], "aaa"),
  ]);
  check("AQ2 a push is activity", activityAt(pushed) > activityAt(quiet), true);
  check(
    "AQ2 so is a re-request",
    activityAt(record({ headSha: "aaa", rerequestedAt: AT.after }, [])) >
      activityAt(quiet),
    true,
  );

  await rm(STATE_DIR, { recursive: true, force: true });
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify({ seenPullRequests: [], intake: [pushed] }, null, 2),
  );
  check("AQ2 the push leaves the row unread", unseen(pushed), true);
  await markRecordSeen("o/r#1");
  const seen = (await loadState()).intake[0];
  check("AQ2 opening it clears the dot", unseen(seen), false);
  // The next sweep rewrites `pr` and leaves both stamps where they were, because
  // neither moves without a transition behind it.
  const swept = {
    ...seen,
    pr: { ...seen.pr, checkedAt: new Date().toISOString() },
  };
  check(
    "AQ2 and the sweep after it does not put the dot back",
    unseen(swept),
    false,
  );
}

// AQ3. The anchor key puts the path last precisely so a path may hold colons,
// and every reader of it has to split the same way or a Windows style path, or
// a generated file named with one, binds to nothing.
{
  const key = anchorKey({
    path: "apps/web/src/a:b.ts",
    line: 42,
    side: "RIGHT",
    body: "something",
  });
  check("AQ3 the path survives the split", parseAnchor(key), {
    side: "RIGHT",
    line: 42,
    path: "apps/web/src/a:b.ts",
  });
  check(
    "AQ3 and the place drops the wording and keeps the path",
    placeOf(key),
    "RIGHT:42:apps/web/src/a:b.ts",
  );
  check(
    "AQ3 a key with no path at all is not a place",
    placeOf("RIGHT:42:abc:"),
    null,
  );
  check("AQ3 nor is an empty string", parseAnchor(""), null);
}

// AQ4. The state file is read as raw JSON, so the schema default never fires. A
// round stored before `posted` existed must arrive as an empty list rather than
// as undefined, which is a crash in every reader that iterates it.
{
  const legacy = {
    draft: emptyDraft(),
    rounds: [{ ...round(1, ["a"], "aaa"), posted: undefined }],
  };
  check(
    "AQ4 posted is filled on a round written without it",
    roundsOf(legacy)[0].posted,
    [],
  );
  check("AQ4 and the anchors beside it", roundsOf(legacy)[0].anchors, ["a"]);
  check(
    "AQ4 a round that has ids keeps them",
    roundsOf({
      draft: emptyDraft(),
      rounds: [{ ...round(1, ["a"], "aaa"), posted: [{ id: 7, anchor: "a" }] }],
    })[0].posted,
    [{ id: 7, anchor: "a" }],
  );
}

// AQ5. One precedence order, written once, so the brief, the wizard and the
// threads screen cannot each decide what a thread means. Resolved outranks an
// argument still running; a human's answer outranks the diff having shifted.
{
  const thread = (over) => ({
    id: "T",
    isResolved: false,
    isOutdated: false,
    path: "a.ts",
    diffSide: "RIGHT",
    originalLine: 10,
    line: 10,
    comments: [
      {
        databaseId: 1,
        author: "radar",
        body: "the finding",
        url: "u",
        createdAt: AT.round,
        reviewId: 1,
      },
    ],
    ...over,
  });
  const answered = (author) => [
    thread({}).comments[0],
    {
      databaseId: 2,
      author,
      body: "fixed in b7",
      url: "u2",
      createdAt: AT.after,
      reviewId: null,
    },
  ];

  check(
    "AQ5 resolved outranks a reply still in the thread",
    outcomeOf(thread({ isResolved: true, comments: answered("dev") })).state,
    "resolved",
  );
  check(
    "AQ5 a reply outranks the diff having moved",
    outcomeOf(thread({ isOutdated: true, comments: answered("dev") })).state,
    "replied",
  );
  check(
    "AQ5 outdated when nobody answered",
    outcomeOf(thread({ isOutdated: true })).state,
    "outdated",
  );
  check(
    "AQ5 untouched when none of the three holds",
    outcomeOf(thread({})).state,
    "untouched",
  );
  // The opener answering themself is not the author addressing the finding.
  check(
    "AQ5 the opener replying to their own comment is not a reply",
    outcomeOf(thread({ comments: answered("radar") })).state,
    "untouched",
  );
  check(
    "AQ5 the reply is carried with whoever wrote it",
    (({ reply, replier }) => ({ reply, replier }))(
      outcomeOf(thread({ comments: answered("dev") })),
    ),
    { reply: "fixed in b7", replier: "dev" },
  );
  check(
    "AQ5 unknown is read as untouched everywhere",
    shownState("unknown"),
    "untouched",
  );
}

// AQ6. Two ways to bind, and the exact one is used only where it is exact. A
// short id list means the order assumption did not hold, and a mispaired id
// names the wrong finding resolved.
{
  const key1 = anchorKey({
    path: "a.ts",
    line: 10,
    side: "RIGHT",
    body: "one",
  });
  const key2 = anchorKey({
    path: "a.ts",
    line: 10,
    side: "RIGHT",
    body: "two",
  });
  const key3 = anchorKey({
    path: "b.ts",
    line: 20,
    side: "RIGHT",
    body: "three",
  });
  const thread = (id, databaseId, path, line, over = {}) => ({
    id,
    isResolved: false,
    isOutdated: false,
    path,
    diffSide: "RIGHT",
    originalLine: line,
    line,
    comments: [
      {
        databaseId,
        author: "radar",
        body: `posted ${id}`,
        url: `https://github.com/o/r/pull/1#discussion_r${databaseId}`,
        createdAt: AT.round,
        reviewId: 1,
      },
    ],
    ...over,
  });

  // Two findings at one place. By id they separate cleanly, because the id is
  // the thing GitHub itself paired.
  const exact = bindRounds(
    [
      {
        ...round(1, [key1, key2], "aaa"),
        posted: [
          { id: 101, anchor: key1 },
          { id: 102, anchor: key2 },
        ],
      },
    ],
    [
      thread("T1", 101, "a.ts", 10, { isResolved: true }),
      thread("T2", 102, "a.ts", 10),
    ],
  );
  check(
    "AQ6 by id, two findings at one line still separate",
    exact.map((f) => [f.anchor === key1, f.state, f.threadId]),
    [
      [true, "resolved", "T1"],
      [false, "untouched", "T2"],
    ],
  );

  // The same two by place. Neither can be told from the other, so neither is
  // claimed: naming the wrong one resolved is worse than saying it is unknown.
  const ambiguous = bindRounds(
    [round(1, [key1, key2], "aaa")],
    [
      thread("T1", 101, "a.ts", 10, { isResolved: true }),
      thread("T2", 102, "a.ts", 10),
    ],
  );
  check(
    "AQ6 by place, an ambiguous line binds neither",
    ambiguous.map((f) => [f.state, f.threadId]),
    [
      ["unknown", null],
      ["unknown", null],
    ],
  );
  check(
    "AQ6 and an unbound anchor still reports its own place",
    ambiguous.map((f) => [f.path, f.line]),
    [
      ["a.ts", 10],
      ["a.ts", 10],
    ],
  );

  // One finding at a place of its own binds by position, which is what every
  // round stored before the ids were captured relies on.
  check(
    "AQ6 by place, an unambiguous line binds",
    bindRounds([round(1, [key3], "aaa")], [thread("T3", 103, "b.ts", 20)]).map(
      (f) => [f.state, f.threadId],
    ),
    [["untouched", "T3"]],
  );
  // A thread another review opened sits at the same place. It is not ours, so
  // it binds to nothing: `reviewId` is what keeps a round to its own threads.
  check(
    "AQ6 and a thread from somebody else's review is not ours to bind",
    bindRounds(
      [round(1, [key3], "aaa")],
      [
        thread("T4", 104, "b.ts", 20, {
          comments: [
            { ...thread("T4", 104, "b.ts", 20).comments[0], reviewId: 99 },
          ],
        }),
      ],
    ).map((f) => [f.state, f.threadId]),
    [["unknown", null]],
  );
  // A short id list falls back rather than pairing by position in the array.
  check(
    "AQ6 a short id list falls back to place rather than guessing the pairing",
    bindRounds(
      [
        {
          ...round(1, [key3, key1], "aaa"),
          posted: [{ id: 103, anchor: key3 }],
        },
      ],
      [thread("T3", 103, "b.ts", 20)],
    ).map((f) => [f.anchor === key3, f.threadId]),
    [
      [true, "T3"],
      [false, null],
    ],
  );
}

// AQ7. Five ways to end up reading the whole diff, each of them said out loud.
// A review that quietly narrows to the wrong range is worse than one that reads
// everything, so no fallback is silent and no base is ever inferred from a date.
{
  let asked = 0;
  const never = async () => {
    asked++;
    return { anchors: new Map(), files: [], commits: 0, fault: null };
  };
  const scope = async (pr, rounds, compare = never) =>
    scopeFor(record(pr, rounds), compare);

  check(
    "AQ7 no round at all is no scope",
    await scope({ headSha: "bbb" }, []),
    null,
  );
  check(
    "AQ7 a round with no head reads the whole diff and says so",
    (await scope({ headSha: "bbb" }, [round(1, ["a"])])).reason,
    "round 1 recorded no head commit",
  );
  check(
    "AQ7 and never invents a base from the submit time",
    (await scope({ headSha: "bbb" }, [round(1, ["a"])])).base,
    null,
  );
  check(
    "AQ7 no head read yet reads the whole diff",
    (await scope({}, [round(1, ["a"], "aaa")])).reason,
    "the head commit has not been read yet",
  );
  check(
    "AQ7 a head that has not moved reads the whole diff",
    (await scope({ headSha: "aaa" }, [round(1, ["a"], "aaa")])).reason,
    "the head has not moved since round 1",
  );
  check("AQ7 and none of those three asked GitHub anything", asked, 0);

  const faulted = async () => ({
    anchors: new Map(),
    files: [],
    commits: 0,
    fault: "the author rebased or force pushed since the base commit",
  });
  check(
    "AQ7 a rebase is a named fault, not a range",
    (await scope({ headSha: "bbb" }, [round(1, ["a"], "aaa")], faulted)).reason,
    "the author rebased or force pushed since the base commit",
  );
  const empty = async () => ({
    anchors: new Map(),
    files: [],
    commits: 0,
    fault: null,
  });
  check(
    "AQ7 a range with nothing in it reads the whole diff",
    (await scope({ headSha: "bbb" }, [round(1, ["a"], "aaa")], empty)).reason,
    "no new commits since round 1",
  );
  const thrown = async () => {
    throw new Error("the daemon could not reach GitHub");
  };
  check(
    "AQ7 a comparer that throws is one more reason to read everything",
    (await scope({ headSha: "bbb" }, [round(1, ["a"], "aaa")], thrown)).reason,
    "the two commits could not be compared: the daemon could not reach GitHub",
  );
  check(
    "AQ7 every fallback is still `whole`",
    (await scope({ headSha: "bbb" }, [round(1, ["a"], "aaa")], thrown)).mode,
    "whole",
  );

  const real = async (repo, base, head) => ({
    anchors: new Map([
      ["a.ts", { RIGHT: new Set([12, 13, 14, 18, 44]), LEFT: new Set() }],
      ["b.ts", { RIGHT: new Set(), LEFT: new Set([3]) }],
    ]),
    files: ["a.ts", "b.ts"],
    commits: 3,
    fault: null,
    repo,
    base,
    head,
  });
  const narrowed = await scope(
    { headSha: "bbb" },
    [round(2, ["a"], "aaa")],
    real,
  );
  check("AQ7 three new commits narrows the read", narrowed.mode, "commits");
  check(
    "AQ7 and the node reads what was read",
    narrowed.reason,
    "3 commits since round 1",
  );
  check(
    "AQ7 the base is the round's own head, never a date",
    narrowed.base,
    "aaa",
  );
  check("AQ7 the lines are compacted as a person writes them", narrowed.files, [
    { path: "a.ts", lines: "12-14, 18, 44" },
    { path: "b.ts", lines: "" },
  ]);
  check(
    "AQ7 one commit is singular",
    (
      await scope({ headSha: "bbb" }, [round(1, ["a"], "aaa")], async () => ({
        ...(await real()),
        commits: 1,
      }))
    ).reason,
    "1 commit since round 1",
  );
}

// AQ8. Four states, six pairs, and no pair that differs in colour alone. The
// square sits beside a word everywhere it is drawn, but a theme that renders
// colour poorly must not collapse two of them into one mark.
{
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
  const states = ["resolved", "replied", "outdated", "untouched"];
  const look = (state) => findingAppearance(state, theme);

  check(
    "AQ8 no two states share a glyph",
    new Set(states.map((state) => look(state).glyph)).size,
    4,
  );
  const fields = [
    "glyph",
    "glyphColor",
    "background",
    "borderColor",
    "borderStyle",
  ];
  const pairs = [];
  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      const left = look(states[i]);
      const right = look(states[j]);
      pairs.push(fields.filter((field) => left[field] !== right[field]).length);
    }
  }
  check("AQ8 six pairs", pairs.length, 6);
  check(
    "AQ8 and every one of them differs in at least three of the five fields",
    pairs.every((differing) => differing >= 3),
    true,
  );
  check(
    "AQ8 an unmatched thread is drawn as untouched rather than as a fifth thing",
    look("unknown"),
    look("untouched"),
  );

  // One glyph is shared with the stage nodes, deliberately: both mean finished,
  // and the threads screen draws no stage nodes. Any second overlap is an
  // accident and reads as two different things wearing one mark.
  const nodeGlyphs = new Set(
    ["pending", "queued", "running", "done", "skipped", "failed"].map(
      (status) => nodeAppearance(status, theme).glyph,
    ),
  );
  check(
    "AQ8 the only glyph shared with the stage nodes is the tick",
    states
      .map((state) => look(state).glyph)
      .filter((glyph) => nodeGlyphs.has(glyph)),
    ["✓"],
  );
}

// AQ9. The rewording trap. A scoped re-run that rewrites a carried finding's
// sentence produces a key nothing has seen, so `postedRounds` misses it and the
// author gets a near duplicate with no mark on it. The place is what catches it.
{
  const original = anchorKey({
    path: "a.ts",
    line: 10,
    side: "RIGHT",
    body: "This leaks a handle.",
  });
  const reworded = anchorKey({
    path: "a.ts",
    line: 10,
    side: "RIGHT",
    body: "This leaks a file handle.",
  });
  const rounds = [round(1, [original], "aaa")];

  check(
    "AQ9 one word changed is a different key",
    original === reworded,
    false,
  );
  check(
    "AQ9 so the round mark misses it",
    postedRounds(rounds).has(reworded),
    false,
  );
  check(
    "AQ9 and the place catches it",
    postedPlaces(rounds).get(placeOf(reworded)),
    1,
  );
  check(
    "AQ9 a genuinely new place is not claimed",
    postedPlaces(rounds).has(
      placeOf(anchorKey({ path: "a.ts", line: 99, side: "RIGHT", body: "x" })),
    ),
    false,
  );
  // The hint is a hint. A place says something was said here, never that it was
  // this, which is why it never stands in for the round mark.
  check(
    "AQ9 the place keeps the first round that spoke there",
    postedPlaces([
      round(1, [original], "aaa"),
      round(2, [reworded], "bbb"),
    ]).get(placeOf(original)),
    1,
  );
}

// AQ10. Nothing is pre-ticked, in any state. The reopen stamps what the last
// round got onto the record, and the draft it opens beside that is empty: a
// carried finding is marked, never switched on. AC-G3 is untouched.
{
  const states = ["resolved", "replied", "outdated", "untouched", "unknown"];
  const posted = states.map((state, index) => ({
    anchor: anchorKey({
      path: "a.ts",
      line: index + 1,
      side: "RIGHT",
      body: state,
    }),
    round: 1,
    state,
    path: "a.ts",
    line: index + 1,
    threadId: `T${index}`,
    resolved: state === "resolved",
    url: "u",
    body: `posted ${state}`,
    reply: state === "replied" ? "done" : "",
    replier: state === "replied" ? "dev" : null,
  }));

  const carried = carriedOf(posted, AT.after);
  check("AQ10 every anchor that went out is carried", carried.length, 5);
  check(
    "AQ10 including the one no thread could be found for",
    carried.some((entry) => entry.state === "unknown"),
    true,
  );
  check(
    "AQ10 and each entry parses as stored",
    carried.every((entry) => carriedSchema.safeParse(entry).success),
    true,
  );
  check(
    "AQ10 the read is dated, so the card never implies live",
    new Set(carried.map((entry) => entry.readAt)).size,
    1,
  );

  const typed = { ...emptyDraft(), body: "last round's body" };
  const next = reopened({
    draft: typed,
    rounds: [
      round(
        1,
        posted.map((f) => f.anchor),
        "aaa",
      ),
    ],
  });
  check(
    "AQ10 the next round opens with no comment switched on",
    next.draft.comments,
    {},
  );
  check("AQ10 and with last round's body gone", next.draft.body, "");
  check(
    "AQ10 the history it carries is the one that went out",
    next.rounds.map((r) => r.id),
    [1],
  );

  // The agent's copy is the same decision read the other way: a finding with no
  // body anywhere is dropped rather than carried as a row saying only that
  // something was said at line 40.
  const guide = carryFor(posted, {
    version: 1,
    key: "o/r#1",
    generatedAt: AT.round,
    findings: [],
    verification: [],
  });
  check("AQ10 the agent is told about all five", guide.length, 5);
  check(
    "AQ10 with unknown folded to untouched, which is the same instruction",
    guide.filter((entry) => entry.outcome === "untouched").length,
    2,
  );
  check(
    "AQ10 a finding with no body on either side is dropped",
    carryFor([{ ...posted[0], body: "" }], null).length,
    0,
  );
  check(
    "AQ10 and the findings file supplies the body when the thread has none",
    carryFor([{ ...posted[0], body: "" }], {
      version: 1,
      key: "o/r#1",
      generatedAt: AT.round,
      findings: [
        {
          path: "a.ts",
          line: 1,
          side: "RIGHT",
          severity: "concern",
          body: "resolved",
        },
      ],
      verification: [],
    }).map((entry) => [entry.body, entry.severity]),
    [["resolved", "concern"]],
  );
}

// AQ16. The rounds nothing can be recovered for. Twenty nine of the thirty one
// rounds on James' machine predate `anchors`, so they hold a comment count and
// nothing else: the backfill cannot pair ids to anchors that were never stored,
// and the carry cannot bind a thread to them. The claim being tested is that
// the file says so, because an empty `carried` on a pull request carrying live
// comments reads as "nothing was ever raised".
{
  const legacy = (comments) => ({
    id: 5616250241,
    url: "https://github.com/o/r/pull/1#pullrequestreview-5616250241",
    event: "COMMENT",
    submittedAt: AT.round,
    comments,
    anchors: [],
  });

  check(
    "AQ16 a round that posted comments without anchors is named",
    unanchoredNote(record(null, [legacy(3)])),
    "round 1 posted 3 comments but recorded no anchors, so nothing those rounds said could be carried here",
  );
  check(
    "AQ16 one comment is one comment",
    unanchoredNote(record(null, [legacy(1)])),
    "round 1 posted 1 comment but recorded no anchors, so nothing those rounds said could be carried here",
  );
  check(
    "AQ16 an approval that said nothing inline has nothing to report",
    unanchoredNote(record(null, [legacy(0)])),
    null,
  );
  check(
    "AQ16 a round with anchors is not a gap",
    unanchoredNote(record(null, [round(1, ["a", "b"])])),
    null,
  );
  check(
    "AQ16 and a record that never sent a round is not one either",
    unanchoredNote(record(null, [])),
    null,
  );
  // The ordinal, not the review id: every carried finding names its round the
  // way `postedRounds` numbers them, and two numbering schemes on one screen
  // would read as two different rounds.
  check(
    "AQ16 the gap is numbered as the carry numbers rounds",
    unanchoredNote(record(null, [legacy(2), round(2, ["a"])])),
    "round 1 posted 2 comments but recorded no anchors, so nothing those rounds said could be carried here",
  );
  check(
    "AQ16 two gaps are both named",
    unanchoredNote(record(null, [legacy(2), legacy(1)])),
    "round 1 posted 2 comments but recorded no anchors; round 2 posted 1 comment but recorded no anchors, so nothing those rounds said could be carried here",
  );
  // The legacy `submitted` shape is what all twenty nine of them are actually
  // stored as, so reading them through `roundsOf` is the case that matters.
  check(
    "AQ16 the pre-rounds shape is read the same way",
    unanchoredNote({
      key: "o/r#1",
      repo: "o/r",
      number: 1,
      title: "t",
      firstSeen: "2026-10-01T09:00:00.000Z",
      state: "created",
      feedback: { draft: emptyDraft(), submitted: legacy(3) },
    }),
    "round 1 posted 3 comments but recorded no anchors, so nothing those rounds said could be carried here",
  );
}

console.log(failures === 0 ? "\nall pass" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
