import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Text, TextInput, View } from "react-native";

const LINE_HEIGHT = 18;
/** Label, hint and the field's own padding, so `lines` counts lines of text. */
const CHROME = 20;

export interface MultilineInputProps {
  label: string;
  hint?: string;
  initialValue?: string;
  placeholder?: string;
  /** Visible lines before it starts scrolling. */
  lines: number;
  theme: PluginTheme;
  onChangeText(text: string): void;
}

/**
 * A field for prose, where `SettingsInput` gives one line.
 *
 * Not a variant of it: the host component takes `initialValue`, `onChangeText`,
 * `placeholder`, `disabled`, `secureTextEntry` and `ref`, and hands everything
 * else to the row wrapper rather than the input, so a `multiline` prop would be
 * accepted by the types and then dropped.
 *
 * Stacked rather than laid out beside its label, which is the other reason to
 * own it. A settings row gives its control the half of the width the label does
 * not take, and a review message is the thing on this screen most worth the full
 * measure.
 *
 * Uncontrolled, like the field it replaces. Keystrokes reach the draft ref and
 * nothing re-renders, so a long message costs no renders and the cursor cannot
 * be moved out from under the typing. AC-G6.
 */
export function MultilineInput({
  label,
  hint,
  initialValue,
  placeholder,
  lines,
  theme,
  onChangeText,
}: MultilineInputProps) {
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      wrapper: { gap: 6, padding: 12 },
      label: { color: colors.foreground, fontSize: 13 },
      hint: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
      input: {
        color: colors.foreground,
        backgroundColor: colors.surface0,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 13,
        lineHeight: LINE_HEIGHT,
        minHeight: lines * LINE_HEIGHT + CHROME,
        // Text starts at the top of the box on Android, which otherwise centres
        // a single line vertically in a field six lines tall.
        textAlignVertical: "top" as const,
      },
    }),
    [colors, lines],
  );

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <TextInput
        accessibilityLabel={label}
        multiline
        defaultValue={initialValue}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundMuted}
        onChangeText={onChangeText}
        style={styles.input}
        // Return types a newline rather than dismissing the field, which is the
        // whole point of a box this shape.
        blurOnSubmit={false}
      />
    </View>
  );
}
