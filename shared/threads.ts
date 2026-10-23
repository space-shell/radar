import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

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

export const readThreads = defineRpc({
  name: "radar.threads.read",
  input: z.object({ key: z.string() }),
  output: z.object({
    threads: z.array(reviewThreadSchema),
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
