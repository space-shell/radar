import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { feedbackSchema, roundsOf, type SubmittedReview } from "./feedback";
import { REVIEW_STAGES, reviewOf, reviewSchema } from "./review";
import { summarySchema } from "./summary";

/**
 * What the pull request itself says, read back on each search tick. Stored on the
 * record so the inbox can show a merged or already-approved row without the
 * screen making a request of its own. Group M.
 */
export const pullRequestStatusSchema = z.object({
  state: z.enum(["open", "merged", "closed"]),
  isDraft: z.boolean(),
  /** GitHub's verdict across every reviewer. Null when it has formed none. */
  decision: z
    .enum(["approved", "changes_requested", "review_required"])
    .nullable(),
  /** Whose latest review approved, James excluded so the row can name others. */
  approvedBy: z.array(z.string()),
  /** Whose latest review asked for changes, James excluded for the same reason. */
  blockedBy: z.array(z.string()),
  /** James' own latest opinionated review, when he has left one. */
  mine: z.enum(["approved", "changes_requested"]).nullable(),
  checkedAt: z.string(),
  /**
   * The head commit, as of `checkedAt`. Recorded on every sweep, including the
   * first one, which stamps nothing below.
   */
  headSha: z.string().optional(),
  /**
   * When a sweep first saw the head differ from the sha it had stored, and only
   * ever after a round had gone out.
   *
   * Stamped on the change, never on the read, which is the whole of why it is
   * allowed into `activityAt`. The first observation never stamps: without that
   * guard every record already on disk carries no sha, so all sixty would flag
   * on the first tick after this shipped, which is a screen full of dots rather
   * than news. AC-AQ1.
   */
  headMovedAt: z.string().optional(),
  /**
   * When a sweep first saw James back on the review request list after a round
   * had gone out. The author asking for another look, which is news even when
   * nothing was pushed.
   *
   * Latched against the round rather than against the previous sweep, so a list
   * that never clears costs one mark per round and not one per tick.
   */
  rerequestedAt: z.string().optional(),
});
export type PullRequestStatus = z.infer<typeof pullRequestStatusSchema>;

