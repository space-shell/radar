import { join } from "node:path";
import {
  findingsFileSchema,
  verificationFileSchema,
  type FindingsFile,
  type VerificationFile,
  type VerificationStep,
} from "../shared/findings";
import { readArtifact, writeArtifact } from "./artifact";
import { inLane } from "./queue";
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

/**
 * Serialises the two stages that write one record's findings file.
 *
 * Under the default settings QA and verification share an agent, so the agent
 * lane already holds them apart and this grants immediately. It matters where the
 * settings give each its own model: the two then run on two agents, genuinely at
 * once, and the file is read-modify-written by one while the other's agent
 * overwrites it wholesale. A verification merge landing between QA's clear and
 * its agent's write is lost, and the stage still reports the steps it lost.
 *
 * Always taken inside the agent lane, never the other way round, so two stages
 * acquiring both cannot deadlock. `ready` is a constant: this is a mutex, not a
 * wait for something outside the process. AC-AG6.
 */
export function inFindingsLane<T>(
  key: string,
  body: () => Promise<T>,
): Promise<T> {
  return inLane(`findings\u0000${key}`, async () => true, body);
}
