import { roundsOf, type SubmittedReview } from "../shared/feedback";
import { call, githubError } from "./api";
import { log } from "./log";
import { loadState, updateState } from "./state";

/** One inline comment, as the review's own comment list returns it. */
interface ReviewCommentRow {
  id: number;
}

/**
 * The ids GitHub gave one review's inline comments, in the order it holds them.
 *
 * `POST /pulls/{n}/reviews` answers with the review and not with its comments,
 * so this is a second read. The order it returns is the order the comments were
 * sent in, which is the order `anchors` holds, and the id it gives each one is
 * the `databaseId` that review thread's first comment carries. That pairing is
 * what lets a later round say which finding a thread belongs to.
 */
async function fetchCommentIds(
  repo: string,
  number: number,
  reviewId: number,
): Promise<number[]> {
  const { status, body } = await call<ReviewCommentRow[]>(
    `/repos/${repo}/pulls/${number}/reviews/${reviewId}/comments?per_page=100`,
    "GET",
  );
  if (status !== 200 || !Array.isArray(body)) {
    throw new Error(githubError(body) ?? `GitHub returned ${status}`);
  }
  return body.map((row) => row.id);
}

/**
 * Pairs each inline comment GitHub created with the finding it came from, and
 * stores the pairing on the round.
 *
 * Written only when the two lists are the same length. A short answer means the
 * assumption about order or count does not hold, and a mispaired id would report
 * one finding resolved when it was a different one. The round keeps its anchors
 * either way and falls back to matching on path, side and line. AC-AQ6.
 */
export async function recordCommentIds(
  key: string,
  repo: string,
  number: number,
  reviewId: number,
  anchors: string[],
): Promise<boolean> {
  const ids = await fetchCommentIds(repo, number, reviewId);
  if (ids.length !== anchors.length) {
    log(
      `${key}: review ${reviewId} returned ${ids.length} comments for ${anchors.length} anchors, so the ids were not stored`,
    );
    return false;
  }

  const posted = anchors.map((anchor, index) => ({
    id: ids[index] ?? 0,
    anchor,
  }));
  await updateState((live) => {
    const stored = live.intake.find((candidate) => candidate.key === key);
    if (!stored?.feedback) return;
    const rounds = roundsOf(stored.feedback);
    const target = rounds.find((round) => round.id === reviewId);
    if (!target) return;
    target.posted = posted;
    // Written back whole, and the legacy `submitted` key dropped with it, the
    // same way the submit path writes: `roundsOf` reads one or the other.
    stored.feedback = { draft: stored.feedback.draft, rounds };
  });
  return true;
}

/** A round that went out but has no ids to pair its anchors with. */
function needsIds(round: SubmittedReview): boolean {
  return round.anchors.length > 0 && (round.posted ?? []).length === 0;
}

/**
 * The one-off repair for every round stored before the ids were captured.
 *
 * Thirty one of them at the time of writing, each one GET. Without it those
 * rounds live on the position fallback forever, which cannot tell two findings
 * at one line apart and reports both `unknown`.
 *
 * Runs at most once: the flag is set only after a clean pass, so a run that died
 * partway resumes on the next start, and a round it already finished is skipped
 * because it now has ids. A round GitHub no longer answers for is logged and
 * left on the fallback rather than retried forever.
 */
export async function backfillCommentIds(): Promise<void> {
  const state = await loadState();
  if (state.backfill?.commentIds === 1) return;

  const work: {
    key: string;
    repo: string;
    number: number;
    round: SubmittedReview;
  }[] = [];
  for (const record of state.intake) {
    for (const round of roundsOf(record.feedback)) {
      if (needsIds(round)) {
        work.push({
          key: record.key,
          repo: record.repo,
          number: record.number,
          round,
        });
      }
    }
  }

  if (work.length === 0) {
    await updateState((live) => {
      live.backfill = { ...live.backfill, commentIds: 1 };
    });
    return;
  }

  log(`backfilling comment ids for ${work.length} rounds`);
  let paired = 0;
  let failed = 0;
  for (const item of work) {
    try {
      const ok = await recordCommentIds(
        item.key,
        item.repo,
        item.number,
        item.round.id,
        item.round.anchors,
      );
      if (ok) paired++;
    } catch (error) {
      failed++;
      log(
        `${item.key}: review ${item.round.id} could not be paired: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Set even when some rounds could not be paired. A review GitHub will not
  // answer for today will not answer tomorrow either, and retrying it on every
  // start would spend a request a tick forever to learn the same thing.
  await updateState((live) => {
    live.backfill = { ...live.backfill, commentIds: 1 };
  });
  log(`comment ids backfilled: ${paired} paired, ${failed} unreadable`);
}
