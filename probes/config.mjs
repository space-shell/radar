import "./guard.mjs";
import { mkdir, rm, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STATE_DIR, configPath } from "../server/state.ts";
import { loadConfig, readLegacyFile, __setSettingsForTest } from "../server/settings.ts";
import { TASKS, radarSettings, agentFor, baseAgent, needsOwnAgent, DEFAULT_AGENT } from "../shared/settings.ts";
import { linearRef } from "../server/linear-ref.ts";
import { setupLines } from "../server/setup.ts";
import { paseoBin, ghBin, gitBin } from "../server/binaries.ts";
import { discoverCheckouts } from "../server/repos.ts";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};
const setConfig = async (value) => {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(configPath, JSON.stringify(value, null, 2));
};

await rm(STATE_DIR, { recursive: true, force: true });

// P1. No settings, no config file. The defaults name no machine.
const d = await loadConfig();
check("P1 binaries default to bare names", [d.paseoPath, d.ghPath, d.gitPath], ["paseo", "gh", "git"]);
check("P1 linear is off by default", [d.linearWorkspace, d.linearTeamKeys], [null, []]);
check("P1 setup is off by default", d.setupCommand, null);
check("P1 one checkout root under the home", d.checkoutRoots, [process.env.HOME + "/work"]);

// P2. A config naming one key keeps the defaults for the rest. The flat shape is the point.
await setConfig({ ghPath: "/somewhere/gh" });
const partial = await loadConfig();
check("P2 the named key is taken", await ghBin(), "/somewhere/gh");
check("P2 the others keep their defaults", [await paseoBin(), await gitBin()], ["paseo", "git"]);
check("P2 and so does everything else", partial.searchIntervalSeconds, 600);

// P3. The Linear reader. A full URL is taken at its word, workspace included.
const naming = { workspace: "acme", teamKeys: ["ENG", "WEB"] };
check("P3 no body", linearRef(undefined, naming), null);
check("P3 a URL keeps its own workspace", linearRef("see https://linear.app/other/issue/ENG-12 please", naming), "https://linear.app/other/issue/ENG-12");
check("P3 a bare key uses the configured workspace", linearRef("fixes ENG-12", naming), "https://linear.app/acme/issue/ENG-12");
check("P3 an unlisted prefix is not a link", linearRef("fixes HTTP-404", naming), null);
check("P3 no workspace means no bare-key link", linearRef("fixes ENG-12", { workspace: null, teamKeys: ["ENG"] }), null);
check("P3 but a URL still links without one", linearRef("https://linear.app/acme/issue/ENG-12", { workspace: null, teamKeys: [] }), "https://linear.app/acme/issue/ENG-12");

// P4. The setup lines.
check("P4 nothing configured, nothing said", setupLines(null), []);
check("P4 configured, three lines ending in the command", setupLines("enter-shell"), ["", "Tooling is not on PATH. Enter the development environment first:", "enter-shell"]);

// P5. Checkout discovery across roots, including one that is not there.
const root = await mkdtemp(join(tmpdir(), "radar-roots-"));
const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const run = promisify(execFile);
for (const [dir, origin] of [["one", "git@github.com:owner/one.git"], ["two", "https://github.com/owner/two"]]) {
  await mkdir(join(root, dir), { recursive: true });
  await run("git", ["-C", join(root, dir), "init", "-q"]);
  await run("git", ["-C", join(root, dir), "remote", "add", "origin", origin]);
}
await mkdir(join(root, "not-a-repo"), { recursive: true });
await setConfig({ gitPath: "git", checkoutRoots: [join(root, "missing"), root] });
const found = await discoverCheckouts();
check("P5 both origins mapped", [...found.keys()].sort(), ["owner/one", "owner/two"]);
check("P5 a directory with no git remote is skipped", found.has("not-a-repo"), false);
check("P5 a root that is not there costs nothing", found.size, 2);
await rm(root, { recursive: true, force: true });

