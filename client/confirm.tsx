import type { PluginTheme } from "@getpaseo/plugin";
import { useMachine } from "./vendor/xstate-react.mjs";
import { useEffect, useMemo, useRef } from "react";
import { Pressable, Text, View, type TextStyle } from "react-native";
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
  busy,
  disabled,
  onConfirm,
}: ConfirmButtonProps) {
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
      <Text style={style}>{label}</Text>
      <Text style={confirmStyle}>{confirmLabel}</Text>
      <View style={{ flexDirection: "row", gap: GAP }}>
        <View style={{ width: dotsWidth() }} />
        <Text style={style}>{busyLabel}</Text>
      </View>
    </>
  );

  return (
    <Steady widest={ruler}>
      {busy ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: GAP }}>
          <BusyDots theme={theme} label={busyLabel} />
          <Text style={style}>{busyLabel}</Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={armed ? confirmLabel : label}
          disabled={disabled}
          onPress={() => send({ type: "PRESS" })}
        >
          <Text style={armed ? confirmStyle : style}>
            {armed ? confirmLabel : label}
          </Text>
        </Pressable>
      )}
    </Steady>
  );
}
