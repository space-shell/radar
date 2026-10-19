import { assign, setup } from "../vendor/xstate.mjs";
import type { MapNode } from "../review";

export interface ViewContext {
  /** The record the detail and the wizard are about. Null only in `list`. */
  key: string | null;
  /**
   * Which node of the review map is expanded, at most one. It lives here and
   * not in the detail view because the detail view unmounts when the wizard
   * opens: James pressed Write feedback on the feedback node, wrote a review,
   * came back, and found the whole map collapsed and his place in it gone.
   */
  node: MapNode | null;
}

export type ViewEvent =
  | { type: "OPEN_DETAIL"; key: string }
  | { type: "OPEN_WIZARD" }
  | { type: "BACK" }
  /** A press on a map node. The same node again closes it. */
  | { type: "EXPAND"; node: MapNode }
  /** A record named by the sidebar item, the popover or a command. AC-J1. */
  | { type: "PARAM"; key: string };

/**
 * Which of the inbox screen's three views is on screen.
 *
 * A screen cannot open another screen: `openScreen` is on the sidebar item, the
 * popover and the command context, never on the screen itself. So the detail and
 * the wizard are views of the inbox rather than screens of their own, and which
 * one is showing was three independent values whose precedence was decided by the
 * order of the early returns in the render body. It is one value here.
 *
 * The wizard is reachable only from a detail, and BACK means the same thing in
 * every state that has one, which is what the three booleans could not say.
 *
 * `PARAM` is ignored in `wizard` on purpose. Honouring it would swap the record
 * under a half written review: the wizard holds unsaved keystrokes in a ref until
 * a discrete press commits them, and a view change that did not go through the
 * wizard's own exit would drop them. The previous code kept a second key for the
 * same reason without saying so.
 *
 * The expanded map node is held here for the same reason the key is: the detail
 * view unmounts on the way to the wizard, so anything it owned about where James
 * was is gone by the time he comes back.
 */
export const viewMachine = setup({
  types: {} as {
    context: ViewContext;
    events: ViewEvent;
    input: { key: string | null };
  },
  actions: {
    // A different record is a different map, so the open node goes with the key
    // rather than outliving it on a screen it does not belong to.
    remember: assign({
      key: ({ event }) =>
        event.type === "OPEN_DETAIL" || event.type === "PARAM"
          ? event.key
          : null,
      node: ({ context, event }) =>
        (event.type === "OPEN_DETAIL" || event.type === "PARAM") &&
        event.key === context.key
          ? context.node
          : null,
    }),
    forget: assign({ key: null, node: null }),
    expand: assign({
      node: ({ context, event }) =>
        event.type !== "EXPAND"
          ? context.node
          : event.node === context.node
            ? null
            : event.node,
    }),
  },
}).createMachine({
  id: "view",
  context: ({ input }) => ({ key: input.key, node: null }),
  // A key supplied before the first render is a record someone asked for, so the
  // screen opens on it rather than on the list it would have to be found in.
  initial: "list",
  states: {
    list: {
      always: {
        guard: ({ context }) => context.key !== null,
        target: "detail",
      },
      on: {
        OPEN_DETAIL: { target: "detail", actions: "remember" },
        PARAM: { target: "detail", actions: "remember" },
      },
    },
    detail: {
      on: {
        OPEN_WIZARD: { target: "wizard" },
        EXPAND: { actions: "expand" },
        PARAM: { target: "detail", actions: "remember", reenter: true },
        BACK: { target: "list", actions: "forget" },
      },
    },
    wizard: {
      on: { BACK: { target: "detail" } },
    },
  },
});
