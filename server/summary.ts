import { join } from "node:path";
import { pullRequestUrl, type IntakeRecord } from "../shared/inbox";
import { summaryFileSchema, type SummaryFile } from "../shared/summary";
import { clearArtifact, prepareArtifact, readArtifact } from "./artifact";
import { log } from "./log";
import { briefPath } from "./briefs";
import { loadState, STATE_DIR, updateState } from "./state";
import { askAgent, type Paseo } from "./turn";

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

/** The turn itself. Nothing waits on it, so its outcome is written, not returned. */
async function summarise(record: IntakeRecord, paseo: Paseo): Promise<void> {
  const key = record.key;
  try {
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
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : String(caught);
    await setError(key, error);
    log(`summary failed for ${key}: ${error}`);
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Asks the record's own agent for the summary the detail view renders.
 *
 * It runs on a press, never on the screen opening: an agent turn spent because
 * a view was looked at is a cost James did not ask for, and every other
 * transition in this plugin follows a press. AC-K1.
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
