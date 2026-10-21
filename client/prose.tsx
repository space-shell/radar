import { Text, type TextProps } from "react-native";

/**
 * Text that can be copied off the screen.
 *
 * React Native's `Text` is not selectable on Android. `selectable` defaults to
 * undefined (`Libraries/Text/Text.js:139`), which reaches the view as false, so
 * a long press does nothing at all. The desktop app hid it: react-native-web
 * renders a `div` and only writes `user-select` when the prop is set either
 * way, so the browser's own default made every string selectable there. The
 * phone was the first place the gap could be seen, and it was never a rule in
 * this plugin's code, only an absence.
 *
 * One component rather than a prop at twenty call sites, so what can be copied
 * is a decision with a name: `Prose` is content, `Text` is a label. The host
 * makes the same call the same way, opting in per string on the values worth
 * copying. AC-AJ1, AC-AJ2.
 *
 * Control labels stay `Text`. Selection and a press both begin with a long
 * hold, and a stage node, a collapsing card and a link are each worth more as
 * the thing they do than as four words to copy. AC-AJ3.
 */
export function Prose(props: TextProps) {
  return <Text selectable {...props} />;
}
