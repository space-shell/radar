import {
  activityAt,
  intakeRecordSchema,
  stillArriving,
  type IntakeRecord,
} from "../shared/inbox";
import { takingIn } from "./add";
import { AGENT_STAGES, reviewOf } from "../shared/review";
import { workingAgents } from "./reconcile";
import { loadConfig } from "./settings";
import { loadState, updateState } from "./state";
import { log } from "./log";
import { summarising } from "./summary";

/**
 * Keys with a summary on its way, from either direction it can arrive.
 *
 * A press is the first: the call that started it returned in milliseconds and
 * the turn behind it runs for minutes, so the daemon is the only thing that
 * knows it is still going. AC-Q3.
 *
 * Intake is the second, and it is the ordinary one now that a record arrives
 * with a summary written by the turn that read the diff. Nothing here started
 * that turn and nothing waits on it, so the only evidence it is still running
 * is the agent's own status. Without this the detail view shows an empty card
 * for the several minutes intake takes, which reads as a summary that is not
 * coming rather than one that has not arrived. AC-AD2.
 *
 * A record with an agent stage under way is left out. The same agent runs QA and
 * verification when the settings give them no model of their own, so its status
 * cannot tell one turn from another: a QA run on a record that never got a
 * summary is not a summary arriving, and saying so would be a spinner that
 * never resolves. AC-AD7.
 *
 * Those two only, and only once they have started. Acknowledge and feedback are
 * a `gh` call inside one RPC and never reach the agent, so neither says anything
 * about what the agent is doing; a queued stage has not been sent yet, so the
 * turn still running is the summary's. Testing every stage instead put the card
 * back to an empty summary for as long as an acknowledge took, and for the whole
 * of the turn a queued QA was waiting behind. AC-AM1.
 */
function awaitingSummary(records: IntakeRecord[]): string[] {
  const live = workingAgents();
  const keys = new Set(summarising());

  for (const record of records) {
    if (record.summary) continue;
    if (!record.agentId || !live.has(record.agentId)) continue;
    const review = reviewOf(record);
    const busy = AGENT_STAGES.some((stage) => {
      const held = review[stage];
      return held.status === "running" && !held.queuedAt;
    });
    if (busy) continue;
    keys.add(record.key);
  }

  return [...keys];
}

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
    summarising: awaitingSummary(records),
    takingIn: stillArriving(takingIn(), records),
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
