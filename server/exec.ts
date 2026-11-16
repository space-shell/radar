import { basename } from "node:path";
import { execCommand } from "@getpaseo/plugin/server";

/**
 * Running a command with a timeout that is actually a timeout.
 *
 * `execCommand`'s own `timeout` is a request, not a bound: it sends
 * `killSignal`, which defaults to SIGTERM, and never escalates. A child that
 * traps the signal, or that is blocked in a kernel call waiting on a daemon
 * that has not answered, keeps the call pending for as long as it likes.
 * Measured here: a child trapping TERM against a declared 1000ms timeout
 * returned after 4021ms, when the child chose to exit.
 *
 * That is not an abstract risk in this plugin, because `tick` runs to
 * completion before the next one is scheduled. One launch that would not come
 * back held every sweep, every reap and the Linear poll behind it for 956
 * seconds against a declared 120.
 *
 * So two bounds rather than one: SIGKILL, which cannot be trapped, and a race
 * against a timer in this process, which does not depend on the child reacting
 * to anything at all.
 *
 * What this does not do, and cannot through this SDK: reap the tree. The signal
 * goes to the command, not to its process group, so a grandchild it started
 * outlives it, and one holding the inherited stdout pipe open is precisely why
 * the second bound has to be a timer rather than a signal. The bound is on the
 * call, which is what the tick waits on. A stray grandchild is the daemon's to
 * collect. AC-AS1.
 */

/** How long after the kill a command is still given to be reaped. */
const GRACE_MS = 5_000;

export interface RunOptions {
  /** The bound. Not a suggestion: the command is killed at it. */
  timeout: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

export async function run(
  command: string,
  args: string[],
  options: RunOptions,
): Promise<RunResult> {
  const attempt = execCommand(command, args, {
    ...options,
    killSignal: "SIGKILL",
  });

  let expire: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    expire = setTimeout(() => {
      reject(
        new Error(
          `${basename(command)} did not finish within ${Math.round(options.timeout / 1000)}s`,
        ),
      );
    }, options.timeout + GRACE_MS);
    // Safe only because the child holds the event loop open while this timer
    // waits. An unref'd timer that is the last thing running lets the process
    // exit mid wait and the awaiting promise never settles. See `turn.ts`.
    expire.unref();
  });

  try {
    return await Promise.race([attempt, deadline]);
  } finally {
    clearTimeout(expire);
    // The losing half is nobody's: an unhandled rejection in the daemon's
    // subprocess takes the whole plugin down with it.
    attempt.catch(() => {});
  }
}

/** Roughly a phone's worth of red text, which is all the footer can show. */
const MAX_CAUSE = 240;

const MESSAGE = /"message"\s*:\s*("(?:[^"\\]|\\.)*")/g;

/** The last `"message": "..."` in a blob of JSON, unescaped. */
function messageIn(text: string): string {
  let found = "";
  for (const match of text.matchAll(MESSAGE)) {
    try {
      const value: unknown = JSON.parse(match[1] ?? "");
      if (typeof value === "string" && value) found = value;
    } catch {
      // Not a JSON string. The next match may still be one.
    }
  }
  return found;
}

/**
 * The one sentence in a blob of output: a JSON error message if there is one,
 * otherwise the last line that says anything, as opposed to a brace or a blank.
 * Empty when the text says nothing, so the caller can look elsewhere.
 */
function sentenceIn(text: string): string {
  const named = messageIn(text);
  if (named) return named;
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /[a-z]/i.test(line));
  return lines.at(-1) ?? "";
}

function clamp(text: string): string {
  const flat = text.trim();
  return flat.length <= MAX_CAUSE ? flat : `${flat.slice(0, MAX_CAUSE - 1)}…`;
}

/**
 * The sentence worth storing from a failed command.
 *
 * `String(error)` on an exec failure is `Command failed: <every argument>` and
 * then the output, which for a launch is the whole brief prompt: 1250
 * characters with the cause at character 1062, rendered in 12px red on a phone
 * under a record that says only `failed`. The log keeps the full text; the
 * record keeps the part that names the fault.
 */
export function causeOf(error: unknown): string {
  const detail = error as { stderr?: unknown; message?: unknown } | null;
  const stderr = typeof detail?.stderr === "string" ? detail.stderr.trim() : "";
  const said = stderr ? sentenceIn(stderr) : "";
  if (said) return clamp(said);
  // Output that says nothing is not a cause. Braces and blank lines happen.
  const message =
    typeof detail?.message === "string" ? detail.message : String(error);
  return clamp(sentenceIn(message) || message);
}
