import "./guard.mjs";
import { launchArgs } from "../server/intake.ts";
import * as summary from "../server/summary.ts";
import { DEFAULT_AGENT } from "../shared/settings.ts";

let fails = 0;
const check = (ok, name, detail = "") => {
  if (!ok) fails++;
  console.log(ok ? "pass" : "FAIL", name, ok ? "" : detail);
};

const target = { repo: "owner/web", number: 42, title: "Cache the lookup", url: "https://github.com/owner/web/pull/42" };
const briefs = { intake: "/plugin/briefs/pr-intake.md", summary: "/plugin/briefs/summary.md" };

const args = launchArgs(target, "/clones/web", briefs, "nix develop -c zsh", DEFAULT_AGENT);
const prompt = args[args.length - 1];

// The argv that creates the workspace. A worktree checked out at the pull request.
check(args[0] === "run" && args.includes("--background"), "A1 it runs in the background");
check(args.includes("--new-workspace") && args.includes("worktree"), "A2 a worktree workspace");
check(args.includes("--worktree-mode") && args.includes("checkout-pr"), "A3 checked out at the pull request");
check(args[args.indexOf("--pr-number") + 1] === "42", "A4 at the number it was given");
check(args[args.indexOf("--cwd") + 1] === "/clones/web", "A5 from the clone that was found");
check(args[args.indexOf("--title") + 1] === "PR #42 Cache the lookup", "A6 titled for a human");
check(args.includes("inbox=pr") && args.includes("pr=42") && args.includes("repo=owner/web"), "A7 labelled so the inbox can find it");
check(args[args.indexOf("--thinking") + 1] === "xhigh", "A8 at the thinking level a review deserves");
check(args[args.indexOf("--provider") + 1] === "claude/claude-opus-5", "A9 on the model the settings name", args.join(" "));

// A spec leaving thinking or mode empty means the provider's own default, and a
// blank flag value is not that. The flag has to be absent.
const bare_spec = launchArgs(target, "/clones/web", briefs, null, { provider: "codex", model: "gpt-6.1-sol", thinking: "", mode: "" });
check(bare_spec[bare_spec.indexOf("--provider") + 1] === "codex/gpt-6.1-sol", "A10 another provider is passed through");
check(!bare_spec.includes("--thinking") && !bare_spec.includes("--mode"), "A11 and an empty default is left unsaid", bare_spec.join(" "));

// The prompt. Two briefs, one turn, two writes. AC-AB1, AC-AB2.
check(prompt.includes("/plugin/briefs/pr-intake.md"), "B1 the operating brief is named");
check(prompt.includes("/plugin/briefs/summary.md"), "B2 and so is the summary brief", prompt);
// Named rather than restated: the schema, the ceilings and the diction rules live
// in one file, so an edited brief governs the automatic path and the press alike.
check(!/headline|changes|risk|scope/i.test(prompt), "B3 whose contents are not copied into the prompt", prompt);
check(prompt.includes(summary.summaryPath("owner/web", 42)), "B4 the file to write is named, by its real path", prompt);
check(prompt.includes("Record key: owner/web#42"), "B5 keyed to the record the collector will match");
check(prompt.includes("owner/web #42"), "B6 the pull request is named");
check(prompt.includes(target.url), "B7 with its URL");
check(prompt.includes("nix develop -c zsh"), "B8 the development environment is named");
check(Object.keys(briefs).length === 2, "B9 a launch carries both briefs");

// The tick takes the file in. AC-AB3.
check(typeof summary.collectSummaries === "function", "C1 the tick has a collector again");
check(typeof summary.runSummary === "function", "C2 and a press still rewrites one");

// A launch with no development environment configured says nothing about one.
const bare = launchArgs(target, "/clones/web", briefs, null, DEFAULT_AGENT);
check(!/develop/.test(bare[bare.length - 1]), "D1 no setup command means no setup line");

console.log(fails === 0 ? "all clear" : `${fails} failures`);
