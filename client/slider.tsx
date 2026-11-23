import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View } from "react-native";
import { highlight } from "../shared/colour";

/** The height of the bar itself. The press target around it is taller. */
const BAR = 10;
/** Enough to hit with a thumb, whatever the bar does. */
const TOUCH = 30;

export interface SentenceSliderProps {
  /** How many sentences the proposal has. Always two or more; one needs no slider. */
  count: number;
  /** How many of them go out. Zero posts nothing. */
  value: number;
  theme: PluginTheme;
  onChange(value: number): void;
}

/**
 * How much of a finding to post, as a run of stops rather than a switch.
 *
 * A finding is a claim and then its evidence, and the whole of it is not always
 * what is worth saying: the first sentence often is. The switch could only send
 * all of it or none, so trimming meant retyping the agent's words into the
 * replacement box, which is the one thing that box exists to avoid.
 *
 * Stops, not a dragged thumb. A drag inside a vertical `ScrollView` has to claim
 * the responder to track the finger, and claiming it on touch down means a
 * scroll that happens to begin on the bar moves the slider instead of the page.
 * A `Pressable` per stop cannot: the scroll view cancels the press the moment the
 * finger travels, which is exactly the behaviour a phone wants. Every stop is
 * also a real press target with its own accessibility label, which a bar with a
 * thumb on it is not. AC-AU6.
 */
export function SentenceSlider({
  count,
  value,
  theme,
  onChange,
}: SentenceSliderProps) {
  const { colors } = theme;
  const accent = highlight(colors.accent);
  const stops = [];
  for (let stop = 1; stop <= count; stop++) {
    const filled = stop <= value;
    stops.push(
      <Pressable
        key={stop}
        accessibilityRole="button"
        accessibilityState={{ selected: stop === value }}
        accessibilityLabel={
          stop === count
            ? `Post all ${count} sentences`
            : `Post the first ${stop === 1 ? "sentence" : `${stop} sentences`}`
        }
        onPress={() => onChange(stop)}
        style={{ flex: 1, height: TOUCH, justifyContent: "center" }}
      >
        <View
          style={{
            height: BAR,
            borderRadius: 3,
            borderWidth: 1,
            borderColor: filled ? accent : colors.border,
            backgroundColor: filled ? accent : colors.surface2,
          }}
        />
      </Pressable>,
    );
  }

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      {/* The off stop sits apart from the run and is drawn as a square rather
          than a length of bar, because it is not a smaller amount of comment.
          It is no comment. */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: value === 0 }}
        accessibilityLabel="Post nothing for this finding"
        onPress={() => onChange(0)}
        style={{
          width: TOUCH,
          height: TOUCH,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: BAR + 4,
            height: BAR + 4,
            borderRadius: 3,
            borderWidth: 1,
            borderColor: value === 0 ? colors.foregroundMuted : colors.border,
            backgroundColor:
              value === 0 ? colors.foregroundMuted : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: colors.surface0, fontSize: 9 }}>
            {value === 0 ? "–" : ""}
          </Text>
        </View>
      </Pressable>
      {stops}
    </View>
  );
}
