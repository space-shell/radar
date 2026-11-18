import { causeOf, run } from "./exec";
import type { IntakeRecord } from "../shared/inbox";
import { keyUrl, note as ledger } from "./ledger";
import { loadState, updateState } from "./state";
import { log } from "./log";
import { paseoBin } from "./binaries";

/**
 * Long enough for the daemon to answer, short enough that the dismiss RPC
 * waiting on it still returns before the host abandons the call at thirty
 * seconds. The reaper has a whole tick and never needed the old sixty.
 */
const ARCHIVE_TIMEOUT_MS = 20_000;

export interface ArchiveOutcome {
  ok: boolean;
  /** Why it did not happen, already clamped by `causeOf`. AC-AS3. */
  error?: string;
}

/**
 * The one place a workspace is archived.
 *
 * One place because the operation has no inverse. `paseo workspace archive`
 * is the whole of the surface a plugin has: there is no `unarchive` command,
 * no `workspaces.unarchive()` in the SDK, and no MCP tool for it. The app
 * reaches it over the daemon's internal `workspace.archive.undo.request`,
 * which plugin code cannot send. Every caller is therefore closing a door it
 * cannot reopen, and that is easier to hold to with one function than four.
 */
export async function archiveWorkspace(workspaceId: string): Promise<void> {
  await run(await paseoBin(), ["workspace", "archive", workspaceId], {
    timeout: ARCHIVE_TIMEOUT_MS,
  });
}

/**
 * Archives one record's workspace and stamps when it happened.
 *
 * The stamp is written only after the archive has landed, so a daemon that
 * refused leaves the record eligible for the reaper's next pass rather than
 * claiming a workspace is gone when it is still there. `also` folds the
 * caller's own field writes into that same transaction, which is how the
 * reaper settles the record in one write rather than two.
 *
 * A record with no workspace, or one already stamped, succeeds without calling
 * anything: both mean there is no workspace left to archive, and a second
 * `paseo workspace archive` on the same id would be a refusal logged once a
 * tick for ever. AC-AT2.
 */
export async function archiveRecordWorkspace(
  record: IntakeRecord,
  because: string,
  also?: (fresh: IntakeRecord) => void,
): Promise<ArchiveOutcome> {
  const { workspaceId } = record;
  if (!workspaceId || record.workspaceArchivedAt) return { ok: true };

  try {
    await archiveWorkspace(workspaceId);
  } catch (caught) {
    const error = causeOf(caught);
    log(`archive failed for ${record.key}, trying again next tick: ${error}`);
    return { ok: false, error };
  }

  await updateState((state) => {
    const fresh = state.intake.find(
      (candidate) => candidate.key === record.key,
    );
    if (!fresh) return;
    fresh.workspaceArchivedAt = new Date().toISOString();
    if (also) also(fresh);
  });

  log(`archived ${workspaceId} for ${record.key}: ${because}`);
  // After the write, so the ledger never claims a transition the state refused.
  ledger({
    source: "github",
    subject: record.key,
    what: `archived, ${because}`,
    url: keyUrl(record.key),
  });
  return { ok: true };
}

/**
 * Marks the rows dismissed before a dismissal archived anything, once.
 *
 * Run at start, before the first tick, because the reaper's dismissal branch
 * would otherwise archive them on the first sweep after this shipped, and there
 * is no way back. Two rows on this machine were dismissed on 17 November, when
 * Dismiss meant hide the row and nothing else. Archiving them now would act on
 * an agreement their press never gave.
 *
 * The flag is set only on a clean pass, matching `backfill.commentIds`, so a run
 * that dies partway marks what it reached and finishes on the next start. Rows
 * already carrying a workspace stamp are skipped: their archive has happened and
 * the marker would say something false about it. AC-AT8.
 */
export async function keepDismissedWorkspaces(): Promise<void> {
  const state = await loadState();
  if (state.backfill?.dismissedWorkspaces === 1) return;

  const kept = await updateState((live) => {
    const marked: string[] = [];
    for (const record of live.intake) {
      if (!record.dismissedAt) continue;
      if (!record.workspaceId) continue;
      if (record.workspaceArchivedAt || record.keptWorkspace) continue;
      record.keptWorkspace = true;
      marked.push(record.key);
    }
    live.backfill = { ...live.backfill, dismissedWorkspaces: 1 };
    return marked;
  });

  if (kept.length === 0) return;
  log(
    `keeping the workspaces of ${kept.length} rows dismissed before this: ${kept.join(", ")}`,
  );
}
