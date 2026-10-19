import "./guard.mjs";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

// A lost agent is not always a fault. Paseo archives the worktree workspace when
// the pull request merges, and the agent goes with it, so the row must read
// archived rather than red. This probe drives reconcileAgents over every way an
// agent can go missing. Group V.
const STATE = join(process.env.HOME, ".local", "state", "radar");
const BIN = join(import.meta.dirname, "bin");
const FIX = join(process.env.HOME, "reconcile-fixtures");
process.env.PROBE_FIXTURES = FIX;

rmSync(FIX, { recursive: true, force: true });
rmSync(join(STATE, "ledger"), { recursive: true, force: true });
mkdirSync(FIX, { recursive: true });
mkdirSync(STATE, { recursive: true });

const pr = (n, state) => writeFileSync(join(FIX, `pr-${n}.json`), JSON.stringify({ state }));

// 200 merged, 201 closed, 202 open. 203 has no fixture, so `gh pr view` fails
// and the stored status is all there is. 204 has none either and no stored
// status, which is the case that must stay a fault.
pr(200, "MERGED");
pr(201, "CLOSED");
pr(202, "OPEN");
pr(205, "MERGED");
pr(206, "MERGED");

const status = (state) => ({
  state,
  isDraft: false,
  decision: state === "merged" ? "approved" : null,
  approvedBy: [],
  blockedBy: [],
  mine: null,
  checkedAt: new Date().toISOString(),
});

const record = (n, extra = {}) => ({
  key: `owner/web#${n}`,
  repo: "owner/web",
  number: n,
  title: `probe ${n}`,
  firstSeen: new Date(Date.now() - 86_400_000).toISOString(),
  state: "created",
  agentId: `a${n}`,
  workspaceId: `ws-${n}`,
  ...extra,
});

const intake = [
  record(200),
  record(201),
  record(202),
  record(203, { pr: status("merged") }),
  record(204),
  // Alive, so nothing may touch it however its pull request reads.
  record(205, { agentId: "alive" }),
  // Orphaned by an earlier tick, with nothing stored to settle it.
  record(206, { state: "orphaned", lastError: "the agent was archived or deleted" }),
  // No agent id at all. Not watched, so not lost.
  record(207, { agentId: undefined }),
  // Orphaned while the pull request was open, merged since. The fault has
  // stopped being one anybody can act on.
  record(209, { state: "orphaned", lastError: "the agent was archived or deleted", pr: status("merged") }),
  // The same, still open. Nothing has changed, so nothing moves.
  record(210, { state: "orphaned", lastError: "the agent was archived or deleted", pr: status("open") }),
  // Already archived. Terminal, and never reconsidered.
  record(211, { state: "archived", pr: status("merged") }),
];

const write = (records) =>
  writeFileSync(
    join(STATE, "seen.json"),
    JSON.stringify({ intake: records, seenPullRequests: [], githubLastModified: null, lastSearchAt: null, lastLinearAt: null, linearSweptAt: null, linearSeen: [], linearOpen: [] }, null, 1),
  );
write(intake);
writeFileSync(
  join(STATE, "config.json"),
  JSON.stringify({ ghPath: join(BIN, "fake-gh"), paseoPath: join(BIN, "fake-paseo"), gitPath: "git" }, null, 1),
);
// Only `alive` is still running. Every other watched agent has gone.
writeFileSync(join(FIX, "agents.json"), JSON.stringify([{ id: "alive" }]));

const { reconcileAgents, settled } = await import("../server/reconcile.ts");

let fails = 0;
const check = (ok, name, detail = "") => {
  if (!ok) fails++;
  console.log(ok ? "pass" : "FAIL", name, ok ? "" : detail);
};

const real = console.log;
let lines = [];
const capture = () => { lines = []; console.log = (m) => lines.push(String(m)); };
const release = () => { console.log = real; };
const said = (fragment) => lines.some((line) => line.includes(fragment));
const rowOf = (n) =>
  JSON.parse(readFileSync(join(STATE, "seen.json"), "utf8")).intake.find((r) => r.number === n);

// ---- A. settled, read on its own. -------------------------------------------
check(await settled(record(200)) === "merged", "A1 GitHub says merged");
check(await settled(record(201)) === "closed", "A2 GitHub says closed");
check(await settled(record(202)) === null, "A3 an open pull request has not finished");
check(await settled(record(203, { pr: status("merged") })) === "merged", "A4 an unreadable GitHub falls back to the stored status");
check(await settled(record(204)) === null, "A5 unreadable with nothing stored reads as unfinished");
check(await settled(record(203, { pr: status("open") })) === null, "A6 a stored open status is not a finish");

