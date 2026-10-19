import {
  RUNNABLE_STAGES,
  STAGE_LABELS,
  UNDOABLE_STAGES,
  type ReviewStage,
} from "../shared/review";
import { acknowledge, unacknowledge } from "./acknowledge";
import { runQa } from "./qa";
import { runVerification } from "./verification";
import type { StageResult } from "./stages";
import type { Paseo } from "./turn";

/**
 * The dispatcher between a pressed node and the action behind it.
 *
 * It refuses an unbuilt stage rather than trusting the screen to have hidden the
 * control, because the screen's idea of what is wired is a copy and this one is the
 * original. Groups E, F and G add their cases here.
 */
export function runStageFor(
  key: string,
  stage: ReviewStage,
  paseo: Paseo,
): Promise<StageResult> {
  if (!RUNNABLE_STAGES.includes(stage)) {
    return Promise.resolve({
      ok: false,
      error: `${STAGE_LABELS[stage]} has no action yet`,
    });
  }

  switch (stage) {
    case "acknowledge":
      return acknowledge(key);
    case "qa":
      return runQa(key, paseo);
    case "verification":
      return runVerification(key, paseo);
    default:
      return Promise.resolve({
        ok: false,
        error: `${STAGE_LABELS[stage]} has no action yet`,
      });
  }
}

export function undoStageFor(
  key: string,
  stage: ReviewStage,
): Promise<StageResult> {
  if (!UNDOABLE_STAGES.includes(stage)) {
    return Promise.resolve({
      ok: false,
      error: `${STAGE_LABELS[stage]} cannot be undone`,
    });
  }

  switch (stage) {
    case "acknowledge":
      return unacknowledge(key);
    default:
      return Promise.resolve({
        ok: false,
        error: `${STAGE_LABELS[stage]} cannot be undone`,
      });
  }
}
