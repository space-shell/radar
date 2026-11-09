import "./guard.mjs";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// Which states a Retry press is allowed to start from, and what a refused press
// leaves behind. The press is the only control that can rebuild a session, so a
// state it cannot start from is a state nothing can leave. Group AR.
const STATE = join(process.env.HOME, ".local", "state", "radar");
const BIN = join(import.meta.dirname, "bin");
const FIX = join(process.env.HOME, "retry-fixtures");
process.env.PROBE_FIXTURES = FIX;

rmSync(FIX, { recursive: true, force: true });
mkdirSync(FIX, { recursive: true });
mkdirSync(STATE, { recursive: true });

const record = (n, state) => ({
  key: `owner/web#${n}`,
  repo: "owner/web",
  number: n,
  title: `probe ${n}`,
  firstSeen: new Date().toISOString(),
  state,
});

writeFileSync(
  join(STATE, "seen.json"),
  JSON.stringify(
    {
      intake: [
        record(300, "dry-run"),
        record(301, "created"),
        record(302, "archived"),
        record(303, "orphaned"),
      ],
      seenPullRequests: ["owner/web#300"],
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
// No checkout roots, so `discoverCheckouts` maps nothing and every press that
// clears the gate stops at the same named place rather than launching anything.
writeFileSync(
  join(STATE, "config.json"),
  JSON.stringify(
    {
      ghPath: join(BIN, "fake-gh"),
      paseoPath: join(BIN, "fake-paseo"),
      gitPath: "git",
      checkoutRoots: [],
    },
    null,
    1,
  ),
);

const { retryRecord } = await import("../server/actions.ts");

let fails = 0;
const check = (ok, name, detail = "") => {
  if (!ok) fails++;
  console.log(ok ? "pass" : "FAIL", name, ok ? "" : detail);
};
const rowOf = (n) =>
  JSON.parse(readFileSync(join(STATE, "seen.json"), "utf8")).intake.find(
    (r) => r.number === n,
  );

// ---- AR1. A dry run is not a dead end. --------------------------------------
// `intake` is the only writer of `dry-run` and the key is in `seenPullRequests`
// by the time it is written, so turning dry run off moves nothing and `addByLink`
// answers `already: "present"`. Retry is the only way out, and before this the
// gate refused it.
const dry = await retryRecord("owner/web#300");
check(
  dry.error !== "cannot retry a dry-run record",
  "AR1 a dry-run record is past the gate",
  String(dry.error),
);
check(
  dry.error === "no local checkout for owner/web",
  "AR1b and stops where any other unmapped press stops",
  String(dry.error),
);
check(
  rowOf(300).state === "unmapped",
  "AR1c leaving a state the row can act on again",
  rowOf(300).state,
);
check(
  rowOf(300).lastError === "no local checkout for owner/web",
  "AR1d with the reason on the record, which is what draws the glyph",
  String(rowOf(300).lastError),
);

// ---- AR2. And the two states Retry still refuses. ---------------------------
// `created` has an agent already; `archived` is a record James is done with, and
// a reopened pull request is brought back by the reconciler rather than by a
// Retry control standing on every finished row.
const made = await retryRecord("owner/web#301");
check(
  made.error === "cannot retry a created record",
  "AR2 a record that already has an agent is refused",
  String(made.error),
);
check(rowOf(301).state === "created", "AR2b and is not moved by the refusal");
check(rowOf(301).lastError === undefined, "AR2c nor marked as a fault");

const done = await retryRecord("owner/web#302");
check(
  done.error === "cannot retry a archived record",
  "AR2d an archived record is refused too",
  String(done.error),
);
check(rowOf(302).state === "archived", "AR2e and stays settled");

// ---- The states that were always retryable still are. -----------------------
const lost = await retryRecord("owner/web#303");
check(
  lost.error === "no local checkout for owner/web",
  "AR2f an orphan reaches the same place it always did",
  String(lost.error),
);

// A key nobody holds is refused before anything is read.
const absent = await retryRecord("owner/web#999");
check(
  absent.error === "no such record",
  "AR2g an unknown key is refused",
  String(absent.error),
);

rmSync(FIX, { recursive: true, force: true });
console.log(fails === 0 ? "\nall clear" : `\n${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
