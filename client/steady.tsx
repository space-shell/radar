import type { ReactNode } from "react";
import { View, type FlexAlignType } from "react-native";

export interface SteadyProps {
  /**
   * Every variant this slot can show, stacked in a column. A column is as wide
   * as its widest child, and that is the width the slot then keeps.
   */
  widest: ReactNode;
  /** Where the visible content sits inside the reserved width. */
  align?: FlexAlignType;
  children: ReactNode;
}

/**
 * Holds a slot at the width of the widest thing it can ever show.
 *
 * Controls here rewrite themselves as they are used. Dismiss becomes Dismiss?
 * on the first press, and in a heavier weight. The clock reads 7m until it is
 * pressed and then a grid of dots. Each of those is a different number of
 * pixels wide, and every one of them moved whatever sat to its right, so
 * arming one control slid the next one out from under the pointer.
 *
 * The width is reserved rather than measured. A copy of every variant is laid
 * out in a box of zero height: it is invisible and costs no vertical space, but
 * it is still a flex child, so the column is at least as wide as the widest of
 * them. Nothing is measured, so there is no first frame at the wrong width and
 * no state to settle.
 *
 * It is the trick the summary chevron plays with a hard-coded 12 points,
 * generalised to text, whose width in a proportional font nobody can hard-code.
 */
export function Steady({
  widest,
  align = "flex-start",
  children,
}: SteadyProps) {
  return (
    <View style={{ alignItems: align }}>
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ height: 0, opacity: 0, overflow: "hidden" }}
      >
        {widest}
      </View>
      {children}
    </View>
  );
}
