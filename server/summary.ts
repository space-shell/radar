import { join } from "node:path";
import { pullRequestUrl, type IntakeRecord } from "../shared/inbox";
import { summaryFileSchema, type SummaryFile } from "../shared/summary";
import {
  clearArtifact,
  MissingArtifact,
  prepareArtifact,
  readArtifact,
} from "./artifact";
import { log } from "./log";
import { briefPath } from "./briefs";
import { loadState, STATE_DIR, updateState } from "./state";
import { inLane, isLaneCancelled } from "./queue";
import { askAgent, gateFor, type Paseo } from "./turn";

/** Ten minutes. A summary of a diff the agent has already read is not a review. */
const SUMMARY_TIMEOUT_MS = 10 * 60_000;

/** Keys with a summary run in flight, so a double press cannot send two turns. */
const inFlight = new Set<string>();

/**
 * Which records have a summary turn running. In memory on purpose: a turn exists
 * only as long as this daemon does, so a restart clearing the set is the truth,
 * not a loss. The screen reads it through the inbox. AC-Q3.
 */
export function summarising(): string[] {
  return [...inFlight];
}

export function summaryPath(repo: string, number: number): string {
  return join(STATE_DIR, "summaries", `${repo}#${number}.json`);
}

function prompt(record: IntakeRecord, brief: string, output: string): string {
  return [
    `Read ${brief} and follow it exactly.`,
    "",
    `Pull request: ${pullRequestUrl(record)}`,
    `Record key: ${record.key}`,
    `Write the summary file to: ${output}`,
    "",
    "Post nothing to GitHub. The summary file is the only output.",
  ].join("\n");
}

/** Keeps the four prose fields and drops the envelope the agent wrote. */
async function store(key: string, file: SummaryFile): Promise<void> {
  await updateState((state) => {
    const record = state.intake.find((candidate) => candidate.key === key);
    if (!record) return;
    record.summary = {
      headline: file.headline,
      changes: file.changes,
      risk: file.risk,
      scope: file.scope,
      generatedAt: file.generatedAt,
    };
    // A summary that arrived makes the last failure stale, whichever path wrote it.
    delete record.summaryError;
  });
}

/** Records why a run failed, or clears the last reason before a new one starts. */
async function setError(key: string, error: string | null): Promise<void> {
  await updateState((state) => {
    const record = state.intake.find((candidate) => candidate.key === key);
    if (!record) return;
    if (error) record.summaryError = error;
    else delete record.summaryError;
  });
}

export interface SummaryResult {
  ok: boolean;
  error?: string;
}

/**
 * The turn itself. Nothing waits on it, so its outcome is written, not returned.
 *
 * Queued behind whatever the agent is doing, rather than refused. A summary is
 * regenerated automatically when a record changes, so colliding with James typing
 * into the same agent was the common case, and it showed as a red line on the card
 * for something that was only ever a moment's overlap.
 *
 * The claim is taken by the caller and released here, so the spinner holds across
 * the wait with nothing further to do. No cancel: a summary has no node on the map
 * to put a control on.
 */
async function summarise(record: IntakeRecord, paseo: Paseo): Promise<void> {
  const key = record.key;

  const turn = async (): Promise<void> => {
    const output = summaryPath(record.repo, record.number);
    await prepareArtifact(output);
    // A stale file from a previous run must not be read as this run's output.
    await clearArtifact(output);

    const brief = await briefPath("summary");
    await askAgent(
      paseo,
      record,
      "summary",
      prompt(record, brief, output),
      SUMMARY_TIMEOUT_MS,
    );

    const file = await readArtifact(output, summaryFileSchema, "summary");
    await store(key, file);
    await clearArtifact(output);
    log(`summarised ${key}`);
  };

  try {
    const gate = await gateFor(paseo, record, "summary");
    if (gate.agentId) await inLane(gate.agentId, gate.ready, turn);
    else await turn();
  } catch (caught) {
    // A queued summary dropped at shutdown is not a failed summary. No turn was
    // sent, so there is nothing to report against the record.
    if (isLaneCancelled(caught)) {
      log(`summary for ${key} dropped before it started`);
      return;
    }
    const error = caught instanceof Error ? caught.message : String(caught);
    await setError(key, error);
    log(`summary failed for ${key}: ${error}`);
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Takes in the summary files the intake turns wrote, one sweep over the ledger.
 *
 * Intake asks for the file in the turn that already read the diff, so a record
 * normally arrives with one and the detail view has something to render before
 * anything is pressed. Nothing waits on that turn, so the file appears whenever
 * the agent finishes: the tick looks rather than being told. AC-AB3.
 *
 * A record that already has a summary keeps it: a press is the only thing that
 * replaces one. The file waiting for such a record is discarded unread rather
 * than left alone, which is not tidiness. Left on disk it would be collected by
 * a later sweep the moment anything cleared the stored summary, landing an
 * intake's reading of an old diff on a record that had moved on.
 *
 * A file that is there and wrong is not the same event as no file at all. The
 * first is the agent breaching the schema, which is recorded against the record
 * and cleared so the next sweep does not report it again. The second is a turn
 * that has not finished, or an agent that wrote nothing, and costs nothing to
 * meet on every tick. AC-AB5.
 */
export async function collectSummaries(): Promise<number> {
  const { intake } = await loadState();
  let taken = 0;

  for (const record of intake) {
    // A press is mid-flight for this key: its own path stores the result and
    // clears the file, and collecting underneath it would race that write.
    if (inFlight.has(record.key)) continue;

    const output = summaryPath(record.repo, record.number);
    if (record.summary) {
      await clearArtifact(output);
      continue;
    }

    try {
      const file = await readArtifact(output, summaryFileSchema, "summary");
      await store(record.key, file);
      await clearArtifact(output);
      taken++;
      log(`collected the summary for ${record.key}`);
    } catch (caught) {
      if (caught instanceof MissingArtifact) continue;
      const error = caught instanceof Error ? caught.message : String(caught);
      await setError(record.key, error);
      await clearArtifact(output);
      log(`discarded the summary file for ${record.key}: ${error}`);
    }
  }

  return taken;
}

/**
 * Rewrites the summary on a press, for a record whose intake wrote none or
 * wrote one that has since gone stale. AC-K1.
 *
 * This is the second reading of the same diff and it is charged for every time,
 * which is why it is a press and not something the screen does on opening.
 *
 * The press is answered as soon as the turn is under way. The plugin host
 * abandons any RPC at 30 seconds and a summary turn runs for minutes, so a
 * handler that waited reported a transport failure every time while the summary
 * it had started went on to land. What is running is read from the inbox
 * instead, and what went wrong is written to the record. AC-Q1, AC-Q4.
 */
export async function runSummary(
  key: string,
  paseo: Paseo,
): Promise<SummaryResult> {
  // Claimed before the first await, or two presses both pass the check. R4.
  if (inFlight.has(key))
    return { ok: false, error: "a summary is already running" };
  inFlight.add(key);

  const state = await loadState();
  const record = state.intake.find((candidate) => candidate.key === key);
  if (!record) {
    inFlight.delete(key);
    return { ok: false, error: "no such record" };
  }

  // The last reason goes before the new run starts, so the card cannot show a
  // stale failure next to a spinner.
  await setError(key, null);
  void summarise(record, paseo);
  return { ok: true };
}