export const intakeRecordSchema = z.object({
  key: z.string(),
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  firstSeen: z.string(),
  /** `orphaned` means the agent is gone but the pull request is not finished. R3. */
  state: z.enum([
    "created",
    "dry-run",
    "unmapped",
    "failed",
    "orphaned",
    "archived",
  ]),
  agentId: z.string().optional(),
  workspaceId: z.string().optional(),
  /**
   * The agent each task got of its own, when the settings gave it a model intake
   * is not running. Absent for a task that inherits intake's agent, which is the
   * default and is what keeps one agent per record.
   *
   * Keyed loosely rather than by the task union, because a record written by a
   * later version naming a task this one has not heard of must still parse.
   */
  taskAgents: z.record(z.string(), z.string()).optional(),
  /** The Linear issue the PR names. null once looked up and absent, undefined until then. */
  linearUrl: z.string().nullable().optional(),
  /** Failed lookups so far. Stops an unreachable body being refetched forever. R11. */
  linearAttempts: z.number().optional(),
  /** Set when James dismisses the row. Hides it, and archives its workspace. AC-AT1. */
  dismissedAt: z.string().nullable().optional(),
  /** Why the last action on this record failed, for AC-A4. */
  lastError: z.string().optional(),
  /** Review pipeline progress, kept separate from the intake state above. AC-C1. */
  review: reviewSchema.partial().optional(),
  /** What the agent made of the pull request. Absent until one is written. AC-K1. */
  summary: summarySchema.optional(),
  /**
   * Why the last summary run failed. Stored rather than returned, because the run
   * outlives the call that started it: the press is answered in milliseconds and
   * the turn takes minutes, so there is no longer a caller to hand the reason to.
   * AC-Q4.
   */
  summaryError: z.string().optional(),
  /**
   * What the first summary's verification decision did, written once so it is
   * never done twice. A push, a re-summary and a reopen all leave it alone,
   * which is what stops an automatic run being repeated. `actedAt` is absent
   * only on a run that is decided and still waiting for a handle to send its
   * turn. AC-AY2.
   */
  autoVerification: z
    .object({
      decidedAt: z.string(),
      required: z.boolean(),
      actedAt: z.string().optional(),
    })
    .optional(),
  /** The feedback wizard's draft, and the review once it has gone out. Group G. */
  feedback: feedbackSchema.optional(),
  /** What GitHub says about the pull request. Absent until the first sweep. AC-M1. */
  pr: pullRequestStatusSchema.optional(),
  /**
   * When James last had the record open. Absent until he has opened it once, which
   * is why a record arrives already marked. Stored on the record rather than kept
   * in the app, so the mark survives a restart and reads the same on the phone and
   * the desktop. AC-AC4.
   */
  seenAt: z.string().optional(),
  /**
   * When an archived record came back, because the author reopened the pull
   * request and asked again.
   *
   * Stamped on the transition out of `archived` and never on a read, which is
   * what makes it admissible to `activityAt`. Top level rather than inside `pr`
   * because the reconciler writes it and `refreshStatuses` is the only writer of
   * `pr`. AC-AR2.
   */
  reopenedAt: z.string().optional(),
  /**
   * When the record was settled as archived.
   *
   * Written so that the wake branch can tell a stored `pr.state` that is older
   * than the archive from one that is newer. `pr` is refreshed on the search
   * clock and the archive decision asks GitHub live, so for a pull request that
   * merges between two sweeps the two disagree for one window, and the wake
   * read the stale half: `#9983` came back as an orphan 223ms after the same
   * tick archived it, carrying `the pull request was reopened` about a pull
   * request that had merged four hours earlier. AC-AS5.
   */
  archivedAt: z.string().optional(),
  /**
   * When this record's Paseo workspace was archived, by whichever writer did it.
   *
   * Separate from `archivedAt`, which says the *record* settled. A dismissal
   * archives the workspace while the pull request is still open, so the record
   * keeps its own state and only this stamp moves. Collapsing the two would
   * hand the wake branch a record that never merged, and it would read every
   * sweep after as `the pull request was reopened`.
   *
   * There is no way back. `paseo workspace archive` exists; nothing unarchives.
   * Not the CLI, which lists only setup, create, ls, rename and archive; not
   * the SDK, whose `workspaces` carries no such method; not the MCP tools. The
   * app does it over the internal `workspace.archive.undo.request` route, which
   * a plugin cannot reach, exactly like `workspace.pin.set.request`.
   *
   * So this stamp does three jobs: it stops a second archive being attempted,
   * it is the reaper's "already done" guard, and it is what the screens read to
   * say the workspace is gone rather than letting Restore imply otherwise.
   * AC-AT1.
   */
  workspaceArchivedAt: z.string().optional(),

  /**
   * Set once, at the first start after dismissal began archiving, on a row that
   * was already dismissed. It means: this dismissal was pressed when a dismissal
   * did not take the workspace, so the press never agreed to lose it.
   *
   * The reaper's dismissal branch is a backstop for an archive the press started
   * and did not land. A row dismissed before the press archived anything had no
   * such archive to finish, and the archive has no inverse, so sweeping them up
   * would spend workspaces on a decision nobody made. AC-AT8.
   */
  keptWorkspace: z.boolean().optional(),
  /**
   * How many times a failed launch has been tried again on its own, and when it
   * was last tried. Absent until the first automatic attempt. AC-AS2.
   */
  launchAttempts: z.number().optional(),
  lastAttemptAt: z.string().optional(),
});

/** Epoch milliseconds for the latest of some timestamps, 0 when none parses. */
function latest(times: ReadonlyArray<string | undefined>): number {
  let best = 0;
  for (const time of times) {
    if (!time) continue;
    // summary.generatedAt is written by an agent, so its notation is not this
    // code's to assume. An unparseable one is ignored rather than guessed at.
    const when = Date.parse(time);
    if (Number.isFinite(when) && when > best) best = when;
  }
  return best;
}

/**
 * The last moment the record gained something worth a look: it arriving, a stage
 * settling, the summary landing, the author moving the pull request on after a
 * round went out, and an archived pull request being reopened.
 *
 * Those last two are timestamps this daemon writes on a transition, not on a
 * read, and that is the only reason they are admissible. `pr.headMovedAt` moves
 * only when the fetched sha differs from the stored one and `pr.rerequestedAt`
 * only when the request reappears after a round, so each is stamped once per
 * event: opening the record clears the dot and it stays clear until the author
 * does something else. AC-AQ2.
 *
 * Three things are still deliberately not here. `pr.checkedAt` moves on every
 * sweep and would leave every record permanently unread. A skip is James' own
 * press, so it cannot be news to him. A stage merely starting is the same: he
 * started it. AC-AC5.
 */
