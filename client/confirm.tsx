import type { PluginTheme } from "@getpaseo/plugin";
import { useMachine } from "./vendor/xstate-react.mjs";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  Pressable,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { confirmMachine } from "../shared/machines/confirm";
import { BusyDots, dotsWidth } from "./spinner";
import { Steady } from "./steady";

/** Between the working grid and the word beside it, in both states. */
const GAP = 6;

export interface ConfirmButtonProps {
  label: string;
  confirmLabel: string;
  /** Shown while this action runs. A retry can take two minutes. AC-A10. */
  busyLabel: string;
  theme: PluginTheme;
  style: TextStyle;
  confirmStyle: TextStyle;
  /**
   * The fill, border and padding drawn behind the word. Absent, the control is
   * the bare text it has always been, which is what a row control still wants:
   * a page of buttons names no action in particular. AC-AA1.
   */
  chrome?: ViewStyle;
  /** The chrome of the armed state. Falls back to `chrome`. */
  confirmChrome?: ViewStyle;
  busy?: boolean;
  disabled?: boolean;
  onConfirm(): void;
}

/** Two-stage press, so one tap while scrolling cannot fire the action. AC-A8. */
export function ConfirmButton({
  label,
  confirmLabel,
  busyLabel,
  theme,
  style,
  confirmStyle,
  chrome,
  confirmChrome,
  busy,
  disabled,
  onConfirm,
}: ConfirmButtonProps) {
  const armedChrome = confirmChrome ?? chrome;
  /** The word, in its box when it has one. The box is what takes the press. */
  const shell = (box: ViewStyle | undefined, content: ReactNode) =>
    box ? <View style={box}>{content}</View> : content;

  // The machine is created once. `fire` reads the callback through a ref so a new
  // `onConfirm` on a later render reaches the action without rebuilding the actor
  // and losing the armed state mid-window.
  const confirm = useRef(onConfirm);
  confirm.current = onConfirm;
  const logic = useMemo(
    () =>
      confirmMachine.provide({ actions: { fire: () => confirm.current() } }),
    [],
  );
  const [state, send] = useMachine(logic);
  const armed = state.matches("armed");

  // The one thing the machine cannot see. Whether this action is in flight is the
  // parent's knowledge, and an armed control has to stand down when it starts, so
  // the confirm wording cannot outlive the press that began the work.
  //
  // `disabled` counts too, and for a reason `busy` does not cover: these controls
  // come in rows that disable together while any one of them runs. Arming Skip,
  // then running QA, used to leave "Skip?" sitting in the armed colour and
  // unpressable for the rest of its four seconds, asking a question nothing
  // could answer.
  useEffect(() => {
    if (busy || disabled) send({ type: "DISARM" });
  }, [busy, disabled, send]);

  /**
   * All three states this control can show. Arming adds a question mark and a
   * heavier weight, and working replaces the word entirely, so the widest of
   * the three is the width the control holds throughout. Without it, arming
   * Dismiss pushed every control beside it along, which is the one moment the
   * pointer is already on its way to the second press.
   */
  const ruler = (
    <>
      {shell(chrome, <Text style={style}>{label}</Text>)}
      {shell(armedChrome, <Text style={confirmStyle}>{confirmLabel}</Text>)}
      {shell(
        chrome,
        <View style={{ flexDirection: "row", gap: GAP }}>
          <View style={{ width: dotsWidth() }} />
          <Text style={style}>{busyLabel}</Text>
        </View>,
      )}
    </>
  );

  return (
    <Steady widest={ruler}>
      {busy ? (
        shell(
          chrome,
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: GAP }}
          >
            <BusyDots theme={theme} label={busyLabel} />
            <Text style={style}>{busyLabel}</Text>
          </View>,
        )
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={armed ? confirmLabel : label}
          disabled={disabled}
          onPress={() => send({ type: "PRESS" })}
        >
          {shell(
            armed ? armedChrome : chrome,
            <Text style={armed ? confirmStyle : style}>
              {armed ? confirmLabel : label}
            </Text>,
          )}
        </Pressable>
      )}
    </Steady>
  );
}
