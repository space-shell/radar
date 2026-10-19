import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PluginSettings } from "@getpaseo/plugin/server";
import { radarSettings, type RadarSettings } from "../shared/settings";
import { log } from "./log";
import { configPath } from "./state";

export type RadarConfig = RadarSettings;

/** Every key at its default, which is also what an unconfigured machine reads. */
const DEFAULTS: RadarSettings = radarSettings.schema.parse({});
const DEFAULTS_JSON = JSON.stringify(DEFAULTS);

type Handle = PluginSettings<typeof radarSettings.schema>;

let handle: Handle | null = null;
let cached: RadarSettings | null = null;
/** True once the document holds something other than the defaults. */
let configured = false;
let warned = "";

const expand = (path: string) =>
  path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;

/**
 * Paths are absolute by the time anything downstream sees one. The schema is
 * shared with the client bundle, which has no `node:os`, so its defaults are
 * written with a tilde and resolved here instead.
 */
function resolvePaths(values: RadarSettings): RadarSettings {
  return {
    ...values,
    paseoPath: expand(values.paseoPath),
    ghPath: expand(values.ghPath),
    gitPath: expand(values.gitPath),
    checkoutRoots: values.checkoutRoots.map(expand),
  };
}

/**
 * The legacy file, which is the only configuration this plugin had before the
 * settings screen existed.
 *
 * Only a missing file means "nothing recorded yet". A corrupt one throws, because
 * treating it as empty would read `dryRun` as its default and relaunch an agent
 * for every open pull request. R1.
 */
export async function readLegacyFile(): Promise<RadarSettings | null> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${configPath} is not valid JSON, refusing to read it: ${String(error)}`,
    );
  }

  const result = radarSettings.schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `${configPath} does not match the settings schema: ${result.error.message}`,
    );
  }
  return result.data;
}

/**
 * Registers the settings document and keeps a snapshot of it.
 *
 * Subscribed rather than read per call, because `loadConfig` is asked for a
 * binary path on the way to every shell-out and a host round trip each time
 * would put the daemon's latency inside every one of them.
 */
export function attachSettings(registered: Handle): void {
  handle = registered;
  registered.subscribe((state) => {
    if (state.status === "ready") {
      cached = resolvePaths(state.values);
      configured = JSON.stringify(state.values) !== DEFAULTS_JSON;
      return;
    }
    // An invalid document is not a reason to run on defaults: `dryRun` would
    // flip back to true and every press would create nothing. Hold the last
    // good snapshot and say so once per revision.
    if (warned !== state.revision) {
      warned = state.revision;
      log(`settings are invalid, holding the last good values: ${state.error}`);
    }
  });
}

/**
 * The settings as the daemon should act on them.
 *
 * The settings document wins as soon as it holds anything other than its own
 * defaults. Until then the legacy `config.json` does, which is what stops this
 * change quietly reverting a configured machine to a dry run on the first
 * reload after the upgrade. The settings screen offers a one-press import so
 * that state ends rather than lingering.
 */
export async function loadConfig(): Promise<RadarSettings> {
  if (handle && !cached) {
    const state = await handle.read();
    if (state.status === "ready") {
      cached = resolvePaths(state.values);
      configured = JSON.stringify(state.values) !== DEFAULTS_JSON;
    }
  }

  if (cached && configured) return cached;

  const legacy = await readLegacyFile().catch((error: unknown) => {
    log(String(error));
    return null;
  });
  if (legacy) return resolvePaths(legacy);
  return cached ?? resolvePaths(DEFAULTS);
}

/** Which of the two the daemon is acting on, for the screen and the log. */
export async function configSource(): Promise<"settings" | "config.json"> {
  await loadConfig();
  if (cached && configured) return "settings";
  return (await readLegacyFile().catch(() => null)) ? "config.json" : "settings";
}

/** Test seam. The probes run with no host, so they drive the snapshot directly. */
export function __setSettingsForTest(values: RadarSettings | null): void {
  cached = values ? resolvePaths(values) : null;
  configured = values ? JSON.stringify(values) !== DEFAULTS_JSON : false;
  handle = null;
}
