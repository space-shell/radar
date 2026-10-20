import type { PluginTheme } from "@getpaseo/plugin";
import { highlight } from "../shared/colour";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { activityAt, pullRequestUrl, type IntakeRecord } from "../shared/inbox";
import {
  MAP_NODES,
  REVIEW_STAGES,
  STAGE_ACTIONS,
  STAGE_LABELS,
  currentNode,
  nodeStatus,
  reviewOf,
  type MapNode,
  type ReviewStage,
  type Stage,
  type StageStatus,
} from "../shared/review";
import { stageEvents, type StageEvent } from "../shared/machines/stage";
import { ConfirmButton } from "./confirm";
import { age, issueKey, recordMeta } from "./format";
import {
  useActingKeys,
  useDismiss,
  useDismissingKeys,
  useInbox,
  useMarkSeen,
  useStage,
  useStageAction,
  useStagingKeys,
  useSummarise,
  useSummarisingKeys,
} from "./queries";
import { Connector, StageNode } from "./stages";
import { StatusBadge } from "./status";
import { SummaryCard } from "./summary";

/** Big enough for its glyph to read at arm's length, small enough for five in a column. */
const NODE_SIZE = 22;
const RAIL_LENGTH = 12;

type Navigation = PluginScreenProps["navigation"];
type Layout = PluginScreenProps["layout"];

export interface DetailProps {
  recordKey: string;
  theme: PluginTheme;
  layout: Layout;
  navigation: Navigation;
  onBack(): void;
  /** Opens the feedback wizard, which is a third view of this screen. D6. */
  onOpenWizard(): void;
  /**
   * Which node is expanded, and the press that changes it. Held by the screen
   * rather than here: this view unmounts on the way to the wizard, so a node
   * remembered here would be forgotten on the way back.
   */
  openNode: MapNode | null;
  onExpand(node: MapNode): void;
}

/** A state-changing control on one node. Open agent is not one: it changes nothing. */
interface NodeAction {
  label: string;
  confirmLabel: string;
  busyLabel: string;
  /**
   * The in-flight key for this control alone. A node offers Skip and Run QA side
   * by side, and one key per node lit both spinners from either press. AC-Q5.
   */
  busyKey: string;
  run(): void;
}

function isReviewStage(node: MapNode): node is ReviewStage {
  return (REVIEW_STAGES as readonly string[]).includes(node);
}

/** The two stages the settings can give a model of their own, so an agent of their own. */
function spawnable(node: MapNode): node is "qa" | "verification" {
  return node === "qa" || node === "verification";
}

/** What the per-stage control says, once there is a second transcript to name. */
const AGENT_LABELS: Record<"qa" | "verification", string> = {
  qa: "Open QA agent",
  verification: "Open verification agent",
};

/**
 * Which agent to open for a node, and only when it is not the record's own. A
 * stage with no model of its own ran inside intake's agent, which the heading
 * above already opens: repeating that link on every node offered five routes to
 * one transcript and said nothing about which. Undefined removes the control.
 * AC-AC1.
 */
function stageAgent(record: IntakeRecord, node: MapNode): string | undefined {
  return spawnable(node) ? record.taskAgents?.[node] : undefined;
}

function stageOf(record: IntakeRecord, node: MapNode): Stage | undefined {
  return isReviewStage(node) ? reviewOf(record)[node] : undefined;
}

/**
 * The status word, which carries what the glyph and the border carry so neither
 * shape nor colour is ever the only signal. AC-J3, AC-J4.
 */
