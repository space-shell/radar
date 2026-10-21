import "./guard.mjs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { anchorsOf, anchorFault, diffAnchors } from "../server/diff.ts";
import { findingsPath } from "../server/findings.ts";
import { checkDraftAnchors, readFeedbackState, storeDraft, submitReview } from "../server/feedback.ts";
import { STATE_DIR, statePath, loadState } from "../server/state.ts";
import { anchorKey, anchorLabel, commentBody, emptyDraft } from "../shared/feedback.ts";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

// A. anchorsOf, against a patch carrying every line kind.
const patch = [
  "@@ -10,6 +10,7 @@ function one() {",
  " context ten",
  "-removed eleven",
  "+added eleven",
  "+added twelve",
  " context thirteen",
  "\\ No newline at end of file",
  "@@ -40,2 +41,2 @@ function two() {",
  "-removed forty",
  "+added forty one",
  " context forty two",
].join("\n");
const a = anchorsOf(patch);
check("A1 RIGHT lines", [...a.RIGHT].sort((x, y) => x - y), [10, 11, 12, 13, 41, 42]);
check("A2 LEFT lines", [...a.LEFT].sort((x, y) => x - y), [10, 11, 12, 40, 41]);
check("A3 no hunk header, no anchors", [...anchorsOf("+orphan line").RIGHT], []);

// B. anchorFault.
const map = new Map([["src/a.ts", a]]);
check("B1 in the diff", anchorFault(map, { path: "src/a.ts", line: 12, side: "RIGHT" }), null);
check("B2 wrong file", anchorFault(map, { path: "src/b.ts", line: 12, side: "RIGHT" }), "src/b.ts is not in the diff");
check("B3 off the diff", anchorFault(map, { path: "src/a.ts", line: 99, side: "RIGHT" }), "src/a.ts line 99 is outside the diff on the RIGHT side");
check("B4 old side holds its own numbering", anchorFault(map, { path: "src/a.ts", line: 12, side: "LEFT" }), null);
check("B5 wrong side", anchorFault(map, { path: "src/a.ts", line: 13, side: "LEFT" }), "src/a.ts line 13 is outside the diff on the LEFT side");

// C. A live read of a real pull request. GET only. The repository and the number
// come from the environment: neither belongs in the source.
const [REPO, PR] = [process.env.RADAR_PROBE_REPO, Number(process.env.RADAR_PROBE_PRS?.split(",")[0])];
if (REPO && PR) {
  const live = await diffAnchors(REPO, PR);
  const [sample] = [...live.entries()];
  console.log(`pass  C1 live diff: ${live.size} files with a patch, e.g. ${sample?.[0]} with ${sample?.[1].RIGHT.size} RIGHT anchors`);
  if (live.size === 0) { failures++; console.log("FAIL  C1 no files came back"); }
} else {
  console.log("skip  C1 live diff needs RADAR_PROBE_REPO and RADAR_PROBE_PRS");
}

// D. The draft round trip, against a repo that does not exist, so a refusal that
// failed open would 404 rather than reach a real pull request.
const key = "radar-probe/none#1";
await rm(STATE_DIR, { recursive: true, force: true });
await mkdir(STATE_DIR, { recursive: true });
const record = { key, repo: "radar-probe/none", number: 1, title: "probe", firstSeen: new Date().toISOString(), state: "created" };
await writeFile(statePath, JSON.stringify({ githubLastModified: null, lastSearchAt: null, seenPullRequests: [], intake: [record] }, null, 2));

const findings = [
  { path: "src/a.ts", line: 12, side: "RIGHT", severity: "blocking", body: "Agent wording." },
  { path: "src/a.ts", line: 13, side: "RIGHT", severity: "nit", body: "Nit wording." },
];
const fpath = findingsPath("radar-probe/none", 1);
await mkdir(dirname(fpath), { recursive: true });
await writeFile(fpath, JSON.stringify({ version: 1, key, generatedAt: "2026-10-16T09:00:00.000Z", findings, verification: [{ step: "Load the dashboard", outcome: "passed", detail: "" }] }));

const first = await readFeedbackState(key);
check("D1 findings read", first.findings.length, 2);
check("D2 empty draft by default", first.draft, emptyDraft());
check("D3 nothing submitted", first.submitted, undefined);

const draft = { ...emptyDraft(), step: 2, body: "", approve: false, uncheckedBy: anchorKey(findings[0]), comments: { [anchorKey(findings[0])]: { include: true, text: "James' own wording." } } };
check("D4 draft saved", await storeDraft(key, draft), { ok: true });
const second = await readFeedbackState(key);
check("D5 draft read back verbatim", second.draft, draft);

const checked = await checkDraftAnchors(key);
check("D6 unreadable diff reports rather than throws", checked.ok, false);
console.log(`      reason: ${checked.error}`);

check("D7 comment review with no body is refused", await submitReview(key, "COMMENT"), { ok: false, error: "GitHub refuses a comment review with no body. Write one on the verification step", excluded: [] });
check("D8 approve with the box unchecked is refused", await submitReview(key, "APPROVE"), { ok: false, error: "the approve box is unchecked", excluded: [] });

