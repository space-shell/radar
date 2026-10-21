import "./guard.mjs";
import { createActor } from "xstate";
import {
  CONFIRM_WINDOW_MS,
  confirmMachine,
} from "../shared/machines/confirm.ts";
import { viewMachine } from "../shared/machines/view.ts";
import { previewStepOf, wizardMachine } from "../shared/machines/wizard.ts";
import { stageEvents } from "../shared/machines/stage.ts";
import { nodeAppearance, statusWord } from "../shared/appearance.ts";
import { recordMeta } from "../shared/format.ts";
import {
  currentNode,
  REVIEW_STAGES,
  RUNNABLE_STAGES,
  SKIPPABLE_STAGES,
  UNDOABLE_STAGES,
  laterStagesStarted,
  stageBlocked,
} from "../shared/review.ts";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { STATE_DIR, statePath } from "../server/state.ts";
import { setStageStatus } from "../server/stages.ts";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`,
  );
};

/**
 * A clock the probe advances by hand, so the four second window is asserted
 * without the probe taking four seconds to say so. xstate takes the clock as an
 * option, which is the reason the window lives in the machine rather than in a
 * component's effect: an effect's `setTimeout` could not be swapped out.
 */
function testClock() {
  let now = 0;
  let next = 1;
  const pending = new Map();
  return {
    setTimeout(fn, ms) {
      const id = next++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...pending].sort(
        (left, right) => left[1].at - right[1].at,
      )) {
        if (timer.at > now) continue;
        pending.delete(id);
        timer.fn();
      }
    },
  };
}

/** One armed control, with every fire recorded so a double fire cannot pass. */
function arm() {
  const fired = [];
  const clock = testClock();
  const actor = createActor(
    confirmMachine.provide({ actions: { fire: () => fired.push(1) } }),
    { clock },
  );
  actor.start();
  const at = () => String(actor.getSnapshot().value);
  return { actor, clock, fired, at };
}

// M1. The resting state, and the only one a control is built in.
{
  const { at } = arm();
  check("M1 starts idle", at(), "idle");
}

// M2. One press arms and fires nothing. This is the whole point of AC-A8.
{
  const { actor, at, fired } = arm();
  actor.send({ type: "PRESS" });
  check("M2 one press arms", at(), "armed");
  check("M2 one press fires nothing", fired.length, 0);
}

// M3. The second press fires exactly once and stands the control back down.
{
  const { actor, at, fired } = arm();
  actor.send({ type: "PRESS" });
  actor.send({ type: "PRESS" });
  check("M3 the second press fires once", fired.length, 1);
  check("M3 and returns to idle", at(), "idle");
}

// M4. The window is held right up to its last millisecond, then released.
{
  const { actor, clock, at, fired } = arm();
  actor.send({ type: "PRESS" });
  clock.advance(CONFIRM_WINDOW_MS - 1);
  check("M4 still armed one ms before the window closes", at(), "armed");
  clock.advance(1);
  check("M4 idle once it closes", at(), "idle");
  check("M4 expiry fires nothing", fired.length, 0);
}

// M5. The regression a boolean and a loose timer invite: a press arriving after
// the window has closed must arm again, never count as the second press.
{
  const { actor, clock, at, fired } = arm();
  actor.send({ type: "PRESS" });
  clock.advance(CONFIRM_WINDOW_MS);
  actor.send({ type: "PRESS" });
  check("M5 a press after expiry re-arms", at(), "armed");
  check("M5 and fires nothing", fired.length, 0);
}

// M6. Re-arming restarts the window rather than inheriting the old one.
{
  const { actor, clock, at } = arm();
  actor.send({ type: "PRESS" });
  clock.advance(CONFIRM_WINDOW_MS);
  actor.send({ type: "PRESS" });
  clock.advance(CONFIRM_WINDOW_MS - 1);
  check("M6 the second window runs its full length", at(), "armed");
  clock.advance(1);
  check("M6 then closes", at(), "idle");
}

// M7. The parent saying the action started takes the question off the screen,
// and takes it off without answering it.
{
  const { actor, at, fired } = arm();
  actor.send({ type: "PRESS" });
  actor.send({ type: "DISARM" });
  check("M7 disarm stands the control down", at(), "idle");
  check("M7 disarm fires nothing", fired.length, 0);
}

// M8. Armed and busy cannot both hold, which is what the old boolean pair could
// represent and what an effect had to correct after the fact.
{
  const { actor, clock, at, fired } = arm();
  actor.send({ type: "PRESS" });
  actor.send({ type: "DISARM" });
  clock.advance(CONFIRM_WINDOW_MS * 2);
  check("M8 a disarmed window cannot re-arm itself", at(), "idle");
  check("M8 and never fires late", fired.length, 0);
}

// M9. Disarm on a control nobody armed is a no-op rather than an error.
{
  const { actor, at, fired } = arm();
  actor.send({ type: "DISARM" });
  check("M9 disarm from idle stays idle", at(), "idle");
  check("M9 and fires nothing", fired.length, 0);
}

/** The inbox screen's three views, started with or without a record named. */
function screen(key = null) {
  const actor = createActor(viewMachine, { input: { key } });
  actor.start();
  const at = () => String(actor.getSnapshot().value);
  const on = () => actor.getSnapshot().context.key;
  const open = () => actor.getSnapshot().context.node;
  // Variadic, because `actor.send` takes one event and silently drops the rest.
  const send = (...events) => { for (const event of events) actor.send(event); return actor; };
  return { actor, at, on, open, send };
}

// V1. Nothing named, so the list. The only state with no record behind it.
{
  const { at, on } = screen();
  check("V1 opens on the list", at(), "list");
  check("V1 with no record", on(), null);
}

// V2. A record named before the first render is a record someone asked for, so
// the screen opens on it rather than on the list it would have to be found in.
{
  const { at, on } = screen("o/r#1");
  check("V2 a named record opens its detail", at(), "detail");
  check("V2 on that record", on(), "o/r#1");
}

// V3. A row press.
{
  const { actor, at, on } = screen();
  actor.send({ type: "OPEN_DETAIL", key: "o/r#2" });
  check("V3 a row opens its detail", at(), "detail");
  check("V3 remembering the record", on(), "o/r#2");
}

// V4. The wizard is reachable from a detail and from nowhere else. That was the
// combination three independent values could represent and this one cannot.
{
  const { actor, at } = screen();
  actor.send({ type: "OPEN_WIZARD" });
  check("V4 the wizard cannot be opened from the list", at(), "list");
}
{
  const { actor, at, on } = screen("o/r#3");
  actor.send({ type: "OPEN_WIZARD" });
  check("V4 the wizard opens from a detail", at(), "wizard");
  check("V4 on the record the detail was on", on(), "o/r#3");
}

// V5. Back means one thing, and it means it in both states that have one.
{
  const { actor, at, on } = screen("o/r#4");
  actor.send({ type: "OPEN_WIZARD" });
  actor.send({ type: "BACK" });
  check("V5 back from the wizard returns to the detail", at(), "detail");
  check("V5 still on the same record", on(), "o/r#4");
  actor.send({ type: "BACK" });
  check("V5 back from the detail returns to the list", at(), "list");
  check("V5 and lets the record go", on(), null);
}

// V6. Back on the list is the end of the road, not a fourth state.
{
  const { actor, at } = screen();
  actor.send({ type: "BACK" });
  check("V6 back from the list stays on the list", at(), "list");
}

// V7. A record named from the sidebar while a detail is open switches to it.
{
  const { actor, at, on } = screen("o/r#5");
  actor.send({ type: "PARAM", key: "o/r#6" });
  check("V7 a named record switches the detail", at(), "detail");
  check("V7 to the record named", on(), "o/r#6");
}

// V8. The same arriving over an open wizard is ignored. Honouring it would swap
// the record under a half written review, and the wizard holds unsaved
// keystrokes in a ref that only its own exit commits.
{
  const { actor, at, on } = screen("o/r#7");
  actor.send({ type: "OPEN_WIZARD" });
  actor.send({ type: "PARAM", key: "o/r#8" });
  check("V8 the wizard ignores a record named elsewhere", at(), "wizard");
  check("V8 and stays on its own record", on(), "o/r#7");
  actor.send({ type: "BACK" });
  check("V8 back lands on the record it was opened from", on(), "o/r#7");
}

// V9. Every state is reachable. Only that: this walks a set of event
// sequences and collects where each lands, so it proves the reachable set
// and says nothing about states it never tried to leave.
{
  const reached = new Set();
  const walk = (events) => {
    const { actor, at } = screen();
    for (const event of events) actor.send(event);
    reached.add(at());
  };
  walk([]);
  walk([{ type: "OPEN_DETAIL", key: "o/r#9" }]);
  walk([{ type: "OPEN_DETAIL", key: "o/r#9" }, { type: "OPEN_WIZARD" }]);
  check("V9 every view is reachable", [...reached].sort(), [
    "detail",
    "list",
    "wizard",
  ]);
}

// V10. The expanded map node. It belongs to the screen because the detail view
// unmounts on the way to the wizard, which is how James lost his place in the
// map every time he wrote a review.
{
  const { at, open, send } = screen();
  send({ type: "OPEN_DETAIL", key: "o/r#10" });
  check("V10 a detail opens with nothing expanded", open(), null);
  send({ type: "EXPAND", node: "feedback" });
  check("V10 a press expands that node", open(), "feedback");
  send({ type: "EXPAND", node: "qa" });
  check("V10 another press moves to the new node", open(), "qa");
  send({ type: "EXPAND", node: "qa" });
  check("V10 the same node again closes it", open(), null);
  send({ type: "EXPAND", node: "feedback" }, { type: "OPEN_WIZARD" });
  check("V10 the wizard does not disturb it", [at(), open()], ["wizard", "feedback"]);
  send({ type: "BACK" });
  check("V10 and the map comes back as it was left", [at(), open()], ["detail", "feedback"]);
}

// V11. A different record is a different map, so what was open does not carry.
{
  const { open, send } = screen();
  send({ type: "OPEN_DETAIL", key: "o/r#11" }, { type: "EXPAND", node: "qa" });
  send({ type: "PARAM", key: "o/r#12" });
  check("V11 a record named elsewhere collapses the map", open(), null);
  send({ type: "EXPAND", node: "qa" }, { type: "PARAM", key: "o/r#12" });
  check("V11 the same record again keeps it", open(), "qa");
  send({ type: "BACK" });
  check("V11 and the list holds no node at all", open(), null);
}

/**
 * The wizard's walk, with both side effects recorded rather than performed.
 * `saved` is every step value written to the draft on disk, in order, and
 * `checked` counts the arrivals at the preview that asked GitHub about the
 * anchors. Neither can be asserted from the component without a renderer.
 */
function wizard() {
  const saved = [];
  const checked = { count: 0 };
  const actor = createActor(
    wizardMachine.provide({
      actions: {
        persist: ({ context }) => saved.push(context.step),
        checkAnchors: () => checked.count++,
      },
    }),
  );
  actor.start();
  const snap = () => actor.getSnapshot();
  const at = () => {
    const value = snap().value;
    return typeof value === "string" ? value : value.reviewing;
  };
  const step = () => snap().context.step;
  const send = (...events) => {
    for (const event of events) actor.send(event);
    return actor;
  };
  const ready = (step, findings) => send({ type: "READY", step, findings });
  return { actor, at, step, send, ready, saved, checked };
}

// W1. Nothing has arrived from the server, so there is nothing to show. The one
// state that is not a screen James can act on.
{
  const w = wizard();
  check("W1 starts loading", w.at(), "loading");
  check("W1 and asks GitHub nothing", w.checked.count, 0);
}

// W2. Three findings and a fresh draft. The walk starts on the first of them.
{
  const w = wizard();
  w.ready(0, 3);
  check("W2 a fresh draft opens on the first finding", w.at(), "finding");
  check("W2 on step zero", w.step(), 0);
  check("W2 and asks GitHub nothing yet", w.checked.count, 0);
}

// W3. A draft resumed part way through resumes where it was left, which is the
// reason the step is on disk at all.
{
  const w = wizard();
  w.ready(1, 3);
  check(
    "W3 a resumed draft lands mid walk",
    [w.at(), w.step()],
    ["finding", 1],
  );
}

// W4. The step past the last finding is verification, and it is one screen
// whatever the count of findings is.
{
  for (const findings of [0, 1, 5]) {
    const w = wizard();
    w.ready(findings, findings);
    check(`W4 verification sits at step ${findings}`, w.at(), "verification");
  }
}

// W5. Arriving at the preview asks GitHub whether the anchors still exist,
// without a press. That used to be an effect whose dependency list had to be
// suppressed to say so.
{
  const w = wizard();
  w.ready(previewStepOf(3), 3);
  check("W5 a draft resumed at the preview shows it", w.at(), "preview");
  check("W5 and re-checks the anchors on arrival", w.checked.count, 1);
  check("W5 without writing to the draft", w.saved, []);
}

// W6. The clamp that used to be inline at every read of the step. A draft
// written by an older build, or one whose findings file has since shrunk,
// cannot point past the end of the walk.
{
  const w = wizard();
  w.ready(99, 2);
  check("W6 a step past the preview is clamped to it", w.step(), 3);
  check("W6 landing on the preview", w.at(), "preview");
  const back = wizard();
  back.ready(-4, 2);
  check("W6 a negative step is clamped to zero", back.step(), 0);
  check("W6 landing on the first finding", back.at(), "finding");
}

// W7. The whole walk forward, two findings, naming every screen in order.
{
  const w = wizard();
  w.ready(0, 2);
  const seen = [w.at()];
  for (let i = 0; i < 4; i++) {
    w.send({ type: "NEXT" });
    seen.push(w.at());
  }
  check(
    "W7 next walks the findings, then verification, then the preview",
    seen,
    ["finding", "finding", "verification", "preview", "preview"],
  );
  check("W7 and stops at the preview", w.step(), 3);
  check(
    "W7 writing one step per move and none for the press that did nothing",
    w.saved,
    [1, 2, 3],
  );
  check("W7 asking GitHub once, on the arrival", w.checked.count, 1);
}

// W8. The same walk backwards, which must stop rather than wrap.
{
  const w = wizard();
  w.ready(previewStepOf(2), 2);
  const seen = [w.at()];
  for (let i = 0; i < 4; i++) {
    w.send({ type: "PREV" });
    seen.push(w.at());
  }
  check("W8 previous walks back to the first finding", seen, [
    "preview",
    "verification",
    "finding",
    "finding",
    "finding",
  ]);
  check("W8 and stops at zero", w.step(), 0);
  check(
    "W8 writing one step per move and none for the press that did nothing",
    w.saved,
    [2, 1, 0],
  );
}

// W9. The anchors are re-checked on each arrival rather than once. The diff can
// move while a review is part way through, and a preview that said otherwise
// would be a lie. AC-G12.
{
  const w = wizard();
  w.ready(previewStepOf(1), 1);
  check("W9 checks on the first arrival", w.checked.count, 1);
  w.send({ type: "PREV" }, { type: "NEXT" });
  check("W9 and again on the second", w.checked.count, 2);
  check("W9 having returned to the preview", w.at(), "preview");
}

// W10. Walking between findings never asks GitHub anything. Only the preview
// does, which is what keeps a long review off the network.
{
  const w = wizard();
  w.ready(0, 4);
  w.send(...Array.from({ length: 4 }, () => ({ type: "NEXT" })));
  check("W10 the findings and verification ask nothing", w.checked.count, 0);
  check("W10 sitting on verification", w.at(), "verification");
}

// W11. A review already sent. No step event can reopen the walk, which is the
// rule that stops a second review going out. AC-G15.
{
  const w = wizard();
  w.ready(previewStepOf(1), 1);
  w.send({ type: "SUBMITTED" });
  check("W11 submitted is where it ends", w.at(), "submitted");
  w.send(
    { type: "PREV" },
    { type: "NEXT" },
    { type: "READY", step: 0, findings: 1 },
  );
  check("W11 and nothing walks out of it", w.at(), "submitted");
  check("W11 writing nothing further to the draft", w.saved, []);
  check("W11 and asking GitHub nothing further", w.checked.count, 1);
}

// W12. A review submitted before the screen opened at all, which is the state
// after a reload. It must not pass through the walk on the way.
{
  const w = wizard();
  w.send({ type: "SUBMITTED" });
  check("W12 a submitted review opens on its receipt", w.at(), "submitted");
  check("W12 never touching the preview", w.checked.count, 0);
}

// W13. QA has not run, so there is no findings file. Said plainly, and it is
// not a walk with nothing in it. R10.
{
  const w = wizard();
  w.send({ type: "UNAVAILABLE" });
  check("W13 no findings file is its own screen", w.at(), "unavailable");
  w.send({ type: "NEXT" }, { type: "PREV" });
  check("W13 with no walk behind it", w.at(), "unavailable");
  check("W13 and nothing written", w.saved, []);
}

// W14. Zero findings is a real shape: QA ran and found nothing. Verification is
// then the first screen and the preview the second.
{
  const w = wizard();
  w.ready(0, 0);
  check(
    "W14 with no findings the walk opens on verification",
    w.at(),
    "verification",
  );
  w.send({ type: "NEXT" });
  check("W14 and next is the preview", w.at(), "preview");
  w.send({ type: "NEXT" });
  check("W14 which is the end", [w.at(), w.step()], ["preview", 1]);
}

// W15. Every screen is reachable. The same caveat as V9: this is the set of
// landings for a set of walks, not a proof that no other route reaches them.
{
  const reached = new Set();
  for (const walk of [
    [],
    [{ type: "UNAVAILABLE" }],
    [{ type: "SUBMITTED" }],
    [{ type: "READY", step: 0, findings: 1 }],
    [{ type: "READY", step: 1, findings: 1 }],
    [{ type: "READY", step: 2, findings: 1 }],
  ]) {
    const w = wizard();
    w.send(...walk);
    reached.add(w.at());
  }
  check("W15 every screen is reachable", [...reached].sort(), [
    "finding",
    "loading",
    "preview",
    "submitted",
    "unavailable",
    "verification",
  ]);
}

// W16. The list shrank under a walk already in progress. QA can finish while
// the wizard is open, so the screen can be handed a shorter list than the one
// it is walking, and the step has to come back inside it.
{
  const w = wizard();
  w.ready(2, 5);
  check("W16 walking the third of five findings", [w.at(), w.step()], ["finding", 2]);
  w.send({ type: "RECOUNT", findings: 1 });
  check("W16 a list of one leaves the step on the preview", [w.at(), w.step()], ["preview", 2]);
  check("W16 and the clamp is written through to the draft", w.saved, [2]);
}

// W17. The list grew. The step is in range already, so it stays where it is and
// only what counts as the end moves.
{
  const w = wizard();
  w.ready(1, 1);
  check("W17 on the verification step of one finding", [w.at(), w.step()], ["verification", 1]);
  w.send({ type: "RECOUNT", findings: 4 });
  check("W17 four findings makes the same step a finding", [w.at(), w.step()], ["finding", 1]);
  w.send({ type: "NEXT" }, { type: "NEXT" }, { type: "NEXT" });
  check("W17 and verification moved out to step four", [w.at(), w.step()], ["verification", 4]);
  w.send({ type: "NEXT" });
  check("W17 and the walk now runs to the new end", [w.at(), w.step()], ["preview", 5]);
  check("W17 with no further step past it", w.send({ type: "NEXT" }).getSnapshot().context.step, 5);
}

// W18. A count that did not change still re-dispatches, because the component
// only sends this when it did. The screen must not move.
{
  const w = wizard();
  w.ready(0, 3);
  w.send({ type: "RECOUNT", findings: 3 });
  check("W18 an unchanged count leaves the screen alone", [w.at(), w.step()], ["finding", 0]);
}

// W19. Neither terminal screen moves for a recount.
{
  for (const [opening, where] of [[{ type: "SUBMITTED" }, "submitted"], [{ type: "UNAVAILABLE" }, "unavailable"]]) {
    const w = wizard();
    w.send(opening, { type: "RECOUNT", findings: 9 });
    check(`W19 ${where} ignores a recount`, w.at(), where);
  }
}

/**
 * The cascade the stage machine replaced, transcribed from the detail view as it
 * stood. It is the oracle: the machine has to agree with it on every combination
 * of stage, status, reach and whether a later stage has moved, or the migration
 * changed behaviour without saying so.
 *
 * One line of it has changed since: the cascade asked whether the stage was the
 * current node, and the rule is now whether every earlier stage has left
 * pending. Being current implies that, so the oracle is the same table read
 * through a wider condition, and AG3 is the check that nothing was withdrawn.
 */
function offeredByTheOldCascade(stage, status, blocked, laterMoved) {
  if (status === "running") return [];
  const perform = RUNNABLE_STAGES.includes(stage) ? ["RUN"] : [];
  const skip = SKIPPABLE_STAGES.includes(stage) ? ["SKIP"] : [];
  const undo = UNDOABLE_STAGES.includes(stage) && !laterMoved ? ["UNDO"] : [];
  if (status === "done") return undo.length ? undo : ["REOPEN"];
  if (status === "skipped") return [...perform, "REOPEN"];
  if (status === "failed") return [...perform, "REOPEN", ...skip];
  if (blocked) return [];
  return [...perform, ...skip];
}

/**
 * A record whose named stage carries `status`, whose next stage has or has not
 * moved, and whose earlier stages are in one of the three shapes that decide
 * whether this one is reachable.
 *
 * `earlier` replaces the old `isCurrent` argument. Currency used to be passed
 * in beside the record, which let the grid ask for combinations the record did
 * not hold; it is now read off the fixture, so every row the grid asserts is a
 * record that could exist.
 */
function recordWith(stage, status, laterMoved, earlier = "settled") {
  const review = {};
  const before = REVIEW_STAGES.slice(0, REVIEW_STAGES.indexOf(stage));
  for (const name of REVIEW_STAGES) review[name] = { status: "pending" };
  for (const name of before) {
    review[name] =
      earlier === "settled"
        ? { status: "done" }
        : earlier === "running"
          ? { status: "running", startedAt: "2026-10-21T08:00:00Z" }
          : { status: "pending" };
  }
  review[stage] = { status };
  const after = REVIEW_STAGES[REVIEW_STAGES.indexOf(stage) + 1];
  if (laterMoved && after) review[after] = { status: "done" };
  return { review };
}

// S1. Every row of the table, for every stage, against each of the three shapes
// its predecessors can be in, with and without a later stage having moved. The
// whole grid, nothing skipped.
//
// An earlier version skipped the quarter where a later stage has moved and this
// stage is still reachable, calling it unreachable. It is reachable: Reopen on a
// done acknowledge while QA is already done leaves acknowledge pending, first in
// the map and behind a stage that moved. Nine rows went untested on a claim that
// was wrong.
//
// Both derived inputs are read back off the record rather than taken from the
// loop. `laterMoved` because feedback has no later stage, so its two halves are
// one fixture; `blocked` because acknowledge has no earlier stage, so its three
// thirds are one fixture. Reading them back is what keeps the oracle answering
// the question the machine was actually asked. 120 fixtures, 60 distinct rows.
{
  const disagreed = [];
  const rows = new Set();
  for (const stage of REVIEW_STAGES) {
    for (const status of ["pending", "running", "done", "skipped", "failed"]) {
      for (const earlier of ["settled", "pending", "running"]) {
        for (const asked of [true, false]) {
          const record = recordWith(stage, status, asked, earlier);
          const laterMoved = laterStagesStarted(record, stage);
          const blocked = stageBlocked(record, stage);
          rows.add(`${stage}/${status}/${blocked}/${laterMoved}`);
          const got = stageEvents(record, stage);
          const want = offeredByTheOldCascade(
            stage,
            status,
            blocked,
            laterMoved,
          );
          if (JSON.stringify(got) === JSON.stringify(want)) continue;
          disagreed.push(
            `${stage}/${status}/blocked=${blocked}/later=${laterMoved}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`,
          );
        }
      }
    }
  }
  check("S1 the machine agrees with the cascade it replaced", disagreed, []);
  check("S1 across the whole grid", rows.size, 60);
}

// S1b. The row the old skip called unreachable, reached the way a person reaches
// it: Reopen a done acknowledge on a record whose QA is already done.
{
  const record = {
    review: {
      acknowledge: { status: "pending" },
      qa: { status: "done" },
      verification: { status: "pending" },
      feedback: { status: "pending" },
    },
  };
  check(
    "S1b a reopened acknowledge is current with a later stage moved",
    [currentNode(record), laterStagesStarted(record, "acknowledge")],
    ["acknowledge", true],
  );
  check(
    "S1b and it offers exactly what the cascade offered",
    stageEvents(record, "acknowledge"),
    offeredByTheOldCascade("acknowledge", "pending", false, true),
  );
}

// S2. The rows that matter most, named one at a time so a failure says which.
{
  const qa = (status, earlier, laterMoved = false) =>
    stageEvents(recordWith("qa", status, laterMoved, earlier), "qa");
  check("S2 a running stage offers nothing", qa("running", "settled"), []);
  check(
    "S2 a pending stage behind one still pending offers nothing",
    qa("pending", "pending"),
    [],
  );
  check("S2 a reached pending stage runs or skips", qa("pending", "settled"), [
    "RUN",
    "SKIP",
  ]);
  check("S2 a skipped stage runs or reopens", qa("skipped", "settled"), [
    "RUN",
    "REOPEN",
  ]);
  check("S2 a failed stage runs, reopens or skips", qa("failed", "settled"), [
    "RUN",
    "REOPEN",
    "SKIP",
  ]);
  check("S2 a done stage with no undo reopens", qa("done", "settled"), [
    "REOPEN",
  ]);
}

// S3. Acknowledge is the stage the rules bend around. It never skips, and it is
// the only one that undoes.
{
  const ack = (status, laterMoved = false) =>
    stageEvents(recordWith("acknowledge", status, laterMoved), "acknowledge");
  check("S3 acknowledge never offers skip", ack("pending"), ["RUN"]);
  check("S3 nor when it failed", ack("failed"), ["RUN", "REOPEN"]);
  check("S3 done acknowledge undoes", ack("done"), ["UNDO"]);
  check("S3 and reopens once a later stage moved", ack("done", true), [
    "REOPEN",
  ]);
}

// S4. Undo and Reopen are each other's negation on a settled stage, so a done
// node offers exactly one control and never both or neither.
{
  let wrong = [];
  for (const stage of REVIEW_STAGES) {
    for (const laterMoved of [true, false]) {
      const offered = stageEvents(
        recordWith(stage, "done", laterMoved),
        stage,
      ).filter((type) => type === "UNDO" || type === "REOPEN");
      if (offered.length !== 1)
        wrong.push(`${stage}/later=${laterMoved}: ${JSON.stringify(offered)}`);
    }
  }
  check("S4 a done stage offers exactly one of undo and reopen", wrong, []);
}

// S5. Feedback has no action wired behind it, so Run is never offered for it,
// and since group AG it cannot be skipped either. A reached, pending feedback
// node therefore offers nothing at all: it is finished by writing the review in
// the wizard, or the record is put down with Dismiss. AC-AG7.
{
  check(
    "S5 feedback is neither runnable nor skippable",
    stageEvents(recordWith("feedback", "pending", false), "feedback"),
    [],
  );
  check(
    "S5 nor skippable once it has failed, which is the other skip row",
    stageEvents(recordWith("feedback", "failed", false), "feedback"),
    ["REOPEN"],
  );
}

// AF23. Queued is a sub-state of running, not a sixth status, and Cancel is the
// only thing that parts them. The press has not been sent, so it can still be
// taken back; once it has, there is nothing to take back and the stage offers
// nothing, which is what S2 has always said.
{
  const queued = (stage, extra = {}) => {
    const review = {};
    for (const name of REVIEW_STAGES) review[name] = { status: "pending" };
    review.acknowledge = { status: "done" };
    review[stage] = { status: "running", queuedAt: "2026-10-20T08:00:00Z" };
    return { review: { ...review, ...extra } };
  };

  check(
    "AF23 a queued stage offers Cancel and nothing else",
    stageEvents(queued("qa"), "qa"),
    ["CANCEL"],
  );
  check(
    "AF23 a started running stage still offers nothing",
    stageEvents(
      { review: { qa: { status: "running", startedAt: "2026-10-20T08:00:00Z" } } },
      "qa",
    ),
    [],
  );
  check(
    "AF23 a running stage with neither timestamp is not queued either",
    stageEvents({ review: { qa: { status: "running" } } }, "qa"),
    [],
  );

  // AF24. Cancel carries no reach guard, on purpose. Undoing acknowledge while
  // QA is queued leaves QA behind a pending stage, and a reach guard would leave
  // that press holding a lane with no way to let go of it.
  check(
    "AF24 Cancel is offered on a queued stage that is blocked",
    stageEvents(
      {
        review: {
          acknowledge: { status: "pending" },
          qa: { status: "running", queuedAt: "2026-10-20T08:00:00Z" },
          verification: { status: "pending" },
          feedback: { status: "pending" },
        },
      },
      "qa",
    ),
    ["CANCEL"],
  );
  // The converse, which is `laterMoved` doing what it is for: a queued QA is a
  // stage that has moved, so acknowledge cannot be undone out from under it.
  check(
    "AF24 and a queued later stage withdraws Undo from the one before it",
    stageEvents(queued("qa"), "acknowledge"),
    ["REOPEN"],
  );
}

// AF25. The screen has one value more than the store. Queued has to read apart
// from running at a glance, in a strip whose nodes are nine points across, and
// it must not lean on colour to do it. AC-C3.
{
  const theme = {
    colors: {
      accent: "#3b82f6",
      accentForeground: "#ffffff",
      surface2: "#1f2937",
      statusSuccess: "#22c55e",
      statusDanger: "#ef4444",
      foregroundMuted: "#9ca3af",
      border: "#374151",
    },
  };
  const look = (status) => nodeAppearance(status, theme);
  const statuses = ["pending", "queued", "running", "done", "skipped", "failed"];

  check(
    "AF25 no two statuses share a glyph",
    new Set(statuses.map((status) => look(status).glyph)).size,
    statuses.length,
  );
  const queued = look("queued");
  const running = look("running");
  check(
    "AF25 queued parts from running in glyph, fill and border, not in colour alone",
    [
      queued.glyph !== running.glyph,
      queued.background !== running.background,
      queued.borderStyle !== running.borderStyle,
    ],
    [true, true, true],
  );
  check(
    "AF25 and from pending and skipped, the other two it could be mistaken for",
    [
      queued.glyph !== look("pending").glyph,
      queued.borderStyle !== look("pending").borderStyle,
      queued.glyph !== look("skipped").glyph,
      queued.glyphColor !== look("skipped").glyphColor,
    ],
    [true, true, true, true],
  );
  check(
    "AF25 the accent is carried, so it reads as work rather than absence",
    [queued.glyphColor, queued.borderColor],
    [running.glyphColor, running.borderColor],
  );
}

// AG1. The row the queue created, and the reason James could not line a press
// up behind the one already running. QA is mid-turn, so it holds the title of
// current node for as long as it runs; verification sat behind it offering
// nothing, which is exactly the press worth taking.
{
  const behind = (qa) => ({
    review: {
      acknowledge: { status: "done" },
      qa,
      verification: { status: "pending" },
      feedback: { status: "pending" },
    },
  });
  const running = behind({ status: "running", startedAt: "2026-10-21T08:00:00Z" });
  const queued = behind({ status: "running", queuedAt: "2026-10-21T08:00:00Z" });

  check(
    "AG1 QA still holds the title of current node while it runs",
    [currentNode(running), currentNode(queued)],
    ["qa", "qa"],
  );
  check(
    "AG1 and verification, which is not current, is offered anyway",
    [
      stageEvents(running, "verification"),
      stageEvents(queued, "verification"),
    ],
    [
      ["RUN", "SKIP"],
      ["RUN", "SKIP"],
    ],
  );
  check(
    "AG1 because every stage before it has left pending",
    [stageBlocked(running, "verification"), stageBlocked(queued, "verification")],
    [false, false],
  );
  // A skipped or failed QA counts as having left pending just as a done one
  // does, which is what makes "left pending" the rule rather than "settled".
  check(
    "AG1 a skipped or failed earlier stage reaches it the same way",
    [
      stageEvents(behind({ status: "skipped" }), "verification"),
      stageEvents(behind({ status: "failed" }), "verification"),
    ],
    [
      ["RUN", "SKIP"],
      ["RUN", "SKIP"],
    ],
  );
}

// AG2. The rule did not become "everything is always offered". A stage with an
// earlier one still untouched is still inert, which is AC-J7 unchanged.
{
  const untouched = {
    review: {
      acknowledge: { status: "pending" },
      qa: { status: "pending" },
      verification: { status: "pending" },
      feedback: { status: "pending" },
    },
  };
  check(
    "AG2 a stage behind an untouched one offers nothing",
    [
      stageEvents(untouched, "qa"),
      stageEvents(untouched, "verification"),
      stageEvents(untouched, "feedback"),
    ],
    [[], [], []],
  );
  check(
    "AG2 while the first stage of all is offered",
    stageEvents(untouched, "acknowledge"),
    ["RUN"],
  );
  // One pending stage anywhere earlier is enough, however far back it is.
  check(
    "AG2 and a gap left behind still blocks, not just the stage just before",
    stageEvents(
      {
        review: {
          acknowledge: { status: "pending" },
          qa: { status: "done" },
          verification: { status: "pending" },
          feedback: { status: "pending" },
        },
      },
      "verification",
    ),
    [],
  );
}

// AG3. Nothing was withdrawn. Being the current node means every earlier stage
// is done or skipped, which is a stricter claim than having left pending, so
// the new rule can only ever offer more. Checked as a containment over the
// whole grid rather than asserted in prose.
{
  const lost = [];
  for (const stage of REVIEW_STAGES) {
    for (const status of ["pending", "running", "done", "skipped", "failed"]) {
      for (const earlier of ["settled", "pending", "running"]) {
        for (const asked of [true, false]) {
          const record = recordWith(stage, status, asked, earlier);
          const wasCurrent = currentNode(record) === stage;
          const before = offeredByTheOldCascade(
            stage,
            status,
            !wasCurrent,
            laterStagesStarted(record, stage),
          );
          const now = stageEvents(record, stage);
          const missing = before.filter((type) => !now.includes(type));
          if (missing.length > 0) {
            lost.push(
              `${stage}/${status}/earlier=${earlier}/later=${asked}: lost ${JSON.stringify(missing)}`,
            );
          }
        }
      }
    }
  }
  check("AG3 the currency rule offered nothing the new rule does not", lost, []);
}

// AG5. The word under the node reads off the same rule the controls do. Split
// them and the first thing produced is a node reading "waiting" with a Run
// button beneath it, which is the screen telling James two things at once.
{
  check(
    "AG5 a reached pending node reads ready, an unreached one waiting",
    [statusWord("pending", true), statusWord("pending", false)],
    ["ready", "waiting"],
  );
  check(
    "AG5 and every other status is said verbatim",
    ["running", "queued", "done", "skipped", "failed"].map((status) => [
      statusWord(status, true),
      statusWord(status, false),
    ]),
    [
      ["running", "running"],
      ["queued", "queued"],
      ["done", "done"],
      ["skipped", "skipped"],
      ["failed", "failed"],
    ],
  );

  const contradicted = [];
  for (const stage of REVIEW_STAGES) {
    for (const earlier of ["settled", "pending", "running"]) {
      const record = recordWith(stage, "pending", false, earlier);
      const reached = !stageBlocked(record, stage);
      const offered = stageEvents(record, stage);
      const word = statusWord("pending", reached);
      if (offered.length > 0 && word !== "ready") {
        contradicted.push(`${stage}/${earlier}: ${word} under ${offered}`);
      }
    }
  }
  check("AG5 so no pending node reads waiting under a control", contradicted, []);
}

// AG8. The one line summary under a record. It said `created · Quartr-App/web ·
// 3h ago` on every row of a one repository inbox, spending two thirds of its
// width saying a record is a record.
{
  const record = {
    key: "o/r#1",
    repo: "o/r",
    number: 1,
    title: "t",
    firstSeen: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    state: "created",
  };
  check("AG8 an ordinary record says its age and nothing else", recordMeta(record), "3h ago");
  check(
    "AG8 naming neither the repository nor the word created",
    [recordMeta(record).includes("o/r"), recordMeta(record).includes("created")],
    [false, false],
  );
  check(
    "AG8 while a state that is a fault is still said",
    ["orphaned", "failed", "dry-run"].map((state) =>
      recordMeta({ ...record, state }),
    ),
    ["orphaned · 3h ago", "failed · 3h ago", "dry-run · 3h ago"],
  );
  check(
    "AG8 and a dismissal keeps its own age",
    recordMeta({
      ...record,
      dismissedAt: new Date(Date.now() - 3_600_000).toISOString(),
    }),
    "3h ago · dismissed 1h ago",
  );
}

