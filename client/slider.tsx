import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View } from "react-native";
import { highlight } from "../shared/colour";

/** Comfortably bigger than a thumb, and the same whatever the count is. */
const CHIP = 38;

export interface SentenceSliderProps {
  /** How many sentences the proposal has. Always two or more; one needs no slider. */
  count: number;
  /** How many of them go out. Zero posts nothing. */
  value: number;
  theme: PluginTheme;
  onChange(value: number): void;
}

/**
 * How much of a finding to post, as a row of numbered stops.
 *
 * A finding is a claim and then its evidence, and the whole of it is not always
 * what is worth saying: the first sentence often is. The switch could only send
 * all of it or none, so trimming meant retyping the agent's words into the
 * replacement box, which is the one thing that box exists to avoid.
 *
 * Numbered chips, not a bar of blank segments and not a dragged thumb.
 *
 * A drag is out, because tracking a finger inside a vertical `ScrollView` means
 * claiming the responder on touch down, and a scroll that happens to begin on
 * the control would move the control instead of the page.
 *
 * Blank segments are out because the first version was exactly that, and on a
 * phone every press landed on the first or the last stop. Three things were
 * wrong with it at once and the chips fix all three: the segments were
 * `flex: 1`, so their width depended on the card and nothing guaranteed a
 * thumb-sized target; they carried no labels, so there was nothing to aim at
 * between the two ends; and a finding is two sentences one time in five, where
 * a run of stops has only its two ends and looked broken for being what it is.
 * A chip is a fixed 38 points, says its own number, and wraps rather than
 * shrinking when the count is high. AC-AU6.
 */
export function SentenceSlider({
  count,
  value,
  theme,
  onChange,
}: SentenceSliderProps) {
  const { colors } = theme;
  const accent = highlight(colors.accent);

  const chip = (
    stop: number,
    label: string,
    spoken: string,
    selected: boolean,
    /** Below the selection: part of the run that goes out, but not the stop itself. */
    within: boolean,
  ) => (
    <Pressable
      key={stop}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={spoken}
      onPress={() => onChange(stop)}
      style={{
        minWidth: CHIP,
        height: CHIP,
        paddingHorizontal: 8,
        borderRadius: 8,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        borderColor: selected || within ? accent : colors.border,
        backgroundColor: selected
          ? accent
          : within
            ? colors.surface2
            : "transparent",
      }}
    >
      <Text
        style={{
          color: selected
            ? colors.accentForeground
            : within
              ? colors.foreground
              : colors.foregroundMuted,
          fontSize: 13,
          fontWeight: selected ? "600" : "400",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );

  const stops = [];
  for (let stop = 1; stop <= count; stop++) {
    stops.push(
      chip(
        stop,
        stop === count ? "All" : `${stop}`,
        stop === count
          ? `Post all ${count} sentences`
          : `Post the first ${stop === 1 ? "sentence" : `${stop} sentences`}`,
        stop === value,
        stop < value,
      ),
    );
  }

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {/* The off stop sits in the same row and is drawn the same size, because a
          phone has no hover and a control that is harder to hit than its
          neighbours is the one that gets mis-hit. It is not a smaller amount of
          comment. It is no comment, so it is worded rather than numbered. */}
      {chip(0, "None", "Post nothing for this finding", value === 0, false)}
      {stops}
    </View>
  );
}
