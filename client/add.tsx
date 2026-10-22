import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { highlight } from "../shared/colour";
import { BusyDots } from "./spinner";
import { useAddPullRequest } from "./queries";

export interface AddPullRequestProps {
  theme: PluginTheme;
  /** A key the daemon claimed. The list holds a place for it until it lands. */
  onTakingIn(key: string): void;
  /** A key already in the inbox. Opening it beats adding it twice. */
  onPresent(key: string): void;
  onClose(): void;
}

function styleSheet(theme: PluginTheme) {
  const { colors } = theme;
  return {
    card: {
      gap: 8,
      padding: 10,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      backgroundColor: colors.surface1,
    },
    input: {
      color: colors.foreground,
      backgroundColor: colors.surface0,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 13,
    },
    controls: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "flex-end" as const,
      gap: 16,
    },
    cancel: { color: colors.foregroundMuted, fontSize: 13 },
    add: { color: highlight(colors.accent), fontSize: 13 },
    addOff: { color: colors.foregroundMuted, fontSize: 13, opacity: 0.4 },
  };
}

/**
 * A pull request James names himself, for the ones GitHub never asked him about.
 *
 * A link rather than a repository picker and a number: the link is what he
 * already has, in the address bar or in whatever message sent him there, so the
 * shortest path is a paste and one press. Every shape that link comes in is read
 * by the daemon, which also says why a paste was refused. AC-AK4.
 *
 * Controlled, unlike the wizard's box. The field holds one short line, so a
 * render per keystroke costs nothing, and the Add control has to know whether
 * there is anything to add.
 *
 * A refusal leaves the text where it is. The reason is in the toast and the fix
 * is nearly always one character, which is not a thing to retype from nothing.
 */
export function AddPullRequest({
  theme,
  onTakingIn,
  onPresent,
  onClose,
}: AddPullRequestProps) {
  const styles = useMemo(() => styleSheet(theme), [theme]);
  const [link, setLink] = useState("");
  const addMutation = useAddPullRequest(() => {});
  const ready = link.trim().length > 0 && !addMutation.isPending;

  const submit = () => {
    if (!ready) return;
    addMutation.mutate(link.trim(), {
      onSuccess: (result) => {
        if (!result.ok || !result.key) return;
        if (result.already) onPresent(result.key);
        else onTakingIn(result.key);
        setLink("");
        onClose();
      },
    });
  };

  return (
    <View style={styles.card}>
      <TextInput
        accessibilityLabel="Pull request link"
        autoFocus
        value={link}
        onChangeText={setLink}
        placeholder="https://github.com/owner/repo/pull/123"
        placeholderTextColor={theme.colors.foregroundMuted}
        style={styles.input}
        // A pasted URL, so none of the helpfulness a prose field wants.
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel adding a pull request"
          onPress={() => {
            setLink("");
            onClose();
          }}
        >
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        {addMutation.isPending ? (
          <BusyDots theme={theme} label="Reading the pull request" size={3} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add this pull request to the inbox"
            disabled={!ready}
            onPress={submit}
          >
            <Text style={ready ? styles.add : styles.addOff}>Add</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
