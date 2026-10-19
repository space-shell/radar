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
  console.log("skip  needs RADAR_PROBE_REPO=owner/name and RADAR_PROBE_PRS=1,2,3");
  process.exit(0);
}
const keys = (process.env.RADAR_PROBE_PRS ?? "").split(",").filter(Boolean).map(Number);
if (keys.length === 0) {
  console.log("skip  needs RADAR_PROBE_PRS=1,2,3, some pull request numbers in that repository");
  process.exit(0);
}
const intake = keys.map((n, i) => ({
  key: `${REPO}#${n}`,
  repo: REPO,
  number: n,
  title: `probe ${n}`,
  firstSeen: new Date(Date.now() - 86400000).toISOString(),
  state: "created",
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
  JSON.stringify({ intake, seenPullRequests: [], githubLastModified: null, lastSearchAt: null }, null, 1),
);

const { refreshStatuses } = await import("../server/status.ts");
const { statusNote } = await import("../shared/inbox.ts");
const { intakeRecordSchema } = await import("../shared/inbox.ts");

await refreshStatuses();

const after = JSON.parse(readFileSync(join(STATE, "seen.json"), "utf8"));
let bad = 0;
for (const r of after.intake) {
  const parsed = intakeRecordSchema.safeParse(r);
  if (!parsed.success) { bad++; console.log("SCHEMA FAIL", r.key, parsed.error.issues.map(i=>i.message).join("; ")); continue; }
  const note = statusNote(r.pr);
  console.log(
    r.key.padEnd(24),
    r.pr ? `${r.pr.state}/${r.pr.decision ?? "none"} approvedBy=[${r.pr.approvedBy}] blockedBy=[${r.pr.blockedBy}] mine=${r.pr.mine}` : "no status",
    "| badge:", note ? `${note.label} (${note.tone})` : "none",
  );
}

// The missing pull request must keep its record and simply have no status.
const missing = after.intake.find((r) => r.number === 999999);
console.log(missing && !missing.pr ? "PASS: missing PR left without a status" : "FAIL: missing PR");
console.log(bad === 0 ? "PASS: every record still parses" : `FAIL: ${bad} unreadable`);
