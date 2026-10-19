import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import {
  ExternalLink,
  SettingsCard,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useMachine } from "./vendor/xstate-react.mjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { success } from "../shared/colour";
import {
  anchorKey,
  anchorLabel,
  commentBody,
  type Draft,
  type Fault,
} from "../shared/feedback";
import type { Finding, VerificationStep } from "../shared/findings";
import { previewStepOf, wizardMachine } from "../shared/machines/wizard";
import { ConfirmButton } from "./confirm";
import { age } from "./format";
import { MultilineInput } from "./multiline";
import {
  useCheckAnchors,
  useFeedback,
  useInbox,
  useSaveDraft,
  useSubmitReview,
} from "./queries";
import { Steady } from "./steady";

type Layout = PluginScreenProps["layout"];

export interface WizardProps {
  recordKey: string;
  title: string;
  theme: PluginTheme;
  layout: Layout;
  onBack(): void;
}

function styleSheet(theme: PluginTheme, compact: boolean) {
  const { colors } = theme;
  // One box for every submit control, so a fill and an outline sit at the same
  // height and the row does not step as the approve switch moves.
  const button = {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
  };
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
    back: { color: colors.accent, fontSize: 13 },
    title: {
      color: colors.foreground,
      fontSize: compact ? 15 : 16,
      flexShrink: 1,
    },
    scroll: { gap: 12, paddingBottom: 12 },
    anchor: { color: colors.foregroundMuted, fontSize: 12 },
    severity: {
      color: colors.foreground,
      fontSize: 11,
      textTransform: "uppercase" as const,
      letterSpacing: 0.6,
    },
    blocking: {
      color: colors.statusDanger,
      fontSize: 11,
      textTransform: "uppercase" as const,
      letterSpacing: 0.6,
    },
    proposal: { gap: 6, padding: 12 },
    body: { color: colors.foreground, fontSize: 13, lineHeight: 18 },
    muted: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
    fault: { color: colors.statusWarning, fontSize: 12, lineHeight: 17 },
    danger: { color: colors.statusDanger, fontSize: 12, lineHeight: 17 },
    step: { gap: 2, padding: 12 },
    outcome: {
      color: colors.foregroundMuted,
      fontSize: 11,
      textTransform: "uppercase" as const,
      letterSpacing: 0.6,
    },
    // The preview's own typography: what GitHub receives, set apart from the
    // controls that built it so the two are never read as one block. AC-G8.
    sent: {
      gap: 6,
      padding: 12,
      borderLeftWidth: 2,
      borderLeftColor: colors.accent,
    },
    excluded: {
      gap: 6,
      padding: 12,
      borderLeftWidth: 2,
      borderLeftColor: colors.statusWarning,
    },
    actions: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      flexWrap: "wrap" as const,
      gap: 10,
      padding: 12,
    },
    // Armed, not idle. The accent is the colour of every other link on the
    // screen, so an armed control read as one more thing to tap. Warning is
    // what the second press is: the next tap does the thing. AC-R1.
    confirm: {
      color: colors.statusWarning,
      fontSize: 13,
      fontWeight: "600" as const,
    },
    // The one press on this screen that reaches GitHub, and the only control in
    // the plugin drawn as a filled button. It is sized to its own label rather
    // than to the card: a full width bar is a row, and a row is what the rest of
    // this screen is made of. AC-AA1.
    submit: {
      ...button,
      backgroundColor: success(colors.statusSuccess),
      borderColor: success(colors.statusSuccess),
    },
    // Armed keeps the shape and changes the fill, so the second press lands on
    // the target the first one armed. AC-R1, AC-AA3.
    submitArmed: {
      ...button,
      backgroundColor: colors.statusWarning,
      borderColor: colors.statusWarning,
    },
    // On a fill, not on the page. The same weight in both states, so the word
    // does not reflow under the finger.
    onFill: {
      color: colors.accentForeground,
      fontSize: 13,
      fontWeight: "600" as const,
    },
    // Request changes is a real action but not the expected one, and two fills
    // side by side name no default between them. AC-G24.
    secondary: { ...button, borderColor: colors.border },
    secondaryArmed: { ...button, borderColor: colors.statusWarning },
    secondaryLabel: { color: colors.foreground, fontSize: 13 },
    footer: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 10,
    },
    nav: { color: colors.accent, fontSize: 13 },
    navOff: { color: colors.foregroundMuted, fontSize: 13, opacity: 0.4 },
    counter: { color: colors.foregroundMuted, fontSize: 12 },
    link: { color: colors.accent, fontSize: 13 },
  };
}