const after = await loadState();
check("D9 a refusal left the draft alone", after.intake[0].feedback.draft, draft);
check("D10 a refusal submitted nothing", after.intake[0].feedback.submitted, undefined);

// E. A submitted review is final, whatever the draft or the event says.
const submitted = { id: 1, url: "https://github.com/radar-probe/none/pull/1#pullrequestreview-1", event: "APPROVE", submittedAt: new Date().toISOString(), comments: 2 };
await writeFile(statePath, JSON.stringify({ githubLastModified: null, lastSearchAt: null, seenPullRequests: [], intake: [{ ...record, feedback: { draft: { ...draft, approve: true }, submitted } }] }, null, 2));
check("E1 the wizard reads the submitted review back", (await readFeedbackState(key)).submitted, submitted);
check("E2 a second draft save is refused", await storeDraft(key, emptyDraft()), { ok: false, error: "this review has already been submitted" });
check("E3 a second submit is refused", await submitReview(key, "APPROVE"), { ok: false, error: "this review has already been submitted", excluded: [] });
const final = await loadState();
check("E4 the submitted review is unchanged", final.intake[0].feedback.submitted, submitted);

// F. No findings file. Why there is none decides what the screen says.
await rm(fpath, { force: true });
for (const [status, want] of [["pending", true], ["running", true], ["done", true], ["skipped", false]]) {
  await writeFile(statePath, JSON.stringify({ githubLastModified: null, lastSearchAt: null, seenPullRequests: [], intake: [
    { ...record, review: { acknowledge: { status: "done" }, qa: { status }, verification: { status: "pending" }, feedback: { status: "pending" } } },
  ]}, null, 2));
  const state = await readFeedbackState(key);
  check(`F1 qa ${status}: ${want ? "reports the missing file" : "opens the walk anyway"}`, [state.error !== undefined, state.findings, state.verification], [want, [], []]);
}

// F2. A skip is not a licence to swallow a broken writer. The file is there and
// wrong, which is the case the skip must still report.
await writeFile(fpath, "{ not json");
check("F2 a corrupt file is reported even on a skipped stage", (await readFeedbackState(key)).error?.startsWith("the findings file is not valid JSON"), true);
await rm(fpath, { force: true });

await rm(STATE_DIR, { recursive: true, force: true });
// E5. The hint on the approve row names the finding, not just its file. A path
// with a colon in it is the case the old `.slice(2)` was reaching for.
check("E5 anchorLabel reverses anchorKey", [
  anchorLabel(anchorKey({ side: "RIGHT", line: 21, path: "apps/web/src/a.ts", body: "one" })),
  anchorLabel(anchorKey({ side: "LEFT", line: 4, path: "a:b/c.ts", body: "two" })),
  anchorLabel("nonsense"),
], ["apps/web/src/a.ts:21", "a:b/c.ts:4", "nonsense"]);

// AH. Two findings at one line. An agent writes as many as it has things to say
// about a line, and `side:line:path` gave all of them one key: one include
// switch, one replacement field and one React identity between them, so the
// text could not be cleared and at most one of them could be posted. This is
// the record that showed it, three findings on prometheus.ts line 4.
const crowd = [
  { path: "packages/observability/src/prometheus.ts", line: 4, side: "RIGHT", severity: "concern", body: "The Rust port hardcodes the old buckets." },
  { path: "packages/observability/src/prometheus.ts", line: 4, side: "RIGHT", severity: "nit", body: "Nothing pins the new boundaries." },
  { path: "packages/observability/src/prometheus.ts", line: 4, side: "RIGHT", severity: "nit", body: "The residual error moves rather than goes." },
];
const keys = crowd.map(anchorKey);
check("AH2 three findings at one line are three keys", new Set(keys).size, 3);
check("AH2 and they still carry the place they anchor to", keys.map(anchorLabel), [
  "packages/observability/src/prometheus.ts:4",
  "packages/observability/src/prometheus.ts:4",
  "packages/observability/src/prometheus.ts:4",
]);

// AH3. The draft that follows from it. Switching the first on and writing under
// it leaves the other two alone, which is the whole of what was broken.
const crowded = {
  ...emptyDraft(),
  comments: { [keys[0]]: { include: true, text: "James' own wording." } },
};
check("AH3 the one switched on is the only one switched on", crowd.map((f) => crowded.comments[anchorKey(f)]?.include ?? false), [true, false, false]);
check("AH3 and the wording is read back under it alone", crowd.map((f) => commentBody(f, crowded)), [
  "James' own wording.",
  "Nothing pins the new boundaries.",
  "The residual error moves rather than goes.",
]);

// AH4. Stable, and independent of where the finding sits. The key is not the
// index for exactly this reason: a QA re-run reorders the list.
check("AH4 the same finding gives the same key twice", anchorKey(crowd[1]), keys[1]);
check("AH4 reversing the list does not move a key", [...crowd].reverse().map(anchorKey), [...keys].reverse());
check("AH4 rewording is a new finding", anchorKey({ ...crowd[1], body: "Reworded." }) !== keys[1], true);
check("AH4 moving the line is too, as it always was", anchorKey({ ...crowd[1], line: 5 }) !== keys[1], true);

console.log(failures === 0 ? "\nall clear" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
