import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { findingStateSchema } from "./findings";

/**
 * One review conversation on the pull request, as GitHub holds it.
 *
 * Not a finding and not a draft comment: a thread is something already posted,
 * by anyone, and the only thing radar does to it is mark it resolved. It has no
 * stored shape, because there is nothing worth keeping between reads: GitHub is
 * the truth and a cached copy would only be a stale one. AC-AP6.
 */
export const reviewThreadSchema = z.object({
  /** The GraphQL node id, which is what the mutation takes. */
  id: z.string(),
  resolved: z.boolean(),
  /** The diff moved under it. Still resolvable, and worth saying so. */
  outdated: z.boolean(),
  path: z.string(),
  /** Null on a thread whose line has left the diff entirely. */
  line: z.number().nullable(),
  author: z.string().nullable(),
  /** The opening comment. The rest of the thread is read on GitHub. */
  body: z.string(),
  url: z.string(),
  /** How many comments the thread holds, the opening one included. */
  comments: z.number(),
});
export type ReviewThread = z.infer<typeof reviewThreadSchema>;

/**
 * One finding this plugin posted, and what became of it.
 *
 * A thread seen from the other end. `reviewThreadSchema` is every conversation
 * on the pull request, whoever opened it; this is the subset radar sent, bound
 * back to the anchor it was sent for, so the screen can say "round 1, three
 * findings, two resolved" rather than listing fifteen comments and leaving the
 * arithmetic to the reader.
 *
 * It rides the same RPC rather than a second one: same upstream read, same cache
 * key, one screen. AC-AQ5.
 */
export const postedFindingSchema = z.object({
  /** The anchor key it went out under, which is the key everything else uses. */
  anchor: z.string(),
  /** Which round sent it, counting from one in submit order. */
  round: z.number(),
  state: findingStateSchema,
  path: z.string(),
  /** Where it sits now. Null once the line has left the diff. */
  line: z.number().nullable(),
  /** The thread it became, so the screen's Resolve has something to press. */
  threadId: z.string().nullable(),
  resolved: z.boolean(),
  url: z.string(),
  /**
   * The comment as it was actually posted, which is not always the finding's own
   * body: James can type a replacement in the wizard, and what the author read
   * is the only version worth showing back. Empty on an unbound anchor.
   */
  body: z.string(),
  /** The first answer from somebody other than whoever opened the thread. */
  reply: z.string(),
  replier: z.string().nullable(),
});
export type PostedFinding = z.infer<typeof postedFindingSchema>;

export const readThreads = defineRpc({
  name: "radar.threads.read",
  input: z.object({ key: z.string() }),
  output: z.object({
    threads: z.array(reviewThreadSchema),
    /**
     * What radar itself posted, oldest round first. Empty when no round has gone
     * out, which is the ordinary case before the first review.
     */
    posted: z.array(postedFindingSchema).default([]),
    /** Why there are none, when that is the answer rather than an empty list. R10. */
    error: z.string().optional(),
  }),
});

/**
 * Marks a thread resolved, or puts it back.
 *
 * Both directions, because a resolve is an outward write with no undo on the
 * screen otherwise, and a mis-press on a list of fifteen is the ordinary way this
 * gets used wrong. AC-AP8.
 */
export const setThreadResolved = defineRpc({
  name: "radar.threads.resolve",
  input: z.object({
    key: z.string(),
    id: z.string(),
    resolved: z.boolean(),
  }),
  output: z.object({ ok: z.boolean(), error: z.string().optional() }),
});
