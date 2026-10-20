import "./guard.mjs";
import { chmod, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { isoWeek, keyUrl, ledgerPath, note, record, writeOpen, LEDGER_DIR, OPEN_PATH } from "../server/ledger.ts";
import { STATE_DIR, statePath } from "../server/state.ts";
import { writeAtomic } from "../server/atomic.ts";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

await rm(STATE_DIR, { recursive: true, force: true });

// L1. ISO weeks, against Python's own %G-W%V for the same local dates.
const weeks = JSON.parse(await readFile(new URL("./weeks.json", import.meta.url), "utf8"));
let wrong = 0;
for (const { y, m, d, want } of weeks) {
  const got = isoWeek(new Date(y, m - 1, d, 12, 0));
  if (got !== want) { wrong++; console.log(`      ${y}-${m}-${d}: got ${got}, want ${want}`); }
}
check(`L1 ${weeks.length} ISO weeks match Python`, wrong, 0);

// L2 to L4. The file shape.
const monday = new Date(2026, 9, 12, 9, 41);
await record({ source: "github", subject: "owner/web#9457", what: "review requested, Fix the status bar", url: "https://github.com/owner/web/pull/9457", at: monday });
await record({ source: "github", subject: "owner/web#9457", what: "acknowledge done", url: "https://github.com/owner/web/pull/9457", at: new Date(2026, 9, 12, 9, 44) });
await record({ source: "linear", subject: "ENG-1182", what: "assigned", at: new Date(2026, 9, 13, 14, 5) });
const week = await readFile(ledgerPath(monday), "utf8");
console.log("---\n" + week + "---");
check("L2 one week file", ledgerPath(monday).endsWith("2026-W42.md"), true);
check("L3 one heading per day", [week.match(/^## /gm)?.length, week.includes("## 2026-10-12 Monday"), week.includes("## 2026-10-13 Tuesday")], [2, true, true]);
check("L4 three lines", week.match(/^- /gm)?.length, 3);
check("L5 a line with no url carries no brackets", week.includes("- 14:05 linear ENG-1182 assigned\n"), true);
check("L6 the opening heading is the week", week.startsWith("# 2026-W42\n"), true);

// L7. Concurrency.
await Promise.all(Array.from({ length: 20 }, (_, i) =>
  record({ source: "github", subject: `owner/web#${9000 + i}`, what: "review requested", at: new Date(2026, 9, 14, 10, i) })));
const after = await readFile(ledgerPath(monday), "utf8");
check("L7 20 concurrent appends, 20 whole lines", after.match(/^- \d\d:\d\d github owner\/web#90\d\d review requested$/gm)?.length, 20);
check("L8 and one heading for that day", after.match(/^## 2026-10-14 Wednesday$/gm)?.length, 1);

// L9. OPEN.md, regenerated from state.
await mkdir(STATE_DIR, { recursive: true });
const base = { repo: "owner/web", title: "Fix the status bar", firstSeen: new Date(Date.now() - 3 * 86400000).toISOString() };
await writeFile(statePath, JSON.stringify({ githubLastModified: null, lastSearchAt: null, seenPullRequests: [], intake: [
  { ...base, key: "owner/web#1", number: 1, state: "created", review: { acknowledge: { status: "done" }, qa: { status: "pending" }, verification: { status: "pending" }, feedback: { status: "pending" } }, linearUrl: "https://linear.app/acme/issue/ENG-1182" },
  { ...base, key: "owner/web#2", number: 2, state: "archived", pr: { state: "merged", isDraft: false, decision: "approved", approvedBy: [], blockedBy: [], mine: null, checkedAt: new Date().toISOString() } },
  { ...base, key: "owner/web#3", number: 3, state: "created", dismissedAt: new Date().toISOString() },
] }));
await writeOpen();
const open = await readFile(OPEN_PATH, "utf8");
console.log("---\n" + open + "---");
check("L9 every undismissed record, and only those", [open.includes("#1"), open.includes("#2"), open.includes("#3")], [true, true, false]);
check("L10 its current stage, state and age", [open.includes("QA, created, tracked 3d"), open.includes("<https://linear.app/acme/issue/ENG-1182>")], [true, true]);
// An archived row is listed because nobody dismissed it, which is the one rule.
// It must still not read as work: the merged badge leads and the stage is settled.
check("L10b an archived merged row reads as settled, not as work", open.includes("merged, settled, archived, tracked 3d"), true);
await writeOpen();
check("L11 regenerating leaves one copy", (await readFile(OPEN_PATH, "utf8")).match(/owner\/web#1/g)?.length, 1);

// AF26. Two writers of OPEN.md at once. The defect was one fixed temp name per
// process: both renames chose the same path, the second got ENOENT, and the line
// it was regenerating for was lost. Nothing sequential could catch it, which is
// why L9 to L11 never did.
const openState = (keys) => JSON.stringify({ intake: keys.map((n) => ({
  ...base, key: `owner/web#${n}`, number: n, state: "created",
  review: { acknowledge: { status: "done" }, qa: { status: "pending" }, verification: { status: "pending" }, feedback: { status: "pending" } },
})) });
await writeAtomic(statePath, openState([1, 2, 3]));
const slow = writeOpen();
// Written between the two asks, so the trailing run has something newer to read
// and the body on disk says which of the two landed.
await writeAtomic(statePath, openState([1, 2, 3, 4]));
const fast = writeOpen();
const settled = await Promise.allSettled([slow, fast]);
check("AF26 two concurrent writeOpen calls both resolve", settled.map((r) => r.status), ["fulfilled", "fulfilled"]);
const raced = await readFile(OPEN_PATH, "utf8");
check("AF26b OPEN.md is one whole body, not a half of each", [raced.startsWith("# Open\n"), raced.endsWith("\n"), raced.match(/^# Open$/gm)?.length], [true, true, 1]);
// Coalescing is what makes this the newer body rather than either one at random.
check("AF26c the body on disk is the freshest read", [raced.includes("owner/web#4"), raced.includes("owner/web#1")], [true, true]);
check("AF26d no temp file survives the race", (await readdir(STATE_DIR)).filter((name) => name.endsWith(".tmp")), []);

// L12. keyUrl.
check("L12 keyUrl", [keyUrl("owner/web#9457"), keyUrl("nonsense"), keyUrl("a/b#x")], ["https://github.com/owner/web/pull/9457", undefined, undefined]);

// L13. A ledger that cannot be written never throws upward.
await rm(LEDGER_DIR, { recursive: true, force: true });
await writeFile(LEDGER_DIR, "not a directory");
note({ source: "github", subject: "owner/web#9457", what: "acknowledge done" });
await new Promise((resolve) => setTimeout(resolve, 200));
console.log("pass  L13 note() swallowed the failure and logged it, above");

await rm(STATE_DIR, { recursive: true, force: true });
console.log(failures === 0 ? "\nall clear" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
