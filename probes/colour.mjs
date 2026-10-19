import "./guard.mjs";
const { desaturate, success, highlight, carryWhite, WHITE } = await import("../shared/colour.ts");

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

// C1. Every notation a theme is likely to be written in, read to the same colour.
check("C1 six digit hex", desaturate("#22c55e", 0), "rgb(34, 197, 94)");
check("C1 three digit hex is doubled", desaturate("#2c5", 0), "rgb(34, 204, 85)");
check("C1 eight digit hex keeps its alpha", desaturate("#22c55e80", 0), "rgba(34, 197, 94, 0.502)");
check("C1 four digit hex too", desaturate("#2c58", 0), "rgba(34, 204, 85, 0.533)");
check("C1 a four digit hex can be fully transparent", desaturate("#ff00", 0), "rgba(255, 255, 0, 0)");
check("C1 rgb", desaturate("rgb(34, 197, 94)", 0), "rgb(34, 197, 94)");
check("C1 rgba", desaturate("rgba(34 197 94 / 0.5)", 0), "rgba(34, 197, 94, 0.5)");
check("C1 rgb in percentages", desaturate("rgb(0%, 100%, 0%)", 0), "rgb(0, 255, 0)");
check("C1 hsl", desaturate("hsl(120, 100%, 50%)", 0), "rgb(0, 255, 0)");
check("C1 hsl at every sixth of the wheel", [0, 60, 120, 180, 240, 300, 360].map((h) => desaturate(`hsl(${h} 100% 50%)`, 0)), ["rgb(255, 0, 0)", "rgb(255, 255, 0)", "rgb(0, 255, 0)", "rgb(0, 255, 255)", "rgb(0, 0, 255)", "rgb(255, 0, 255)", "rgb(255, 0, 0)"]);
check("C1 hsla", desaturate("hsla(120, 100%, 50%, 0.25)", 0), "rgba(0, 255, 0, 0.25)");
check("C1 hsl with no saturation is grey", desaturate("hsl(120, 0%, 50%)", 0), "rgb(128, 128, 128)");

// C2. A notation this cannot read is returned exactly as it came, because a
// colour slightly louder than asked for beats a colour that is not there.
for (const odd of ["rebeccapurple", "color(display-p3 0 1 0)", "oklch(0.7 0.2 150)", "#ff", "#ffddaacc11", "#zzzzzz", "rgb(1, 2)", "rgb(1, 2, 3, 4, 5)", "", "var(--green)"]) {
  check(`C2 ${odd || "an empty string"} is left alone`, desaturate(odd, 0.4), odd);
}

// C3. The adjustment itself. The hue stays, the intensity drops, and the
// brightness the eye reads does not move.
const luma = (text) => {
  const [r, g, b] = text.match(/[\d.]+/g).slice(0, 3).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const green = "#22c55e";
const muted = desaturate(green, 0.4);
check("C3 a mute of zero changes nothing", desaturate(green, 0), "rgb(34, 197, 94)");
check("C3 brightness is held", Math.round(luma(muted)), Math.round(luma("rgb(34, 197, 94)")));
check("C3 green is still the strongest channel", muted, "rgb(82, 180, 118)");
check("C3 a full mute is the grey itself", desaturate(green, 1), "rgb(155, 155, 155)");
check("C3 and the spread has narrowed", (() => { const [r, g, b] = muted.match(/\d+/g).map(Number); return Math.max(r, g, b) - Math.min(r, g, b) < 197 - 34; })(), true);
check("C3 an amount past the ends is clamped", [desaturate(green, -1), desaturate(green, 7)], ["rgb(34, 197, 94)", "rgb(155, 155, 155)"]);
check("C3 alpha survives the mute", desaturate("#22c55e80", 0.4), "rgba(82, 180, 118, 0.502)");
check("C3 grey in, the same grey out", desaturate("#808080", 0.4), "rgb(128, 128, 128)");

// C4. The one green the plugin draws. Three call sites, one value.
check("C4 success is a mute of what the theme said", success(green), desaturate(green, 0.4));
check("C4 and it is not the theme's own green", success(green) === "rgb(34, 197, 94)", false);
check("C4 an unreadable theme green still renders", success("oklch(0.7 0.2 150)"), "oklch(0.7 0.2 150)");

// C5. White on a fill. The floor is cleared in both of Paseo's own themes, and
// the fill is moved by as little as that takes: a colour already dark enough
// comes back at its own value.
const lin = (c) => { const p = c / 255; return p <= 0.04045 ? p / 12.92 : Math.pow((p + 0.055) / 1.055, 2.4); };
const contrast = (text) => { const [r, g, b] = text.match(/[\d.]+/g).slice(0, 3).map(Number); return 1.05 / (0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) + 0.05); };
check("C5 white is what the fill is paired with", WHITE, "#ffffff");
check("C5 black is already dark enough", carryWhite("#000000"), "rgb(0, 0, 0)");
check("C5 white is not, and is darkened until it reads", contrast(carryWhite("#ffffff")) >= 4.5, true);
check("C5 an unreadable notation is left alone", carryWhite("oklch(0.7 0.2 150)"), "oklch(0.7 0.2 150)");
// Cleared, and barely. A whole channel is the smallest step there is, so the
// result cannot land on the floor exactly; it has to land just past it.
const barely = (colour) => { const got = contrast(carryWhite(colour)); return got >= 4.5 && got < 4.6; };
check("C5 the floor is cleared and not overshot", ["#6cb17b", "#c09664", "#ffffff", "#e4e4e7"].map(barely), [true, true, true, true]);
check("C5 a higher floor darkens further", contrast(carryWhite("#6cb17b", 7)) >= 7, true);

// C6. Paseo's own two themes, which are the only ones this runs against today.
// The light theme accents in a green and the dark theme in a near grey, so the
// one call has to be right for both.
const light = { statusSuccess: "#6cb17b", statusWarning: "#c09664", accent: "#20744A" };
const dark = { statusSuccess: "#3e704a", statusWarning: "#7b5d39", accent: "#e4e4e7" };
check("C6 light: the button fill carries white", [carryWhite(success(light.statusSuccess)), contrast(carryWhite(success(light.statusSuccess))) >= 4.5], ["rgb(95, 126, 102)", true]);
check("C6 dark: already dark enough, so the mute is all that happens", [carryWhite(success(dark.statusSuccess)), success(dark.statusSuccess)], ["rgb(77, 107, 84)", "rgb(77, 107, 84)"]);
check("C6 both armed fills carry white too", [contrast(carryWhite(light.statusWarning)) >= 4.5, contrast(carryWhite(dark.statusWarning)) >= 4.5], [true, true]);
check("C6 light: the green accent is quietened", highlight(light.accent), "rgb(48, 111, 79)");
check("C6 dark: a grey accent is left where it was", highlight(dark.accent), "rgb(228, 228, 230)");
check("C6 and the grey moves by less than one step of a channel", (() => { const [r, g, b] = highlight(dark.accent).match(/\d+/g).map(Number); return Math.max(Math.abs(r - 228), Math.abs(g - 228), Math.abs(b - 231)) <= 1; })(), true);
check("C6 the accent mute is gentler than the green's", [highlight("#6cb17b"), success("#6cb17b")], ["rgb(121, 172, 132)", "rgb(128, 170, 137)"]);
check("C6 gentler means nearer the colour it started from", (() => { const away = (text) => Math.abs(Number(text.match(/\d+/g)[1]) - 177); return away(highlight("#6cb17b")) < away(success("#6cb17b")); })(), true);

console.log(failures === 0 ? "\nall pass" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
