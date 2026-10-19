import "./guard.mjs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { STATE_DIR, statePath, loadState } from "../server/state.ts";
import { __setSettingsForTest } from "../server/settings.ts";
import { askAgent } from "../server/turn.ts";
import { DEFAULT_AGENT, radarSettings } from "../shared/settings.ts";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

await rm(STATE_DIR, { recursive: true, force: true });
await mkdir(STATE_DIR, { recursive: true });

const seed = async (extra = {}) => {
  await writeFile(statePath, JSON.stringify({
    seenPullRequests: ["o/r#1"],
    intake: [{ key: "o/r#1", repo: "o/r", number: 1, title: "t", firstSeen: new Date().toISOString(), state: "created", agentId: "intake-1", workspaceId: "ws-1", ...extra }],
  }, null, 2));
  return (await loadState()).intake[0];
};
const stored = async () => (await loadState()).intake[0];

/**
 * A daemon that answers for the agents it is told exist. `created` records every
 * agent this run made, which is the count the whole design turns on.
 */
const fake = (live = new Set(["intake-1"])) => {
  const created = [];
  const sent = [];
  let next = 0;
  return {
    created,
    sent,
    live,
    agents: {
      ref: (id) => ({
        refresh: async () => (live.has(id) ? {} : null),
        archivedAt: null,
        status: "idle",
        activeTurn: null,
        run: async (prompt) => {
          sent.push({ id, prompt });
          return { status: "idle", lastMessage: "done" };
        },
      }),
    },
    workspaces: {
      ref: (workspaceId) => ({
        agents: {
          create: async (options) => {
            const id = `made-${++next}`;
            created.push({ workspaceId, id, options });
            live.add(id);
            return { id };
          },
        },
      }),
    },
  };
};

const settings = (tasks) =>
  __setSettingsForTest(radarSettings.schema.parse({ dryRun: false, tasks }));
const OTHER = { provider: "codex", model: "gpt-6.1-sol", thinking: "high", mode: "plan" };

// T1. The default. Every task is answered by intake's own agent, so a record
// that runs the whole pipeline still holds exactly one agent. AC-E1, AC-I6.
settings({});
let paseo = fake();
let record = await seed();
for (const task of ["qa", "verification", "summary"]) {
  await askAgent(paseo, record, task, `run ${task}`);
}
check("T1 nothing was created", paseo.created.length, 0);
check("T1 and intake's agent took all three", paseo.sent.map((turn) => turn.id), ["intake-1", "intake-1", "intake-1"]);
check("T1 the record records no task agent", (await stored()).taskAgents, undefined);

// T2. A task given a model intake is not running gets an agent of its own, in
// the workspace intake already made rather than a new one.
settings({ qa: { agent: OTHER } });
paseo = fake();
record = await seed();
await askAgent(paseo, record, "qa", "run qa");
check("T2 one agent was created", paseo.created.length, 1);
check("T2 in the record's own workspace", paseo.created[0].workspaceId, "ws-1");
check("T2 on the model it was given", paseo.created[0].options.config, { provider: "codex/gpt-6.1-sol", modeId: "plan", thinkingOptionId: "high" });
check("T2 labelled as the inbox reads them", paseo.created[0].options.labels, { "inbox": "pr", "pr": "1", "repo": "o/r", "radar-task": "qa" });
check("T2 the turn went to it, not to intake", paseo.sent.at(-1).id, "made-1");
check("T2 and the record remembers it", (await stored()).taskAgents, { qa: "made-1" });

// T3. Reused on the next run. A re-run is the common case and must not be a
// second agent.
await askAgent(paseo, await stored(), "qa", "run qa again");
check("T3 still one agent", paseo.created.length, 1);
check("T3 the same one answered", paseo.sent.at(-1).id, "made-1");

// T4. The other tasks still inherit. Giving QA a model says nothing about
// verification.
await askAgent(paseo, await stored(), "verification", "run verification");
check("T4 the inheritors are unmoved", paseo.created.length, 1);
check("T4 and went to intake's agent", paseo.sent.at(-1).id, "intake-1");

// T5. A task agent archived by hand is replaced in place. It holds nothing but
// the turn it was running, so losing it is not the record losing its session.
paseo.live.delete("made-1");
await askAgent(paseo, await stored(), "qa", "run qa once more");
check("T5 a replacement was made", paseo.created.length, 2);
check("T5 the record points at the new one", (await stored()).taskAgents, { qa: "made-2" });
check("T5 and the record is untouched", (await stored()).state, "created");

// T6. Intake's agent is the opposite case. Losing it is losing the session, so
// the record is orphaned and only Retry may make another. AC-E2.
settings({});
paseo = fake(new Set());
record = await seed();
const refused = await askAgent(paseo, record, "qa", "run qa").then(() => null, (error) => String(error.message));
check("T6 the turn was refused", refused, "the agent is gone. Retry the record to make a new one");
check("T6 nothing was created to cover for it", paseo.created.length, 0);
check("T6 and the record is orphaned", (await stored()).state, "orphaned");

// T7. A record with no workspace cannot have an agent made in the right place,
// so it falls back to intake's rather than making one somewhere else.
settings({ qa: { agent: OTHER } });
paseo = fake();
record = await seed({ workspaceId: undefined });
await askAgent(paseo, record, "qa", "run qa");
check("T7 nothing was created", paseo.created.length, 0);
check("T7 intake's agent answered", paseo.sent.at(-1).id, "intake-1");

// T8. Choosing intake's own model again is not a different model, so it costs
// no second agent however it was written.
settings({ qa: { agent: { ...DEFAULT_AGENT } } });
paseo = fake();
record = await seed();
await askAgent(paseo, record, "qa", "run qa");
check("T8 the same model is still intake's agent", [paseo.created.length, paseo.sent.at(-1).id], [0, "intake-1"]);

__setSettingsForTest(null);
console.log(failures === 0 ? "\nall pass" : `\n${failures} FAILED`);