function statusWord(status: StageStatus, current: boolean): string {
  if (status !== "pending") return status;
  return current ? "ready" : "waiting";
}

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
    linkTitle: {
      color: highlight(colors.accent),
      fontSize: compact ? 15 : 16,
      flexShrink: 1,
    },
    scroll: { gap: 12 },
    map: { paddingVertical: 4 },
    // Half a node wide, so the rail runs through the centre of the squares above
    // and below it rather than down their left edge.
    rail: { paddingLeft: NODE_SIZE / 2 },
    nodeRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
      paddingVertical: 3,
    },
    nodeLabel: { color: colors.foreground, fontSize: 14 },
    nodeStatus: { color: colors.foregroundMuted, fontSize: 12 },
    // Indented to the rail, so everything a node says sits under that node.
    nodeAside: { paddingLeft: NODE_SIZE + 10, gap: 4, paddingBottom: 4 },
    nodeTiming: { color: colors.foregroundMuted, fontSize: 12 },
    nodeNote: { color: colors.foreground, fontSize: 12 },
    nodeError: { color: colors.statusDanger, fontSize: 12 },
    actions: {
      flexDirection: "row" as const,
      gap: 12,
      alignItems: "center" as const,
    },
    action: { color: colors.foregroundMuted, fontSize: 12 },
    // Armed, not idle. The accent is the colour of every other link on the
    // screen, so an armed control read as one more thing to tap. Warning is
    // what the second press is: the next tap does the thing. AC-R1.
    confirm: {
      color: colors.statusWarning,
      fontSize: 12,
      fontWeight: "600" as const,
    },
    link: { color: highlight(colors.accent), fontSize: 12 },
    // One row, links first, then the information. Wrapping rather than scrolling,
    // so a narrow window drops the tail onto a second line instead of hiding it.
    footer: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      flexWrap: "wrap" as const,
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 10,
    },
    footerState: { color: colors.foreground, fontSize: 13 },
    footerLine: { color: colors.foregroundMuted, fontSize: 12 },
    footerError: { color: colors.statusDanger, fontSize: 12, flexShrink: 1 },
    footerLinks: {
      flexDirection: "row" as const,
      gap: 12,
      alignItems: "center" as const,
      flexWrap: "wrap" as const,
    },
    /** Separates the links from the information without a word doing the job. */
    footerRule: {
      width: 1,
      alignSelf: "stretch" as const,
      backgroundColor: colors.border,
    },
    missing: { color: colors.foregroundMuted, fontSize: 14 },
  };
}

/**
 * One record as a metro map: the five nodes in order, connected, each carrying its
 * own status, timing, reason and controls. Vertical at every width, so the labels
 * never need horizontal scrolling to read. AC-J2, AC-J9.
 */
