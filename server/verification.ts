import { join } from "node:path";
import type { VerificationStep } from "../shared/findings";
import { pullRequestUrl, type IntakeRecord } from "../shared/inbox";
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
import { previewUrl } from "./preview";
import { setupCommand, setupLines } from "./setup";
import { runStage, type StageResult } from "./stages";
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
