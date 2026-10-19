/**
 * Colour arithmetic, for the one tone the plugin wants that the host theme does
 * not define.
 *
 * The theme hands every colour over as a string and promises nothing about the
 * notation, so everything here parses what it is given and returns the input
 * untouched when it cannot read it. A theme written in a notation this does not
 * know loses the adjustment, which costs a colour slightly louder than
 * intended. Guessing would cost the colour itself.
 */

/** Channels are 0 to 255, alpha is 0 to 1, which is what both notations use. */
interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/** A `50%` or a `0.5`, as a ratio. Null when it is neither. */
function ratio(token: string): number | null {
  const percent = token.endsWith("%");
  const value = Number(percent ? token.slice(0, -1) : token);
  if (!Number.isFinite(value)) return null;
  return clamp(percent ? value / 100 : value, 0, 1);
}

/** A channel written either `204` or `80%`. */
function channel(token: string): number | null {
  if (token.endsWith("%")) {
    const part = ratio(token);
    return part === null ? null : part * 255;
  }
  const value = Number(token);
  return Number.isFinite(value) ? clamp(value, 0, 255) : null;
}

/** `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa`. */
function hex(text: string): Rgba | null {
  const digits = text.slice(1);
  if (!/^[0-9a-f]+$/i.test(digits)) return null;
  const short = digits.length === 3 || digits.length === 4;
  if (!short && digits.length !== 6 && digits.length !== 8) return null;

  const size = short ? 1 : 2;
  const at = (index: number) => {
    const part = digits.slice(index * size, index * size + size);
    return parseInt(short ? part + part : part, 16);
  };
  const opaque = digits.length === 3 || digits.length === 6;
  return { r: at(0), g: at(1), b: at(2), a: opaque ? 1 : at(3) / 255 };
}

/** The 0 to 1 channels of an hsl triple, in the usual order. */
function fromHsl(hue: number, saturation: number, lightness: number): number[] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = hue / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const base = lightness - chroma / 2;
  const triples = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ];
  const triple = triples[Math.min(5, Math.floor(sector))];
  return triple.map((part) => (part + base) * 255);
}

const CALL = /^(rgba?|hsla?)\(([^)]*)\)$/i;

/** `rgb()`, `rgba()`, `hsl()` and `hsla()`, comma separated or not. */
function call(text: string): Rgba | null {
  const match = CALL.exec(text);
  if (!match) return null;

  const tokens = match[2].split(/[\s,/]+/).filter(Boolean);
  if (tokens.length < 3 || tokens.length > 4) return null;
  const alpha = tokens.length === 4 ? ratio(tokens[3]) : 1;
  if (alpha === null) return null;

  if (match[1].toLowerCase().startsWith("rgb")) {
    const parts = tokens.slice(0, 3).map(channel);
    if (parts.some((part) => part === null)) return null;
    const [r, g, b] = parts as number[];
    return { r, g, b, a: alpha };
  }

  const degrees = Number(tokens[0].replace(/deg$/i, ""));
  const saturation = ratio(tokens[1]);
  const lightness = ratio(tokens[2]);
  if (!Number.isFinite(degrees) || saturation === null || lightness === null) {
    return null;
  }
  const [r, g, b] = fromHsl(
    ((degrees % 360) + 360) % 360,
    saturation,
    lightness,
  );
  return { r, g, b, a: alpha };
}

/** What the theme said, as numbers, or null when the notation is unknown. */
function parse(colour: string): Rgba | null {
  const text = colour.trim();
  return text.startsWith("#") ? hex(text) : call(text);
}

/** Always `rgb` or `rgba`, which every target accepts and nothing truncates. */
function format({ r, g, b, a }: Rgba): string {
  const round = (value: number) => Math.round(clamp(value, 0, 255));
  const channels = `${round(r)}, ${round(g)}, ${round(b)}`;
  return a >= 1
    ? `rgb(${channels})`
    : `rgba(${channels}, ${Math.round(a * 1000) / 1000})`;
}

/**
 * Pulls a colour towards its own grey.
 *
 * The grey is the weighted mix the eye reads as the colour's brightness, not
 * the flat average, so the result sits at the lightness it started at. That is
 * the property worth having: a fill stays as readable under white text after
 * the adjustment as it was before it, and only the intensity moves.
 */
