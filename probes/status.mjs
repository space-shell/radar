import "./guard.mjs";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STATE = join(process.env.HOME, ".local", "state", "radar");
mkdirSync(STATE, { recursive: true });

// This probe reads the real GitHub API, so it needs a repository the token can
// see and some pull request numbers in it. Both come from the environment: a
// repository name is one machine's fact, and no fact like that is in the source.
const REPO = process.env.RADAR_PROBE_REPO;
if (!REPO) {
  console.log(
    "skip  needs RADAR_PROBE_REPO=owner/name and RADAR_PROBE_PRS=1,2,3",
  );
  process.exit(0);
}
const keys = (process.env.RADAR_PROBE_PRS ?? "")
  .split(",")
  .filter(Boolean)
  .map(Number);
if (keys.length === 0) {
  console.log(
    "skip  needs RADAR_PROBE_PRS=1,2,3, some pull request numbers in that repository",
  );
  process.exit(0);
}
// Every record carries a round submitted yesterday, so `lastRoundAt` is set and
// the first observation guard is the only thing standing between the sweep and a
// `headMovedAt` stamp. Without a round the stamp is impossible either way and
// the check below would pass on a plugin that had lost the guard entirely.
const roundAt = new Date(Date.now() - 86400000).toISOString();
const intake = keys.map((n, i) => ({
  key: `${REPO}#${n}`,
  repo: REPO,
  number: n,
  title: `probe ${n}`,
  firstSeen: new Date(Date.now() - 86400000).toISOString(),
  state: "created",
  feedback: {
    draft: { comments: {}, body: "", approve: true, step: 0 },
    rounds: [
      {
        id: 1000 + n,
        url: `https://github.com/${REPO}/pull/${n}#pullrequestreview-${1000 + n}`,
        event: "COMMENT",
        submittedAt: roundAt,
        comments: 0,
        anchors: [],
      },
    ],
  },
  ...(i === 0 ? { dismissedAt: new Date().toISOString() } : {}),
}));
// A number that does not exist, to prove one dead alias costs only itself.
intake.push({
  key: `${REPO}#999999`,
  repo: REPO,
  number: 999999,
  title: "probe missing",
  firstSeen: new Date().toISOString(),
  state: "created",
});
writeFileSync(
  join(STATE, "seen.json"),
  JSON.stringify(
    {
      intake,
      seenPullRequests: [],
      githubLastModified: null,
      lastSearchAt: null,
    },
    null,
    1,
  ),
);

const { refreshStatuses } = await import("../server/status.ts");
const { statusNote } = await import("../shared/inbox.ts");
const { intakeRecordSchema } = await import("../shared/inbox.ts");

const read = () => JSON.parse(readFileSync(join(STATE, "seen.json"), "utf8"));

await refreshStatuses();

const after = read();
let bad = 0;
for (const r of after.intake) {
  const parsed = intakeRecordSchema.safeParse(r);
  if (!parsed.success) {
    bad++;
    console.log(
      "SCHEMA FAIL",
      r.key,
      parsed.error.issues.map((i) => i.message).join("; "),
    );
    continue;
  }
  const note = statusNote(r.pr);
  console.log(
    r.key.padEnd(24),
    r.pr
      ? `${r.pr.state}/${r.pr.decision ?? "none"} approvedBy=[${r.pr.approvedBy}] blockedBy=[${r.pr.blockedBy}] mine=${r.pr.mine}`
      : "no status",
    "| badge:",
    note ? `${note.label} (${note.tone})` : "none",
  );
}

// The missing pull request must keep its record and simply have no status.
const missing = after.intake.find((r) => r.number === 999999);
console.log(
  missing && !missing.pr
    ? "PASS: missing PR left without a status"
    : "FAIL: missing PR",
);
console.log(
  bad === 0 ? "PASS: every record still parses" : `FAIL: ${bad} unreadable`,
);

// AQ1, the guard, proved against the live API rather than against a fixture.
// Sixty records on disk carry no sha, and without the first observation guard
// every one of them would stamp `headMovedAt` on the first tick after this
// shipped: a screen of dots saying everything moved when nothing did. Nobody
// pushes anything here. The sweep is simply run twice.
const live = after.intake.filter((r) => r.pr);
const stamped = live.filter((r) => r.pr.headMovedAt);
console.log(
  live.length > 0 && live.every((r) => r.pr.headSha)
    ? `PASS: the first sweep recorded a head on all ${live.length}`
    : "FAIL: the first sweep recorded no head",
);
console.log(
  stamped.length === 0
    ? "PASS: and stamped no movement, having had no sha to compare"
    : `FAIL: the first sweep stamped ${stamped.map((r) => r.key).join(", ")}`,
);

await refreshStatuses();

const twice = read();
const held = new Map(after.intake.map((r) => [r.key, r.pr?.headSha]));
const second = twice.intake.filter((r) => r.pr);
console.log(
  second.every((r) => r.pr.headSha === held.get(r.key))
    ? "PASS: the second sweep read the same heads"
    : "FAIL: a head changed between two sweeps a second apart",
);
const moved = second.filter((r) => r.pr.headMovedAt);
console.log(
  moved.length === 0
    ? "PASS: and stamped no movement, the shas being equal"
    : `FAIL: the second sweep stamped ${moved.map((r) => r.key).join(", ")}`,
);
console.log(
  second.every(
    (r) =>
      Date.parse(r.pr.checkedAt) >=
      Date.parse(after.intake.find((p) => p.key === r.key).pr.checkedAt),
  )
    ? "PASS: the read itself is dated forward, which is the field that does move"
    : "FAIL: checkedAt went backwards",
);
