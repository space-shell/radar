import { intakeRecordSchema, type IntakeRecord } from "../shared/inbox";
import { loadConfig } from "./settings";
import { loadState } from "./state";
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
