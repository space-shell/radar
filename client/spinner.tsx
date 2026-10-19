import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useState } from "react";
import { View } from "react-native";

const CELLS = 9;
const BRIGHT = 3;
const MID = 2;
const DIM = 0.18;
const FRAME_MS = 140;

/**
 * Three cells bright, two mid, the rest dim, reshuffled every frame. Holding the
 * counts fixed stops the grid flashing fully on or fully blank between frames.
 */
function pattern(): number[] {
  const order = [...Array(CELLS).keys()];
  for (let index = order.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }

  const levels = Array<number>(CELLS).fill(DIM);
  for (const cell of order.slice(0, BRIGHT)) levels[cell] = 1;
  for (const cell of order.slice(BRIGHT, BRIGHT + MID)) levels[cell] = 0.5;
  return levels;
}

/**
 * Three cells and two two-point gaps across. Exported so a slot that swaps text
 * for this grid can reserve the room before the swap, rather than widening as
 * it happens.
 */
export const dotsWidth = (size = 4) => size * 3 + 4;

interface BusyDotsProps {
  theme: PluginTheme;
  label: string;
  /** Side of one cell in points. The grid is three cells plus two gaps wide. */
  size?: number;
}

/** A working indicator for an action that can run for a minute or more. AC-A10. */
export function BusyDots({ theme, label, size = 4 }: BusyDotsProps) {
  const [levels, setLevels] = useState(pattern);

  useEffect(() => {
    const timer = setInterval(() => setLevels(pattern()), FRAME_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{ gap: 2 }}
    >
      {[0, 1, 2].map((row) => (
        <View key={row} style={{ flexDirection: "row", gap: 2 }}>
          {[0, 1, 2].map((column) => (
            <View
              key={column}
              style={{
                width: size,
                height: size,
                borderRadius: 1,
                backgroundColor: theme.colors.accent,
                opacity: levels[row * 3 + column],
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
