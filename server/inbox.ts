import {
  activityAt,
  intakeRecordSchema,
  stillArriving,
  type IntakeRecord,
} from "../shared/inbox";
import { z } from "zod";
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
 * Why zod refused a record, in one line, with the field named.
 *
 * The path is the half that makes it actionable: `state: invalid enum value` can
 * be found in the file, while `invalid enum value` on its own cannot. An issue
 * at the root has an empty path and keeps the bare message.
 */
function refusal(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length > 0
        ? `${issue.path.join(".")}: ${issue.message}`
        : issue.message,
    )
    .join("; ");
}

/**
 * The screen parses this payload against the same schema, so one malformed record
 * used to throw client-side and blank the whole inbox. Bad records are dropped here
 * and counted, because a visible gap beats an empty screen. R10.
 */
export async function readInboxState() {
  const [config, state] = await Promise.all([loadConfig(), loadState()]);

  const records: IntakeRecord[] = [];
  const unreadable: Array<{ key: string | null; reason: string }> = [];

  for (const candidate of state.intake) {
    const parsed = intakeRecordSchema.safeParse(candidate);
    if (parsed.success) {
      records.push(parsed.data);
      continue;
    }

    const key = (candidate as { key?: unknown }).key;
    const reason = refusal(parsed.error);
    // Carried to the screen as well as logged. The log is on the daemon host and
    // the screen is wherever James is, which is rarely the same machine. AC-AR9.
    unreadable.push({ key: typeof key === "string" ? key : null, reason });
    log(`unreadable record ${String(key)}: ${reason}`);
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

/**
 * Drops one record nothing can parse, and forgets its key with it.
 *
 * Two deletions, and both are needed. Removing the record alone leaves the key
 * in `seenPullRequests`, which is the list that stops a sweep taking the same
 * pull request in twice, so the row would simply never come back. Forgetting
 * the key alone leaves the unreadable record in place, and the next intake
 * refuses because the key is already present.
 *
 * The parse is re-checked inside the lock, against the same schema the read
 * used, so a record that has since become readable is refused rather than
 * destroyed: the only thing this can delete is a record with no row, no
 * control and no way back. AC-AR9.
 */
export async function forgetUnreadableRecord(key: string): Promise<SeenResult> {
  const result = await updateState<SeenResult>((state) => {
    const index = state.intake.findIndex(
      (candidate) => (candidate as { key?: unknown }).key === key,
    );
    if (index === -1) return { ok: false, error: "no such record" };
    if (intakeRecordSchema.safeParse(state.intake[index]).success)
      return { ok: false, error: "that record reads fine now, leaving it" };

    state.intake.splice(index, 1);
    state.seenPullRequests = state.seenPullRequests.filter(
      (seen) => seen !== key,
    );
    return { ok: true };
  });

  if (result.ok)
    log(`forgot the unreadable record ${key}, it can arrive again`);
  return result;
}