// ---- B. The reconciliation itself. ------------------------------------------
capture();
await reconcileAgents();
release();

check(rowOf(200).state === "archived", "B1 a merged pull request whose agent is gone reads archived", rowOf(200).state);
check(rowOf(200).lastError === undefined, "B2 and carries no fault", String(rowOf(200).lastError));
check(said("owner/web#200 is merged and its agent is gone, marking archived"), "B3 the log says why");

check(rowOf(201).state === "archived", "B4 closed settles the row on the same terms", rowOf(201).state);
check(rowOf(201).lastError === undefined, "B5 and carries no fault either");

check(rowOf(202).state === "orphaned", "B6 an open pull request with no agent is still a fault", rowOf(202).state);
check(rowOf(202).lastError === "the agent was archived or deleted", "B7 and says so", String(rowOf(202).lastError));

check(rowOf(203).state === "archived", "B8 the stored status settles the row when GitHub cannot be read", rowOf(203).state);
check(said("cannot read owner/web#203 state"), "B9 and the failed read is logged rather than swallowed");

check(rowOf(204).state === "orphaned", "B10 unknown on both counts stays the retryable fault", rowOf(204).state);

check(rowOf(205).state === "created", "B11 a live agent is left alone", rowOf(205).state);
check(rowOf(206).state === "orphaned", "B12 an orphan with no stored status stays one");
check(rowOf(207).state === "created", "B13 a row with no agent id was never watched");

// ---- The late pass: an orphan whose pull request finished after the fact. ---
check(rowOf(209).state === "archived", "B14 an orphan whose pull request has since merged settles", rowOf(209).state);
check(rowOf(209).lastError === undefined, "B15 and drops the fault it was carrying", String(rowOf(209).lastError));
check(said("owner/web#209 is merged, settling the orphan as archived"), "B16 the log distinguishes a late settle from a fresh one");
check(rowOf(210).state === "orphaned", "B17 an orphan on an open pull request is still a fault", rowOf(210).state);
check(rowOf(211).state === "archived" && !said("#211"), "B18 an archived row is terminal and is not reconsidered");

// ---- C. The ledger. `note()` is fire and forget, so wait for the lines. ------
// The plugin's own ISO-8601 week, not a second implementation of it. The naive
// formula this replaced treated Sunday as the start of a week, so every Sunday it
// read one file ahead of the one the ledger had just written and found nothing.
const { ledgerPath } = await import("../server/ledger.ts");
const path = ledgerPath(new Date());
let ledger = "";
for (let i = 0; i < 40 && (ledger.match(/the session closed/g) ?? []).length < 4; i++) {
  await new Promise((r) => setTimeout(r, 50));
  ledger = existsSync(path) ? readFileSync(path, "utf8") : "";
}
check(ledger.includes("owner/web#200") && ledger.includes("the pull request is merged"), "C1 the merged row reached the ledger", ledger);
check(ledger.includes("owner/web#201") && ledger.includes("the pull request is closed"), "C2 so did the closed one");
check(!ledger.includes("owner/web#202"), "C3 a fault writes no ledger line");
check(ledger.includes("owner/web#209"), "C3b a late settle is recorded on the same terms as a fresh one");
check((ledger.match(/the session closed/g) ?? []).length === 4, "C4 one line per settled row, 200, 201, 203 and 209", String((ledger.match(/the session closed/g) ?? []).length));

// ---- D. A second pass is a no-op, and an unreadable agent list holds. --------
capture();
await reconcileAgents();
release();
check(lines.length === 0, "D1 a second pass says nothing: every settled row has already moved", lines.join(" | "));

// An unreadable agent list with nothing orphaned to settle beside it.
write([record(208, { agentId: "a208" })]);
pr(208, "MERGED");
writeFileSync(join(FIX, "ls-fails"), "");
capture();
await reconcileAgents();
release();
check(said("cannot list agents"), "D2 an unreadable agent list is logged");
check(rowOf(208).state === "created", "D3 and changes nothing: it is not evidence that an agent died", rowOf(208).state);

rmSync(FIX, { recursive: true, force: true });
console.log(fails === 0 ? "\nall clear" : `\n${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
