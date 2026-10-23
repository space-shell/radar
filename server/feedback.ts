import type { Finding, VerificationStep } from "../shared/findings";
import type { IntakeRecord } from "../shared/inbox";
import {
  anchorKey,
  commentBody,
  emptyDraft,
  roundsOf,
  type Draft,
  type Fault,
  type Feedback,
  type ReviewEvent,
  type SubmittedReview,
} from "../shared/feedback";
import { reviewOf } from "../shared/review";
import { call, githubError } from "./api";
import { MissingArtifact } from "./artifact";
import { anchorFault, diffAnchors } from "./diff";
import { findingsPath, readFindings } from "./findings";
import { log } from "./log";
import { removeEyes } from "./reactions";
import { runStage, type StageResult } from "./stages";
import { loadState, updateState } from "./state";

/** What GitHub sends back from a created review. */
interface ReviewResponse {
  id: number;
  html_url: string;
}

interface InlineComment {
  path: string;
  line: number;
  side: Finding["side"];
  body: string;
}

export interface FeedbackState {
  findings: Finding[];
  verification: VerificationStep[];
  generatedAt: string | null;
  draft: Draft;
  rounds: SubmittedReview[];
  open: boolean;
  error?: string;
}

function feedbackOf(record: IntakeRecord): Feedback {
  return record.feedback ?? { draft: emptyDraft() };
}

/**
 * Whether a round is open for composing.
 *
 * The feedback stage is the flag. `submitReview` settles it `done`, and the only
 * way back to `pending` is a Reopen, which is the press that opens the next
 * round. Reading the stage rather than counting rounds is what lets one decision
 * drive both the wizard's screen and the refusals below: before rounds existed
 * this was `feedback.submitted != null`, which no press could ever clear.
 * AC-AP5.
 */
function roundOpen(record: IntakeRecord): boolean {
  return reviewOf(record).feedback.status !== "done";
}

/** Said in one place, because three callers refuse with it. */
const CLOSED =
  "this review has already been submitted. Reopen the feedback stage to start another round";

async function findRecord(key: string): Promise<IntakeRecord> {
  const state = await loadState();
  const record = state.intake.find((candidate) => candidate.key === key);
  if (!record) throw new Error("no such record");
  return record;
}

/**
 * Everything the wizard renders, in one read: the agent's findings, the
 * verification list it must never turn into comments, and James' draft so far.
 */
export async function readFeedbackState(key: string): Promise<FeedbackState> {
  const record = await findRecord(key);
  const feedback = feedbackOf(record);
  const base = {
    draft: feedback.draft,
    rounds: roundsOf(feedback),
    open: roundOpen(record),
  };

  try {
    const file = await readFindings(findingsPath(record.repo, record.number));
    return {
      ...base,
      findings: file.findings,
      verification: file.verification,
      generatedAt: file.generatedAt,
    };
  } catch (error) {
    // A missing file is the ordinary state before QA has run. It is reported
    // rather than shown as an empty review, so the two never look alike. R10.
    //
    // Unless QA was skipped. Then there is no file because James said there
    // should not be one, and the screen used to answer that decision with "Run
    // QA from the review map, then come back", sending him back to undo the
    // thing the map had just offered. A skip means he still wants to review,
    // without the agent's findings, so the walk opens empty: verification,
    // then a preview carrying a body and an approve.
    const skipped =
      error instanceof MissingArtifact &&
      reviewOf(record).qa.status === "skipped";
    return {
      ...base,
      findings: [],
      verification: [],
      generatedAt: null,
      ...(skipped
        ? {}
        : { error: error instanceof Error ? error.message : String(error) }),
    };
  }
}

/**
 * Stores the draft as sent. The server never edits it: the text James typed is
 * what the preview shows and what GitHub receives. AC-G5, AC-G6.
 */
export async function storeDraft(
  key: string,
  draft: Draft,
): Promise<StageResult> {
  return updateState<StageResult>((state) => {
    const record = state.intake.find((candidate) => candidate.key === key);
    if (!record) return { ok: false, error: "no such record" };
    // A closed round's draft is the record of what went out, so it is not typed
    // over. Reopening the stage empties it and lets the next round be written.
    if (!roundOpen(record)) return { ok: false, error: CLOSED };
    record.feedback = { ...feedbackOf(record), draft };
    return { ok: true };
  });
}

/** The findings James switched on, in the order the agent wrote them. */
function included(findings: Finding[], draft: Draft): Finding[] {
  return findings.filter(
    (finding) => draft.comments[anchorKey(finding)]?.include,
  );
}

export interface AnchorCheck {
  ok: boolean;
  faults: Fault[];
  error?: string;
}

/**
 * Checks every included finding against the live diff. Returning the faults
 * rather than throwing is the point: a finding anchored off the diff is shown
 * as excluded, and the rest of the review still goes out. AC-G12.
 */
