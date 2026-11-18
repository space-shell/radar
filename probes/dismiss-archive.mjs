import "./guard.mjs";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";

const STATE = join(process.env.HOME, ".local", "state", "radar");
const BIN = join(import.meta.dirname, "bin");
const FIX = join(process.env.HOME, "dismiss-fixtures");
process.env.PROBE_FIXTURES = FIX;

rmSync(FIX, { recursive: true, force: true });
rmSync(STATE, { recursive: true, force: true });
mkdirSync(FIX, { recursive: true });
mkdirSync(STATE, { recursive: true });

// 203's workspace refuses to archive, which is what proves the stamp is written
// after the daemon answers rather than before it is asked.
writeFileSync(join(FIX, "archive-fails-ws-203"), "");

const hours = (n) => new Date(Date.now() - n * 3_600_000).toISOString();

const record = (n, extra = {}) => ({
  key: `owner/web#${n}`,
  repo: "owner/web",
  number: n,
  title: `probe ${n}`,
  firstSeen: hours(4),
  state: "created",
  workspaceId: `ws-${n}`,
  review: { acknowledge: { status: "pending" }, qa: { status: "pending" } },
  ...extra,
});

const intake = [
  record(201),
  record(202),
  record(203),
  record(204, { workspaceId: undefined, state: "dry-run" }),
  // Settled before the workspace stamp existed: its workspace went with the
  // archive that settled it, so nothing may try again.
  record(205, {
    state: "archived",
    dismissedAt: hours(1),
    archivedAt: hours(1),
  }),
  record(206, { state: "orphaned", agentId: "a206" }),
  // Dismissed, archived, and now wanted back. Retry is the only control that
  // can build a workspace, which is what makes `orphaned` the right landing
  // state for a record whose workspace went with its dismissal.
  record(207, {
    state: "orphaned",
    dismissedAt: hours(1),
    workspaceId: "ws-old-207",
    workspaceArchivedAt: hours(1),
  }),
  // Dismissed before a dismissal archived anything, and marked as such at the
  // first start after it did. The press never agreed to lose this workspace, so
  // the backstop must not spend it.
  record(208, {
    dismissedAt: hours(1),
    workspaceId: "ws-208",
    keptWorkspace: true,
  }),
];

writeFileSync(
  join(STATE, "seen.json"),
  JSON.stringify(
    {
      intake,
      seenPullRequests: [],
      githubLastModified: null,
      lastSearchAt: null,
      lastLinearAt: null,
      linearSweptAt: null,
      linearSeen: [],
      linearOpen: [],
    },
    null,
    1,
  ),
);
writeFileSync(
  join(STATE, "config.json"),
  JSON.stringify(
    {
      ghPath: join(BIN, "fake-gh"),
      paseoPath: join(BIN, "fake-paseo"),
      gitPath: "git",
    },
    null,
    1,
  ),
);

const { dismissRecord, retryRecord } = await import("../server/actions.ts");
const { reap } = await import("../server/reap.ts");
const { recordMeta } = await import("../shared/format.ts");

let fails = 0;
const check = (ok, name, detail = "") => {
  if (!ok) fails++;
  console.log(ok ? "pass" : "FAIL", name, ok ? "" : detail);
};

const real = console.log;
let lines = [];
const capture = () => {
  lines = [];
  console.log = (m) => lines.push(String(m));
};
const release = () => {
  console.log = real;
};
const said = (fragment) => lines.some((line) => line.includes(fragment));

