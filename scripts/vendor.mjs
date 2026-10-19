// Vendors xstate and @xstate/react as class-free ES5, because the app cannot run
// the originals.
//
// Paseo compiles plugin client bundles with esbuild at target es2020 and hands the
// result to the app, which on Android is React Native running Hermes. Hermes has no
// ES6 class syntax: its parser rejects `class` outright, and `eval("class A {}")`
// fails with "invalid statement encountered". Every other byte of a React Native app
// reaches Hermes through Metro, which runs Babel's class transform first. Plugin
// client bundles bypass Metro, so nothing lowers them. The Paseo compiler already
// makes this allowance for one case, `supported: { "async-await": false }`, and its
// own comment says why: "Metro lowers async syntax before Hermes sees app code."
// Classes were missed.
//
// xstate's five classes (Mailbox, Actor, StateNode, StateMachine, SimulatedClock)
// are the only ones radar ships, and esbuild cannot remove them: asking it to lower
// class syntax returns "not supported yet". TypeScript can, at target ES5, which is
// why the pipeline is esbuild to bundle and then tsc to downlevel.
//
// Delete all of this the day Paseo lowers classes itself. Nothing else depends on
// the vendored copies beyond the import specifiers in shared/machines and client/.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = path.join(root, "node_modules", ".vendor-work");

/**
 * The same esbuild the daemon compiles with, so the vendored output cannot drift
 * from what the real build would have produced.
 */
function esbuildBinary() {
  const candidates = [
    path.join(root, "node_modules", ".bin", "esbuild"),
    "/Applications/Paseo.app/Contents/Resources/app.asar.unpacked/node_modules/@esbuild/darwin-arm64/bin/esbuild",
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`No esbuild found. Looked in:\n  ${candidates.join("\n  ")}`);
  }
  return found;
}

function bundle(specifier, outFile, external) {
  const entry = path.join(work, `entry-${path.basename(outFile, ".js")}.js`);
  writeFileSync(entry, `export * from "${specifier}";\n`);
  execFileSync(esbuildBinary(), [
    entry,
    "--bundle",
    "--format=esm",
    "--platform=neutral",
    "--target=es2020",
    "--main-fields=module,main",
    // The daemon resolves these packages to their CommonJS builds, where an external
    // import survives as a runtime require() the host cannot answer. Asking for the
    // module condition gets the ESM build, whose imports stay static and rewritable.
    "--conditions=module",
    ...external.map((name) => `--external:${name}`),
    `--outfile=${outFile}`,
  ]);
}

/** Target ES5 is the only setting that removes `class`. Everything below it follows. */
function downlevel(inFile, outDir) {
  execFileSync(path.join(root, "node_modules", ".bin", "tsc"), [
    inFile,
    "--allowJs",
    "--target", "es5",
    "--module", "esnext",
    "--moduleResolution", "bundler",
    "--downlevelIteration",
    "--skipLibCheck",
    "--outDir", outDir,
  ]);
}

const banner = (name) =>
  `// ${name}, bundled and downlevelled to ES5 by scripts/vendor.mjs.\n` +
  `// Hand edits are lost on the next run. Hermes cannot parse ES6 class syntax and\n` +
  `// nothing in the plugin client pipeline lowers it, so the package cannot be\n` +
  `// imported directly. See scripts/vendor.mjs for the whole story.\n`;

function write(file, body) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
  console.log(`${path.relative(root, file)}  ${body.length} bytes`);
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

bundle("xstate", path.join(work, "xstate.js"), []);
bundle("@xstate/react", path.join(work, "xstate-react.js"), ["react", "xstate"]);
downlevel(path.join(work, "xstate.js"), path.join(work, "es5"));
downlevel(path.join(work, "xstate-react.js"), path.join(work, "es5"));

write(
  path.join(root, "shared", "vendor", "xstate.mjs"),
  banner("xstate") + readFileSync(path.join(work, "es5", "xstate.js"), "utf8"),
);
write(
  path.join(root, "shared", "vendor", "xstate.d.mts"),
  "// Types come from the real package, which is still a dependency. Only the runtime\n" +
    "// is vendored.\nexport * from \"xstate\";\n",
);

// The React bindings keep xstate external so there is one copy of the library and one
// set of its internals. esbuild writes the bare specifier; the plugin has to resolve
// it to the vendored file instead of back to node_modules.
const bindings = readFileSync(path.join(work, "es5", "xstate-react.js"), "utf8");
const rewritten = bindings.replaceAll('from "xstate"', 'from "../../shared/vendor/xstate.mjs"');
if (rewritten === bindings) throw new Error("No xstate import to rewrite in the React bindings");
write(path.join(root, "client", "vendor", "xstate-react.mjs"), banner("@xstate/react") + rewritten);
write(
  path.join(root, "client", "vendor", "xstate-react.d.mts"),
  "// Types come from the real package, which is still a dependency. Only the runtime\n" +
    "// is vendored.\nexport * from \"@xstate/react\";\n",
);

rmSync(work, { recursive: true, force: true });