export function Detail({
  recordKey,
  theme,
  layout,
  navigation,
  onBack,
  onOpenWizard,
  openNode,
  onExpand,
}: DetailProps) {
  const { data, refresh } = useInbox();
  const dismissMutation = useDismiss(refresh);
  const stageMutation = useStage(refresh);
  const actionMutation = useStageAction(refresh);
  const dismissingKeys = useDismissingKeys();
  const stagingKeys = useStagingKeys();
  const actingKeys = useActingKeys();
  const summaryMutation = useSummarise(refresh);
  const summarisingKeys = useSummarisingKeys();
  const seenMutation = useMarkSeen(refresh);

  const styles = useMemo(
    () => styleSheet(theme, layout.compact),
    [theme, layout.compact],
  );

  const record = data?.records.find((candidate) => candidate.key === recordKey);

  /**
   * Looking at the record is what marks it seen, and it is marked again each time
   * something lands while it is open: a QA stage that settles under his eyes must
   * not light a dot on the screen he is already reading. The stamp the server
   * writes makes the condition false, so this settles after one write. AC-AC8.
   */
  const activity = record ? activityAt(record) : 0;
  const seenAt = record?.seenAt;
  const mark = seenMutation.mutate;
  useEffect(() => {
    if (!record) return;
    if (seenAt && Date.parse(seenAt) >= activity) return;
    mark(record.key);
  }, [record, seenAt, activity, mark]);

  if (!record) {
    return (
      <View style={styles.screen}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the inbox"
          onPress={onBack}
        >
          <Text style={styles.back}>← Inbox</Text>
        </Pressable>
        <Text style={styles.missing}>
          {data ? `${recordKey} is no longer in the inbox.` : "Loading..."}
        </Text>
      </View>
    );
  }

  const current = currentNode(record);
  const { agentId, workspaceId } = record;
  const openAgent = navigation?.openAgent;
  const openWorkspace = navigation?.openWorkspace;

  /**
   * Every transition in flight, each named by the control that asked for it.
   * Dismiss is folded into the same shape so one rule covers every node.
   */
  const inFlight = [
    ...stagingKeys,
    ...actingKeys,
    ...dismissingKeys.map((key) => key && `${key}:dismiss:`),
  ];

  /** Any control on this node is working, which is what locks its siblings. */
  const busy = (node: MapNode) => {
    const prefix = `${record.key}:${node}:`;
    return inFlight.some((entry) => entry?.startsWith(prefix));
  };

  const moveStage = (stage: ReviewStage, status: "pending" | "skipped") => () =>
    stageMutation.mutate({ key: record.key, stage, status });

  const act = (stage: ReviewStage, direction: "run" | "undo") => () =>
    actionMutation.mutate({ key: record.key, stage, direction });

  /**
   * What this node can be made to do right now. An empty list is the whole point:
   * it is what makes a node inert rather than a control that silently does nothing.
   * AC-J7.
   */
  const actionsFor = (node: MapNode, isCurrent: boolean): NodeAction[] => {
    if (node === "dismiss") {
      const dismissed = Boolean(record.dismissedAt);
      return [
        {
          label: dismissed ? "Restore" : "Dismiss",
          confirmLabel: dismissed ? "Restore?" : "Dismiss?",
          busyLabel: dismissed ? "Restoring" : "Dismissing",
          busyKey: `${record.key}:dismiss:`,
          run: () =>
            dismissMutation.mutate({ key: record.key, dismissed: !dismissed }),
        },
      ];
    }

    if (!isReviewStage(node)) return [];

    // What the stage will accept, asked of the machine rather than worked out
    // here. Which events those are, and in what order, is `shared/machines/
    // stage.ts`; this function's remaining job is what each one is called and
    // what it does. The server refuses the same events, so the offer and the
    // answer cannot disagree. AC-O1, AC-O2, AC-D6.
    const controls: Record<StageEvent["type"], NodeAction> = {
      RUN: {
        label: STAGE_ACTIONS[node],
        confirmLabel: `${STAGE_ACTIONS[node]}?`,
        busyLabel: `${STAGE_ACTIONS[node]}...`,
        busyKey: `${record.key}:${node}:run`,
        run: act(node, "run"),
      },
      UNDO: {
        label: "Undo",
        confirmLabel: "Undo?",
        busyLabel: "Undoing",
        busyKey: `${record.key}:${node}:undo`,
        run: act(node, "undo"),
      },
      REOPEN: {
        label: "Reopen",
        confirmLabel: "Reopen?",
        busyLabel: "Reopening",
        busyKey: `${record.key}:${node}:pending`,
        run: moveStage(node, "pending"),
      },
      SKIP: {
        label: "Skip",
        confirmLabel: "Skip?",
        busyLabel: "Skipping",
        busyKey: `${record.key}:${node}:skipped`,
        run: moveStage(node, "skipped"),
      },
    };

    return stageEvents(record, node, isCurrent).map((type) => controls[type]);
  };

  const timing = (node: MapNode, stage: Stage | undefined): string | null => {
    if (node === "dismiss") {
      return record.dismissedAt ? `dismissed ${age(record.dismissedAt)}` : null;
    }
    const parts: string[] = [];
    if (stage?.startedAt) parts.push(`started ${age(stage.startedAt)}`);
    if (stage?.endedAt) parts.push(`ended ${age(stage.endedAt)}`);
    return parts.length > 0 ? parts.join(", ") : null;
  };

  const heading =
    openAgent && agentId ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open the agent reviewing ${record.key}`}
        onPress={() => openAgent({ agentId })}
      >
        <Text style={styles.linkTitle}>
          #{record.number} {record.title}
        </Text>
      </Pressable>
    ) : (
      <Text style={styles.title}>
        #{record.number} {record.title}
      </Text>
    );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the inbox"
          onPress={onBack}
        >
          <Text style={styles.back}>← Inbox</Text>
        </Pressable>
        {heading}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Above the map, because it is what the pull request is, and the map is
            what has been done about it. Inside the scroll view, so a long summary
            pushes the map down rather than squeezing it. AC-K5. */}
        <SummaryCard
          record={record}
          theme={theme}
          compact={layout.compact}
          busy={
            // The press, then the daemon's own list once the read catches up.
            // One alone leaves a gap: the mutation settles in milliseconds and
            // the turn behind it runs for minutes. AC-Q3.
            summarisingKeys.includes(record.key) ||
            (data?.summarising ?? []).includes(record.key)
          }
          onRun={() => summaryMutation.mutate(record.key)}
        />

        <View style={styles.map}>
          {MAP_NODES.map((node, index) => {
            const status = nodeStatus(record, node);
            const isCurrent = node === current;
            const actions = actionsFor(node, isCurrent);
            const stage = stageOf(record, node);
            const selected = node === openNode;
            const working = busy(node);
            // "Cannot run yet" is exactly a pending node the pipeline has not reached.
            const blocked = actions.length === 0 && status === "pending";
            const when = timing(node, stage);
            // Set only where the stage was spawned with an agent of its own, so
            // the control appears exactly where it leads somewhere new.
            const nodeAgent = stageAgent(record, node);
            const agentLink = Boolean(openAgent && nodeAgent);
            /**
             * A node opens when it has something under it. A running stage offers
             * no action, because nothing can interrupt a turn, but it is exactly
             * the node whose agent James wants to watch: gating on actions alone
             * made the one stage worth opening the only one that would not. AC-Q6.
             */
            const expandable =
              actions.length > 0 || node === "feedback" || agentLink;

            return (
              <View key={node}>
                {index > 0 ? (
                  <View style={styles.rail}>
                    <Connector theme={theme} vertical length={RAIL_LENGTH} />
                  </View>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  // Keyed on whether the node opens, not on whether it has a
                  // confirm action. A pending feedback node has no action and
                  // still opens onto the wizard, so announcing "no action
                  // available" talked a screen reader past the one thing on it.
                  accessibilityLabel={`${STAGE_LABELS[node]}, ${statusWord(status, isCurrent)}${
                    expandable ? "" : ", nothing to open"
                  }`}
                  disabled={!expandable}
                  onPress={() => onExpand(node)}
                >
                  <View
                    style={[styles.nodeRow, blocked ? { opacity: 0.45 } : null]}
                  >
                    <StageNode
                      status={status}
                      theme={theme}
                      current={isCurrent}
                      size={NODE_SIZE}
                    />
                    <Text style={styles.nodeLabel}>{STAGE_LABELS[node]}</Text>
                    <Text style={styles.nodeStatus}>
                      {statusWord(status, isCurrent)}
                    </Text>
                  </View>
                </Pressable>

                <View style={styles.nodeAside}>
                  {/* What the stage produced, in a few words. "7 findings". No tap. */}
                  {stage?.note ? (
                    <Text style={styles.nodeNote}>{stage.note}</Text>
                  ) : null}
                  {/* A failure says why where it happened, with no further tap. AC-J6. */}
                  {stage?.error ? (
                    <Text style={styles.nodeError}>{stage.error}</Text>
                  ) : null}
                  {selected && when ? (
                    <Text style={styles.nodeTiming}>{when}</Text>
                  ) : null}
                  {selected && expandable ? (
                    <View style={styles.actions}>
                      {actions.map((action) => (
                        <ConfirmButton
                          key={action.label}
                          label={action.label}
                          confirmLabel={action.confirmLabel}
                          busyLabel={action.busyLabel}
                          theme={theme}
                          style={styles.action}
                          confirmStyle={styles.confirm}
                          busy={inFlight.includes(action.busyKey)}
                          disabled={working}
                          onConfirm={action.run}
                        />
                      ))}
                      {/* A view, not an action: opening it posts nothing, so it
                          takes a plain press rather than a confirm. The one
                          outward press lives inside it. AC-G9. */}
                      {node === "feedback" ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Open the feedback wizard for ${record.key}`}
                          onPress={onOpenWizard}
                        >
                          <Text style={styles.link}>
                            {status === "done"
                              ? "Open the review"
                              : STAGE_ACTIONS.feedback}
                          </Text>
                        </Pressable>
                      ) : null}
                      {openAgent && nodeAgent && spawnable(node) ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${AGENT_LABELS[node]} for ${record.key}`}
                          onPress={() => openAgent({ agentId: nodeAgent })}
                        >
                          <Text style={styles.link}>{AGENT_LABELS[node]}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Links, then the same state vocabulary the row shows, from the same helper.
          AC-J11, AC-J12. */}
      <View style={styles.footer}>
        <View style={styles.footerLinks}>
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
          {openWorkspace && workspaceId ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open the workspace for ${record.key}`}
              onPress={() => openWorkspace({ workspaceId })}
            >
              <Text style={styles.link}>Workspace</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.footerRule} />

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <StatusBadge record={record} theme={theme} />
          <Text style={styles.footerState}>{recordMeta(record)}</Text>
        </View>
        <Text style={styles.footerLine}>{record.key}</Text>
        {record.lastError ? (
          <Text style={styles.footerError}>{record.lastError}</Text>
        ) : null}
      </View>
    </View>
  );
}
