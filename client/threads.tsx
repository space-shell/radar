import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import {
  ExternalLink,
  SettingsCard,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { highlight } from "../shared/colour";
import type { ReviewThread } from "../shared/threads";
import { ConfirmButton } from "./confirm";
import { Prose } from "./prose";
import { useResolveThread, useResolvingThreads, useThreads } from "./queries";

type Layout = PluginScreenProps["layout"];

export interface ThreadsProps {
  recordKey: string;
  title: string;
  theme: PluginTheme;
  layout: Layout;
  onBack(): void;
}

/** The opening comment, trimmed to what fits a card without becoming the page. */
const PREVIEW = 400;

function styleSheet(theme: PluginTheme, compact: boolean) {
  const { colors } = theme;
  return {
    screen: {
      flex: 1,
      padding: compact ? 16 : 24,
      gap: 12,
      backgroundColor: colors.surface0,
    },
    header: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 12,
    },
    back: { color: highlight(colors.accent), fontSize: 13 },
    title: {
      color: colors.foreground,
      fontSize: compact ? 15 : 16,
      flexShrink: 1,
    },
    scroll: { gap: 12, paddingBottom: 12 },
    thread: { gap: 6, padding: 12 },
    anchor: { color: colors.foregroundMuted, fontSize: 12 },
    body: { color: colors.foreground, fontSize: 13, lineHeight: 18 },
    muted: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
    danger: { color: colors.statusDanger, fontSize: 12, lineHeight: 17 },
    /** Carried by the word as well as the colour, so it survives a mono theme. */
    state: {
      color: colors.foregroundMuted,
      fontSize: 11,
      textTransform: "uppercase" as const,
      letterSpacing: 0.6,
    },
    actions: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      flexWrap: "wrap" as const,
      gap: 12,
      paddingTop: 2,
    },
    action: { color: colors.foregroundMuted, fontSize: 12 },
    confirm: {
      color: colors.statusWarning,
      fontSize: 12,
      fontWeight: "600" as const,
    },
    link: { color: highlight(colors.accent), fontSize: 12 },
  };
}

/** `path:line`, or just the path on a thread whose line has left the diff. */
function anchorOf(thread: ReviewThread): string {
  return thread.line === null ? thread.path : `${thread.path}:${thread.line}`;
}

/**
 * The pull request's review conversations, and the one press that resolves them.
 *
 * A fourth view of the inbox screen rather than a step of the wizard. Resolving
 * reaches GitHub on the press, and the wizard's contract is that nothing does
 * until its final confirm, so a Resolve control among the finding switches would
 * make that sentence false. These are also about rounds already sent, where the
 * wizard is about the one being written. AC-AP10.
 *
 * Nothing here is stored. The list is read live on each open, because the screen
 * answers "what is still open" and a cached copy could only answer it as of some
 * earlier minute. AC-AP6.
 */
export function Threads({
  recordKey,
  title,
  theme,
  layout,
  onBack,
}: ThreadsProps) {
  const { data, isPending, error } = useThreads(recordKey);
  const resolve = useResolveThread(recordKey);
  const resolving = useResolvingThreads();

  const styles = useMemo(
    () => styleSheet(theme, layout.compact),
    [theme, layout.compact],
  );

  const threads = data?.threads ?? [];
  const open = threads.filter((thread) => !thread.resolved).length;

  const header = (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to the review map"
        onPress={onBack}
      >
        <Text style={styles.back}>← Map</Text>
      </Pressable>
      <Prose style={styles.title}>{title}</Prose>
    </View>
  );

  const card = (thread: ReviewThread) => {
    const anchor = anchorOf(thread);
    const body =
      thread.body.length > PREVIEW
        ? `${thread.body.slice(0, PREVIEW).trimEnd()}...`
        : thread.body;

    return (
      <SettingsCard key={thread.id}>
        <View style={styles.thread}>
          <Text style={styles.state}>
            {thread.resolved ? "resolved" : "open"}
            {thread.outdated ? " · outdated" : ""}
          </Text>
          <Prose style={styles.anchor}>
            {anchor}
            {thread.author ? ` · ${thread.author}` : ""}
            {thread.comments > 1 ? ` · ${thread.comments} comments` : ""}
          </Prose>
          <Prose style={body.length > 0 ? styles.body : styles.muted}>
            {body.length > 0 ? body : "No comment text."}
          </Prose>
          <View style={styles.actions}>
            <ConfirmButton
              label={thread.resolved ? "Reopen" : "Resolve"}
              confirmLabel={thread.resolved ? "Reopen?" : "Resolve?"}
              busyLabel={thread.resolved ? "Reopening" : "Resolving"}
              theme={theme}
              style={styles.action}
              confirmStyle={styles.confirm}
              busy={resolving.includes(thread.id)}
              disabled={resolving.includes(thread.id)}
              onConfirm={() =>
                resolve.mutate({
                  id: thread.id,
                  resolved: !thread.resolved,
                  label: anchor,
                })
              }
            />
            {thread.url ? (
              <ExternalLink
                href={thread.url}
                accessibilityLabel={`Open the thread at ${anchor} on GitHub`}
              >
                <Text style={styles.link}>Open on GitHub</Text>
              </ExternalLink>
            ) : null}
          </View>
        </View>
      </SettingsCard>
    );
  };

  return (
    <View style={styles.screen}>
      {header}
      <ScrollView contentContainerStyle={styles.scroll}>
        {isPending ? (
          <SettingsCard>
            <View style={styles.thread}>
              <Text style={styles.muted}>Reading the review threads...</Text>
            </View>
          </SettingsCard>
        ) : null}

        {/* A failure says why rather than showing an empty list, which would read
            as a pull request nobody has commented on. R10. */}
        {error || data?.error ? (
          <SettingsCard>
            <View style={styles.thread}>
              <Prose style={styles.danger}>
                {data?.error ?? String(error)}
              </Prose>
            </View>
          </SettingsCard>
        ) : null}

        {!isPending && !data?.error && threads.length === 0 ? (
          <SettingsCard>
            <View style={styles.thread}>
              <Text style={styles.muted}>
                No review comments on this pull request yet.
              </Text>
            </View>
          </SettingsCard>
        ) : null}

        {threads.length > 0 ? (
          <SettingsSection
            title="Review threads"
            info={`${open} open of ${threads.length}. Unresolved first.`}
          >
            {threads.map(card)}
          </SettingsSection>
        ) : null}
      </ScrollView>
    </View>
  );
}
