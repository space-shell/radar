import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";
import { success } from "../shared/colour";
import { statusNote, type IntakeRecord } from "../shared/inbox";

/**
 * What GitHub says about the pull request, on the row rather than behind a click.
 *
 * A row reading "merged" or "approved by a teammate" is one James can
 * dismiss where he reads it, which is the whole point of putting it here. It
 * renders nothing when there is nothing to say: an open pull request awaiting its
 * first review is the ordinary case and earns no badge. AC-M2.
 */
export function StatusBadge({
  record,
  theme,
}: {
  record: IntakeRecord;
  theme: PluginTheme;
}) {
  const note = statusNote(record.pr);
  if (!note) return null;

  const colour =
    note.tone === "settled"
      ? success(theme.colors.statusSuccess)
      : note.tone === "blocked"
        ? theme.colors.statusWarning
        : theme.colors.foregroundMuted;

  return (
    <View
      accessibilityLabel={`GitHub says ${note.label}`}
      style={{
        paddingHorizontal: 6,
        paddingVertical: 1,
        // Radius 3 is the stage node's radius, so this sits in the same family.
        borderRadius: 3,
        borderWidth: 1,
        borderColor: colour,
      }}
    >
      <Text style={{ color: colour, fontSize: 11 }}>{note.label}</Text>
    </View>
  );
}
