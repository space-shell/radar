import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";
import { success } from "../shared/colour";
import { rereviewNote, statusNote, type IntakeRecord } from "../shared/inbox";

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

/**
 * That the pull request has moved on since the last round went out.
 *
 * Beside `StatusBadge` rather than folded into it, because the two answer
 * different questions and the pair is what matters: a record James approved and
 * the author has since pushed to shows `approved` and `new commits` together,
 * and either one alone is the wrong story. AC-AQ12.
 *
 * It is also not a second unread dot. The dot clears on opening the record;
 * this clears when the next round goes out. Two lifetimes, two marks.
 *
 * The accent is used by no `StatusBadge` tone and the glyph by no stage node, so
 * nothing on the row reads like it. AC-AF25.
 */
export function MovedBadge({
  record,
  theme,
}: {
  record: IntakeRecord;
  theme: PluginTheme;
}) {
  const note = rereviewNote(record);
  if (!note) return null;
  const colour = theme.colors.accent;

  return (
    <View
      accessibilityLabel={note}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 3,
        borderWidth: 1,
        borderColor: colour,
      }}
    >
      <Text style={{ color: colour, fontSize: 11 }}>{"\u2191"}</Text>
      <Text style={{ color: colour, fontSize: 11 }}>{note}</Text>
    </View>
  );
}