/**
 * The machine decides what the map offers. The server decides what it allows,
 * and it has refused the same things since before there was a machine. The two
 * have to agree in one direction: anything the machine offers, the server must
 * accept. The reverse is not required and is not checked, because the server is
 * a backstop against a call that bypassed the screen rather than a second copy
 * of the journey.
 *
 * Skip and Reopen are put to the real server function. Run and Undo cannot be:
 * running them posts to GitHub and starts agents, so what is checked for those
 * is the predicate the server refuses on, read from the same constants it reads.
 */
await rm(STATE_DIR, { recursive: true, force: true });
await mkdir(STATE_DIR, { recursive: true });

const seedRecord = async (record) => {
  await writeFile(
    statePath,
    JSON.stringify({
      seenPullRequests: ["o/r#1"],
      intake: [
        {
          key: "o/r#1",
          repo: "o/r",
          number: 1,
          title: "t",
          firstSeen: new Date().toISOString(),
          state: "created",
          review: record.review,
        },
      ],
    }),
  );
};

{
  const refused = [];
  for (const stage of REVIEW_STAGES) {
    for (const status of ["pending", "running", "done", "skipped", "failed"]) {
      for (const earlier of ["settled", "pending", "running"]) {
        for (const laterMoved of [true, false]) {
          const record = recordWith(stage, status, laterMoved, earlier);
          const offered = stageEvents(record, stage);
          const where = `${stage}/${status}/earlier=${earlier}/later=${laterMoved}`;

          for (const event of offered) {
            if (event === "RUN") {
              if (!RUNNABLE_STAGES.includes(stage)) {
                refused.push(`${where}: offers RUN, the server has no action`);
              }
              continue;
            }
            if (event === "UNDO") {
              if (!UNDOABLE_STAGES.includes(stage)) {
                refused.push(`${where}: offers UNDO, the server refuses it`);
              } else if (laterStagesStarted(record, stage)) {
                refused.push(`${where}: offers UNDO past a later stage`);
              }
              continue;
            }
            // Skip and Reopen go to the server itself.
            await seedRecord(record);
            const answer = await setStageStatus(
              "o/r#1",
              stage,
              event === "SKIP" ? "skipped" : "pending",
            );
            if (!answer.ok)
              refused.push(`${where}: ${event} refused, ${answer.error}`);
          }
        }
      }
    }
  }
  check("R1 the server accepts everything the map offers", refused, []);
}

