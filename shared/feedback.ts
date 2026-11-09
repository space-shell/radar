import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  findingSchema,
  findingStateSchema,
  verificationStepSchema,
  type Finding,
} from "./findings";

/**
 * A 32 bit FNV-1a, base 36. Hand written because this module is parsed by
 * Hermes on the phone and runs in Node on the daemon, and there is no
 * synchronous digest both of them reach. It only ever separates findings within
 * one file, which is a list of ten, so 32 bits is far more than the job needs.
 */
function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * A finding's identity, used to key the draft.
 *
 * Not its index: a QA re-run reorders the list, and an include toggle must
 * never land on a different finding than the one James pressed.
 *
 * Not its position either, which is what `side:line:path` amounted to. An agent
 * writes as many findings at one line as it has things to say there, and three
 * at `prometheus.ts:4` shared one draft comment, one include switch and one
 * text field: the wording typed for the first was shown under all three, could
 * not be cleared, and only one of the three could be posted. The body goes into
 * the key through a digest, so two proposals at one place are two findings.
 *
 * Rewording a finding therefore changes its key and drops the replacement
 * written for it. That is the right loss: James' wording answered words that
 * are no longer on the screen. AC-AH2, AC-AH4.
 */
export function anchorKey(finding: {
  path: string;
  line: number;
  side: string;
  body: string;
}): string {
  return `${finding.side}:${finding.line}:${digest(finding.body)}:${finding.path}`;
}

/**
 * An anchor key read back as a person writes it, `path:line`. The side, the
 * line and the digest come first so the key sorts usefully, which means the
 * path is everything after the third colon and a path may hold colons of its
 * own. AC-AH5.
 */
export function anchorLabel(key: string): string {
  const [, line, , ...rest] = key.split(":");
  const path = rest.join(":");
  return path.length > 0 ? `${path}:${line}` : key;
}

/**
 * An anchor key split back into the position it names.
 *
 * The digest is dropped. It separates two findings at one place, and nothing
 * outside this module can recompute it from what GitHub returns: the posted body
 * is James' wording when he wrote any, so a digest of the comment will not match
 * a digest of the finding.
 *
 * Split the way `anchorLabel` splits, for the same reason: the path is
 * everything after the third colon and a path may hold colons of its own.
 */
export function parseAnchor(
  key: string,
): { side: string; line: number; path: string } | null {
  const parts = key.split(":");
  const side = parts[0];
  const line = Number(parts[1]);
  const path = parts.slice(3).join(":");
  if (!side || !Number.isFinite(line) || path.length === 0) return null;
  return { side, line, path };
}

/** The place an anchor names, the wording dropped. `side:line:path`. */
export function placeOf(key: string): string | null {
  const parsed = parseAnchor(key);
  return parsed ? `${parsed.side}:${parsed.line}:${parsed.path}` : null;
}

export const draftCommentSchema = z.object({
  /** Off by default. Nothing is posted that James did not switch on. AC-G3. */
  include: z.boolean(),
  /** James' own words. Sent verbatim, never rewritten or summarised. AC-G5. */
  text: z.string(),
});
export type DraftComment = z.infer<typeof draftCommentSchema>;

export const draftSchema = z.object({
  comments: z.record(z.string(), draftCommentSchema),
  /** Becomes the review body. Empty means no body at all. AC-G18, AC-G19. */
  body: z.string(),
  /** Checked by default. AC-G21. */
  approve: z.boolean(),
  /** The blocking finding that unchecked it, so the screen can say which. AC-G22. */
  uncheckedBy: z.string().optional(),
  /** Where James was. Restored on return, which is what AC-G6 asks for. */
  step: z.number().int().min(0),
});
export type Draft = z.infer<typeof draftSchema>;

export function emptyDraft(): Draft {
  return { comments: {}, body: "", approve: true, step: 0 };
}

/** Approve is one press. Request changes is its own control, never a default. AC-G24. */
export const reviewEventSchema = z.enum([
  "APPROVE",
  "COMMENT",
  "REQUEST_CHANGES",
]);
export type ReviewEvent = z.infer<typeof reviewEventSchema>;

/**
 * One inline comment as GitHub stored it, paired with the finding it came from.
 *
 * Read back with one GET after the review is created, because the POST answers
 * with the review and not with its comments. It is what makes a later round's
 * correlation exact: the thread's first comment carries this same id, so nothing
 * has to be inferred from where a comment sits or from what it says.
 *
 * Inferring from what it says cannot work at all. `commentBody` posts James'
 * typed replacement when he wrote one, so the posted text and the finding text
 * are routinely different and a digest of either will not find the other.
 */
export const postedCommentSchema = z.object({
  /** The REST review comment id. Equals the thread's first comment `databaseId`. */
  id: z.number(),
  /** The anchor key the comment was posted for. */
  anchor: z.string(),
});
export type PostedComment = z.infer<typeof postedCommentSchema>;