const archived = () =>
  existsSync(join(FIX, "archived.log"))
    ? readFileSync(join(FIX, "archived.log"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
    : [];
const rowOf = (n) =>
  JSON.parse(readFileSync(join(STATE, "seen.json"), "utf8")).intake.find(
    (r) => r.number === n,
  );

// ---- AT1. The press closes the door. ----------------------------------------
capture();
const first = await dismissRecord("owner/web#201", true);
release();

check(first.ok === true, "AT1 the dismissal lands");
check(
  first.warning === undefined,
  "AT1 and says nothing went wrong",
  String(first.warning),
);
check(
  archived().includes("ws-201"),
  "AT1 the workspace is archived at the press, not on a later tick",
  archived().join(","),
);
check(Boolean(rowOf(201).dismissedAt), "AT1 the row is down");
check(
  typeof rowOf(201).workspaceArchivedAt === "string",
  "AT1 and carries the stamp saying its workspace went with it",
);
check(
  rowOf(201).state === "created",
  "AT2 the record's own state is untouched: the pull request did not settle, the row was put aside",
);
check(
  rowOf(201).archivedAt === undefined,
  "AT2 so the settle stamp stays clear and the wake branch cannot read it as a reopened pull request",
);

// ---- AT3. Restore brings the row back and nothing else. ---------------------
capture();
const back = await dismissRecord("owner/web#201", false);
release();

check(
  back.ok === true && back.warning === undefined,
  "AT3 restore lands clean",
);
check(rowOf(201).dismissedAt === null, "AT3 the row is back");
check(
  typeof rowOf(201).workspaceArchivedAt === "string",
  "AT3 and the workspace is still gone: there is no unarchive to call",
);
check(
  archived().filter((id) => id === "ws-201").length === 1,
  "AT3 restore archived nothing and un-archived nothing",
  archived().join(","),
);

// A second dismissal must not archive an archived workspace.
capture();
await dismissRecord("owner/web#201", true);
release();
check(
  archived().filter((id) => id === "ws-201").length === 1,
  "AT3 nor does dismissing it again",
  archived().join(","),
);

// ---- AT4. What the screens say. ---------------------------------------------
check(
  recordMeta(rowOf(201)).includes("workspace archived"),
  "AT4 the one state summary says the workspace is gone, on the row and the footer alike",
  recordMeta(rowOf(201)),
);
check(
  !recordMeta(rowOf(202)).includes("workspace archived"),
  "AT4 and says nothing of the sort about a live one",
  recordMeta(rowOf(202)),
);

// ---- AT5. A refused archive. ------------------------------------------------
capture();
const refused = await dismissRecord("owner/web#203", true);
release();

check(
  refused.ok === true,
  "AT5 the row still goes down when the daemon refuses the archive",
);
check(
  Boolean(rowOf(203).dismissedAt),
  "AT5 and the press is durable: the write happens before the archive is asked for",
);
check(
  String(refused.warning).includes("the workspace could not be archived"),
  "AT5 the refusal is raised rather than swallowed",
  String(refused.warning),
);
check(
  rowOf(203).workspaceArchivedAt === undefined,
  "AT5 nothing is stamped, so the record stays eligible for the next pass",
);
check(
  said("archive failed for owner/web#203"),
  "AT5 and it is logged saying it will try again",
);

// ---- AT6. A record with no workspace. ---------------------------------------
capture();
const empty = await dismissRecord("owner/web#204", true);
release();
check(
  empty.ok === true && empty.warning === undefined,
  "AT6 a dry-run row has no workspace, so its dismissal is clean",
  String(empty.warning),
);
check(
  rowOf(204).workspaceArchivedAt === undefined,
  "AT6 and nothing is stamped about a workspace that never existed",
);

// ---- AT7. The reaper is the backstop, and only that. ------------------------
capture();
await reap(true);
release();
check(
  said("would archive ws-203 for owner/web#203 (dismissed)"),
  "AT7 a dry run names the dismissal it would finish",
);
check(
  !said("would archive ws-201"),
  "AT7 and leaves the one already stamped alone",
);
check(
  !said("#205"),
  "AT7 nor does it reconsider a row settled before the stamp existed",
);
// 202 is undismissed, so it takes the old route: `gh pr view`, which has no
// fixture here and fails. What matters is that the dismissed branch skipped it.
check(
  !said("would archive ws-202"),
  "AT7 an undismissed row is not archived by the dismissal branch",
);
check(
  said("cannot read owner/web#202 state"),
  "AT7 it went down the merged-or-closed route instead",
);
check(
  !said("would archive ws-208"),
  "AC-AT8 a row dismissed before this existed keeps its workspace",
);

rmSync(join(FIX, "archive-fails-ws-203"));
capture();
await reap(false);
release();

check(
  archived().includes("ws-203"),
  "AT8 the next pass finishes the archive the press could not",
  archived().join(","),
);
check(
  typeof rowOf(203).workspaceArchivedAt === "string",
  "AT8 and stamps it this time",
);
check(
  rowOf(203).state === "created",
  "AT8 without settling a pull request that is still open",
);
check(
  !archived().includes("ws-205"),
  "AT8 and the legacy archived row is never asked a second time",
  archived().join(","),
);

// ---- AT9. An orphan's workspace goes too. -----------------------------------
capture();
await dismissRecord("owner/web#206", true);
release();
check(
  archived().includes("ws-206"),
  "AT9 dismissing an orphan archives its workspace: the reaper's created-only rule is not the press's rule",
  archived().join(","),
);

// ---- AT11. Retry is the way back, and it spends the stamp. ------------------
writeFileSync(
  join(FIX, "agents.json"),
  JSON.stringify([{ id: "a207", cwd: "/w/207", status: "idle" }]),
);
writeFileSync(
  join(FIX, "workspaces.json"),
  JSON.stringify([{ workspaceId: "ws-new-207", cwd: "/w/207" }]),
);

capture();
const retried = await retryRecord("owner/web#207");
release();

check(
  retried.ok === true,
  "AT11 a record whose workspace was archived on dismissal is retryable",
  String(retried.error),
);
check(
  rowOf(207).workspaceId === "ws-new-207",
  "AT11 and comes back pointing at the new workspace",
);
check(
  rowOf(207).workspaceArchivedAt === undefined,
  "AT11 the stamp is spent, so the row stops reading `workspace archived` over a live worktree",
);
check(
  recordMeta(rowOf(207)).includes("workspace archived") === false,
  "AT11 which is what the summary line reads from",
);

// ---- AT10. The ledger. `note()` is fire and forget, so wait for it. ---------
let ledger = "";
for (let i = 0; i < 40 && !ledger.includes("the row was dismissed"); i++) {
  await new Promise((r) => setTimeout(r, 50));
  const dir = join(STATE, "ledger");
  const files = existsSync(dir) ? readdirSync(dir) : [];
  ledger = files.map((f) => readFileSync(join(dir, f), "utf8")).join("");
}
check(
  ledger.includes("owner/web#201 dismissed <"),
  "AT10 the dismissal is its own ledger line",
);
check(
  ledger.includes("owner/web#201 archived, the row was dismissed <"),
  "AT10 and the archive is a second, saying why the workspace went",
);
check(
  ledger.includes("owner/web#201 restored <"),
  "AT10 the restore is recorded as what it is: the row came back",
);
check(
  !ledger.includes(
    "#203 archived, the row was dismissed <https://github.com/owner/web/pull/203>\n\n- github owner/web#203 archived",
  ),
  "AT10 one archive line per archive, not one per attempt",
);

console.log(fails === 0 ? "all clear" : `${fails} failures`);

// ---- AC-AT8. The marker is one-off, and only marks what it must. ------------
{
  const { keepDismissedWorkspaces } = await import("../server/archive.ts");

  capture();
  await keepDismissedWorkspaces();
  release();
  check(
    rowOf(201).keptWorkspace === undefined,
    "AC-AT8 a row dismissed after this shipped is never marked",
  );
  check(
    rowOf(208).keptWorkspace === true,
    "AC-AT8 and the row marked before it stays marked",
  );

  const { loadState } = await import("../server/state.ts");
  const state = await loadState();
  check(
    state.backfill?.dismissedWorkspaces === 1,
    "AC-AT8 the pass records that it ran, so it never runs twice",
  );

  capture();
  await keepDismissedWorkspaces();
  release();
  check(
    !said("keeping the workspaces of"),
    "AC-AT8 and a second call does nothing at all",
  );
}
