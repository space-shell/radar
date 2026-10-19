import "./guard.mjs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { briefPath } from "../server/briefs.ts";
import { STATE_DIR } from "../server/state.ts";
import { radarSettings, TASKS } from "../shared/settings.ts";
import { __setSettingsForTest } from "../server/settings.ts";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

await rm(STATE_DIR, { recursive: true, force: true });
const overrides = join(STATE_DIR, "briefs");
const settings = (tasks) =>
  __setSettingsForTest(radarSettings.schema.parse({ dryRun: false, tasks }));

// B1. An edited brief is a file of its own, outside the plugin directory, so a
// `git pull` improving the shipped brief cannot be a conflict with this one.
settings({ qa: { prompt: "Read the diff twice." } });
const edited = await briefPath("qa");
check("B1 the override is under the state directory", edited, join(overrides, "qa.md"));
check("B1 and holds what was written", await readFile(edited, "utf8"), "Read the diff twice.");

// B2. Each task has its own file. Editing one leaves the others on the shipped
// brief, which is the file no override was written for.
check("B2 only the edited task has a file", await readFile(join(overrides, "summary.md"), "utf8").catch((error) => error.code), "ENOENT");

// B3. A second resolve with the same text does not rewrite the file. An agent
// reading it mid-write would otherwise see a truncated brief.
const before = (await import("node:fs")).statSync(edited).mtimeMs;
await new Promise((resolve) => setTimeout(resolve, 10));
await briefPath("qa");
check("B3 an unchanged brief is left alone", (await import("node:fs")).statSync(edited).mtimeMs, before);

// B4. An edit replaces the file rather than appending to it.
settings({ qa: { prompt: "Read it once." } });
check("B4 the file follows the setting", await readFile(await briefPath("qa"), "utf8"), "Read it once.");

// B5. Whitespace is not an override. Clearing the editor has to return the task
// to the shipped brief rather than pointing an agent at an empty file.
settings({ qa: { prompt: "   \n  " } });
// The shipped path is resolved by shelling out to paseo, which may or may not
// answer under the probe's HOME, so what is asserted is the half that holds
// either way: whatever comes back, it is not the override.
const blank = await briefPath("qa").then(
  (path) => path,
  () => "the shipped brief, via a daemon this HOME cannot reach",
);
check("B5 blank is not an override", blank.startsWith(overrides), false);
check("B5 and the stale override file is not read", blank.endsWith("/briefs/qa.md") ? "shipped qa.md" : blank, "shipped qa.md");

// B6. Every task resolves. A task missing from the map would throw on launch,
// which is the one moment nothing is watching.
settings(Object.fromEntries(TASKS.map((task) => [task, { prompt: `brief for ${task}` }])));
const all = [];
for (const task of TASKS) all.push(await readFile(await briefPath(task), "utf8"));
check("B6 all four write their own file", all, TASKS.map((task) => `brief for ${task}`));
check("B6 intake keeps the shipped file's name", await briefPath("intake"), join(overrides, "pr-intake.md"));

__setSettingsForTest(null);
console.log(failures === 0 ? "\nall pass" : `\n${failures} FAILED`);
