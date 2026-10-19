import { record, writeOpen } from "./ledger";
import { openIssues, pollLinear } from "./linear";
import { log } from "./log";
import { loadState, updateState } from "./state";

/**
 * How many notification ids are kept. The cursor does the work; this list only
 * covers the overlap around it, so it needs to span one page, not one history.
 */
const SEEN_LIMIT = 200;

/**
 * Reads Linear and writes down what arrived.
 *
 * Nothing here decides anything. It records what happened and where to find it,
 * which is what makes the ledger answerable in a week, and it never drafts a word
 * of what to say back: naming who is waiting is this plugin's job, replying is not.
 *
 * Silent when no key is configured, which is the ordinary state of a machine that
 * has not issued one. The GitHub half does not depend on this.
 */
export async function sweepLinear(): Promise<void> {
  const before = await loadState();
  const poll = await pollLinear(before.lastLinearAt);
  if (!poll) return;

  const seen = new Set(before.linearSeen);
  // The cursor is `createdAt > since`, so two notifications sharing a second would
  // see the later one dropped. The id list is what makes the overlap safe.
  const fresh = poll.engagements.filter((item) => !seen.has(item.id));

  for (const item of fresh) {
    await record({
      source: "linear",
      subject: item.issue,
      what: `${item.what}, ${item.title}`,
      url: item.url,
      // The time it happened, not the time it was read, or a quiet night would
      // file a Tuesday evening comment under Wednesday morning.
      at: new Date(item.createdAt),
    });
  }

  // Asked for every sweep, not only when something arrived: an issue is closed
  // without notifying its own assignee, and the standing list has to lose it.
  const open = await openIssues();

  await updateState((state) => {
    if (poll.newest) state.lastLinearAt = poll.newest;
    if (fresh.length > 0) {
      state.linearSeen = [
        ...state.linearSeen,
        ...fresh.map((item) => item.id),
      ].slice(-SEEN_LIMIT);
    }
    if (open) state.linearOpen = open;
  });

  await writeOpen();

  if (fresh.length === 0 && poll.skipped === 0) return;
  log(
    `linear: ${fresh.length} recorded, ${poll.skipped} not about an issue, ${open?.length ?? 0} assigned and open`,
  );
}