export function desaturate(colour: string, amount: number): string {
  const rgba = parse(colour);
  if (!rgba) return colour;

  const grey = 0.2126 * rgba.r + 0.7152 * rgba.g + 0.0722 * rgba.b;
  const pull = clamp(amount, 0, 1);
  const towards = (value: number) => value + (grey - value) * pull;
  return format({
    r: towards(rgba.r),
    g: towards(rgba.g),
    b: towards(rgba.b),
    a: rgba.a,
  });
}

/** sRGB to linear light, the gamma step a contrast ratio is defined on. */
function linear(channel: number): number {
  const part = channel / 255;
  return part <= 0.04045
    ? part / 12.92
    : Math.pow((part + 0.055) / 1.055, 2.4);
}

/** Relative luminance as WCAG defines it: 0 for black, 1 for white. */
function luminance({ r, g, b }: Rgba): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The text drawn on a filled control. See `carryWhite`. */
export const WHITE = "#ffffff";

/** WCAG's floor for text that is neither large nor decorative. */
const FLOOR = 4.5;

/**
 * Darkens a fill by as little as it takes for white text on it to be legible.
 *
 * `accentForeground` cannot do this job. It is the foreground for the accent,
 * and Paseo's dark theme accents in a near white, so the token is a near black
 * there: correct on the accent, unreadable on a green. A filled control has to
 * derive its text colour from its own fill, and the cheapest way to do that is
 * to fix the text at white and move the fill until the pair reads.
 *
 * Black always clears the floor, so the search always terminates. A colour
 * already dark enough is returned at its own value, untouched.
 */
export function carryWhite(colour: string, floor = FLOOR): string {
  const rgba = parse(colour);
  if (!rgba) return colour;

  // Rounded here rather than in `format`, so the contrast is measured on the
  // colour that is actually emitted. Measuring the unrounded one returned a
  // fill a hundredth under the floor: the bisection converged on the boundary
  // and the rounding then stepped back across it.
  const round = (value: number) => Math.round(Math.max(0, value));
  const toBlack = (amount: number): Rgba => ({
    r: round(rgba.r * (1 - amount)),
    g: round(rgba.g * (1 - amount)),
    b: round(rgba.b * (1 - amount)),
    a: rgba.a,
  });
  const reads = (value: Rgba) => 1.05 / (luminance(value) + 0.05) >= floor;
  if (reads(toBlack(0))) return format(toBlack(0));

  // Bisection on how far towards black the fill is pulled. Sixteen rounds puts
  // the answer within a fifteen thousandth of the least darkening that works,
  // which is far below one step of an eight bit channel.
  let enough = 1;
  let short = 0;
  for (let round = 0; round < 16; round++) {
    const middle = (short + enough) / 2;
    if (reads(toBlack(middle))) enough = middle;
    else short = middle;
  }
  return format(toBlack(enough));
}

/**
 * How far the plugin's green sits from the host's. One knob for all three
 * places it is drawn: the done node, the settled badge and the submit button.
 *
 * The host green is a signal colour tuned to be found anywhere in an app. Here
 * it is the only green on the screen and one of the three carries a filled
 * button, so at full strength it was the loudest thing in a view whose whole
 * job is to be read slowly.
 */
const MUTE = 0.4;

/** The plugin's green. Always this, never `colors.statusSuccess` directly. */
export const success = (statusSuccess: string) =>
  desaturate(statusSuccess, MUTE);

/**
 * How far the plugin's accent sits from the host's. Gentler than the green,
 * because this one colours every link on the screen and a link has to stay
 * apart from the text around it.
 */
const ACCENT_MUTE = 0.25;

/**
 * The plugin's accent.
 *
 * Paseo's light theme accents in a saturated green and its dark theme in a near
 * grey, so the one pull towards grey is right for both: it quietens a hue and
 * does nothing at all to something already grey. That is also its limit. A
 * theme accenting in some other hue gets that hue quietened too, which is a
 * choice this plugin is making for its own screens rather than something the
 * host asked for.
 */
export const highlight = (accent: string) => desaturate(accent, ACCENT_MUTE);
