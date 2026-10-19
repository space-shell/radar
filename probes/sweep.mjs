import "./guard.mjs";
const { singleFlight } = await import("../server/single-flight.ts");

let fails = 0;
const check = (ok, name, detail = "") => {
  if (!ok) fails++;
  console.log(ok ? "pass" : "FAIL", name, ok ? "" : detail);
};

// A second call while one runs joins it and does not run the work twice.
let runs = 0;
let release;
const gate = new Promise((resolve) => (release = resolve));
let flight = singleFlight(async () => { runs++; await gate; });
const first = flight();
const second = flight();
const third = flight();
release();
const [a, b, c] = await Promise.all([first, second, third]);
check(runs === 1, "three overlapping calls ran the work once", `ran ${runs}`);
check(a === false, "the first call reports that it started one");
check(b === true && c === true, "the others report that they joined");

// The slot clears, so a later call runs again rather than returning instantly.
const fourth = await flight();
check(runs === 2, "a call after the first finished ran the work again", `ran ${runs}`);
check(fourth === false, "and reports that it started one");

// A failure reaches every waiter and still clears the slot.
let attempts = 0;
flight = singleFlight(async () => {
  attempts++;
  if (attempts === 1) throw new Error("boom");
});
const caught = await Promise.allSettled([flight(), flight()]);
check(
  caught.every((r) => r.status === "rejected" && String(r.reason).includes("boom")),
  "a failure reaches the caller and the joiner",
  JSON.stringify(caught.map((r) => r.status)),
);
await flight();
check(attempts === 2, "and the slot cleared, so the next call tried again", `attempts ${attempts}`);

console.log(fails === 0 ? "all clear" : `${fails} failures`);
