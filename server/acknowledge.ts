import { laterStagesStarted } from "../shared/review";
import { addEyes, removeEyes } from "./reactions";
import { runStage, type StageResult } from "./stages";

/** Posts the eyes reaction and nothing else. AC-D1. */
export function acknowledge(key: string): Promise<StageResult> {
  return runStage(key, "acknowledge", (record) =>
    addEyes(record.repo, record.number),
  );
}

/**
 * The removal itself. Returns the stage to pending rather than inventing a
 * fifth status, so a withdrawn acknowledgement reads as one never made and can
 * simply be made again.
 */
function withdraw(key: string, guarded: boolean): Promise<StageResult> {
  return runStage(
    key,
    "acknowledge",
    async (record) => {
      await removeEyes(record.repo, record.number);
    },
    {
      settleAs: "pending",
      allow: guarded
        ? (record) =>
            laterStagesStarted(record, "acknowledge")
              ? "a later stage has already run"
              : null
        : undefined,
    },
  );
}

/**
 * The Undo control. Refused once a later stage has moved, so an undo cannot pull
 * the ground out from under work that already ran. AC-D6.
 */
export function unacknowledge(key: string): Promise<StageResult> {
  return withdraw(key, true);
}

/**
 * Dismiss's withdrawal, and the one case that ignores that guard. A row James has
 * put down must not leave a pull request marked as watched, whatever ran after the
 * acknowledgement, so there is nothing a later stage can do to keep the reaction
 * in place. AC-H2.
 */
export function withdrawAcknowledgement(key: string): Promise<StageResult> {
  return withdraw(key, false);
}
