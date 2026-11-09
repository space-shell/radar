import type { PluginTheme } from "@getpaseo/plugin";
import { highlight, success } from "./colour";
import type { FindingState } from "./findings";
import { STAGE_LABELS, type DisplayStatus, type MapNode } from "./review";

export interface NodeAppearance {
  /** Carries the status without colour, so colour is never the only signal. AC-C3, AC-J3. */
  glyph: string;
  glyphColor: string;
  background: string;
  borderColor: string;
  borderStyle: "solid" | "dashed";
}

/**
 * One mapping from status to appearance, shared by the row strip and the metro map,
 * so the two can never drift apart.
 *
 * Shared rather than client, for no reason but that a probe can read it there. It
 * is a lookup from a status to five strings, with no React and no platform in it,
 * and the one claim worth testing, that no two statuses look alike, cannot be made
 * about a module the probes cannot load. AC-AF25.
 */
export function nodeAppearance(
  status: DisplayStatus,
  theme: PluginTheme,
): NodeAppearance {
  const { colors } = theme;
  switch (status) {
    /*
     * The hollow counterpart of running's filled triangle: claimed, pointed the
     * same way, not yet moving. Three signals part it from running, not one, so
     * neither colour nor shape alone has to carry it: the glyph is outlined, the
     * fill is gone and the border is dashed. AC-AF25.
     */
    case "queued":
      return {
        glyph: "▹",
        glyphColor: highlight(colors.accent),
        background: "transparent",
        borderColor: highlight(colors.accent),
        borderStyle: "dashed",
      };
    case "running":
      return {
        glyph: "▸",
        glyphColor: highlight(colors.accent),
        background: colors.surface2,
        borderColor: highlight(colors.accent),
        borderStyle: "solid",
      };
    case "done":
      return {
        glyph: "✓",
        glyphColor: colors.accentForeground,
        background: success(colors.statusSuccess),
        borderColor: success(colors.statusSuccess),
        borderStyle: "solid",
      };
    case "skipped":
      return {
        glyph: "–",
        glyphColor: colors.foregroundMuted,
        background: "transparent",
        borderColor: colors.foregroundMuted,
        borderStyle: "dashed",
      };
    case "failed":
      return {
        glyph: "!",
        glyphColor: colors.accentForeground,
        background: colors.statusDanger,
        borderColor: colors.statusDanger,
        borderStyle: "solid",
      };
    default:
      return {
        glyph: "",
        glyphColor: colors.foregroundMuted,
        background: "transparent",
        borderColor: colors.border,
        borderStyle: "solid",
      };
  }
}

export function nodeLabel(node: MapNode, status: DisplayStatus): string {
  return `${STAGE_LABELS[node]}: ${status}`;
}

/**
 * The status word, which carries what the glyph and the border carry so neither
 * shape nor colour is ever the only signal. AC-J3, AC-J4.
 *
 * `reached` is the same rule the controls are offered on, not the map's idea of
 * which node is current. A node reading `waiting` under a Run button was the
 * first thing group AG's change would have produced had the two been allowed to
 * drift. AC-AG5.
 */
export function statusWord(status: DisplayStatus, reached: boolean): string {
  if (status !== "pending") return status;
  return reached ? "ready" : "waiting";
}

/**
 * `unknown` is read as `untouched` by everything downstream, including the
 * square: a thread that could not be bound and a thread nobody touched both mean
 * judge the finding again. Said here once, so the brief, the wizard and the
 * threads screen cannot each decide it differently. AC-AQ5.
 */
export function shownState(
  state: FindingState,
): Exclude<FindingState, "unknown"> {
  return state === "unknown" ? "untouched" : state;
}

/**
 * What became of a posted finding, in the same five fields the stage nodes use,
 * so one probe shape covers both tables and neither can quietly stop differing.
 *
 * Four appearances, six pairs, and every pair differs in at least three of the
 * five fields. The only glyph shared with `nodeAppearance` is `✓`, deliberately:
 * both mean finished, and the threads screen draws no stage nodes, so the two
 * never appear together. AC-AQ8, AC-AF25.
 */
export function findingAppearance(
  state: FindingState,
  theme: PluginTheme,
): NodeAppearance {
  const { colors } = theme;
  switch (shownState(state)) {
    case "resolved":
      return {
        glyph: "✓",
        glyphColor: colors.accentForeground,
        background: success(colors.statusSuccess),
        borderColor: success(colors.statusSuccess),
        borderStyle: "solid",
      };
    case "replied":
      return {
        glyph: "↩",
        glyphColor: highlight(colors.accent),
        background: colors.surface2,
        borderColor: highlight(colors.accent),
        borderStyle: "solid",
      };
    /*
     * Muted and dashed, because GitHub's `isOutdated` says the code moved and
     * not that anyone answered. It is the one state where nothing was decided.
     */
    case "outdated":
      return {
        glyph: "~",
        glyphColor: colors.foregroundMuted,
        background: "transparent",
        borderColor: colors.foregroundMuted,
        borderStyle: "dashed",
      };
    default:
      return {
        glyph: "·",
        glyphColor: colors.statusWarning,
        background: "transparent",
        borderColor: colors.statusWarning,
        borderStyle: "solid",
      };
  }
}

/**
 * The state in words, so the square is never the only signal. AC-J3.
 *
 * Three of the five keep GitHub's own vocabulary, because the same thread on
 * GitHub says the same word and a second name for one thing is a reader's
 * problem. `unknown` is the exception and says what actually happened: the
 * comment could not be matched to a finding, which is not a claim about the
 * author.
 */
export function findingWord(state: FindingState): string {
  if (state === "unknown") return "not matched";
  return state;
}
