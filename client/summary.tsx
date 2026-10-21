import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { IntakeRecord } from "../shared/inbox";
import { ConfirmButton } from "./confirm";
import { age } from "../shared/format";
import { BusyDots } from "./spinner";

export interface SummaryCardProps {
  record: IntakeRecord;
  theme: PluginTheme;
  compact: boolean;
  /** A summary is on its way: intake is still writing one, or a retry is running. */
  busy: boolean;
  onRun(): void;
}

function styleSheet(theme: PluginTheme, compact: boolean) {
  const { colors } = theme;
  return {
    card: {
      gap: 8,
      padding: compact ? 10 : 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      backgroundColor: colors.surface1,
    },
    headlineRow: {
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      gap: 8,
    },
    headline: {
      color: colors.foreground,
      fontSize: compact ? 14 : 15,
      lineHeight: compact ? 19 : 21,
      flexShrink: 1,
    },
    /** Fixed width, so the headline starts at the same column in both states. */
    chevron: {
      color: colors.foregroundMuted,
      fontSize: 12,
      lineHeight: compact ? 19 : 21,
      width: 12,
    },
    changes: { gap: 3 },
    change: {
      color: colors.foreground,
      fontSize: 12,
      lineHeight: 17,
      flexShrink: 1,
    },
    // A list, so it reads as one. The prose fields below stay prose.
    changeRow: { flexDirection: "row" as const, gap: 6 },
    bullet: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
    field: { gap: 2 },
    label: {
      color: colors.foregroundMuted,
      fontSize: 11,
      textTransform: "uppercase" as const,
      letterSpacing: 0.6,
    },
    body: { color: colors.foreground, fontSize: 12, lineHeight: 17 },
    foot: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      flexWrap: "wrap" as const,
      gap: 10,
      paddingTop: 2,
    },
    when: { color: colors.foregroundMuted, fontSize: 11 },
    absent: { color: colors.foregroundMuted, fontSize: 12 },
    failure: { color: colors.statusDanger, fontSize: 12, lineHeight: 17 },
    action: { color: colors.foregroundMuted, fontSize: 12 },
    // Armed, not idle. The accent is the colour of every other link on the
    // screen, so an armed control read as one more thing to tap. Warning is
    // what the second press is: the next tap does the thing. AC-R1.
    confirm: {
      color: colors.statusWarning,
      fontSize: 12,
      fontWeight: "600" as const,
    },
  };
}

/**
 * What the agent made of the pull request, in James' own diction rules. Written
 * by the intake agent in the turn that read the diff, so a record arrives with
 * one and the card has something to render before anything is pressed. AC-K1.
 */
export function SummaryCard({
  record,
  theme,
  compact,
  busy,
  onRun,
}: SummaryCardProps) {
  const styles = useMemo(() => styleSheet(theme, compact), [theme, compact]);
  const summary = record.summary;
  /**
   * Open on arrival, because the summary is why the detail view is worth opening.
   * Collapsed keeps the headline and the controls: the headline is the result in
   * one line, and a card that hid its own Refresh would need expanding to be
   * used. The map is what collapsing makes room for. AC-Q7.
   */
  const [open, setOpen] = useState(true);

  /**
   * The one way back when the automatic summary did not arrive, and the only
   * state this card has a control in.
   *
   * Intake writes the summary now, so a Refresh beside a summary that is already
   * there offered to pay for a second reading of a diff nothing had said was
   * stale, and a Summarise beside a card still filling asked for the turn that
   * was running. What is left is the case neither covers: the agent has stopped
   * and nothing landed, which is the only moment a press is the difference
   * between a summary and no summary. AC-AD1.
   */
  const button = (
    <ConfirmButton
      label={record.summaryError ? "Retry" : "Summarise"}
      confirmLabel={record.summaryError ? "Retry?" : "Summarise?"}
      busyLabel="Summarising"
      theme={theme}
      style={styles.action}
      confirmStyle={styles.confirm}
      busy={busy}
      disabled={busy}
      onConfirm={onRun}
    />
  );

  /**
   * The turn outlives the press that started it, so a failure has no call to be
   * returned to and arrives here instead. Shown in both states: a reason hidden
   * behind a collapse is a reason not read. AC-Q4.
   */
  const failure = record.summaryError ? (
    <Text style={styles.failure}>{record.summaryError}</Text>
  ) : null;

  // Absent is a state, not an error: a record taken in before this existed, or
  // one whose agent has not written the file yet. AC-K4.
  if (!summary) {
    return (
      <View style={styles.card}>
        <View style={styles.foot}>
          {busy ? (
            <>
              {/* Where the summary will be, rather than anywhere else on the
                  screen. The card is what James is waiting on, so the card is
                  what has to say it is coming. AC-AD2. */}
              <BusyDots
                theme={theme}
                label="The agent is still reading the pull request"
                size={3}
              />
              <Text style={styles.absent}>Reading the pull request</Text>
            </>
          ) : (
            <>
              <Text style={styles.absent}>No summary yet.</Text>
              {button}
            </>
          )}
        </View>
        {failure}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={
          open ? "Collapse the summary" : "Expand the summary"
        }
        onPress={() => setOpen(!open)}
      >
        <View style={styles.headlineRow}>
          <Text style={styles.chevron}>{open ? "▾" : "▸"}</Text>
          <Text style={styles.headline}>{summary.headline}</Text>
        </View>
      </Pressable>

      {open ? (
        <>
          <View style={styles.changes}>
            {summary.changes.map((change) => (
              <View key={change} style={styles.changeRow}>
                <Text style={styles.bullet}>·</Text>
                <Text style={styles.change}>{change}</Text>
              </View>
            ))}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Risk</Text>
            <Text style={styles.body}>{summary.risk}</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Scope</Text>
            <Text style={styles.body}>{summary.scope}</Text>
          </View>
        </>
      ) : null}

      {failure}

      <View style={styles.foot}>
        <Text style={styles.when}>summarised {age(summary.generatedAt)}</Text>
      </View>
    </View>
  );
}
