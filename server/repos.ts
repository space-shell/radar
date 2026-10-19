import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { execCommand } from "@getpaseo/plugin/server";
import { gitBin } from "./binaries";
import { loadConfig } from "./settings";

function parseOrigin(url: string): string | null {
  const match = url.trim().match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  return match ? match[1] : null;
}

/**
 * Every repository one level under a configured root, keyed by its origin.
 *
 * Discovered rather than listed, so a new clone needs no edit here, and keyed by
 * what git itself reports rather than by directory name, so a clone renamed on
 * disk still matches the pull request it belongs to. The first root holding a
 * given origin wins, which makes the order in `checkoutRoots` the tie-break.
 */
export async function discoverCheckouts(): Promise<Map<string, string>> {
  const checkouts = new Map<string, string>();
  const { checkoutRoots } = await loadConfig();
  const git = await gitBin();

  for (const root of checkoutRoots) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      // A root that is not there is a configuration fact, not a failure worth
      // aborting the sweep for. The remaining roots still map their checkouts.
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(root, entry.name);
      try {
        const { stdout } = await execCommand(
          git,
          ["-C", path, "remote", "get-url", "origin"],
          { timeout: 10_000 },
        );
        const repo = parseOrigin(stdout);
        if (repo && !checkouts.has(repo)) checkouts.set(repo, path);
      } catch {
        continue;
      }
    }
  }

  return checkouts;
}
