import { z } from "zod";

/** Only `blocking` affects the approve checkbox. AC-G20. */
export const severitySchema = z.enum(["blocking", "concern", "nit"]);
export type Severity = z.infer<typeof severitySchema>;

/** Which side of the diff the line sits on, in GitHub's own vocabulary. */
export const sideSchema = z.enum(["LEFT", "RIGHT"]);
export type Side = z.infer<typeof sideSchema>;

/**
 * One candidate inline comment. Every field is required: a finding missing its
 * anchor cannot become a comment, and discovering that at submit time would mean
 * discovering it after James has already chosen to include it. AC-E6.
 */
export const findingSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  side: sideSchema,
  severity: severitySchema,
  body: z.string().min(1),
});
export type Finding = z.infer<typeof findingSchema>;

/**
 * One manual verification step and how it went. Deliberately not a finding: these
 * never become inline comments, so they carry no diff anchor to tempt anyone into
 * posting them. AC-F4, AC-G17.
 *
 * Anything other than a pass must say why. Enforced here rather than asked for in
 * the brief, so a step cannot be quietly written off as not runnable with no
 * reason attached. AC-F4.
 */
export const verificationStepSchema = z
  .object({
    step: z.string().min(1),
    outcome: z.enum(["passed", "failed", "not runnable"]),
    detail: z.string(),
  })
  .refine((step) => step.outcome === "passed" || step.detail.trim().length > 0, {
    error: "a step that did not pass must say why",
    path: ["detail"],
  });
export type VerificationStep = z.infer<typeof verificationStepSchema>;

/**
 * What the verification agent writes, on its own, to its own path. It never opens
 * the findings file: QA's results are not its to rewrite, so the server merges the
 * two rather than trusting an agent to preserve a list it did not produce. AC-F5.
 *
 * At least one step. A pull request whose description lists no steps is recorded as
 * one step that was not runnable, which says so; an empty list would say nothing.
 */
export const verificationFileSchema = z.object({
  version: z.literal(1),
  key: z.string().min(1),
  generatedAt: z.string().min(1),
  verification: z.array(verificationStepSchema).min(1),
});
export type VerificationFile = z.infer<typeof verificationFileSchema>;

/**
 * The file both agent stages write. One file per pull request, holding two lists
 * rather than one list with a stage tag, so a verification result cannot be read
 * as a comment candidate by accident. AC-F5.
 */
export const findingsFileSchema = z.object({
  version: z.literal(1),
  key: z.string().min(1),
  generatedAt: z.string().min(1),
  findings: z.array(findingSchema),
  verification: z.array(verificationStepSchema).default([]),
});
export type FindingsFile = z.infer<typeof findingsFileSchema>;