// P6. The settings document, which is what the daemon reads once anything is
// saved. The schema fills every key it is not given, so a document naming one
// task keeps the defaults for the other three.
const defaults = radarSettings.schema.parse({});
check("P6 the schema defaults match the file defaults", [defaults.dryRun, defaults.searchIntervalSeconds, defaults.linearPollSeconds], [true, 600, 120]);
check("P6 the tasks are all there", Object.keys(defaults.tasks).sort(), ["intake", "qa", "summary", "verification"]);
check("P6 no prompt is overridden out of the box", TASKS.map((t) => defaults.tasks[t].prompt), ["", "", "", ""]);
check("P6 intake keeps the agent it always launched", baseAgent(defaults), DEFAULT_AGENT);
check("P6 every other task inherits it", TASKS.map((t) => agentFor(defaults, t)), TASKS.map(() => DEFAULT_AGENT));
check("P6 so none of them spawns one", TASKS.map((t) => needsOwnAgent(defaults, t)), [false, false, false, false]);

// P7. A task given its own model is the only thing that grows the agent count,
// and naming intake's own model again is not that.
const sameAsIntake = radarSettings.schema.parse({ tasks: { qa: { agent: { ...DEFAULT_AGENT } } } });
check("P7 the same model is still intake's agent", needsOwnAgent(sameAsIntake, "qa"), false);
const ownModel = radarSettings.schema.parse({ tasks: { qa: { agent: { provider: "codex", model: "gpt-6.1-sol" } } } });
check("P7 a different model needs its own", needsOwnAgent(ownModel, "qa"), true);
check("P7 and the others are untouched", [needsOwnAgent(ownModel, "verification"), needsOwnAgent(ownModel, "summary")], [false, false]);
check("P7 thinking alone is a difference", needsOwnAgent(radarSettings.schema.parse({ tasks: { summary: { agent: { ...DEFAULT_AGENT, thinking: "low" } } } }), "summary"), true);
check("P7 intake never spawns a second agent for itself", needsOwnAgent(ownModel, "intake"), false);

// P8. Moving intake moves everything that inherits from it.
const movedBase = radarSettings.schema.parse({ tasks: { intake: { agent: { provider: "claude", model: "claude-opus-5-5", thinking: "high", mode: "auto" } } } });
check("P8 the inheritors follow intake", agentFor(movedBase, "qa").model, "claude-opus-5-5");
check("P8 and still cost no agent of their own", needsOwnAgent(movedBase, "qa"), false);

// P9. Precedence. config.json is the fallback, and it stops an upgrade quietly
// reverting a configured machine to a dry run before anything has been saved.
await setConfig({ dryRun: false, ghPath: "/legacy/gh" });
__setSettingsForTest(radarSettings.schema.parse({}));
const atDefaults = await loadConfig();
check("P9 an untouched settings document yields to the file", [atDefaults.dryRun, atDefaults.ghPath], [false, "/legacy/gh"]);
__setSettingsForTest(radarSettings.schema.parse({ dryRun: false, ghPath: "/settings/gh" }));
const saved = await loadConfig();
check("P9 a saved one wins", saved.ghPath, "/settings/gh");
const legacy = await readLegacyFile();
check("P9 and the file is still readable for the import", legacy.ghPath, "/legacy/gh");
__setSettingsForTest(null);

// P10. A tilde is expanded by the server, so the shared schema needs no node:os.
__setSettingsForTest(radarSettings.schema.parse({ dryRun: false, checkoutRoots: ["~/elsewhere"], paseoPath: "~/.local/bin/paseo" }));
const expanded = await loadConfig();
check("P10 roots are absolute downstream", expanded.checkoutRoots, [process.env.HOME + "/elsewhere"]);
check("P10 and so are binary paths", expanded.paseoPath, process.env.HOME + "/.local/bin/paseo");
__setSettingsForTest(null);

console.log(failures === 0 ? "\nall pass" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