export const submittedReviewSchema = z.object({
  id: z.number(),
  url: z.string(),
  event: reviewEventSchema,
  submittedAt: z.string(),
  comments: z.number(),
  /**
   * The anchors that went out in this round, so a later round can say which
   * findings have already been commented on.
   *
   * Without it a follow up re-offers the whole list with every switch off and no
   * mark on the three that were posted an hour ago, which is a duplicate comment
   * waiting to be pressed. Defaulted rather than required: rounds written before
   * this field read as an empty set, which marks nothing rather than refusing the
   * record. AC-AP3.
   */
  anchors: z.array(z.string()).default([]),
  /**
   * The head commit this review was submitted against, as GitHub reported it on
   * the review itself. The base a re-run diffs the new commits from.
   *
   * Optional, and never guessed. Dating a base from `submittedAt` would pick the
   * wrong commit on any pull request pushed to twice in a minute, and silently
   * reviewing the wrong range is worse than reviewing the whole diff. A round
   * without one reads the whole diff and says so. AC-AQ7.
   */
  headSha: z.string().optional(),
  /**
   * The ids GitHub gave the inline comments, in the order they were sent, which
   * is the order `anchors` holds.
   *
   * Read only when it is exactly as long as `anchors`: a short list means the
   * assumption about order or count does not hold, and a mispaired id would
   * report one finding resolved when it was a different one. Everything else
   * falls back to matching on path, side and the line the thread was opened at.
   * AC-AQ6.
   */
  posted: z.array(postedCommentSchema).optional(),
});
export type SubmittedReview = z.infer<typeof submittedReviewSchema>;

/**
 * What a previous round said at one place, and what the author did about it.
 *
 * Stamped by the server inside the reopen that opens the next round, not read
 * live by the wizard. The wizard holds unsaved keystrokes in a ref, so a query
 * that can refetch under them is the same hazard as a write (AC-G6), and a
 * GitHub call before the first finding renders is the wrong trade on a phone.
 * `readAt` is shown, so the card never implies it is live. AC-AQ15.
 *
 * Display only. It changes no include switch: every one of them still starts
 * off, carried or not. AC-G3, AC-AQ10.
 */
export const carriedSchema = z.object({
  /** The anchor key the finding went out under. */
  anchor: z.string(),
  /** Which round first posted it, 1-based, as `postedRounds` counts. */
  round: z.number(),
  state: findingStateSchema,
  /** The last reply by anyone else, trimmed. Empty unless `state` is `replied`. */
  reply: z.string().default(""),
  replier: z.string().nullable().default(null),
  /** When the read behind this was taken. */
  readAt: z.string(),
});
export type Carried = z.infer<typeof carriedSchema>;

export const feedbackSchema = z.object({
  draft: draftSchema,
  /**
   * Every review sent on this pull request, oldest first.
   *
   * A list rather than one submission, because a review is rarely the end of the
   * conversation: the author pushes a fix and the next thing owed is a second
   * round saying so. One `submitted` object made that impossible, and the map's
   * Reopen on the feedback node only looked like it helped. AC-AP1.
   */
  rounds: z.array(submittedReviewSchema).optional(),
  /**
   * The single submission this held before rounds existed, read but never
   * written. `roundsOf` folds it in, so a record stored by the older shape reads
   * as a one round history with no migration. AC-AP2.
   */
  submitted: submittedReviewSchema.optional(),
  /**
   * What the rounds above got, as of the moment this round was opened. Absent
   * until a reopen reads it, and absent on the first round, which has nothing
   * behind it to carry.
   */
  carried: z.array(carriedSchema).optional(),
});
export type Feedback = z.infer<typeof feedbackSchema>;

/**
 * Every round sent, whichever shape the record was stored in.
 *
 * Never both: a write always sets `rounds` and omits `submitted`, so the legacy
 * field is gone the first time a record is submitted to or reopened after this.
 */
export function roundsOf(feedback: Feedback | undefined): SubmittedReview[] {
  if (!feedback) return [];
  const rounds =
    feedback.rounds ?? (feedback.submitted ? [feedback.submitted] : []);
  // `anchors` is defaulted by the schema, and the server reads its state file as
  // raw JSON rather than through it, so a round written before the field existed
  // arrives without one. Filled here, which is the only place both shapes meet:
  // the readers all iterate it, and an undefined there is a crash rather than an
  // empty set.
  return rounds.map((round) => ({
    ...round,
    anchors: round.anchors ?? [],
    posted: round.posted ?? [],
  }));
}

/**
 * Which findings have already been commented on, and in which round.
 *
 * The first round an anchor went out in, not the last: a finding posted in round
 * one and re-posted in round three was first raised in one, and that is the
 * number that tells James whether he is about to say it twice. AC-AP3.
 */
