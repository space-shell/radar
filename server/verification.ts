import type { VerificationStep } from "../shared/findings";
import { pullRequestUrl, type IntakeRecord } from "../shared/inbox";
import { reviewOf } from "../shared/review";
import {
  findingsPath,
  inFindingsLane,
  mergeVerification,
  readVerification,
  verificationPath,
} from "./findings";
import { clearArtifact, prepareArtifact } from "./artifact";
import { pullRequestBody } from "./github";
import { briefPath } from "./briefs";
import { keyUrl, note as ledger } from "./ledger";
import { log } from "./log";
import { previewUrl } from "./preview";
import { setupCommand, setupLines } from "./setup";
import { runStage, type StageResult } from "./stages";
import { loadState, updateState } from "./state";
import { askAgent, gateFor, type Paseo } from "./turn";

function prompt(
  record: IntakeRecord,
  brief: string,
  output: string,
  preview: string | null,
  setup: string | null,
): string {
  return [
    `Read ${brief} and follow it exactly.`,
    "",
    `Pull request: ${pullRequestUrl(record)}`,
    `Record key: ${record.key}`,
    `Write the result file to: ${output}`,
    preview
      ? `Preview deployment: ${preview}`
      : "Preview deployment: none published on this pull request. Do not start a dev server.",
    ...setupLines(setup),
    "",
    "Post nothing to GitHub. The result file is the only output.",
  ].join("\n");
}

/** What the map shows under the node. Counts rather than prose, so it stays one line. */
function summarise(steps: VerificationStep[]): string {
  const count = (outcome: VerificationStep["outcome"]) =>
    steps.filter((step) => step.outcome === outcome).length;
  const failed = count("failed");
  const blocked = count("not runnable");
  const parts = [`${steps.length} step${steps.length === 1 ? "" : "s"}`];
  if (failed > 0) parts.push(`${failed} failed`);
  if (blocked > 0) parts.push(`${blocked} not runnable`);
  if (failed === 0 && blocked === 0) parts.push("all passed");
  return parts.join(", ");
}

/**
 * Walks the description's own verification steps against the preview deployment and
 * records how each went. Nothing is posted: what James says on the pull request is
 * decided in the feedback wizard, from results he has read.
 *
 * The body is fetched fresh rather than read from the record. The preview block is
 * rewritten by the bot on every push, so a stored copy could name a deployment built
 * from code the worktree no longer holds. AC-F3.
 */
export function runVerification(
  key: string,
  paseo: Paseo,
): Promise<StageResult> {
  return runStage(
    key,
    "verification",
    (record) =>
      // Taken for the whole body, not just the merge: the merge reads a file QA's
      // agent may be about to overwrite, so the two stages are held apart rather
      // than their last writes. AC-AG6.
      inFindingsLane(record.key, async () => {
        const body = await pullRequestBody(record.repo, record.number);
        const preview = previewUrl(body, record.number);

        const scratch = verificationPath(record.repo, record.number);
        await prepareArtifact(scratch);
        // A stale file from a previous run must not be read as this run's output.
        await clearArtifact(scratch);

        const brief = await briefPath("verification");
        await askAgent(
          paseo,
          record,
          "verification",
          prompt(record, brief, scratch, preview, await setupCommand()),
        );

        const file = await readVerification(scratch);
        await mergeVerification(
          findingsPath(record.repo, record.number),
          record.key,
          file.verification,
        );
        await clearArtifact(scratch);

        return summarise(file.verification);
      }),
    {
      background: true,
      gate: (record) => gateFor(paseo, record, "verification"),
    },
  );
}

/**
 * Adopts a verification file a turn wrote after its own stage had given up.
 *
 * The mirror of `adoptFindings`, and needed harder. QA's loss is a turn; this
 * stage's is a person at a browser for a quarter of an hour, and the two ways it
 * is lost are both routine. #9649 failed on a schema error, the agent rewrote the
 * file correctly nineteen minutes later, and nothing read it: the stage still said
 * failed and the merged file held no steps while a genuine failure sat on disk.
 * #9633 failed waiting on a permission and its file landed an hour after it was
 * answered. AC-AO3.
 *
 * Only a failed stage, and only a file newer than that attempt, on the same rules
 * `adoptFindings` holds: `pending` is a Reopen, which is a decision to run it
 * again, and `skipped` is a decision not to.
 */
export async function adoptVerification(): Promise<void> {
  const snapshot = await loadState();

  for (const record of snapshot.intake) {
    const stage = reviewOf(record).verification;
    if (stage.status !== "failed" || !stage.startedAt) continue;

    const scratch = verificationPath(record.repo, record.number);
    const file = await readVerification(scratch).catch(() => null);
    // Written before the attempt began, so it belongs to an earlier run.
    if (!file || Date.parse(file.generatedAt) < Date.parse(stage.startedAt))
      continue;

    const note = summarise(file.verification);
    // The merge and the settle are taken together, under the same lane the stage
    // itself holds. A re-run claims `running` before it enters the lane, so the
    // re-read inside sees it and this file is dropped rather than overwriting a
    // fresher result, and a re-run that starts after cannot interleave with these
    // two writes. AC-AO4.
    const adopted = await inFindingsLane(record.key, async () => {
      const live = await loadState();
      const current = live.intake.find(
        (candidate) => candidate.key === record.key,
      );
      if (!current || reviewOf(current).verification.status !== "failed")
        return false;

      await mergeVerification(
        findingsPath(record.repo, record.number),
        record.key,
        file.verification,
      );
      // Cleared only once it is merged, so a failure above leaves it for the next
      // tick rather than discarding the thing being rescued.
      await clearArtifact(scratch);

      await updateState((state) => {
        const stored = state.intake.find(
          (candidate) => candidate.key === record.key,
        );
        if (!stored) return;
        const review = reviewOf(stored);
        if (review.verification.status !== "failed") return;
        review.verification = {
          status: "done",
          startedAt: review.verification.startedAt,
          endedAt: new Date().toISOString(),
          note,
        };
        stored.review = review;
      });
      return true;
    });
    if (!adopted) continue;

    log(
      `adopted the verification ${record.key} wrote after its stage failed, ${note}`,
    );
    ledger({
      source: "github",
      subject: record.key,
      what: `verification done, ${note}, adopted after the stage failed`,
      url: keyUrl(record.key),
    });
  }
}
