import type { PluginTheme } from "@getpaseo/plugin";
import { highlight } from "../shared/colour";
import { type PluginScreenProps } from "@getpaseo/plugin/client";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { useMachine } from "./vendor/xstate-react.mjs";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { pullRequestUrl, unseen, type IntakeRecord } from "../shared/inbox";
import { viewMachine } from "../shared/machines/view";
import { AddPullRequest } from "./add";
import { ConfirmButton } from "./confirm";
import { Detail } from "./detail";
import { BusyDots, dotsWidth } from "./spinner";
import { Steady } from "./steady";
import { age, issueKey, recordMeta, since } from "../shared/format";
import {
  useDismiss,
  useDismissingKeys,
  useInbox,
  useRetry,
  useRetryingKeys,
  useSweep,
} from "./queries";
import { Prose } from "./prose";
import { StageStrip } from "./stages";
import { StatusBadge } from "./status";
import { Wizard } from "./wizard";

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
      justifyContent: "space-between" as const,
    },
    badges: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
    },
    // Radius 3 is the stage node's radius, so boxes and nodes read as one family.
    badge: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 5,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 3,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface2,
    },
    badgeGlyph: { color: colors.foregroundMuted, fontSize: 15 },
    badgeText: { color: colors.foregroundMuted, fontSize: 14 },
    badgeWarning: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 3,
      borderWidth: 1,
      borderColor: colors.statusWarning,
      backgroundColor: colors.surface2,
    },
    badgeWarningText: { color: colors.statusWarning, fontSize: 14 },
    badgeDanger: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 3,
      borderWidth: 1,
      borderColor: colors.statusDanger,
      backgroundColor: colors.surface2,
    },
    badgeDangerText: { color: colors.statusDanger, fontSize: 14 },
    failureBanner: { color: colors.statusDanger, fontSize: 13 },
    tabs: { flexDirection: "row" as const, gap: 16 },
    tab: { color: colors.foregroundMuted, fontSize: 13 },
    tabActive: {
      color: colors.foreground,
      fontSize: 13,
      fontWeight: "600" as const,
    },
    row: { gap: 4, paddingVertical: 12 },
    /**
     * Where the row will be. A launch takes up to two minutes, so a press with
     * nothing on the screen to show for it reads as a press that did nothing.
     * AC-AK6.
     */
    taking: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingVertical: 12,
    },
    takingText: { color: colors.foregroundMuted, fontSize: compact ? 15 : 16 },
    metaRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
    },
    title: { color: colors.foreground, fontSize: compact ? 15 : 16 },
    /**
     * The same mark the sidebar carries, on the row that earned it. Without it
     * the dot says something moved and leaves James to open every record to find
     * out which. Inline and leading, so it cannot wrap away from its title.
     * AC-AC11.
     */
    titleNew: { color: highlight(colors.accent), fontSize: 10 },
    /** The fault marker rides at the end of the title, inline, so it cannot wrap away. */
    titleFault: { color: colors.statusDanger, fontSize: compact ? 15 : 16 },
    meta: { color: colors.foregroundMuted, fontSize: 12 },
    links: {
      flexDirection: "row" as const,
      gap: 12,
      paddingTop: 2,
      alignItems: "center" as const,
    },
    link: { color: highlight(colors.accent), fontSize: 12 },
    action: { color: colors.foregroundMuted, fontSize: 12 },
    // Armed, not idle. The accent is the colour of every other link on the
    // screen, so an armed control read as one more thing to tap. Warning is
    // what the second press is: the next tap does the thing. AC-R1.
    confirm: {
      color: colors.statusWarning,
      fontSize: 12,
      fontWeight: "600" as const,
    },
    empty: { color: colors.foregroundMuted, fontSize: 14 },
  };
}

