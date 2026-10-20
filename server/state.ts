import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { writeAtomic } from "./atomic";
import type { IntakeRecord } from "../shared/inbox";
import type { LinearOpenIssue } from "../shared/linear";

export const STATE_DIR = join(homedir(), ".local", "state", "radar");

export interface RadarState {
  githubLastModified: string | null;
  lastSearchAt: string | null;
  seenPullRequests: string[];
  intake: IntakeRecord[];
  /**
   * The Linear half. The cursor is what a re-poll asks for, and the id list is what
   * catches the overlap a cursor cannot: two notifications sharing a timestamp, and
   * the one that created the cursor itself.
   */
  lastLinearAt: string | null;
  /** When the Linear half last ran, which is what paces it. Its own clock. */
  linearSweptAt: string | null;
  linearSeen: string[];
  /**
   * What Linear says is outstanding, cached so OPEN.md can be rewritten from local
   * state. The file is regenerated on every ledger write, and a network call on each
   * of those would make a log line cost a round trip.
   */
  linearOpen: LinearOpenIssue[];
}

const DEFAULT_STATE: RadarState = {
  githubLastModified: null,
  lastSearchAt: null,
  seenPullRequests: [],
  intake: [],
  lastLinearAt: null,
  linearSweptAt: null,
  linearSeen: [],
  linearOpen: [],
};

/**
 * Only a missing file means "nothing recorded yet". Every other failure throws,
 * because treating a corrupt file as empty would empty seenPullRequests and
 * relaunch an agent for every open pull request. R1.
 */
async function readJson<T>(path: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }

  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch (error) {
    throw new Error(
      `${path} is not valid JSON, refusing to overwrite it: ${String(error)}`,
    );
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export const statePath = join(STATE_DIR, "seen.json");
export const configPath = join(STATE_DIR, "config.json");

/** Read-only snapshot. Anything that writes must go through updateState. */
export const loadState = () => readJson(statePath, DEFAULT_STATE);

/** Serialises every read-modify-write cycle. One daemon process, so this suffices. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * The only writer. Reloads inside the lock so no caller can save a stale snapshot
 * over another's work. R2.
 *
 * `mutate` must be synchronous: it runs with the lock held, so a slow call inside
 * it would block every press for its duration. Do the slow work first, then apply
 * the result here, keyed by record key rather than by object identity.
 */
export function updateState<T>(mutate: (state: RadarState) => T): Promise<T> {
  const run = async (): Promise<T> => {
    const state = await loadState();
    const result = mutate(state);
    await writeJson(statePath, state);
    return result;
  };

  const next = queue.then(run, run);
  // The queue must survive a rejected caller, or one failure stalls every later write.
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