export function activityAt(record: IntakeRecord): number {
  const review = reviewOf(record);
  const settled = REVIEW_STAGES.map((stage) => {
    const { status, endedAt } = review[stage];
    return status === "done" || status === "failed" ? endedAt : undefined;
  });
  return latest([
    record.firstSeen,
    record.summary?.generatedAt,
    record.pr?.headMovedAt,
    record.pr?.rerequestedAt,
    record.reopenedAt,
    ...settled,
  ]);
}

/**
 * Whether the record has moved since James last opened it. Dismissed and archived
 * records are excluded: he has already said he is done with them, and a dot that
 * cannot be cleared by looking is a dot that gets ignored. AC-AC6.
 */
export function unseen(record: IntakeRecord): boolean {
  if (record.dismissedAt || record.state === "archived") return false;
  return activityAt(record) > latest([record.seenAt]);
}

/** Derived rather than stored: GitHub pull request URLs are a fixed shape. */
export function pullRequestUrl(record: {
  repo: string;
  number: number;
}): string {
  return `https://github.com/${record.repo}/pull/${record.number}`;
}

export type IntakeRecord = z.infer<typeof intakeRecordSchema>;

/**
 * Which of the keys being taken in still have nothing to show for themselves.
 *
 * A launch writes its record and then releases its mark, so for a moment both
 * are true. Showing a placeholder above the row it is a placeholder for would
 * read as two arrivals, so the record wins the moment it exists. AC-AK13.
 */
export function stillArriving(
  pending: string[],
  records: ReadonlyArray<{ key: string }>,
): string[] {
  const landed = new Set(records.map((record) => record.key));
  return pending.filter((key) => !landed.has(key));
}

export interface StatusNote {
  label: string;
  /** `settled` means nothing is waiting on James. It is what makes a row dismissable. */
  tone: "settled" | "blocked" | "neutral";
}

/** Two names in full, more than two counted. A row has no width for a roll call. */
function names(logins: string[]): string {
  if (logins.length <= 2) return logins.join(" and ");
  return `${logins[0]} and ${logins.length - 1} others`;
}

/**
 * The pull request's own state, reduced to the one line the inbox shows. Merged and
 * closed come first: they settle the row whatever the reviews said, and a row that
 * has settled is one James can dismiss without opening it. AC-M4.
 *
 * Null means there is nothing worth flagging, not that nothing is known: an open
 * pull request with no reviews yet is the ordinary case and gets no badge.
 */
export function statusNote(status?: PullRequestStatus): StatusNote | null {
  if (!status) return null;
  if (status.state === "merged") return { label: "merged", tone: "settled" };
  if (status.state === "closed") return { label: "closed", tone: "settled" };
  // Asked for before approved: one blocking review outranks any number of approvals.
  if (status.blockedBy.length > 0) {
    return {
      label: `changes requested by ${names(status.blockedBy)}`,
      tone: "blocked",
    };
  }
  if (status.approvedBy.length > 0) {
    return {
      label: `approved by ${names(status.approvedBy)}`,
      tone: "settled",
    };
  }
  if (status.mine === "approved") return { label: "approved", tone: "settled" };
  if (status.mine === "changes_requested") {
    return { label: "changes requested", tone: "blocked" };
  }
  if (status.isDraft) return { label: "draft", tone: "neutral" };
  return null;
}

/** The last round sent on this record, or undefined when none has been. */
function lastRound(record: IntakeRecord): SubmittedReview | undefined {
  const rounds = roundsOf(record.feedback);
  return rounds[rounds.length - 1];
}

