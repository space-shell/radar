import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { z } from "zod";

/**
 * Files an agent writes for the server to read. Every one lives under the
 * plugin's state directory, which is outside every git worktree, so no stage
 * can dirty a checkout or leave something committable behind. AC-E3, AC-E4.
 */

/** The agent cannot create the tree itself without a write tool pointed outside. */
export async function prepareArtifact(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

/**
 * No file at all, as distinct from a file that is there and wrong. The caller
 * usually wants neither, but a stage that was deliberately skipped has no file
 * by design, and that is not the same event as a writer that broke.
 */
export class MissingArtifact extends Error {}

/**
 * Reads and validates. Every failure is an error rather than an empty result: a
 * missing list and a broken writer must never look the same to the caller. AC-E5.
 */
export async function readArtifact<T>(
  path: string,
  schema: z.ZodType<T>,
  label: string,
): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new MissingArtifact(`the agent wrote no ${label} file`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`the ${label} file is not valid JSON: ${String(error)}`);
  }

  const result = schema.safeParse(parsed);
  if (result.success) return result.data;

  const reasons = result.error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ");
  throw new Error(`the ${label} file does not match the schema. ${reasons}`);
}

export async function writeArtifact(
  path: string,
  value: unknown,
): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Clears a previous run's file, so a stale one cannot be read as this run's output. */
export async function clearArtifact(path: string): Promise<void> {
  await rm(path, { force: true });
}
