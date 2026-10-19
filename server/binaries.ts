import { loadConfig } from "./settings";

/**
 * Where the three binaries live on this machine.
 *
 * Read rather than hardcoded, because the plugin subprocess does not reliably
 * inherit a PATH holding them: the defaults are bare names, which execFile looks
 * up on PATH, and a machine that needs an absolute path says so in its config
 * rather than in the source. One read per call, which costs one small file read
 * against a shell-out that costs seconds.
 */
export const paseoBin = async (): Promise<string> =>
  (await loadConfig()).paseoPath;

export const ghBin = async (): Promise<string> => (await loadConfig()).ghPath;

export const gitBin = async (): Promise<string> => (await loadConfig()).gitPath;
