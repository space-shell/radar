import "./guard.mjs";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const STATE = join(process.env.HOME, ".local", "state", "radar");
// The fakes live beside this file; what they answer with lives under the
// redirected HOME, so a run leaves nothing behind in the repository.
const BIN = join(import.meta.dirname, "bin");
const FIX = join(process.env.HOME, "reap-fixtures");
process.env.PROBE_FIXTURES = FIX;

rmSync(FIX, { recursive: true, force: true });
rmSync(join(STATE, "ledger"), { recursive: true, force: true });
mkdirSync(FIX, { recursive: true });
mkdirSync(STATE, { recursive: true });

const hours = (n) => new Date(Date.now() - n * 3_600_000).toISOString();
const pr = (n, state) => writeFileSync(join(FIX, `pr-${n}.json`), JSON.stringify({ state }));
const agent = (id, body) => writeFileSync(join(FIX, `agent-${id}.json`), body);

// The pull request side of each case.
pr(100, "OPEN");
for (const n of [101, 102, 103, 104, 105, 106, 107, 110, 111, 112, 113]) pr(n, "MERGED");
pr(108, "CLOSED");
// 109 deliberately has no fixture, so `gh pr view` fails.

// The agent side.
agent("a103", JSON.stringify({ Status: "running", UpdatedAt: hours(48) }));
agent("a104", JSON.stringify({ Status: "idle", UpdatedAt: hours(48) }));
agent("a105", JSON.stringify({ Status: "idle", UpdatedAt: hours(1) }));
agent("a106", "TIMEOUT");
// a107 has no fixture at all, which the fake reports as AGENT_NOT_FOUND.
agent("a108", JSON.stringify({ Status: "idle", UpdatedAt: hours(48) }));
agent("a110", JSON.stringify({ Status: "idle", UpdatedAt: "the day before yesterday" }));
writeFileSync(join(FIX, "archive-fails-ws-111"), "");

const record = (n, extra = {}) => ({
  key: `owner/web#${n}`,
  repo: "owner/web",
  number: n,
  title: `probe ${n}`,
  firstSeen: hours(48),
  state: "created",
  workspaceId: `ws-${n}`,
  ...extra,
});

const intake = [
  record(100),
  record(101),
  record(102, { firstSeen: hours(1) }),
  record(103, { agentId: "a103" }),
  record(104, { agentId: "a104" }),
  record(105, { agentId: "a105" }),
  record(106, { agentId: "a106" }),
  record(107, { agentId: "a107" }),
  record(108, { agentId: "a108" }),
  record(109),
  record(110, { agentId: "a110" }),
  record(111),
  record(112, { state: "archived" }),
  record(113, { workspaceId: undefined }),
];

writeFileSync(
  join(STATE, "seen.json"),
  JSON.stringify({ intake, seenPullRequests: [], githubLastModified: null, lastSearchAt: null, lastLinearAt: null, linearSweptAt: null, linearSeen: [], linearOpen: [] }, null, 1),
);
writeFileSync(
  join(STATE, "config.json"),
  JSON.stringify({ ghPath: join(BIN, "fake-gh"), paseoPath: join(BIN, "fake-paseo"), gitPath: "git" }, null, 1),
);

const { reap } = await import("../server/reap.ts");

let fails = 0;
const check = (ok, name, detail = "") => {
  if (!ok) fails++;
  console.log(ok ? "pass" : "FAIL", name, ok ? "" : detail);
};

// Every log line the reaper writes, captured rather than printed.
const real = console.log;
let lines = [];
const capture = () => { lines = []; console.log = (m) => lines.push(String(m)); };
const release = () => { console.log = real; };
const said = (fragment) => lines.some((line) => line.includes(fragment));
const archived = () =>
  existsSync(join(FIX, "archived.log"))
    ? readFileSync(join(FIX, "archived.log"), "utf8").trim().split("\n").filter(Boolean)
    : [];
const stateOf = (n) =>
  JSON.parse(readFileSync(join(STATE, "seen.json"), "utf8")).intake.find((r) => r.number === n)?.state;

// ---- Dry run. It must decide out loud and change nothing. --------------------
capture();
await reap(true);
release();

check(said("would archive ws-101 for owner/web#101 (MERGED)"), "D1 a merged pull request past the window is named, with its state");
check(said("would archive ws-104"), "D1 and so is one whose agent stopped two days ago");
check(said("would archive ws-108 for owner/web#108 (CLOSED)"), "D1 closed is reaped on the same terms as merged");
check(!said("would archive ws-100"), "D2 an open pull request is not a candidate");
check(archived().length === 0, "D3 a dry run archived nothing", archived().join(","));
check(stateOf(101) === "created", "D4 and wrote no state");

// ---- The real run. ----------------------------------------------------------
capture();
await reap(false);
release();

const gone = archived();
check(gone.includes("ws-101"), "R1 no agent and past the window: the record's own age is the clock");
check(gone.includes("ws-104"), "R2 an idle agent last active two days ago is archived");
check(gone.includes("ws-108"), "R3 a closed pull request is archived");
check(gone.length === 3, "R4 nothing else was archived", gone.join(","));

check(stateOf(101) === "archived", "R5 the record moves to archived rather than being deleted");
check(stateOf(104) === "archived", "R5 and so does the one with an agent");
check(stateOf(100) === "created", "R6 an open pull request keeps its row untouched");

check(said("holding owner/web#102, inside the grace window"), "H1 inside 24h, with no agent, it holds");
check(said("holding owner/web#105, inside the grace window"), "H2 inside 24h by the agent's last activity, it holds");
check(said("holding owner/web#103, the agent is working"), "H3 a working agent is never interrupted");
check(said("holding owner/web#106, the agent could not be inspected"), "H4 an inspect that failed is not evidence that an agent died");
check(said("holding owner/web#107, the agent reported no last activity"), "H5 a deleted agent leaves no clock, so it holds");
check(said("holding owner/web#110, the agent's last activity is not a readable date"), "H6 an unparseable timestamp is no evidence");

check(said("cannot read owner/web#109 state"), "E1 a failed status read is logged");
check(stateOf(109) === "created", "E1 and costs that record only");
check(said("archive failed for owner/web#111"), "E2 a refused archive is logged");
check(stateOf(111) === "created", "E2 and the record is not marked archived");

check(!lines.some((l) => l.includes("#112")), "S1 an already-archived record is not reconsidered");
check(!lines.some((l) => l.includes("#113")), "S2 nor is one with no workspace");

// ---- The ledger lines. `note()` is fire and forget, so wait for them. -------
let ledger = "";
for (let i = 0; i < 40 && (ledger.match(/archived/g) ?? []).length < 3; i++) {
  await new Promise((r) => setTimeout(r, 50));
  const { readdirSync } = await import("node:fs");
  const files = existsSync(join(STATE, "ledger")) ? readdirSync(join(STATE, "ledger")) : [];
  ledger = files.map((f) => readFileSync(join(STATE, "ledger", f), "utf8")).join("");
}
check(
  ledger.includes("github owner/web#101 archived, the pull request is merged <https://github.com/owner/web/pull/101>"),
  "L1 the archive is one ledger line saying what happened and where",
  ledger,
);
check(ledger.includes("owner/web#108 archived, the pull request is closed"), "L2 closed reads as closed, not as merged");
check((ledger.match(/archived/g) ?? []).length === 3, "L3 one line per archive and no more", ledger);
check(!ledger.includes("#102") && !ledger.includes("#111"), "L4 a hold and a failure write no ledger line");

console.log(fails === 0 ? "all clear" : `${fails} failures`);
