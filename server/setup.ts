import { loadConfig } from "./settings";

/**
 * How an agent enters this machine's development environment, or null when tooling
 * is already on PATH.
 *
 * It travels in the prompt rather than in a brief, because the command belongs to
 * the machine while the brief belongs to the work. A brief naming one machine's
 * shell is wrong everywhere else it is read.
 */
export const setupCommand = async (): Promise<string | null> =>
  (await loadConfig()).setupCommand;

/** The prompt lines naming it, or none at all when there is nothing to enter. */
export function setupLines(command: string | null): string[] {
  if (!command) return [];
  return [
    "",
    "Tooling is not on PATH. Enter the development environment first:",
    command,
  ];
}