/**
 * Whether the pull request has moved on since the last round went out.
 *
 * Two tests, and both are load bearing. The timestamp alone fires for one sweep
 * after every submit, because `pr.headSha` is as old as the last sweep and a
 * submit does not refresh it. The sha alone fires when the author pushed between
 * that sweep and the submit, which GitHub already folded into the round: the
 * review was anchored to the new head, so there is nothing new to look at.
 * Together they fire only on a push that landed after the round.
 *
 * A round stored before `headSha` existed has only the timestamp, which is the
 * conservative half: it can miss a push, and cannot invent one.
 *
 * Settled rows are excluded. Merged and closed settle the row whatever happened
 * to it, and there is nothing left to re-review. AC-AQ1.
 */
/** As much of a fault as a glyph's spoken label can usefully carry. */
const SPOKEN_FAULT = 120;

/**
 * A stored fault, short enough to be read out.
 *
 * Launch faults recorded before `causeOf` existed are the whole command line,
 * brief prompt included, and a screen reader given 1250 characters of argv says
 * nothing a listener can use. The detail view still shows the stored text.
 */
export function faultSummary(fault: string): string {
  const flat = fault.replace(/\s+/g, " ").trim();
  return flat.length <= SPOKEN_FAULT
    ? flat
    : `${flat.slice(0, SPOKEN_FAULT - 1)}\u2026`;
}

export function rereviewDue(record: IntakeRecord): boolean {
  if (record.dismissedAt || record.state === "archived") return false;
  if (record.pr && record.pr.state !== "open") return false;
  const round = lastRound(record);
  if (!round) return false;
  const moved = record.pr?.headMovedAt;
  if (!moved || Date.parse(moved) <= Date.parse(round.submittedAt))
    return false;
  if (round.headSha && record.pr?.headSha === round.headSha) return false;
  return true;
}

/** Whether the author has asked for another look since the last round. */
export function rerequested(record: IntakeRecord): boolean {
  if (record.dismissedAt || record.state === "archived") return false;
  if (record.pr && record.pr.state !== "open") return false;
  const round = lastRound(record);
  const at = record.pr?.rerequestedAt;
  if (!round || !at) return false;
  return Date.parse(at) > Date.parse(round.submittedAt);
}

/**
 * The row's re-review marker, or null when the last round is still the last word.
 *
 * Kept out of `statusNote`, which answers what the pull request itself says. A
 * round is this plugin's own history, and the two are orthogonal: a pull request
 * James approved and the author then pushed to must show both. AC-AQ12.
 */
export function rereviewNote(record: IntakeRecord): string | null {
  const sent = roundsOf(record.feedback).length;
  if (sent === 0) return null;
  if (rerequested(record)) return `re-review requested, round ${sent} sent`;
  if (rereviewDue(record)) return `pushed since round ${sent}`;
  return null;
}

export const retryIntake = defineRpc({
  name: "radar.inbox.retry",
  input: z.object({ key: z.string() }),
  output: z.object({
    ok: z.boolean(),
    adopted: z.boolean(),
    error: z.string().optional(),
  }),
});

/**
 * Takes in a pull request James named, rather than one GitHub asked him about.
 *
 * The input is whatever he pasted. Parsing happens on the daemon, not here,
 * because the same string has to be read the same way whichever surface sent
 * it, and because the reason a paste was refused is worth writing once.
 *
 * `ok` means the record was claimed and the launch has begun, not that the
 * worktree exists: a launch runs for up to two minutes and the host abandons an
 * RPC at thirty seconds. The row appears when the launch lands. AC-AK6.
 */
export const addPullRequest = defineRpc({
  name: "radar.inbox.add",
  input: z.object({ link: z.string() }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    /** The record key, whether it was claimed now or was already there. */
    key: z.string().optional(),
    /** Already taken in: "present", or "restored" when it had been dismissed. */
    already: z.enum(["present", "restored"]).optional(),
  }),
});

export const setDismissed = defineRpc({
  name: "radar.inbox.dismiss",
  input: z.object({ key: z.string(), dismissed: z.boolean() }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    /** The row moved, but taking the eyes reaction back did not. AC-H2. */
    warning: z.string().optional(),
  }),
});

/**
 * Marks a record as looked at, which is what clears its dot. Called by the detail
 * view rather than pressed: opening the record is the act of seeing it, and a
 * control that asked James to confirm he had read something would be one more
 * thing to remember. AC-AC7.
 */
export const markSeen = defineRpc({
  name: "radar.inbox.seen",
  input: z.object({ key: z.string() }),
  output: z.object({ ok: z.boolean(), error: z.string().optional() }),
});

