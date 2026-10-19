import { setup } from "../vendor/xstate.mjs";

/** How long an armed control waits for the second press before standing down. */
export const CONFIRM_WINDOW_MS = 4_000;

/**
 * The two-stage press, so one tap while scrolling cannot fire an action. AC-A8.
 *
 * `busy` is deliberately absent. The parent knows whether its mutation is in
 * flight and renders the working indicator itself; what the machine owns is
 * whether a second press is currently being waited for. DISARM is how the parent
 * says the question has been overtaken, which is the only thing it needs to tell
 * this machine.
 *
 * The window is `after` rather than a timer the component sets up and tears down,
 * so the one rule that matters here, an armed control stands down by itself, is
 * stated in the machine instead of living in an effect's cleanup.
 */
export const confirmMachine = setup({
  types: {} as {
    events: { type: "PRESS" } | { type: "DISARM" };
  },
  actions: {
    /** Supplied by the component. The machine never knows what it is firing. */
    fire: () => {},
  },
}).createMachine({
  id: "confirm",
  initial: "idle",
  states: {
    idle: {
      on: { PRESS: { target: "armed" } },
    },
    armed: {
      after: { [CONFIRM_WINDOW_MS]: { target: "idle" } },
      on: {
        PRESS: { target: "idle", actions: "fire" },
        DISARM: { target: "idle" },
      },
    },
  },
});
