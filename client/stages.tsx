import type { PluginTheme } from "@getpaseo/plugin";
import { highlight } from "../shared/colour";
import { Text, View } from "react-native";
import { nodeAppearance, nodeLabel } from "../shared/appearance";
import {
  REVIEW_STAGES,
  currentNode,
  displayStatus,
  type DisplayStatus,
  type Reviewable,
} from "../shared/review";

interface StageNodeProps {
  status: DisplayStatus;
  theme: PluginTheme;
  /** The current node draws a thicker accent edge, so it reads apart from both
   * completed and pending neighbours. AC-J4. */
  current?: boolean;
  size?: number;
}

/**
 * One rounded square. The row strip and the detail map both draw this, so a status
 * can never render one way on the row and another on the map. AC-J3, AC-J10.
 */
export function StageNode({
  status,
  theme,
  current = false,
  size = 14,
}: StageNodeProps) {
  const look = nodeAppearance(status, theme);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size / 4),
        borderWidth: current ? 2 : 1,
        borderStyle: look.borderStyle,
        borderColor: current
          ? highlight(theme.colors.accent)
          : look.borderColor,
        backgroundColor: look.background,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{ color: look.glyphColor, fontSize: Math.round(size * 0.64) }}
      >
        {look.glyph}
      </Text>
    </View>
  );
}

interface ConnectorProps {
  theme: PluginTheme;
  vertical?: boolean;
  length?: number;
  /**
   * Take whatever room is left rather than a fixed length. The vertical rail on
   * the detail map runs beside a node whose height is whatever its own contents
   * expanded to, so a fixed length left the line short of the next node by
   * however far that node had grown. AC-AD5.
   */
  fill?: boolean;
}

/**
 * The line between two nodes. What makes the five read as one route. AC-J2.
 *
 * It draws the line and nothing around it: a connector that carried its own
 * margin left a gap at each end, which is a line that points at two nodes
 * rather than one that joins them. Spacing is the caller's, and the caller's
 * answer is that there is none. AC-AD4.
 */
export function Connector({
  theme,
  vertical = false,
  length = 6,
  fill = false,
}: ConnectorProps) {
  return (
    <View
      style={{
        width: vertical ? 1 : fill ? undefined : length,
        height: vertical ? (fill ? undefined : length) : 1,
        // Fills the main axis of whatever column or row holds it, which is the
        // length of the line. The cross axis stays the one point above.
        flex: fill ? 1 : undefined,
        backgroundColor: theme.colors.border,
      }}
    />
  );
}

interface StageStripProps {
  record: Reviewable;
  theme: PluginTheme;
  size?: number;
}

/**
 * Four rounded squares, one per review stage, readable without opening anything.
 * AC-C6. The full map with labels and controls is the detail view, group J.
 *
 * Dismiss is on the map and not here. A dismissed record leaves the active list
 * in the same frame it is dismissed, so the fifth square could never be seen
 * filled, and under the Dismissed tab it is filled on every row, which carries
 * as little. The map keeps it because the node there is the control. AC-AI1.
 *
 * `currentNode` can answer `dismiss`, which is not drawn here. A settled record
 * therefore marks no square current, which is what a finished pipeline is.
 * AC-AI3.
 */
export function StageStrip({ record, theme, size = 14 }: StageStripProps) {
  const current = currentNode(record);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={REVIEW_STAGES.map((node) =>
        nodeLabel(node, displayStatus(record, node)),
      ).join(", ")}
      // No gap, in either row. A three point gap each side of every connector
      // left the line floating between two squares it never reached, which is
      // the one thing a metro line has to do. The connector's own length is
      // what sets the stops apart now. AC-AD4.
      style={{ flexDirection: "row", alignItems: "center" }}
    >
      {REVIEW_STAGES.map((node, index) => (
        <View key={node} style={{ flexDirection: "row", alignItems: "center" }}>
          {index > 0 ? <Connector theme={theme} length={6} /> : null}
          <StageNode
            status={displayStatus(record, node)}
            theme={theme}
            current={node === current}
            size={size}
          />
        </View>
      ))}
    </View>
  );
}