/** What the draft currently says about one finding, with the defaults applied. */
function commentOf(draft: Draft, finding: Finding) {
  return draft.comments[anchorKey(finding)] ?? { include: false, text: "" };
}

/**
 * The review James is about to leave, built one finding at a time. Nothing in
 * here reaches GitHub until the confirm press on the last step: every switch,
 * every keystroke and every step change writes to a draft on disk and nowhere
 * else. AC-G9.
 *
 * A third view of the inbox screen rather than a screen of its own, because
 * `PluginScreenProps` carries no way to open one. D6.
 */
export function Wizard({
  recordKey,
  title,
  theme,
  layout,
  onBack,
}: WizardProps) {
  const { data, isPending, error } = useFeedback(recordKey);
  // The inbox cache is what the map behind this screen reads, so a submitted
  // review has to land in it or the map would still say the stage is pending.
  const { refresh } = useInbox();
  const save = useSaveDraft(recordKey);
  const check = useCheckAnchors(recordKey);
  const submit = useSubmitReview(recordKey, refresh);

  const styles = useMemo(
    () => styleSheet(theme, layout.compact),
    [theme, layout.compact],
  );

  // Two copies on purpose. The ref takes every keystroke, so typing never costs a
  // render or a disk write; the state copy is what the preview reads, and it is
  // brought up to the ref on each discrete press. AC-G6.
  const draftRef = useRef<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  // The machine is built once. Both actions read through a ref, so the handler a
  // later render supplies reaches them without rebuilding the actor and losing
  // the step mid-review.
  const handlers = useRef({ persist: (_step: number) => {}, check: () => {} });
  const logic = useMemo(
    () =>
      wizardMachine.provide({
        actions: {
          persist: ({ context }) => handlers.current.persist(context.step),
          checkAnchors: () => handlers.current.check(),
        },
      }),
    [],
  );
  const [view, go, actor] = useMachine(logic);

  const findings = data?.findings ?? [];
  const previewStep = previewStepOf(view.context.findings);
  const step = view.context.step;

  // The one thing the machine cannot see. Which screen is owed is decided by
  // what the server returned, and that arrives as a query result rather than a
  // press, so a prop to machine sync needs an effect. `submitted` is checked on
  // every arrival because a review submitted from the preview lands here; the
  // rest is seeded once.
  useEffect(() => {
    if (!data) return;
    // The draft is seeded before any screen is chosen, including the two that
    // never read it. The loading gate narrows on it, so a screen reached with a
    // null draft is a screen that renders the loading text and never leaves it:
    // that is what a submitted review did when this returned early.
    if (!draftRef.current) {
      draftRef.current = data.draft;
      setDraft(data.draft);
    }
    if (data.submitted) {
      go({ type: "SUBMITTED" });
      return;
    }
    // Both are refused outside `loading`, so a refetch re-sends and changes
    // nothing. The step is not re-read, which is what keeps the walk where it
    // was left rather than where the last save put it.
    go(
      data.error
        ? { type: "UNAVAILABLE" }
        : {
            type: "READY",
            step: data.draft.step,
            findings: data.findings.length,
          },
    );
    // READY is refused once the walk has started, so a list that changed after
    // it started needs its own event. QA runs from the map and is an agent, so
    // it can finish while this screen is open and hand the next refetch a
    // different list. Read off the actor rather than the snapshot, so this
    // effect does not re-run on every transition of the machine it drives.
    const walked = actor.getSnapshot().context.findings;
    if (!data.error && walked !== data.findings.length) {
      go({ type: "RECOUNT", findings: data.findings.length });
    }
  }, [data, go, actor]);

  const apply = (change: (draft: Draft) => Draft) => {
    const base = draftRef.current;
    if (!base) return;
    const next = change(base);
    draftRef.current = next;
    setDraft(next);
    save.mutate(next);
  };

  /** Keystrokes land on the ref alone. The next press is what commits them. */
  const type = (change: (draft: Draft) => Draft) => {
    const base = draftRef.current;
    if (!base) return;
    draftRef.current = change(base);
  };

  const goTo = (next: number) =>
    apply((current) => ({ ...current, step: next }));

  handlers.current = { persist: goTo, check: () => check.mutate() };

  const leave = () => {
    // Saves what was typed on the way out, so the draft on disk is the draft on
    // screen even when the exit is the back arrow rather than Next. AC-G6.
    const base = draftRef.current;
    if (base && !data?.submitted) save.mutate(base);
    onBack();
  };

  const header = (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to the review map"
        onPress={leave}
      >
        <Text style={styles.back}>← Map</Text>
      </Pressable>
      <Text style={styles.title}>{title}</Text>
    </View>
  );

  // Three screens that are not the review, and the machine says which. The
  // second condition on each is there to narrow the type, never to decide: one
  // state value is matched, so the order these sit in cannot change the answer.
  if (view.matches("loading") || !draft) {
    return (
      <View style={styles.screen}>
        {header}
        <Text style={styles.muted}>
          {error ? String(error) : "Loading the findings..."}
        </Text>
      </View>
    );
  }

  const submitted = data?.submitted;
  if (view.matches("submitted") && submitted) {
    return (
      <View style={styles.screen}>
        {header}
        <SettingsSection title="Submitted">
          <SettingsCard>
            <View style={styles.proposal}>
              <Text style={styles.body}>
                {submitted.event === "APPROVE"
                  ? "Approved"
                  : submitted.event === "REQUEST_CHANGES"
                    ? "Changes requested"
                    : "Commented"}
                , {submitted.comments}{" "}
                {submitted.comments === 1 ? "comment" : "comments"}
              </Text>
              <Text style={styles.muted}>
                submitted {age(submitted.submittedAt)}
              </Text>
              <ExternalLink
                href={submitted.url}
                accessibilityLabel={`Open the submitted review for ${recordKey}`}
              >
                <Text style={styles.link}>Open the review on GitHub</Text>
              </ExternalLink>
            </View>
          </SettingsCard>
        </SettingsSection>
      </View>
    );
  }

  if (view.matches("unavailable") && data?.error) {
    return (
      <View style={styles.screen}>
        {header}
        <Text style={styles.danger}>{data.error}</Text>
        <Text style={styles.muted}>
          Run QA from the review map, then come back.
        </Text>
      </View>
    );
  }

  const toggle = (finding: Finding, include: boolean) =>
    apply((current) => {
      const anchor = anchorKey(finding);
      const comments = {
        ...current.comments,
        [anchor]: { include, text: commentOf(current, finding).text },
      };
      // A blocking finding takes the approval off the table, once, and says which
      // one did it. Nothing in here ever puts it back: that press is James' alone.
      // AC-G22, AC-G23.
      if (
        include &&
        finding.severity === "blocking" &&
        current.approve &&
        !current.uncheckedBy
      ) {
        return { ...current, comments, approve: false, uncheckedBy: anchor };
      }
      return { ...current, comments };
    });

  const findingStep = (finding: Finding, index: number) => {
    const anchor = anchorKey(finding);
    const stored = commentOf(draft, finding);

    return (
      <SettingsSection
        title={`Finding ${index + 1} of ${findings.length}`}
        info={`${finding.path}:${finding.line} on the ${finding.side} side`}
      >
        <SettingsCard>
          <View style={styles.proposal}>
            <Text
              style={
                finding.severity === "blocking"
                  ? styles.blocking
                  : styles.severity
              }
            >
              {finding.severity}
            </Text>
            <Text style={styles.body}>{finding.body}</Text>
          </View>
        </SettingsCard>

        <SettingsCard>
          <SettingsSwitch
            label="Post this comment"
            hint="Off until this is switched on, or a replacement is typed below. Nothing else is posted."
            value={stored.include}
            onValueChange={(value) => toggle(finding, value)}
          />
          <MultilineInput
            key={anchor}
            label="Replacement wording"
            hint="Replaces the agent's text above. Sent verbatim."
            initialValue={stored.text}
            placeholder="Leave empty to send the text above"
            lines={5}
            theme={theme}
            onChangeText={(text) => {
              type((current) => ({
                ...current,
                comments: {
                  ...current.comments,
                  [anchor]: {
                    include: commentOf(current, finding).include,
                    text,
                  },
                },
              }));
              // Writing a replacement is the decision to send it, so the switch
              // follows the typing rather than waiting for a second press. It
              // goes through `toggle`, so a blocking finding still takes the
              // approval off the table. AC-G22.
              //
              // On only. Clearing the box leaves the switch where it is: the
              // comment then sends the agent's own wording, which is what an
              // empty replacement has always meant, and withdrawing a comment
              // stays a press rather than a side effect of a backspace.
              const after = draftRef.current;
              if (text.trim().length === 0 || !after) return;
              if (!commentOf(after, finding).include) toggle(finding, true);
            }}
          />
        </SettingsCard>
      </SettingsSection>
    );
  };

  const verificationStep = (steps: VerificationStep[]) => (
    <SettingsSection
      title="Verification"
      info="Read only here. These never become inline comments."
    >
      <SettingsCard>
        {steps.length === 0 ? (
          <View style={styles.step}>
            <Text style={styles.muted}>
              No verification steps were recorded.
            </Text>
          </View>
        ) : (
          steps.map((entry) => (
            <View key={entry.step} style={styles.step}>
              <Text
                style={
                  entry.outcome === "failed" ? styles.danger : styles.outcome
                }
              >
                {entry.outcome}
              </Text>
              <Text style={styles.body}>{entry.step}</Text>
              {entry.detail.trim().length > 0 ? (
                <Text style={styles.muted}>{entry.detail}</Text>
              ) : null}
            </View>
          ))
        )}
      </SettingsCard>

      <SettingsCard>
        <MultilineInput
          key="review-body"
          label="Review body"
          hint="GitHub refuses a comment or a request for changes with no body. An approval needs none."
          initialValue={draft.body}
          placeholder="Empty"
          lines={8}
          theme={theme}
          onChangeText={(text) =>
            type((current) => ({ ...current, body: text }))
          }
        />
      </SettingsCard>
    </SettingsSection>
  );

  const previewContent = () => {
    const faults = new Map<string, Fault>(
      (check.data?.faults ?? []).map((fault) => [fault.anchor, fault]),
    );
    const wanted = findings.filter(
      (finding) => commentOf(draft, finding).include,
    );
    const sending = wanted.filter((finding) => !faults.has(anchorKey(finding)));
    const dropped = wanted.filter((finding) => faults.has(anchorKey(finding)));
    const body = draft.body.trim();
    const event = draft.approve ? "an approval" : "a comment review";
    const busy = submit.isPending;

    return (
      <SettingsSection
        title="Preview"
        info={`${sending.length} ${sending.length === 1 ? "comment" : "comments"} as ${event}, in one review.`}
      >
        {check.isPending ? (
          <SettingsCard>
            <View style={styles.step}>
              <Text style={styles.muted}>
                Checking the anchors against the diff...
              </Text>
            </View>
          </SettingsCard>
        ) : null}

        {check.data && !check.data.ok ? (
          <SettingsCard>
            <View style={styles.step}>
              <Text style={styles.danger}>
                The diff could not be read:{" "}
                {check.data.error ?? "no reason given"}. Anchors are re-checked
                at submit time regardless.
              </Text>
            </View>
          </SettingsCard>
        ) : null}

        <SettingsCard>
          <View style={styles.sent}>
            <Text style={styles.outcome}>Body</Text>
            <Text style={body.length > 0 ? styles.body : styles.muted}>
              {body.length > 0 ? body : "No body."}
            </Text>
          </View>
        </SettingsCard>

        {sending.map((finding) => (
          <SettingsCard key={anchorKey(finding)}>
            <View style={styles.sent}>
              <Text style={styles.anchor}>
                {finding.path}:{finding.line} {finding.side}
              </Text>
              <Text style={styles.body}>{commentBody(finding, draft)}</Text>
            </View>
          </SettingsCard>
        ))}

        {/* Shown as excluded rather than quietly dropped: a comment that cannot be
            anchored would take the whole review down with it. AC-G12. */}
        {dropped.map((finding) => (
          <SettingsCard key={anchorKey(finding)}>
            <View style={styles.excluded}>
              <Text style={styles.anchor}>
                {finding.path}:{finding.line} {finding.side}
              </Text>
              <Text style={styles.fault}>
                Excluded: {faults.get(anchorKey(finding))?.reason}
              </Text>
            </View>
          </SettingsCard>
        ))}

        <SettingsCard>
          <SettingsSwitch
            label="Approve"
            hint={
              draft.uncheckedBy && !draft.approve
                ? `Unchecked by the blocking finding at ${anchorLabel(draft.uncheckedBy)}`
                : "Checked by default. An approval carries the inline comments with it."
            }
            value={draft.approve}
            onValueChange={(value) =>
              apply((current) => ({ ...current, approve: value }))
            }
          />
        </SettingsCard>

        <SettingsCard>
          <View style={styles.actions}>
            {draft.approve ? (
              <ConfirmButton
                label="Submit approval"
                confirmLabel="Submit approval?"
                busyLabel="Submitting"
                theme={theme}
                style={styles.onFill}
                confirmStyle={styles.onFill}
                chrome={styles.submit}
                confirmChrome={styles.submitArmed}
                busy={busy}
                disabled={busy}
                onConfirm={() => submit.mutate("APPROVE")}
              />
            ) : (
              <>
                <ConfirmButton
                  label="Submit comment"
                  confirmLabel="Submit comment?"
                  busyLabel="Submitting"
                  theme={theme}
                  style={styles.onFill}
                  confirmStyle={styles.onFill}
                  chrome={styles.submit}
                  confirmChrome={styles.submitArmed}
                  busy={busy}
                  disabled={busy}
                  onConfirm={() => submit.mutate("COMMENT")}
                />
                {/* Its own control, never the fallback for an unchecked box. AC-G24. */}
                <ConfirmButton
                  label="Request changes"
                  confirmLabel="Request changes?"
                  busyLabel="Submitting"
                  theme={theme}
                  style={styles.secondaryLabel}
                  confirmStyle={styles.confirm}
                  chrome={styles.secondary}
                  confirmChrome={styles.secondaryArmed}
                  busy={busy}
                  disabled={busy}
                  onConfirm={() => submit.mutate("REQUEST_CHANGES")}
                />
              </>
            )}
          </View>
        </SettingsCard>
      </SettingsSection>
    );
  };

  const content = () => {
    if (view.matches({ reviewing: "preview" })) return previewContent();
    if (view.matches({ reviewing: "verification" }))
      return verificationStep(data?.verification ?? []);
    const finding = findings[step];
    return finding ? findingStep(finding, step) : null;
  };

  // Which end of the walk this is, asked of the machine rather than recomputed.
  // The arrow is dim for exactly the reason the press would do nothing.
  const first = !view.can({ type: "PREV" });
  const last = !view.can({ type: "NEXT" });

  return (
    <View style={styles.screen}>
      {header}

      <ScrollView contentContainerStyle={styles.scroll}>{content()}</ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous step"
          disabled={first}
          onPress={() => go({ type: "PREV" })}
        >
          <Text style={first ? styles.navOff : styles.nav}>← Previous</Text>
        </Pressable>
        {/* Centred by `space-between`, which means its own width decides where
            it sits: stepping from 9 to 10 moved the counter sideways. Held at
            the width of the last step, with the digits at their widest. */}
        <Steady
          align="center"
          widest={
            <Text style={styles.counter}>
              Step {"8".repeat(String(previewStep + 1).length)} of{" "}
              {previewStep + 1}
            </Text>
          }
        >
          <Text style={styles.counter}>
            Step {step + 1} of {previewStep + 1}
          </Text>
        </Steady>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next step"
          disabled={last}
          onPress={() => go({ type: "NEXT" })}
        >
          <Text style={last ? styles.navOff : styles.nav}>Next →</Text>
        </Pressable>
      </View>
    </View>
  );
}
