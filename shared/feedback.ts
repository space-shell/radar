import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  findingSchema,
  verificationStepSchema,
  type Finding,
} from "./findings";

/**
 * A finding's identity, used to key the draft. Not its index: a QA re-run
 * reorders the list, and an include toggle must never land on a different
 * finding than the one James pressed.
 */
export function anchorKey(finding: {
  path: string;
  line: number;
  side: string;
}): string {
  return `${finding.side}:${finding.line}:${finding.path}`;
}

/**
 * An anchor key read back as a person writes it, `path:line`. The key puts the
 * side and the line first so it sorts usefully, which means the path is
 * everything after the second colon and a path may hold colons of its own.
 */
export function anchorLabel(key: string): string {
  const [, line, ...rest] = key.split(":");
  const path = rest.join(":");
  return path.length > 0 ? `${path}:${line}` : key;
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

export const submittedReviewSchema = z.object({
  id: z.number(),
  url: z.string(),
  event: reviewEventSchema,
  submittedAt: z.string(),
  comments: z.number(),
});

export const feedbackSchema = z.object({
  draft: draftSchema,
  /** Set once. Its presence is what refuses a second submit. AC-G15. */
  submitted: submittedReviewSchema.optional(),
});
export type Feedback = z.infer<typeof feedbackSchema>;

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
    submitted: submittedReviewSchema.optional(),
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
