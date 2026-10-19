import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { feedbackSchema } from "./feedback";
import { REVIEW_STAGES, reviewSchema } from "./review";
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
  /** Set when James dismisses the row. Hides it from the default view; archives nothing. */
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
  /** The feedback wizard's draft, and the review once it has gone out. Group G. */
  feedback: feedbackSchema.optional(),
  /** What GitHub says about the pull request. Absent until the first sweep. AC-M1. */
  pr: pullRequestStatusSchema.optional(),
});

/** Derived rather than stored: GitHub pull request URLs are a fixed shape. */
export function pullRequestUrl(record: {
  repo: string;
  number: number;
}): string {
  return `https://github.com/${record.repo}/pull/${record.number}`;
}

export type IntakeRecord = z.infer<typeof intakeRecordSchema>;

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

export const retryIntake = defineRpc({
  name: "radar.inbox.retry",
  input: z.object({ key: z.string() }),
  output: z.object({
    ok: z.boolean(),
    adopted: z.boolean(),
    error: z.string().optional(),
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
  output: z.object({ ok: z.boolean(), error: z.string().optional() }),
});

/** Takes a stage's effect back. Acknowledge removes its reaction. AC-D6. */
export const undoStageAction = defineRpc({
  name: "radar.stage.undo",
  input: z.object({ key: z.string(), stage: z.enum(REVIEW_STAGES) }),
  output: z.object({ ok: z.boolean(), error: z.string().optional() }),
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
    /** Records the server could not parse. Surfaced rather than hidden. R10. */
    unreadable: z.number(),
    /**
     * Keys with a summary turn in flight. The press that started it returned long
     * ago, so the daemon is the only thing that knows this is still running. AC-Q3.
     */
    summarising: z.array(z.string()),
    records: z.array(intakeRecordSchema),
  }),
});
