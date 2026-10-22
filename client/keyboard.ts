import { useCallback, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  Platform,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
  type View,
} from "react-native";
import { keyboardInset, revealOffset } from "../shared/keyboard";

/** Anything that can report its own window rect: a View, a TextInput. */
export interface Measurable {
  measureInWindow(
    callback: (x: number, y: number, width: number, height: number) => void,
  ): void;
}

/** Breathing room above and below a field brought into view. */
const MARGIN = 8;

// iOS announces the keyboard before it moves, Android only after it has. The
// earlier event on each platform is the difference between the column rising
// with the keyboard and rising behind it.
const SHOW = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
const HIDE = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

export interface KeyboardAvoidance {
  /**
   * Pixels of the column the keyboard covers. Apply it as the bottom padding of
   * the view `rootRef` is on, which lifts the footer with it.
   */
  inset: number;
  /** The whole column, footer included. Its bottom edge is what the keyboard covers. */
  rootRef: React.RefObject<View | null>;
  /** The scrolling area inside the column, which is what a field has to fit in. */
  viewportRef: React.RefObject<View | null>;
  scrollRef: React.RefObject<ScrollView | null>;
  onRootLayout(): void;
  onViewportLayout(): void;
  onScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void;
  /** Bring a field into view, and keep doing so as the keyboard settles. */
  reveal(node?: Measurable | null): void;
}

/**
 * Types into a field the keyboard would otherwise cover.
 *
 * The host mounts its own keyboard handling app-wide but exports none of it to
 * plugin code, and the sandbox resolves `react-native` but not
 * `react-native-keyboard-controller`, so this is built from the one keyboard
 * API a plugin can reach. Nothing is assumed about the host: no header height,
 * no `keyboardVerticalOffset`, no `windowSoftInputMode`. Every number is
 * measured, and the arithmetic is in `shared/keyboard.ts` where a probe can
 * reach it. AC-AL3.
 *
 * Layout drives it rather than a timer. The keyboard event records where the
 * keyboard's top edge is and re-measures the column; the inset that follows
 * shrinks the viewport; the viewport's own layout event is what scrolls the
 * focused field up. A press that does not move anything therefore costs one
 * measurement and no scroll.
 */
export function useKeyboardAvoidance(): KeyboardAvoidance {
  const [inset, setInset] = useState(0);
  const rootRef = useRef<View | null>(null);
  const viewportRef = useRef<View | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  // Refs, not state: none of these three should cost a render on their own, and
  // the field has to survive the renders the inset does cause.
  const offset = useRef(0);
  const keyboardTop = useRef<number | null>(null);
  const field = useRef<Measurable | null>(null);

  const measureColumn = useCallback(() => {
    rootRef.current?.measureInWindow((_x, top, _width, height) =>
      setInset(keyboardInset({ top, height }, keyboardTop.current)),
    );
  }, []);

  const reveal = useCallback((node?: Measurable | null) => {
    if (node) field.current = node;
    const target = field.current;
    const viewport = viewportRef.current;
    const scroll = scrollRef.current;
    if (!target || !viewport || !scroll) return;

    viewport.measureInWindow((_x, top, _width, height) =>
      target.measureInWindow((_fx, fieldTop, _fwidth, fieldHeight) => {
        const next = revealOffset(
          { top, height },
          { top: fieldTop, height: fieldHeight },
          offset.current,
          MARGIN,
        );
        if (next === null) return;
        // Taken as read rather than waited for: a second reveal that arrives
        // before the scroll event would otherwise compute from the old offset
        // and scroll the same distance twice.
        offset.current = next;
        scroll.scrollTo({ y: next, animated: true });
      }),
    );
  }, []);

  useEffect(() => {
    const shown = Keyboard.addListener(SHOW, (event) => {
      keyboardTop.current = event.endCoordinates.screenY;
      measureColumn();
    });
    const hidden = Keyboard.addListener(HIDE, () => {
      keyboardTop.current = null;
      // Dropped before the inset, so the viewport growing back does not scroll
      // to a field nobody is typing in any more.
      field.current = null;
      setInset(0);
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [measureColumn]);

  return {
    inset,
    rootRef,
    viewportRef,
    scrollRef,
    onRootLayout: measureColumn,
    // Wrapped, not passed: `onLayout` hands its event to the first argument,
    // which here is the field to reveal.
    onViewportLayout: () => reveal(),
    onScroll: (event) => {
      offset.current = event.nativeEvent.contentOffset.y;
    },
    reveal,
  };
}
