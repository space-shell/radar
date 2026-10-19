import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Runs every probe, each in its own process, against a throwaway HOME.
 *
 * The redirected HOME is the whole safety property: `STATE_DIR` is derived from
 * it, so a probe writes its state, its ledger and its OPEN.md into a temporary
 * directory and cannot touch the live install. `guard.mjs` enforces it from the
 * other side: a probe run directly finds no seal and exits before it writes. It also means a probe that shells
 * out to `gh` finds no token, which is why the two live-API probes skip
 * themselves unless they are given a repository to read.
 */
const HERE = import.meta.dirname;
const HARNESS = new Set(["run.mjs", "register.mjs", "hook.mjs", "guard.mjs"]);
const wanted = process.argv.slice(2);

const probes = readdirSync(HERE)
  .filter((name) => name.endsWith(".mjs") && !HARNESS.has(name))
  .filter(
    (name) =>
      wanted.length === 0 || wanted.includes(name.replace(/\.mjs$/, "")),
  )
  .sort();

if (probes.length === 0) {
  console.error(`no probe matched ${wanted.join(", ")}`);
  process.exit(2);
}

/**
 * The guard is only a guard if every probe imports it, and it must be the first
 * import: top level imports evaluate in source order, so a module loaded ahead
 * of it could write to the real HOME before the check ran. Nothing enforced
 * that until here, which left the rule a convention a new file could miss in
 * silence. The suite now refuses to start instead.
 */
const unguarded = probes.filter((probe) => {
  const first = readFileSync(join(HERE, probe), "utf8")
    .split("\n")
    .find((line) => line.startsWith("import "));
  return first !== 'import "./guard.mjs";';
});

if (unguarded.length > 0) {
  console.error(
    `FAIL  ${unguarded.join(", ")} must open with \`import "./guard.mjs";\`.\n` +
      "      Without it the file writes to the real HOME when it is run\n" +
      "      directly, which is how a week of ledger was once deleted.",
  );
  process.exit(2);
}

/**
 * The live probes need a credential the redirected HOME has just hidden from
 * them: `gh` keeps its token under the real HOME, so a probe that shells out
 * finds none and the run dies on a stack trace rather than reading anything.
 *
 * Read once here, from this process, and handed down as `GH_TOKEN`, which is
 * the variable `gh` and the plugin both already prefer. Only when a repository
 * was named, which is the same opt-in that wakes the live probes at all, so an
 * ordinary run still carries no credential and cannot reach GitHub by mistake.
 * Never printed.
 */
function liveToken() {
  if (!process.env.RADAR_PROBE_REPO) return {};
  const supplied = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (supplied) return { GH_TOKEN: supplied };
  try {
    const token = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return token ? { GH_TOKEN: token } : {};
  } catch {
    console.log(
      "note  RADAR_PROBE_REPO is set but `gh auth token` returned nothing.\n" +
        "      The live probes will report that rather than read anything.",
    );
    return {};
  }
}

const LIVE = liveToken();

/** Type stripping is still experimental, and says so on every run. */
const NOISE =
  /ExperimentalWarning|^\(Use `node|MODULE_TYPELESS_PACKAGE_JSON|Reparsing as ES module|To eliminate this warning/;

function run(probe, home) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--import", "./register.mjs", probe],
      // `RADAR_PROBE_HOME` is the seal `guard.mjs` checks: a probe started
      // any other way sees a HOME nothing vouched for and refuses to run.
      {
        cwd: HERE,
        env: { ...process.env, ...LIVE, HOME: home, RADAR_PROBE_HOME: home },
      },
    );
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => {
      const lines = out.split("\n").filter((line) => line && !NOISE.test(line));
      resolve({ probe, code, lines });
    });
  });
}

let failed = 0;
for (const probe of probes) {
  const home = mkdtempSync(join(tmpdir(), "radar-probe-"));
  const { code, lines } = await run(probe, home);
  rmSync(home, { recursive: true, force: true });

  const name = probe.replace(/\.mjs$/, "");
  const passes = lines.filter((line) => line.startsWith("pass")).length;
  const broken = lines.some((line) => line.startsWith("FAIL"));

  if (code !== 0 || broken) {
    failed++;
    console.log(`FAIL  ${name.padEnd(14)} exit ${code}`);
    for (const line of lines) console.log(`      ${line}`);
    continue;
  }

  if (passes > 0) {
    console.log(`ok    ${name.padEnd(14)} ${passes} checks`);
    continue;
  }

  if (lines.some((line) => line.startsWith("skip"))) {
    console.log(`skip  ${name.padEnd(14)} ${lines[0].replace(/^skip\s+/, "")}`);
    continue;
  }

  // Probes that assert nothing and report instead. Their output is the result,
  // so printing it is the only way they are worth running.
  console.log(`read  ${name.padEnd(14)} ${lines.length} lines`);
  for (const line of lines) console.log(`      ${line}`);
}

console.log(
  failed === 0
    ? "\nall clear"
    : `\n${failed} probe${failed === 1 ? "" : "s"} failed`,
);
process.exit(failed === 0 ? 0 : 1);
