import { assign, setup } from "../vendor/xstate.mjs";

export interface WizardContext {
  /** Zero based. The findings, then verification, then the preview. */
  step: number;
  /** How many finding steps there are, which fixes where the other two sit. */
  findings: number;
}

export type WizardEvent =
  | { type: "READY"; step: number; findings: number }
  | { type: "UNAVAILABLE" }
  | { type: "SUBMITTED" }
  | { type: "NEXT" }
  | { type: "PREV" }
  | { type: "RECOUNT"; findings: number };

/** The step the preview sits on, one past the verification step. */
export const previewStepOf = (findings: number) => findings + 1;

/** Which of the three screens the walk is on. The machine decides it. */
export type WizardScreen = "finding" | "verification" | "preview";

/**
 * What the screen is called, in one place, because it is said twice.
 *
 * The heading said `Finding 1 of 3` and the footer said `Step 1 of 5` on the
 * same screen. Neither was wrong: the heading counted findings and the footer
 * counted the walk, which is the findings plus verification plus the preview.
 * Two counters in two units on one screen read as a disagreement, so there is
 * now one sentence and both ends print it. The screen is passed in rather than
 * derived, so the footer cannot name a screen the body is not showing.
 * AC-AH1.
 */
export function stepLabel(
  screen: WizardScreen,
  step: number,
  findings: number,
): string {
  if (screen === "preview") return "Preview";
  if (screen === "verification") return "Verification";
  return `Finding ${step + 1} of ${findings}`;
}

/**
 * The wizard's journey, and nothing else it holds.
 *
 * Five screens were chosen by four sequential early returns reading three
 * different sources, so which one won was decided by where it sat in the render
 * body rather than by a rule. They are one value here, and the order the guards
 * are written in is the precedence.
 *
 * The anchor check is an `entry` action on the preview rather than an effect
 * watching the step. That effect needed its dependency list suppressed to say
 * what it meant, which was "whenever the preview is arrived at". `entry` is that
 * sentence. Re-running on each arrival is the point: the diff can move while a
 * review is part way through, and a preview that said otherwise would be a lie.
 * AC-G12.
 *
 * What it must never hold is the draft. Keystrokes reach a ref and cost no
 * render, which is what lets a long review message be typed without the cursor
 * being moved; context here would re-render the wizard on every character.
 * AC-G6.
 */
export const wizardMachine = setup({
  types: {} as {
    context: WizardContext;
    events: WizardEvent;
  },
  actions: {
    /** Supplied by the component: writes the new step to the draft on disk. */
    persist: () => {},
    /** Supplied by the component: asks GitHub whether the anchors still exist. */
    checkAnchors: () => {},
    forward: assign({ step: ({ context }) => context.step + 1 }),
    back: assign({ step: ({ context }) => context.step - 1 }),
    arrive: assign({
      // A step stored by an older draft, or one past a finding that has since
      // left the file, is clamped here rather than at every read of it.
      step: ({ event }) =>
        event.type === "READY"
          ? Math.min(Math.max(event.step, 0), previewStepOf(event.findings))
          : 0,
      findings: ({ event }) => (event.type === "READY" ? event.findings : 0),
    }),
    /**
     * The list changed under a walk already in progress. QA runs from the map,
     * not here, but it is an agent and can finish while the wizard is open, and
     * a refetch then hands the screen a shorter list than the one it is walking.
     * The step indexed past the end, which rendered an empty body under a
     * "Step 4 of 3" footer. Clamped the same way `arrive` clamps.
     */
    recount: assign({
      step: ({ context, event }) =>
        event.type === "RECOUNT"
          ? Math.min(context.step, previewStepOf(event.findings))
          : context.step,
      findings: ({ context, event }) =>
        event.type === "RECOUNT" ? event.findings : context.findings,
    }),
  },
  guards: {
    atPreview: ({ context }) => context.step >= previewStepOf(context.findings),
    atVerification: ({ context }) => context.step === context.findings,
    notFirst: ({ context }) => context.step > 0,
    notLast: ({ context }) => context.step < previewStepOf(context.findings),
  },
}).createMachine({
  id: "wizard",
  context: { step: 0, findings: 0 },
  initial: "loading",
  states: {
    loading: {
      on: {
        READY: { target: "reviewing", actions: "arrive" },
        UNAVAILABLE: { target: "unavailable" },
        SUBMITTED: { target: "submitted" },
      },
    },
    /**
     * No findings file, which is the state before QA has run rather than a
     * review with nothing in it. Said plainly rather than shown as an empty
     * list. R10.
     */
    unavailable: {},
    reviewing: {
      initial: "deciding",
      on: {
        NEXT: {
          target: ".deciding",
          guard: "notLast",
          actions: ["forward", "persist"],
        },
        PREV: {
          target: ".deciding",
          guard: "notFirst",
          actions: ["back", "persist"],
        },
        SUBMITTED: { target: "submitted" },
        RECOUNT: { target: ".deciding", actions: ["recount", "persist"] },
      },
      states: {
        /** Which screen the step lands on. Written once, read on every move. */
        deciding: {
          always: [
            { guard: "atPreview", target: "preview" },
            { guard: "atVerification", target: "verification" },
            { target: "finding" },
          ],
        },
        finding: {},
        verification: {},
        preview: { entry: "checkAnchors" },
      },
    },
    /**
     * A round has gone out and none is open. The screen is the receipt for every
     * round so far, and the one control on it opens the next.
     *
     * Not final, which it was until group AP. The draft is still the record of
     * what went out and nothing here can type over it: reopening is a server
     * decision, and the walk only resumes when a refetch comes back saying a
     * round is open, which is what `READY` carries. So the rule AC-G15 was
     * protecting holds unchanged, that no second review leaves this screen
     * without a press that deliberately started one. AC-AP5, AC-AP9.
     */
    submitted: {
      on: {
        READY: { target: "reviewing", actions: "arrive" },
        UNAVAILABLE: { target: "unavailable" },
      },
    },
  },
});
