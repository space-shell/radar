import "./guard.mjs";

// Live, like `probes/status.mjs`: the question is whether GitHub's compare
// endpoint answers in the shape `anchorsOf` was written for, and only GitHub can
// answer that. A fixture would prove the parser against itself.
const REPO = process.env.RADAR_PROBE_REPO;
if (!REPO) {
  console.log("skip  needs RADAR_PROBE_REPO=owner/name");
  process.exit(0);
}

const { call } = await import("../server/api.ts");
const { compareAnchors } = await import("../server/diff.ts");

const { status, body } = await call(
  `/repos/${REPO}/commits?per_page=20`,
  "GET",
);
if (status !== 200 || !Array.isArray(body) || body.length < 2) {
  console.log(
    `FAIL: could not list commits in ${REPO}, GitHub returned ${status}`,
  );
  process.exit(1);
}
const head = body[0].sha;
const base = body[Math.min(5, body.length - 1)].sha;
const expected = Math.min(5, body.length - 1);

const say = (ok, pass, fail) =>
  console.log(ok ? `PASS: ${pass}` : `FAIL: ${fail}`);

// Forward. This is the range a re-review actually reads.
const range = await compareAnchors(REPO, base, head);
say(
  range.fault === null,
  "a real range carries no fault",
  `the range faulted: ${range.fault}`,
);
say(
  range.commits === expected,
  `${range.commits} commits counted, matching the ${expected} walked back`,
  `counted ${range.commits} commits, expected ${expected}`,
);
say(
  range.files.length > 0,
  `${range.files.length} files in the range`,
  "the range named no files",
);

// The whole point of the second entry point: `patch` is the same field on
// `/compare` as on `/pulls/{n}/files`, so one parser reads both. A range whose
// files carry no anchors is a review that can post no comment.
const parsed = [...range.anchors.entries()];
say(
  parsed.length > 0,
  `${parsed.length} of them parsed into anchors`,
  "no file in the range parsed into a single anchor",
);
const lines = parsed.flatMap(([, a]) => [...a.RIGHT, ...a.LEFT]);
say(
  lines.length > 0 && lines.every((line) => Number.isInteger(line) && line > 0),
  `${lines.length} commentable lines, every one a positive integer`,
  "an anchor came back as something other than a line number",
);
// A file GitHub sent without a patch is binary or too large. It must be named
// and carry nothing, rather than be dropped or carry an empty anchor set that
// reads as "nothing is commentable here" for the wrong reason.
say(
  parsed.every(([path]) => range.files.includes(path)),
  "every parsed file is one the range named",
  "a parsed file is missing from the file list",
);

// Reversed. Whatever GitHub calls it, the one thing that must not come back is a
// range an agent could be handed as "the new commits".
const back = await compareAnchors(REPO, head, base);
say(
  back.fault !== null || back.commits === 0,
  back.fault
    ? `reversed is a fault: ${back.fault}`
    : "reversed is zero commits, which the caller reads as nothing new",
  `reversed came back as ${back.commits} commits with no fault`,
);

// Identical. The round has gone out against this very head, which is the sweep
// right after a submit and the commonest case of all.
const same = await compareAnchors(REPO, head, head);
say(
  same.fault === null && same.commits === 0 && same.files.length === 0,
  "an unmoved head is zero commits and no fault",
  `an unmoved head gave ${same.commits} commits, fault ${same.fault}`,
);

// A base GitHub no longer holds. The force push case, reached deterministically
// rather than by waiting for one: a named sentence, and never a throw, because
// the caller's answer is to read the whole diff and say why.
const dead = await compareAnchors(
  REPO,
  "0000000000000000000000000000000000000001",
  head,
);
say(
  dead.fault === "GitHub no longer holds one of the two commits",
  "a dead base is a named fault",
  `a dead base gave fault ${JSON.stringify(dead.fault)}`,
);
say(
  dead.files.length === 0 && dead.commits === 0,
  "and carries no half range beside it",
  "a faulted range carried files or commits",
);