export async function checkDraftAnchors(key: string): Promise<AnchorCheck> {
  try {
    const record = await findRecord(key);
    const state = await readFeedbackState(key);
    const wanted = included(state.findings, state.draft);
    if (wanted.length === 0) return { ok: true, faults: [] };

    const anchors = await diffAnchors(record.repo, record.number);
    const faults: Fault[] = [];
    for (const finding of wanted) {
      const reason = anchorFault(anchors, finding);
      if (reason) faults.push({ anchor: anchorKey(finding), reason });
    }
    return { ok: true, faults };
  } catch (error) {
    return {
      ok: false,
      faults: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface SubmitResult {
  ok: boolean;
  error?: string;
  url?: string;
  comments?: number;
  excluded: Fault[];
  warning?: string;
}

/**
 * GitHub requires a body for COMMENT and REQUEST_CHANGES, and refuses the review
 * outright without one. Checked here rather than discovered as a 422, so the
 * answer names the field instead of the status code.
 */
function refusal(
  record: IntakeRecord,
  event: ReviewEvent,
  draft: Draft,
): string | null {
  if (!roundOpen(record)) return CLOSED;
  if (event === "APPROVE" && !draft.approve)
    return "the approve box is unchecked";
  if (event !== "APPROVE" && draft.body.trim().length === 0) {
    return `GitHub refuses a ${event === "COMMENT" ? "comment" : "request changes"} review with no body. Write one on the verification step`;
  }
  return null;
}

/**
 * One review, one call. Every inline comment rides in it, so a partial post is
 * not a state this can reach: GitHub either accepts the whole review or none of
 * it. AC-G10.
 *
 * Reachable only from the wizard's final confirm press. Nothing before that step
 * calls it, which is what AC-G9 rests on.
 */
export async function submitReview(
  key: string,
  event: ReviewEvent,
): Promise<SubmitResult> {
  let outcome: SubmitResult = { ok: false, excluded: [] };

  const staged = await runStage(
    key,
    "feedback",
    async (record) => {
      const state = await readFeedbackState(key);
      const draft = state.draft;
      const wanted = included(state.findings, draft);

      // Re-checked here rather than trusted from the preview: the diff can move
      // between the two, and a stale anchor would take the whole review with it.
      const anchors =
        wanted.length > 0
          ? await diffAnchors(record.repo, record.number)
          : new Map();
      const excluded: Fault[] = [];
      const comments: InlineComment[] = [];
      for (const finding of wanted) {
        const reason = anchorFault(anchors, finding);
        if (reason) {
          excluded.push({ anchor: anchorKey(finding), reason });
          continue;
        }
        comments.push({
          path: finding.path,
          line: finding.line,
          side: finding.side,
          body: commentBody(finding, draft),
        });
      }

      const body = draft.body.trim();
      const { status, body: payload } = await call<ReviewResponse>(
        `/repos/${record.repo}/pulls/${record.number}/reviews`,
        "POST",
        {
          event,
          // Absent, not empty: an empty string is still a body to GitHub. AC-G19.
          ...(body.length > 0 ? { body } : {}),
          comments,
        },
      );

      if (status !== 200 || !payload) {
        const detail = githubError(payload) ?? `GitHub returned ${status}`;
        // A refused self-approval is its own answer, and the draft survives it
        // intact: nothing here writes to the draft on the way out. AC-G25.
        outcome = { ok: false, error: detail, excluded };
        throw new Error(detail);
      }

      await updateState((live) => {
        const stored = live.intake.find((candidate) => candidate.key === key);
        if (!stored) return;
        // Appended, and the legacy `submitted` key is dropped rather than kept
        // beside it: `roundsOf` reads one or the other and two would double count.
        stored.feedback = {
          draft,
          rounds: [
            ...roundsOf(stored.feedback),
            {
              id: payload.id,
              url: payload.html_url,
              event,
              submittedAt: new Date().toISOString(),
              comments: comments.length,
              anchors: wanted
                .filter(
                  (finding) =>
                    !excluded.some(
                      (fault) => fault.anchor === anchorKey(finding),
                    ),
                )
                .map(anchorKey),
            },
          ],
        };
      });

      // Only now, and only on success. A failed submit leaves the pull request
      // marked as watched, which is the truth. AC-G16.
      let warning: string | undefined;
      try {
        await removeEyes(record.repo, record.number);
      } catch (error) {
        warning = `the eyes reaction could not be removed: ${error instanceof Error ? error.message : String(error)}`;
        log(`${key}: ${warning}`);
      }

      outcome = {
        ok: true,
        url: payload.html_url,
        comments: comments.length,
        excluded,
        warning,
      };

      const verb =
        event === "APPROVE"
          ? "approved"
          : event === "REQUEST_CHANGES"
            ? "changes requested"
            : "commented";
      const count =
        comments.length === 1 ? "1 comment" : `${comments.length} comments`;
      return `${verb}, ${count}`;
    },
    { allow: (record) => refusal(record, event, feedbackOf(record).draft) },
  );

  // A refusal taken before the work ran never reached `outcome`.
  if (!staged.ok && !outcome.error) {
    return { ok: false, error: staged.error, excluded: [] };
  }
  return outcome;
}
