import "./guard.mjs";
import { keyboardInset, revealOffset } from "../shared/keyboard.ts";

let fails = 0;
const check = (ok, name, detail = "") => {
  if (!ok) fails++;
  console.log(ok ? "pass" : "FAIL", name, ok ? "" : detail);
};

let n = 0;
const insets = (column, keyboardTop, want) => {
  const got = keyboardInset(column, keyboardTop);
  check(got === want, `A${++n} inset ${JSON.stringify(column)} top ${keyboardTop}`, `got ${got}, want ${want}`);
};

// A phone 800 tall, a keyboard 300 tall, so its top edge is at 500. AC-AL1.
// The window was not resized: the column still reaches the bottom and 300 of it is covered.
insets({ top: 0, height: 800 }, 500, 300);
// The host resized the window for the keyboard: the column already ends at the
// keyboard's top edge, so nothing is covered and nothing must be added.
insets({ top: 0, height: 500 }, 500, 0);
// Resized with a pixel to spare, which is not a keyboard.
insets({ top: 0, height: 499 }, 500, 0);
insets({ top: 0, height: 500.4 }, 500, 0);
// A column that does not start at the top of the window.
insets({ top: 56, height: 744 }, 500, 300);
// Sub-pixel measurements round rather than churning the layout.
insets({ top: 0, height: 800.4 }, 499.8, 301);
// No keyboard, and no column yet.
insets({ top: 0, height: 800 }, null, 0);
insets(null, 500, 0);
// A keyboard taller than the column is still only the column's own overlap.
insets({ top: 600, height: 100 }, 500, 200);

let m = 0;
const reveals = (field, offset, want, note = "") => {
  const got = revealOffset({ top: 100, height: 400 }, field, offset, 8);
  check(got === want, `B${++m} ${note || JSON.stringify(field)} at ${offset}`, `got ${got}, want ${want}`);
};

// The viewport runs 100 to 500, so with an 8 margin a field is at home in 108 to 492. AC-AL2.
reveals({ top: 200, height: 100 }, 0, null, "wholly visible");
reveals({ top: 108, height: 384 }, 40, null, "exactly filling the margins");
// Below the fold: scrolled by just the overlap, no more.
reveals({ top: 450, height: 100 }, 0, 58, "below the fold");
reveals({ top: 450, height: 100 }, 200, 258, "below the fold, already scrolled");
// A field taller than the viewport cannot be shown whole, so its top wins: the
// label and the caret are there, the end of the box is not.
reveals({ top: 300, height: 600 }, 0, 192, "taller than the viewport");
// Scrolled off the top, which is the same branch with a negative shift.
reveals({ top: 20, height: 100 }, 300, 212, "above the fold");
// Never past the top of the content, however far up the field reads.
reveals({ top: 20, height: 100 }, 50, 0, "clamped at the top");
reveals({ top: -400, height: 100 }, 10, 0, "far above, clamped");
// Sub-pixel differences are not worth a scroll animation.
reveals({ top: 492.4, height: 0 }, 0, null, "within a pixel");

console.log(fails === 0 ? "ok" : "FAILED", `${n + m} checks`);
process.exit(fails === 0 ? 0 : 1);
