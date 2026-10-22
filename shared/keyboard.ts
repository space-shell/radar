/**
 * Where a box sits vertically, in window coordinates. A measured rect, not a
 * style: the point of this module is that nothing here is guessed.
 */
export interface Span {
  top: number;
  height: number;
}

/**
 * How much of a column the on-screen keyboard covers, in pixels.
 *
 * Measured against the column's own bottom edge rather than taken from the
 * keyboard's height, because whether the window has already been resized for
 * the keyboard is the host app's decision and the plugin cannot read it. Under
 * `adjustResize` the column has already shrunk and nothing is covered, so this
 * returns zero; under `adjustPan`, or Android's forced edge to edge, it has not
 * and this returns the overlap. The same arithmetic is right in both. AC-AL1.
 */
export function keyboardInset(
  column: Span | null,
  keyboardTop: number | null,
): number {
  if (!column || keyboardTop === null) return 0;
  const covered = column.top + column.height - keyboardTop;
  // Below a pixel is sub-pixel rounding, not a keyboard.
  return covered > 1 ? Math.round(covered) : 0;
}

/**
 * Where the scroll has to sit for a field to be wholly in view, or null when it
 * already is and nothing should move.
 *
 * `viewport` is the scrolling area after the keyboard has taken its share, so
 * this is the same question whether the room was lost to the inset above or to
 * the host resizing the window. AC-AL2.
 */
export function revealOffset(
  viewport: Span,
  field: Span,
  offset: number,
  margin: number,
): number | null {
  const top = viewport.top + margin;
  const bottom = viewport.top + viewport.height - margin;
  const foot = field.top + field.height;

  let shift = foot > bottom ? foot - bottom : 0;
  // A field taller than the viewport cannot be shown whole, so its top wins:
  // that is where the label is, and where the caret starts. The same branch
  // catches a field already scrolled off the top, where the shift is negative.
  if (field.top - shift < top) shift = field.top - top;

  const next = Math.max(0, offset + shift);
  return Math.abs(next - offset) < 1 ? null : Math.round(next);
}