/**
 * Drops one record the server cannot parse, and forgets its key, so the next
 * sweep takes the pull request in again from scratch.
 *
 * The only escape from a genuinely terminal state. An unparseable record draws
 * no row, so it carries no Retry and no Dismiss, and its key is in
 * `seenPullRequests`, so no sweep will ever take the pull request in a second
 * time: it is invisible and permanent at once. Destructive, and deliberately
 * so, but bounded to a record nothing can read. The server re-checks that the
 * record still fails to parse inside the write lock, so this can never delete a
 * record a newer schema has since made readable. AC-AR9.
 */
export const forgetUnreadable = defineRpc({
  name: "radar.inbox.forget",
  input: z.object({ key: z.string() }),
  output: z.object({ ok: z.boolean(), error: z.string().optional() }),
});

export const setStage = defineRpc({
  name: "radar.stage.set",
  input: z.object({
    key: z.string(),
    stage: z.enum(REVIEW_STAGES),
    /** Only the two transitions with no side effects. Actions own the rest. */
    status: z.enum(["pending", "skipped"]),
  }),
  output: z.object({ ok: z.boolean(), error: z.string().optional() }),
});

/**
 * Runs the stage's action. Only stages in RUNNABLE_STAGES have one; the server
 * refuses the rest rather than trusting the screen to have hidden the control.
 */
export const runStageAction = defineRpc({
  name: "radar.stage.run",
  input: z.object({ key: z.string(), stage: z.enum(REVIEW_STAGES) }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    /**
     * The stage started, but something it does on the press did not. QA posts
     * the eyes reaction when it is claimed, and a GitHub that refuses that is
     * not a reason to lose the run. AC-D2.
     */
    warning: z.string().optional(),
  }),
});

/**
 * Asks the record's own agent for the detail view's summary. Separate from the
 * stage actions: it is a reading of the pull request, not a step of the review,
 * and it reaches nothing outside this machine.
 */
export const runSummary = defineRpc({
  name: "radar.summary.run",
  input: z.object({ key: z.string() }),
  /**
   * `ok` means the turn started, not that it finished. The host abandons any RPC
   * at 30 seconds and a summary turn runs for minutes, so waiting for the result
   * here would fail every time while the work carried on behind it. AC-Q1.
   */
  output: z.object({ ok: z.boolean(), error: z.string().optional() }),
});

/**
 * Runs a sweep now rather than waiting out the interval. The same work the search
 * tick does, reachable from the clock badge. It never reaps: archiving a workspace
 * is not what a refresh means. AC-N3.
 */
export const sweepNow = defineRpc({
  name: "radar.sweep.now",
  input: z.object({}),
  output: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    /** True when it attached to a sweep already running instead of starting one. */
    joined: z.boolean(),
  }),
});

export const readInbox = defineRpc({
  name: "radar.inbox.read",
  input: z.object({}),
  output: z.object({
    lastSearchAt: z.string().nullable(),
    dryRun: z.boolean(),
    /**
     * Records the server could not parse, each with the key it carried and why
     * zod refused it.
     *
     * Named rather than counted. A bare number told James a row was missing and
     * gave him nothing to find it by, while both halves are already known at the
     * drop site and cost nothing to carry. A record with no readable key is the
     * one case that cannot be named, and it is the one case Forget cannot act
     * on either, so the key is nullable rather than invented. AC-AR9. R10.
     */
    unreadable: z.array(
      z.object({ key: z.string().nullable(), reason: z.string() }),
    ),
    /**
     * Keys with a summary on its way: a press whose turn is still running, and a
     * record whose intake agent is still working and has written nothing yet.
     * Neither is visible from the screen, so the daemon is the only thing that
     * can say so. AC-Q3, AC-AD2.
     */
    summarising: z.array(z.string()),
    /**
     * Keys added by hand whose launch is still running. The daemon is again the
     * only thing that knows: the press was answered in milliseconds and the
     * launch behind it takes up to two minutes. Holding it here rather than in
     * the screen is what keeps the placeholder through a navigation, a reload,
     * and a look from the other device. AC-AK12.
     */
    takingIn: z.array(z.string()),
    records: z.array(intakeRecordSchema),
  }),
});
