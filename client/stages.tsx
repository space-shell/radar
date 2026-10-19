import type { PluginTheme } from "@getpaseo/plugin";
import { highlight, success } from "../shared/colour";
import { Text, View } from "react-native";
import {
  MAP_NODES,
  STAGE_LABELS,
  currentNode,
  nodeStatus,
  type MapNode,
  type Reviewable,
  type StageStatus,
} from "../shared/review";

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
 */
export function nodeAppearance(
  status: StageStatus,
  theme: PluginTheme,
): NodeAppearance {
  const { colors } = theme;
  switch (status) {
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

export function nodeLabel(node: MapNode, status: StageStatus): string {
  return `${STAGE_LABELS[node]}: ${status}`;
}

interface StageNodeProps {
  status: StageStatus;
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
        borderColor: current ? highlight(theme.colors.accent) : look.borderColor,
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
}

/** The line between two nodes. What makes the five read as one route. AC-J2. */
export function Connector({
  theme,
  vertical = false,
  length = 6,
}: ConnectorProps) {
  return (
    <View
      style={{
        width: vertical ? 1 : length,
        height: vertical ? length : 1,
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
 * Five rounded squares, one per stage, readable without opening anything. AC-C6.
 * The full map with labels and controls is the detail view, group J.
 */
export function StageStrip({ record, theme, size = 14 }: StageStripProps) {
  const current = currentNode(record);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={MAP_NODES.map((node) =>
        nodeLabel(node, nodeStatus(record, node)),
      ).join(", ")}
      style={{ flexDirection: "row", alignItems: "center", gap: 3 }}
    >
      {MAP_NODES.map((node, index) => (
        <View
          key={node}
          style={{ flexDirection: "row", alignItems: "center", gap: 3 }}
        >
          {index > 0 ? <Connector theme={theme} /> : null}
          <StageNode
            status={nodeStatus(record, node)}
            theme={theme}
            current={node === current}
            size={size}
          />
        </View>
      ))}
    </View>
  );
}