export function postedRounds(rounds: SubmittedReview[]): Map<string, number> {
  const posted = new Map<string, number>();
  for (let index = 0; index < rounds.length; index++) {
    const round = rounds[index];
    if (!round) continue;
    for (const anchor of round.anchors) {
      if (!posted.has(anchor)) posted.set(anchor, index + 1);
    }
  }
  return posted;
}

/**
 * The same thing by place rather than by wording, which is what catches a
 * reworded repeat.
 *
 * `anchorKey` digests the body, so a re-run that rewrites a carried finding's
 * sentence produces a key `postedRounds` has never seen: it reads as new, and
 * the author gets a near duplicate with no mark on it. Keyed on `side:line:path`
 * this still says a round already spoke there.
 *
 * Deliberately weaker than `postedRounds` and never used in its place: two
 * findings at one line share a place, and a place match is a hint that something
 * was said here, not a claim that it was this. AC-AQ9.
 */
export function postedPlaces(rounds: SubmittedReview[]): Map<string, number> {
  const places = new Map<string, number>();
  for (let index = 0; index < rounds.length; index++) {
    const round = rounds[index];
    if (!round) continue;
    for (const anchor of round.anchors) {
      const place = placeOf(anchor);
      if (place && !places.has(place)) places.set(place, index + 1);
    }
  }
  return places;
}

/**
 * Opens a fresh round, keeping the history.
 *
 * The draft is emptied only when a round actually went out. A reopen with nothing
 * sent is James coming back to a review he was part way through, and throwing his
 * typing away there would be the loss, not the fix. A reopen after a round is the
 * opposite: that draft is the record of what was posted, and reusing it would
 * re-offer every comment already on the pull request with its wording intact.
 * AC-AP4.
 */
export function reopened(feedback: Feedback): Feedback {
  const rounds = roundsOf(feedback);
  return rounds.length === 0
    ? { draft: feedback.draft, rounds: [] }
    : { draft: emptyDraft(), rounds };
}

/** One finding that cannot be posted where it claims to belong. AC-G12. */
export const faultSchema = z.object({ anchor: z.string(), reason: z.string() });
export type Fault = z.infer<typeof faultSchema>;

/**
 * The exact body that will be sent for a finding. James' text when he wrote any,
 * the agent's proposal otherwise. His text replaces rather than appends: a
 * comment carrying both would put the agent's prose out under his name next to
 * his own correction of it. AC-G5, AC-G8.
 */
export function commentBody(finding: Finding, draft: Draft): string {
  const typed = draft.comments[anchorKey(finding)]?.text.trim() ?? "";
  return typed.length > 0 ? typed : finding.body;
}

export const readFeedback = defineRpc({
  name: "radar.feedback.read",
  input: z.object({ key: z.string() }),
  output: z.object({
    findings: z.array(findingSchema),
    verification: z.array(verificationStepSchema),
    generatedAt: z.string().nullable(),
    draft: draftSchema,
    /** Every review already sent, oldest first. Empty before the first one. */
    rounds: z.array(submittedReviewSchema),
    /**
     * What those rounds got, as of the reopen that opened this one. Empty on a
     * first round, and on a reopen whose read of GitHub failed.
     */
    carried: z.array(carriedSchema).default([]),
    /**
     * Whether a round is open for composing. False once a review has gone out and
     * nothing has reopened the stage, which is the one thing that decides between
     * the walk and the receipt. The wizard asks this rather than counting rounds,
     * so reopening is a server decision and the screen cannot disagree with the
     * refusal `storeDraft` would give it. AC-AP5.
     */
    open: z.boolean(),
    /** Why there are no findings, when that is the answer. R10. */
    error: z.string().optional(),
  }),
});

export const saveDraft = defineRpc({
  name: "radar.feedback.draft",
  input: z.object({ key: z.string(), draft: draftSchema }),
  output: z.object({ ok: z.boolean(), error: z.string().optional() }),
});

/**
 * Validates every included finding against the live diff, so the preview can show
 * what will actually be sent rather than what was hoped for. AC-G8, AC-G12.
 */
export const checkAnchors = defineRpc({
  name: "radar.feedback.check",
  input: z.object({ key: z.string() }),
  output: z.object({
    ok: z.boolean(),
    faults: z.array(faultSchema),
    error: z.string().optional(),
  }),
});

export const submitFeedback = defineRpc({
  name: "radar.feedback.submit",
  input: z.object({ key: z.string(), event: reviewEventSchema }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    url: z.string().optional(),
    comments: z.number().optional(),
    /** Dropped at submit time because the diff moved under the preview. AC-G12. */
    excluded: z.array(faultSchema),
    /** The review went out, but something after it did not. AC-G16. */
    warning: z.string().optional(),
  }),
});
