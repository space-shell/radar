import {
  activityAt,
  intakeRecordSchema,
  type IntakeRecord,
} from "../shared/inbox";
import { loadConfig } from "./settings";
import { loadState, updateState } from "./state";
import { log } from "./log";
import { summarising } from "./summary";

/**
 * The screen parses this payload against the same schema, so one malformed record
 * used to throw client-side and blank the whole inbox. Bad records are dropped here
 * and counted, because a visible gap beats an empty screen. R10.
 */
export async function readInboxState() {
  const [config, state] = await Promise.all([loadConfig(), loadState()]);

  const records: IntakeRecord[] = [];
  let unreadable = 0;

  for (const candidate of state.intake) {
    const parsed = intakeRecordSchema.safeParse(candidate);
    if (parsed.success) {
      records.push(parsed.data);
      continue;
    }

    unreadable += 1;
    const key = (candidate as { key?: unknown }).key;
    log(
      `unreadable record ${String(key)}: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }

  return {
    lastSearchAt: state.lastSearchAt,
    dryRun: config.dryRun,
    unreadable,
    // The press that started a summary returned in milliseconds. Only the daemon
    // knows the turn behind it is still going, so it says so here. AC-Q3.
    summarising: summarising(),
    records: records.reverse(),
  };
}

export interface SeenResult {
  ok: boolean;
  error?: string;
}

/**
 * Stamps the record as looked at. Now, or the record's own latest activity when
 * that reads as later.
 *
 * The second half is not decoration. `summary.generatedAt` is written by an
 * agent and a clock a minute fast would put it beyond every stamp this could
 * write, so the screen would ask to be marked seen, read a stamp that still
 * lost, and ask again: a write loop paced by the refetch. Stamping to the
 * activity itself ends it in one write. AC-AC7.
 */
export async function markRecordSeen(key: string): Promise<SeenResult> {
  return updateState<SeenResult>((state) => {
    const record = state.intake.find((candidate) => candidate.key === key);
    if (!record) return { ok: false, error: "no such record" };
    record.seenAt = new Date(
      Math.max(Date.now(), activityAt(record)),
    ).toISOString();
    return { ok: true };
  });
}
