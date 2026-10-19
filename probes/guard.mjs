import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { sep } from "node:path";

/**
 * A probe derives its state directory from `HOME` and writes freely inside it.
 * Run directly rather than through `run.mjs`, `HOME` is the real one, and those
 * writes land on the live install: that is how a probe once overwrote the real
 * `seen.json` and deleted a week of ledger. The runner seals the throwaway HOME
 * it creates, and a probe refuses to start unless it is pointed at that seal.
 */
const real = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

const home = process.env.HOME ? real(process.env.HOME) : "";
const sealed = process.env.RADAR_PROBE_HOME
  ? real(process.env.RADAR_PROBE_HOME)
  : "";

if (!home || home !== sealed || !home.startsWith(real(tmpdir()) + sep)) {
  console.error(
    "FAIL  a probe writes to $HOME and must not be run directly.\n" +
      "      Run `npm run probe`, or `node probes/run.mjs <name>` for one of them.\n" +
      "      The runner is the only thing that hands a probe a throwaway HOME.",
  );
  process.exit(2);
}