export function Inbox({
  theme,
  layout,
  navigation,
  params,
}: PluginScreenProps) {
  const { data, error, isPending, refresh } = useInbox();
  const retryMutation = useRetry(refresh);
  const dismissMutation = useDismiss(refresh);
  const sweepMutation = useSweep(refresh);
  const retryingKeys = useRetryingKeys();
  const dismissingKeys = useDismissingKeys();
  const [showDismissed, setShowDismissed] = useState(false);
  const [adding, setAdding] = useState(false);
  /**
   * The key of a pull request added by hand whose launch has not landed yet.
   * Held here rather than in the field, which closes on the press.
   */
  const [takingIn, setTakingIn] = useState<string | null>(null);

  /**
   * Which of the three views is on screen, and the record it is about. One value,
   * because the list, the detail and the wizard are one journey: see
   * `shared/machines/view.ts` for why they are views of this screen rather than
   * screens of their own. D6.
   */
  const paramKey = params.key ?? null;
  const [view, go] = useMachine(viewMachine, { input: { key: paramKey } });
  const selected = view.context.key;

  // The one thing outside the machine's reach. A record named by the sidebar, the
  // popover or a command arrives as a prop change, and this is what turns it into
  // the navigation it means. AC-J1.
  useEffect(() => {
    if (paramKey) go({ type: "PARAM", key: paramKey });
  }, [paramKey, go]);

  const styles = useMemo(
    () => styleSheet(theme, layout.compact),
    [theme, layout.compact],
  );

  /** Elapsed since the last sweep, or a placeholder while there is nothing to show. */
  const swept = () => {
    if (isPending) return "...";
    if (error || !data) return "?";
    return data.lastSearchAt ? since(data.lastSearchAt) : "never";
  };

  const records = data?.records ?? [];
  // The launch landed, so the real row takes the placeholder's place. An effect
  // rather than a render time filter, because the list below reads the state.
  useEffect(() => {
    if (takingIn && records.some((record) => record.key === takingIn))
      setTakingIn(null);
  }, [records, takingIn]);

  /**
   * The floor under the placeholder. A launch is capped at two minutes and
   * always writes its record, so this only fires when the daemon died holding
   * the work, and a spinner that spins for ever is worse than one that stops.
   */
  useEffect(() => {
    if (!takingIn) return;
    const timer = setTimeout(() => setTakingIn(null), 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [takingIn]);
  const active = records.filter((record) => !record.dismissedAt);
  const dismissed = records
    .filter((record) => record.dismissedAt)
    .sort((left, right) =>
      String(right.dismissedAt).localeCompare(String(left.dismissedAt)),
    );
  const shown = showDismissed ? dismissed : active;

  const retrying = (key: string) => retryingKeys.includes(key);
  const dismissing = (key: string) => dismissingKeys.includes(key);
  const busy = (key: string) => retrying(key) || dismissing(key);

  if (view.matches("wizard") && selected) {
    const subject = records.find((record) => record.key === selected);
    return (
      <Wizard
        recordKey={selected}
        title={
          subject
            ? `#${subject.number} ${subject.title}`
            : `Feedback ${selected}`
        }
        theme={theme}
        layout={layout}
        onBack={() => go({ type: "BACK" })}
      />
    );
  }

  if (view.matches("detail") && selected) {
    return (
      <Detail
        recordKey={selected}
        theme={theme}
        layout={layout}
        navigation={navigation}
        onBack={() => go({ type: "BACK" })}
        onOpenWizard={() => go({ type: "OPEN_WIZARD" })}
        openNode={view.context.node}
        onExpand={(node) => go({ type: "EXPAND", node })}
      />
    );
  }

  /**
   * The selected tab is the bold one, and bold is wider, so pressing Active
   * used to widen Active and shove Dismissed along by the difference. Both are
   * held at their bold width in either state. The count is reserved at its
   * widest digits for the same reason: dismissing a row changes both numbers.
   */
  const tab = (
    label: string,
    count: number,
    selected: boolean,
    onPress: () => void,
  ) => (
    <Steady
      key={label}
      widest={
        <Text style={styles.tabActive}>
          {label} {"8".repeat(String(count).length)}
        </Text>
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`Show ${label.toLowerCase()} review requests`}
        onPress={onPress}
      >
        <Text style={selected ? styles.tabActive : styles.tab}>
          {label} {count}
        </Text>
      </Pressable>
    </Steady>
  );

  const row = (record: IntakeRecord) => {
    const retryable =
      record.state === "failed" ||
      record.state === "unmapped" ||
      record.state === "orphaned";

    return (
      <View key={record.key} style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open the review map for ${record.key}`}
          onPress={() => go({ type: "OPEN_DETAIL", key: record.key })}
        >
          <View style={{ gap: 4 }}>
            <Text style={styles.title}>
              {unseen(record) ? (
                <Text
                  accessibilityLabel="New since this record was last opened"
                  style={styles.titleNew}
                >
                  {"\u25CF "}
                </Text>
              ) : null}
              #{record.number} {record.title}
              {record.lastError ? (
                // The reason itself lives on the detail view. A row carrying a
                // sentence of failure prose crowds out the title it belongs to.
                <Text
                  accessibilityLabel={`Fault: ${record.lastError}`}
                  style={styles.titleFault}
                >
                  {" \u24D8"}
                </Text>
              ) : null}
            </Text>
            <View style={styles.metaRow}>
              <StageStrip record={record} theme={theme} />
              <StatusBadge record={record} theme={theme} />
              <Text style={styles.meta}>{recordMeta(record)}</Text>
            </View>
          </View>
        </Pressable>
        <View style={styles.links}>
          <ExternalLink
            href={pullRequestUrl(record)}
            accessibilityLabel={`Open ${record.key} on GitHub`}
          >
            <Text style={styles.link}>Pull request</Text>
          </ExternalLink>
          {record.linearUrl ? (
            <ExternalLink
              href={record.linearUrl}
              accessibilityLabel={`Open ${issueKey(record.linearUrl)} in Linear`}
            >
              <Text style={styles.link}>{issueKey(record.linearUrl)}</Text>
            </ExternalLink>
          ) : null}
          {retryable && !record.dismissedAt ? (
            <ConfirmButton
              label="Retry"
              confirmLabel="Retry?"
              busyLabel="Retrying"
              theme={theme}
              style={styles.action}
              confirmStyle={styles.confirm}
              busy={retrying(record.key)}
              disabled={busy(record.key)}
              onConfirm={() => retryMutation.mutate(record.key)}
            />
          ) : null}
          <ConfirmButton
            label={record.dismissedAt ? "Restore" : "Dismiss"}
            confirmLabel={record.dismissedAt ? "Restore?" : "Dismiss?"}
            busyLabel={record.dismissedAt ? "Restoring" : "Dismissing"}
            theme={theme}
            style={styles.action}
            confirmStyle={styles.confirm}
            busy={dismissing(record.key)}
            disabled={busy(record.key)}
            onConfirm={() =>
              dismissMutation.mutate({
                key: record.key,
                dismissed: !record.dismissedAt,
              })
            }
          />
        </View>
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.tabs}>
          {tab("Active", active.length, !showDismissed, () =>
            setShowDismissed(false),
          )}
          {tab("Dismissed", dismissed.length, showDismissed, () =>
            setShowDismissed(true),
          )}
        </View>

        <View style={styles.badges}>
          {data?.unreadable ? (
            <View
              accessibilityLabel={`${data.unreadable} records could not be read`}
              style={styles.badgeDanger}
            >
              <Text style={styles.badgeDangerText}>
                {data.unreadable} unreadable
              </Text>
            </View>
          ) : null}
          {data?.dryRun ? (
            <View style={styles.badgeWarning}>
              <Text style={styles.badgeWarningText}>dry run</Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: adding }}
            accessibilityLabel="Add a pull request by link"
            onPress={() => setAdding(!adding)}
            style={styles.badge}
          >
            <Text style={styles.badgeGlyph}>{adding ? "\u00D7" : "+"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              data?.lastSearchAt
                ? `Last swept ${age(data.lastSearchAt)}. Sweep now`
                : "Never swept. Sweep now"
            }
            disabled={sweepMutation.isPending}
            onPress={() => sweepMutation.mutate()}
            style={styles.badge}
          >
            <Text style={styles.badgeGlyph}>◷</Text>
            {/* The one part of this badge that changes. It reads 7m, then a
                grid of dots while the sweep runs, then 0m, and the badge used
                to resize under the pointer at each of them. `never` is the
                longest word it has; the digits are there because a proportional
                font does not promise that 8 is as wide as 1. */}
            <Steady
              align="center"
              widest={
                <>
                  <Text style={styles.badgeText}>never</Text>
                  <Text style={styles.badgeText}>888d</Text>
                  <View style={{ width: dotsWidth(3) }} />
                </>
              }
            >
              {sweepMutation.isPending ? (
                <BusyDots theme={theme} label="Sweeping" size={3} />
              ) : (
                <Text style={styles.badgeText}>{swept()}</Text>
              )}
            </Steady>
          </Pressable>
        </View>
      </View>

      {adding ? (
        <AddPullRequest
          theme={theme}
          onTakingIn={(key) => {
            setTakingIn(key);
            setShowDismissed(false);
          }}
          onPresent={(key) => {
            setShowDismissed(false);
            go({ type: "OPEN_DETAIL", key });
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {error ? (
        <Prose style={styles.failureBanner}>Unavailable: {String(error)}</Prose>
      ) : null}

      <ScrollView>
        {takingIn && !showDismissed ? (
          <View style={styles.taking}>
            <BusyDots theme={theme} label={`Taking in ${takingIn}`} size={3} />
            <Text style={styles.takingText}>Taking in {takingIn}</Text>
          </View>
        ) : null}
        {shown.length === 0 && !takingIn ? (
          <Text style={styles.empty}>
            {showDismissed
              ? "Nothing dismissed."
              : "No review requests taken in yet."}
          </Text>
        ) : (
          shown.map(row)
        )}
      </ScrollView>
    </View>
  );
}