// R2. The one rule the server holds and the map never had: a running stage
// refuses every move. The machine now says the same thing rather than leaving
// it to a check the client did not make.
{
  await seedRecord(recordWith("qa", "running", false));
  check(
    "R2 the server refuses a move on a running stage",
    await setStageStatus("o/r#1", "qa", "skipped"),
    { ok: false, error: "qa is running" },
  );
  check(
    "R2 and the map offers nothing there",
    stageEvents(recordWith("qa", "running", false), "qa"),
    [],
  );
}

// R3. Acknowledge, the stage both sides bend around, put to the server directly.
{
  await seedRecord(recordWith("acknowledge", "pending", false));
  check(
    "R3 the server refuses to skip acknowledge",
    await setStageStatus("o/r#1", "acknowledge", "skipped"),
    { ok: false, error: "Acknowledge cannot be skipped" },
  );
  check(
    "R3 and the map never offers it",
    stageEvents(recordWith("acknowledge", "pending", false), "acknowledge").includes(
      "SKIP",
    ),
    false,
  );
}

// R4. Feedback, the stage group AG took Skip away from. The same pair of checks
// as R3, because the two absences from SKIPPABLE_STAGES have to hold on both
// sides or a control appears that the server will refuse. AC-AG7.
{
  await seedRecord(recordWith("feedback", "pending", false));
  check(
    "R4 the server refuses to skip feedback",
    await setStageStatus("o/r#1", "feedback", "skipped"),
    { ok: false, error: "Feedback cannot be skipped" },
  );
  check(
    "R4 and the map never offers it, reached or not",
    [
      stageEvents(recordWith("feedback", "pending", false, "settled"), "feedback"),
      stageEvents(recordWith("feedback", "failed", false, "settled"), "feedback"),
    ].flat().includes("SKIP"),
    false,
  );
  check(
    "R4 while the two stages that may be skipped still are",
    SKIPPABLE_STAGES.slice(),
    ["qa", "verification"],
  );
}

console.log(failures === 0 ? "\nall pass" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
