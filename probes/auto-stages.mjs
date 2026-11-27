import "./guard.mjs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * The first summary starts QA, and acts on its verification decision, on its
 * own and once each, when the switches are on. Groups AY and AZ.
 *
 * The fake daemon's agent can be held busy, which is how a run is proved to be
 * queued without its body ever running: the body fetches the pull request with
 * `gh`, and nothing here is about that. A queued claim is the whole of what the
 * automatic path does; everything after it is the press's own path, which the
 * queued-stage probe already covers.
 */
const { STATE_DIR, statePath, loadState } = await import("../server/state.ts");
const { __setSettingsForTest } = await import("../server/settings.ts");
const { radarSettings } = await import("../shared/settings.ts");
const { collectSummaries, runSummary, summarising, summaryPath } =
  await import("../server/summary.ts");
const {
  NOT_REQUIRED_NOTE,
  applyQaDecision,
  applyVerificationDecision,
  qaDecision,
  startDecidedStages,
  verificationDecision,
} = await import("../server/auto-stages.ts");
const { runQa } = await import("../server/qa.ts");
const { ledgerPath } = await import("../server/ledger.ts");
const { lanesBlocked, stopLanes } = await import("../server/queue.ts");

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`,
  );
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (predicate, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await predicate()) return true;
    await sleep(25);
  }
  return false;
};

const settings = (autoVerify, autoQa = false) =>
  __setSettingsForTest(
    radarSettings.schema.parse({ dryRun: false, autoVerify, autoQa }),
  );

const KEY = "o/r#1";
const base = () => ({
  key: KEY,
  repo: "o/r",
  number: 1,
  title: "t",
  firstSeen: "2026-11-01T00:00:00Z",
  state: "created",
  agentId: "agent-1",
});
const summary = (required) => ({
  headline: "h",
  changes: ["c"],
  risk: "r",
  scope: "s",
  ...(required === undefined
    ? {}
    : {
        verification: {
          required,
          steps: required ? "Open the page." : "Nothing to run.",
        },
      }),
  generatedAt: "2026-11-01T00:00:00Z",
});

// AY1. The rule, as a table. Each row is the record after its summary landed.
const on = { enabled: true, first: true };
const rows = [
  [
    "required, first, switch on",
    { ...base(), summary: summary(true) },
    on,
    "run",
  ],
  [
    "not required, first, switch on",
    { ...base(), summary: summary(false) },
    on,
    "skip",
  ],
  [
    "no decision in the summary",
    { ...base(), summary: summary(undefined) },
    on,
    null,
  ],
  [
    "switch off",
    { ...base(), summary: summary(true) },
    { enabled: false, first: true },
    null,
  ],
  [
    "a second summary",
    { ...base(), summary: summary(true) },
    { enabled: true, first: false },
    null,
  ],
  [
    "already decided once",
    {
      ...base(),
      summary: summary(true),
      autoVerification: { decidedAt: "x", required: true, actedAt: "x" },
    },
    on,
    null,
  ],
  [
    "dismissed",
    { ...base(), summary: summary(true), dismissedAt: "x" },
    on,
    null,
  ],
  [
    "no agent",
    { ...base(), agentId: undefined, summary: summary(true) },
    on,
    null,
  ],
  [
    "not created",
    { ...base(), state: "failed", summary: summary(true) },
    on,
    null,
  ],
  [
    "verification already queued",
    {
      ...base(),
      summary: summary(true),
      review: { verification: { status: "running", queuedAt: "x" } },
    },
    on,
    null,
  ],
  [
    "verification already done",
    {
      ...base(),
      summary: summary(true),
      review: { verification: { status: "done", endedAt: "x" } },
    },
    on,
    null,
  ],
  [
    "verification reopened after a run",
    {
      ...base(),
      summary: summary(true),
      review: { verification: { status: "pending", endedAt: "x" } },
    },
    on,
    null,
  ],
  [
    "verification skipped by hand",
    {
      ...base(),
      summary: summary(false),
      review: { verification: { status: "skipped", endedAt: "x" } },
    },
    on,
    null,
  ],
  [
    "QA still pending does not hold it back",
    {
      ...base(),
      summary: summary(true),
      review: { qa: { status: "pending" } },
    },
    on,
    "run",
  ],
];
for (const [name, record, context, want] of rows)
  check(`AY1 ${name}`, verificationDecision(record, context), want);

// AY2. What each decision writes.
{
  const skip = { ...base(), summary: summary(false) };
  applyVerificationDecision(skip, "skip", "T");
  check("AY2 a skip is carried out at once", skip.review.verification, {
    status: "skipped",
    endedAt: "T",
    note: NOT_REQUIRED_NOTE,
  });
  check("AY2 and spends the decision", skip.autoVerification, {
    decidedAt: "T",
    required: false,
    actedAt: "T",
  });
  check("AY2 leaving QA where it was", skip.review.qa, { status: "pending" });

  const run = { ...base(), summary: summary(true) };
  applyVerificationDecision(run, "run", "T");
  check("AY2 a run is recorded, not sent", run.autoVerification, {
    decidedAt: "T",
    required: true,
  });
  check("AY2 and the stage is untouched", run.review, undefined);

  const none = { ...base() };
  applyVerificationDecision(none, null, "T");
  check("AY2 no decision writes nothing", none, base());
}

// The store, through the sweep that takes intake's file.
await rm(STATE_DIR, { recursive: true, force: true });
await mkdir(STATE_DIR, { recursive: true });
const seed = async (extra = {}) =>
  writeFile(
    statePath,
    JSON.stringify(
      { seenPullRequests: [KEY], intake: [{ ...base(), ...extra }] },
      null,
      2,
    ),
  );
const record = async () => (await loadState()).intake[0];
const drop = async (required) => {
  const out = summaryPath("o/r", 1);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(
    out,
    JSON.stringify({ version: 1, key: KEY, ...summary(required) }),
  );
};

// AY3. Not required: skipped in the same write as the summary.
settings(true);
await seed();
await drop(false);
await collectSummaries();
{
  const r = await record();
  check("AY3 the summary is stored", r.summary?.verification?.required, false);
  check(
    "AY3 verification is skipped",
    [r.review?.verification?.status, r.review?.verification?.note],
    ["skipped", NOT_REQUIRED_NOTE],
  );
  check(
    "AY3 the decision is spent",
    [r.autoVerification?.required, Boolean(r.autoVerification?.actedAt)],
    [false, true],
  );
  const ledger = await until(async () =>
    (await readFile(ledgerPath(new Date()), "utf8").catch(() => "")).includes(
      "verification skipped: the summary says it is not required",
    ),
  );
  check("AY3 the ledger says why", ledger, true);
}

// AY4. Required: recorded and waiting, because the sweep holds no handle.
await seed();
await drop(true);
await collectSummaries();
{
  const r = await record();
  check(
    "AY4 the run is decided",
    [r.autoVerification?.required, r.autoVerification?.actedAt],
    [true, undefined],
  );
  check("AY4 and nothing is claimed yet", r.review?.verification, undefined);
}

// AY5. Off is off: the summary lands and the stage stays a press.
settings(false);
await seed();
await drop(true);
await collectSummaries();
{
  const r = await record();
  check(
    "AY5 the summary still lands with the switch off",
    r.summary?.verification?.required,
    true,
  );
  check(
    "AY5 and no decision is taken",
    [r.autoVerification, r.review],
    [undefined, undefined],
  );
}

// The fake daemon. One agent, which can be held busy so a queued claim stays
// queued and its body, which would reach for gh, never runs.
let busy = false;
let sent = [];
let writeOnRun = null;
const paseo = {
  agents: {
    ref: (id) => ({
      archivedAt: null,
      status: "idle",
      get activeTurn() {
        return busy ? { id: "turn" } : null;
      },
      refresh: async () => ({}),
      run: async (prompt) => {
        sent.push({ id, prompt });
        if (writeOnRun !== null) await drop(writeOnRun);
        // The turn that just ended leaves the agent busy with something else,
        // which is James typing. A verification queued now has to wait.
        busy = true;
        return { status: "idle", lastMessage: "ok" };
      },
    }),
  },
};

// AY6. The sweep sends a decided run once, through the press's own claim.
settings(true);
await seed({
  summary: summary(true),
  autoVerification: { decidedAt: "T", required: true },
});
busy = true;
check("AY6 the sweep sends one", await startDecidedStages(paseo), 1);
{
  const r = await record();
  check(
    "AY6 the stage is queued, as a press would leave it",
    [r.review?.verification?.status, Boolean(r.review?.verification?.queuedAt)],
    ["running", true],
  );
  check(
    "AY6 the decision is spent",
    Boolean(r.autoVerification?.actedAt),
    true,
  );
}
check("AY6 a second sweep sends nothing", await startDecidedStages(paseo), 0);
check("AY6 and no turn was sent while the agent was busy", sent.length, 0);
stopLanes("AY6 is done");
await sleep(50);

// AY7. A decision that no longer applies is spent, not kept for later.
await seed({
  summary: summary(true),
  dismissedAt: "2026-11-02T00:00:00Z",
  autoVerification: { decidedAt: "T", required: true },
});
check("AY7 a dismissed record is not sent", await startDecidedStages(paseo), 0);
{
  const r = await record();
  check(
    "AY7 its decision is spent all the same",
    Boolean(r.autoVerification?.actedAt),
    true,
  );
  check("AY7 and its stage is untouched", r.review, undefined);
}
await seed({
  summary: summary(true),
  review: { verification: { status: "done", endedAt: "T" } },
  autoVerification: { decidedAt: "T", required: true },
});
check(
  "AY7 a stage verified by hand is not sent",
  await startDecidedStages(paseo),
  0,
);
check(
  "AY7 and keeps its result",
  (await record()).review.verification.status,
  "done",
);

// AY8. A summary press on a record with none acts once the turn is over.
const settled = async () => until(async () => summarising().length === 0);
busy = false;
sent = [];
writeOnRun = true;
await seed();
check("AY8 the press is taken", (await runSummary(KEY, paseo)).ok, true);
await settled();
check(
  "AY8 the summary turn went out, alone",
  sent.map((s) => s.prompt.includes("summary file")),
  [true],
);
check(
  "AY8 verification is queued behind the agent",
  // In the lane as well as claimed, or the stop below can run between the two
  // and miss it.
  await until(
    async () =>
      (await record()).review?.verification?.status === "running" &&
      lanesBlocked() === 1,
  ),
  true,
);
{
  const r = await record();
  check(
    "AY8 and the decision is spent",
    Boolean(r.autoVerification?.actedAt),
    true,
  );
}
stopLanes("AY8 is done");
await sleep(50);

// AY9. A re-summary never acts, whatever it says, on a stage still untouched.
busy = false;
sent = [];
writeOnRun = true;
await seed({ summary: summary(false) });
await runSummary(KEY, paseo);
await settled();
{
  const r = await record();
  check("AY9 the new summary is stored", r.summary.verification.required, true);
  check(
    "AY9 and nothing is decided from it",
    [r.autoVerification, r.review],
    [undefined, undefined],
  );
}

// AY10. Construction: the automatic path reaches verification and nothing that
// writes to GitHub. AC-I2.
{
  const source = await readFile(
    join(import.meta.dirname, "../server/auto-stages.ts"),
    "utf8",
  );
  const code = source
    .replace(/\/\*\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const reaches = [
    "onClaim",
    "addEyes",
    "reactions",
    "removeEyes",
    "submitReview",
    "gh(",
  ].filter((name) => code.includes(name));
  check("AY10 the automatic path names nothing that posts", reaches, []);
  check(
    "AY10 and it starts QA and verification only",
    [...new Set(code.match(/run[A-Z]\w*\(/g) ?? [])].sort(),
    ["runQa(", "runVerification("],
  );
  const qaCalls = code.match(/runQa\([^)]*\)/g) ?? [];
  check(
    "AZ3 and every QA it starts is automatic, which is QA without its eyes",
    [qaCalls.length > 0, qaCalls.every((call) => /automatic: true/.test(call))],
    [true, true],
  );
}

// AZ1. QA's rule, as a table. The summary's contents play no part in it.
const qaRows = [
  ["first summary, switch on", { ...base(), summary: summary(true) }, on, true],
  [
    "whatever the summary says about verification",
    { ...base(), summary: summary(false) },
    on,
    true,
  ],
  [
    "a summary with no verification decision",
    { ...base(), summary: summary(undefined) },
    on,
    true,
  ],
  [
    "switch off",
    { ...base(), summary: summary(true) },
    { enabled: false, first: true },
    false,
  ],
  [
    "a second summary",
    { ...base(), summary: summary(true) },
    { enabled: true, first: false },
    false,
  ],
  [
    "already decided once",
    {
      ...base(),
      summary: summary(true),
      automaticQa: { decidedAt: "x", actedAt: "x" },
    },
    on,
    false,
  ],
  [
    "dismissed",
    { ...base(), summary: summary(true), dismissedAt: "x" },
    on,
    false,
  ],
  [
    "no agent",
    { ...base(), agentId: undefined, summary: summary(true) },
    on,
    false,
  ],
  [
    "not created",
    { ...base(), state: "failed", summary: summary(true) },
    on,
    false,
  ],
  [
    "QA already queued",
    {
      ...base(),
      summary: summary(true),
      review: { qa: { status: "running", queuedAt: "x" } },
    },
    on,
    false,
  ],
  [
    "QA already done",
    {
      ...base(),
      summary: summary(true),
      review: { qa: { status: "done", endedAt: "x" } },
    },
    on,
    false,
  ],
  [
    "QA reopened after a run",
    {
      ...base(),
      summary: summary(true),
      review: { qa: { status: "pending", endedAt: "x" } },
    },
    on,
    false,
  ],
  [
    "QA skipped by hand",
    {
      ...base(),
      summary: summary(true),
      review: { qa: { status: "skipped", endedAt: "x" } },
    },
    on,
    false,
  ],
  [
    "verification already done does not hold it back",
    {
      ...base(),
      summary: summary(true),
      review: { verification: { status: "done", endedAt: "x" } },
    },
    on,
    true,
  ],
];
for (const [name, r, context, want] of qaRows)
  check(`AZ1 ${name}`, qaDecision(r, context), want);
check(
  "AZ1 both switches are off by default",
  (({ autoQa, autoVerify }) => [autoQa, autoVerify])(
    radarSettings.schema.parse({}),
  ),
  [false, false],
);

// AZ2. What a QA decision writes.
{
  const run = { ...base(), summary: summary(true) };
  applyQaDecision(run, true, "T");
  check("AZ2 a run is recorded, not sent", run.automaticQa, { decidedAt: "T" });
  check("AZ2 and the stage is untouched", run.review, undefined);
  const none = { ...base() };
  applyQaDecision(none, false, "T");
  check("AZ2 no decision writes nothing", none, base());
}

// AZ1. The store takes both decisions in the summary's own write.
settings(false, true);
await seed();
await drop(true);
await collectSummaries();
{
  const r = await record();
  check(
    "AZ1 QA alone is decided and waiting",
    [Boolean(r.automaticQa?.decidedAt), r.automaticQa?.actedAt],
    [true, undefined],
  );
  check(
    "AZ1 and verification is left a press",
    [r.autoVerification, r.review],
    [undefined, undefined],
  );
}
settings(true, true);
await seed();
await drop(false);
await collectSummaries();
{
  const r = await record();
  check(
    "AZ1 with both on, QA waits while verification is skipped",
    [
      Boolean(r.automaticQa) && !r.automaticQa.actedAt,
      r.review?.verification?.status,
      r.review?.qa,
    ],
    [true, "skipped", { status: "pending" }],
  );
}

// AZ4. One sweep sends QA, then verification, on the shared agent. QA's turn
// goes first and leaves the agent busy, so verification is still queued behind
// it when QA is over.
busy = true;
sent = [];
writeOnRun = null;
await seed({
  summary: summary(true),
  automaticQa: { decidedAt: "T" },
  autoVerification: { decidedAt: "T", required: true },
});
check("AZ4 the sweep sends both", await startDecidedStages(paseo), 2);
{
  const r = await record();
  check(
    "AZ4 both are queued, as presses would leave them",
    [
      r.review?.qa?.status,
      Boolean(r.review?.qa?.queuedAt),
      r.review?.verification?.status,
      Boolean(r.review?.verification?.queuedAt),
    ],
    ["running", true, "running", true],
  );
  check(
    "AZ4 both decisions are spent",
    [Boolean(r.automaticQa?.actedAt), Boolean(r.autoVerification?.actedAt)],
    [true, true],
  );
}
check("AZ4 a second sweep sends nothing", await startDecidedStages(paseo), 0);
busy = false;
check(
  "AZ4 a turn goes out once the agent is free",
  await until(async () => sent.length > 0, 15000),
  true,
);
check(
  "AZ4 and it is QA's",
  sent.map((s) => s.prompt.includes("The findings file is the only output.")),
  [true],
);
await until(async () => (await record()).review?.qa?.status !== "running");
{
  const r = await record();
  check(
    "AZ4 verification waits behind it, not yet started",
    [
      r.review?.verification?.status,
      Boolean(r.review?.verification?.queuedAt),
      r.review?.verification?.startedAt,
    ],
    ["running", true, undefined],
  );
}
stopLanes("AZ4 is done");
await sleep(50);

// AZ3. No eyes. GitHub is out of reach here, so a press reports the reaction it
// could not post, and an automatic start reports nothing because it tried none.
busy = true;
await seed({ summary: summary(true) });
const automatic = await runQa(KEY, paseo, { automatic: true });
check(
  "AZ3 an automatic start is queued, with no reaction tried",
  [automatic.ok, automatic.warning],
  [true, undefined],
);
stopLanes("AZ3 automatic is done");
await sleep(50);
await seed({ summary: summary(true) });
const pressed = await runQa(KEY, paseo);
check(
  "AZ3 a press still tries one",
  String(pressed.warning).startsWith("the eyes reaction could not be posted:"),
  true,
);
stopLanes("AZ3 press is done");
await sleep(50);

// AZ2. Through a summary press: QA is queued once the summary turn is over, and
// a re-summary decides nothing.
settings(false, true);
busy = false;
sent = [];
writeOnRun = true;
await seed();
await runSummary(KEY, paseo);
await settled();
check(
  "AZ2 the summary turn went out, alone",
  sent.map((s) => s.prompt.includes("summary file")),
  [true],
);
check(
  "AZ2 QA is queued behind the agent",
  await until(
    async () =>
      (await record()).review?.qa?.status === "running" && lanesBlocked() === 1,
  ),
  true,
);
check(
  "AZ2 and its decision is spent",
  Boolean((await record()).automaticQa?.actedAt),
  true,
);
stopLanes("AZ2 is done");
// Settled before the reseed, or the cancel's own write lands on the next record.
await until(async () => (await record()).review?.qa?.status === "pending");
busy = false;
sent = [];
await seed({ summary: summary(true) });
await runSummary(KEY, paseo);
await settled();
{
  const r = await record();
  check(
    "AZ2 a re-summary decides nothing",
    [r.automaticQa, r.review],
    [undefined, undefined],
  );
}

stopLanes("the probe ended");
__setSettingsForTest(null);
console.log(failures === 0 ? "\nall clear" : `\n${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
