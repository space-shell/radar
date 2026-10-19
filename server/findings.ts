import { join } from "node:path";
import {
  findingsFileSchema,
  verificationFileSchema,
  type FindingsFile,
  type VerificationFile,
  type VerificationStep,
} from "../shared/findings";
import { readArtifact, writeArtifact } from "./artifact";
import { STATE_DIR } from "./state";

/**
 * Under the plugin's own state directory, which is outside every git worktree. No
 * stage can therefore dirty a checkout or leave something committable behind.
 * AC-E3, AC-E4.
 *
 * The repo carries a slash, so the file sits one directory deeper than it reads.
 */
export function findingsPath(repo: string, number: number): string {
  return join(STATE_DIR, "findings", `${repo}#${number}.json`);
}

export function readFindings(path: string): Promise<FindingsFile> {
  return readArtifact(path, findingsFileSchema, "findings");
}

/**
 * Where the verification agent writes. Its own path, so it cannot overwrite the
 * code findings by writing the wrong shape to the wrong file.
 */
export function verificationPath(repo: string, number: number): string {
  return join(STATE_DIR, "findings", `${repo}#${number}.verification.json`);
}

export function readVerification(path: string): Promise<VerificationFile> {
  return readArtifact(path, verificationFileSchema, "verification");
}

/**
 * Folds the verification run into the one file the wizard reads. The two lists stay
 * apart inside it, so a verification result can never be read as a comment
 * candidate. AC-F5.
 *
 * Verification may run before QA, so the file is created when it is absent rather
 * than required to exist. A re-run replaces this stage's own list and leaves the
 * code findings alone, the mirror of what `runQa` does.
 */
export async function mergeVerification(
  path: string,
  key: string,
  verification: VerificationStep[],
): Promise<void> {
  const existing = await readFindings(path).catch(() => null);
  await writeFindings(path, {
    version: 1,
    key,
    generatedAt: new Date().toISOString(),
    findings: existing?.findings ?? [],
    verification,
  });
}

/** Writes the file back after the server has merged anything the agent cannot see. */
export function writeFindings(path: string, file: FindingsFile): Promise<void> {
  return writeArtifact(path, file);
}
