import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Task } from "../shared/settings";
import { pluginDirectory } from "./plugin-dir";
import { loadConfig } from "./settings";
import { STATE_DIR } from "./state";

/** The file each task ships with. Only intake's is named for something else. */
const FILES: Record<Task, string> = {
  intake: "pr-intake.md",
  qa: "qa.md",
  verification: "verification.md",
  summary: "summary.md",
};

/** Where an edited brief lands, which is deliberately not the plugin directory. */
const OVERRIDE_DIR = join(STATE_DIR, "briefs");

export const shippedBrief = async (task: Task): Promise<string> =>
  join(await pluginDirectory(), "briefs", FILES[task]);

/** The brief as the plugin ships it, for the editor to show and Revert to restore. */
export const readShippedBrief = async (task: Task): Promise<string> =>
  readFile(await shippedBrief(task), "utf8");

/**
 * The brief an agent should be pointed at.
 *
 * An edited brief is written out beside the rest of the plugin's state rather
 * than over the file in the plugin directory, because that directory is a git
 * checkout: editing in place would be reverted by the next pull, and worse, it
 * would make the pull a conflict. The file on disk is what the agent reads, so
 * the override has to exist as a file somewhere, and this is the somewhere that
 * survives both a pull and a plugin reload.
 *
 * Written on every resolve rather than on save, because the daemon cannot write
 * the settings document and so is never told the moment it changes.
 */
export async function briefPath(task: Task): Promise<string> {
  const { tasks } = await loadConfig();
  const override = tasks[task].prompt;
  if (override.trim() === "") return shippedBrief(task);

  const path = join(OVERRIDE_DIR, FILES[task]);
  // Rewriting an identical file would still churn the mtime, and an agent reading
  // it at that moment would see a half-written file without the rename.
  const current = await readFile(path, "utf8").catch(() => null);
  if (current === override) return path;

  await mkdir(OVERRIDE_DIR, { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, override, "utf8");
  await rename(temp, path);
  return path;
}
