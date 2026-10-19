import { z } from "zod";

/**
 * The diction rules James applies to his own output, from
 * `~/.claude/CLAUDE.md`. They are enforced here rather than asked for in the
 * brief, because a brief is a request and a schema is a refusal: an agent that
 * writes "this significantly improves things" fails the read and the stage says
 * which word did it. AC-K3.
 */
const BANNED: ReadonlyArray<{ pattern: RegExp; name: string }> = [
  { pattern: /—/, name: "an em dash" },
  // Vague quantifiers. The rule is to quantify, or to say what is unknown.
  {
    pattern:
      /\b(significant|substantial|considerable|meaningful|notable)(ly)?\b/i,
    name: "a vague quantifier",
  },
  // Hedges, verbatim from the list in the diction rules.
  {
    pattern:
      /\b(sort of|kind of|a bit|I think maybe|it's possible that|just)\b/i,
    name: "a hedge",
  },
  // No second person. The summary describes the pull request, not the reader.
  { pattern: /\b(you|your|yours|you're)\b/i, name: "second person" },
];

/** Reports the offending text, so a re-run has something to act on. */
function diction(value: string): string | null {
  for (const { pattern, name } of BANNED) {
    const hit = pattern.exec(value);
    if (hit) return `${name}, "${hit[0]}"`;
  }
  return null;
}

/**
 * One line of prose under the response contract. The ceiling is a character
 * count rather than a word count because it is the only limit a schema can
 * check; `max` is set per field to the length its row in the contract allows.
 */
function line(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .superRefine((value, ctx) => {
      const offence = diction(value);
      if (offence)
        ctx.addIssue({ code: "custom", message: `contains ${offence}` });
    });
}

export const summarySchema = z.object({
  /** The first sentence is the result. Not "this PR adds", but what it does. */
  headline: line(200),
  /** What the diff does, quantified. Six is the ceiling, not the target. */
  changes: z.array(line(160)).min(1).max(6),
  /** The named assessment: what breaks, under what load, at what threshold. */
  risk: line(300),
  /** Ticket against implementation, description against content. */
  scope: line(300),
  generatedAt: z.string().min(1),
});

/** What the agent writes. The server keeps only the fields above. */
export const summaryFileSchema = summarySchema.extend({
  version: z.literal(1),
  key: z.string().min(1),
});

export type PullRequestSummary = z.infer<typeof summarySchema>;
export type SummaryFile = z.infer<typeof summaryFileSchema>;
