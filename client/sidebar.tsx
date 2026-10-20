import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { View } from "react-native";
import { highlight } from "../shared/colour";
import { unseen } from "../shared/inbox";
import { useInbox } from "./queries";

/** Small enough not to be a badge, large enough to catch at the edge of vision. */
const DOT = 7;

/**
 * The sidebar row, and the one thing on screen when Radar is not open.
 *
 * It runs the inbox read itself rather than waiting for the screen to run it.
 * The row is mounted for as long as Paseo is, and the whole point of the dot is
 * to say something arrived while James was looking at something else: a dot
 * that only updated while the Radar screen was open would never once fire when
 * it mattered. The query key is the screen's, so the two share one cache and
 * one interval rather than polling twice. AC-AC9.
 */
export function InboxItem({
  theme,
  currentScreen,
  openScreen,
  screenId,
}: PluginSidebarItemProps & { screenId: string }) {
  const { data } = useInbox();
  const waiting = (data?.records ?? []).some(unseen);

  return (
    <SidebarRow
      icon="Inbox"
      active={currentScreen?.screenId === screenId}
      onPress={() => openScreen({ screenId })}
      trailing={
        waiting ? (
          <View
            accessibilityRole="image"
            accessibilityLabel="Radar has something new"
            style={{
              width: DOT,
              height: DOT,
              borderRadius: DOT / 2,
              // The accent as the rest of the plugin uses it, muted by the same
              // amount. An untouched accent here would be the one loud green on
              // a screen built to be quiet. AC-AC10.
              backgroundColor: highlight(theme.colors.accent),
            }}
          />
        ) : undefined
      }
    />
  );
}
