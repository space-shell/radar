import { pullRequestUrl, type IntakeRecord } from "../shared/inbox";
import { reviewOf } from "../shared/review";
import {
  findingsPath,
  inFindingsLane,
  readFindings,
  writeFindings,
} from "./findings";
import { clearArtifact, prepareArtifact } from "./artifact";
import { keyUrl, note as ledger } from "./ledger";
import { log } from "./log";
import { briefPath } from "./briefs";
import { setupCommand, setupLines } from "./setup";
import { loadState, updateState } from "./state";
import { runStage, type StageResult } from "./stages";
import { askAgent, gateFor, type Paseo } from "./turn";

/** The wording runQa settles with, so an adopted file reads the same as a waited one. */
function countNote(count: number): string {
  return count === 1 ? "1 finding" : `${count} findings`;
}

function prompt(
  record: IntakeRecord,
  brief: string,
  output: string,
  setup: string | null,
): string {
  return [
    `Read ${brief} and follow it exactly.`,
    "",
    `Pull request: ${pullRequestUrl(record)}`,
    `Record key: ${record.key}`,
    `Write the findings file to: ${output}`,
    ...setupLines(setup),
    "",
    "Post nothing to GitHub. The findings file is the only output.",
  ].join("\n");
}

/**
 * Reviews the code and leaves the result in a file. Nothing is posted anywhere:
 * what James says on the pull request is decided in the feedback wizard, from
 * findings he has read. AC-E7.
 */
export function runQa(key: string, paseo: Paseo): Promise<StageResult> {
  return runStage(
    key,
    "qa",
    (record) =>
      // Held across the whole body rather than around the writes, because the
      // write that must not interleave is the agent's own. AC-AG6.
      inFindingsLane(record.key, async () => {
        const output = findingsPath(record.repo, record.number);
        await prepareArtifact(output);

        // A re-run replaces the code findings. The verification list is not QA's
        // to discard, so it is carried across rather than lost with the old file.
        // AC-F5.
        const previous = await readFindings(output).catch(() => null);
        await clearArtifact(output);

        const brief = await briefPath("qa");
        await askAgent(
          paseo,
          record,
          "qa",
          prompt(record, brief, output, await setupCommand()),
        );

        const file = await readFindings(output);
        const carried = previous?.verification ?? [];
        if (carried.length > 0 && file.verification.length === 0) {
          await writeFindings(output, { ...file, verification: carried });
        }

        return countNote(file.findings.length);
      }),
    { background: true, gate: (record) => gateFor(paseo, record, "qa") },
  );
}

/**
 * Adopts a findings file a QA turn wrote after its own stage had given up.
 *
 * The turn outlives the stage that started it, so a daemon restart fails the
 * stage while the agent carries on and the file lands minutes later with nobody
 * waiting for it. The file is the output; discarding it would cost a review that
 * has already been done. AC-Q8.
 *
 * Only a failed stage is adopted. `pending` is James having pressed Reopen,
 * which is a decision to run it again, and `skipped` is a decision not to.
 */
export async function adoptFindings(): Promise<void> {
  const snapshot = await loadState();
  const adopted = new Map<string, string>();

  for (const record of snapshot.intake) {
    const qa = reviewOf(record).qa;
    if (qa.status !== "failed" || !qa.startedAt) continue;

    const file = await readFindings(
      findingsPath(record.repo, record.number),
    ).catch(() => null);
    // Written before the attempt began, so it belongs to an earlier run.
    if (!file || Date.parse(file.generatedAt) < Date.parse(qa.startedAt))
      continue;

    adopted.set(record.key, countNote(file.findings.length));
  }

  if (adopted.size === 0) return;

  const settled: { key: string; note: string }[] = [];
  await updateState((state) => {
    for (const record of state.intake) {
      const note = adopted.get(record.key);
      if (!note) continue;
      const review = reviewOf(record);
      // A press may have moved the stage on while the files were read.
      if (review.qa.status !== "failed") continue;
      review.qa = {
        status: "done",
        startedAt: review.qa.startedAt,
        endedAt: new Date().toISOString(),
        note,
      };
      record.review = review;
      settled.push({ key: record.key, note });
    }
  });

  for (const { key, note } of settled) {
    log(`adopted the findings ${key} wrote after its stage failed, ${note}`);
    ledger({
      source: "github",
      subject: key,
      what: `qa done, ${note}, adopted after the stage failed`,
      url: keyUrl(key),
    });
  }
}
