import type { FindingsFile } from "../shared/findings";
import { pullRequestUrl, type IntakeRecord } from "../shared/inbox";
import { reviewOf } from "../shared/review";
import {
  findingsPath,
  inFindingsLane,
  readFindings,
  rereviewPath,
  writeFindings,
} from "./findings";
import { clearArtifact, prepareArtifact, writeArtifact } from "./artifact";
import { keyUrl, note as ledger } from "./ledger";
import { log } from "./log";
import { briefPath } from "./briefs";
import {
  carryFor,
  scopeFor,
  unanchoredNote,
  type CarriedFinding,
  type QaScope,
  type ScopedFile,
} from "./rereview";
import { setupCommand, setupLines } from "./setup";
import { loadState, updateState } from "./state";
import { runStage, type StageResult } from "./stages";
import { listThreads } from "./threads";
import { askAgent, gateFor, type Paseo } from "./turn";

/**
 * The wording runQa settles with, so an adopted file reads the same as a waited
 * one.
 *
 * The scope rides on the end, so the node and the ledger say what was read as
 * well as what was found: `7 findings, 3 commits since round 1`. A run with no
 * round behind it has no scope and reads exactly as it did before. Adoption
 * passes none, because the scope that run used is not recoverable after the
 * fact and inventing one would be worse than leaving it off. AC-AQ7.
 */
function countNote(count: number, scope?: QaScope | null): string {
  const found = count === 1 ? "1 finding" : `${count} findings`;
  return scope ? `${found}, ${scope.reason}` : found;
}

/**
 * What the server tells a re-review before it starts. Written to its own file
 * rather than into the prompt: ten carried findings of prose is an unbounded
 * prompt string, and the plugin already has a file channel the agent reads.
 *
 * Never merged into the findings file. If the server wrote carried findings
 * there, the normal path and `adoptFindings`' rescue path would produce
 * different files for the same run, and `generatedAt` would stop meaning the
 * moment the agent wrote its answer.
 */
interface RereviewFile {
  version: 1;
  key: string;
  generatedAt: string;
  round: number;
  base: string | null;
  head: string | null;
  scope: QaScope["mode"];
  reason: string;
  commits: number;
  files: ScopedFile[];
  carried: CarriedFinding[];
  /** Present only when the previous round could not be read back. */
  carriedError?: string;
}

/**
 * Builds that file, including the live read of what each posted finding got.
 *
 * The thread read is held inside the findings lane along with everything else
 * the stage does. New, but precedented: `server/verification.ts` already holds
 * the same lane across a thirty second `gh pr view`.
 *
 * A failed read is named in the file rather than failing the stage. An empty
 * carried list with no explanation would tell the agent nothing was ever raised,
 * which is a different and false claim.
 */
async function guideFor(
  record: IntakeRecord,
  previous: FindingsFile | null,
  scope: QaScope,
): Promise<RereviewFile> {
  const file: RereviewFile = {
    version: 1,
    key: record.key,
    generatedAt: new Date().toISOString(),
    round: scope.round,
    base: scope.base,
    head: scope.head,
    scope: scope.mode,
    reason: scope.reason,
    commits: scope.commits,
    files: scope.files,
    carried: [],
  };

  const threads = await listThreads(record.key);
  if (threads.error) {
    log(
      `${record.key}: the previous round could not be read: ${threads.error}`,
    );
    return { ...file, carriedError: threads.error };
  }

  // A clean read is not the same as a complete one. A round stored before
  // anchors existed posted comments this carry cannot see, and the read says
  // nothing about them because there is nothing to bind. Named rather than
  // left as silence, for the same reason a failed read is. AC-AQ16.
  const gap = unanchoredNote(record);
  const carried = carryFor(threads.posted, previous);
  if (gap) log(`${record.key}: ${gap}`);
  return gap ? { ...file, carried, carriedError: gap } : { ...file, carried };
}

function prompt(
  record: IntakeRecord,
  brief: string,
  output: string,
  setup: string | null,
  guide: string | null,
): string {
  return [
    `Read ${brief} and follow it exactly.`,
    "",
    `Pull request: ${pullRequestUrl(record)}`,
    `Record key: ${record.key}`,
    ...(guide
      ? [
          `This is a re-review. Read ${guide} before the code: it says what the`,
          "last round already posted, what the author did about each one, and how",
          "far the pull request has moved since.",
        ]
      : []),
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
        const guide = rereviewPath(record.repo, record.number);
        await prepareArtifact(output);

        // A re-run replaces the code findings. The verification list is not QA's
        // to discard, so it is carried across rather than lost with the old file.
        // AC-F5.
        const previous = await readFindings(output).catch(() => null);
        // Both reads happen before the clear, because the guide draws on the
        // file the clear is about to remove.
        const scope = await scopeFor(record);
        const context = scope ? await guideFor(record, previous, scope) : null;
        await clearArtifact(output);

        // Cleared whether or not one is written, so a guide a failed run left
        // behind can never be read as this run's input. Left on disk afterwards,
        // unlike verification's scratch file, so a failed run's input stays
        // inspectable: nothing adopts it, so nothing can mistake it for output.
        await clearArtifact(guide);
        if (context) await writeArtifact(guide, context);

        const brief = await briefPath("qa");
        await askAgent(
          paseo,
          record,
          "qa",
          prompt(
            record,
            brief,
            output,
            await setupCommand(),
            context ? guide : null,
          ),
        );

        const file = await readFindings(output);
        const steps = previous?.verification ?? [];
        if (steps.length > 0 && file.verification.length === 0) {
          await writeFindings(output, { ...file, verification: steps });
        }

        return countNote(file.findings.length, scope);
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
