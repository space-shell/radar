import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Distinguishes one write from every other, including one in the same process.
 *
 * The pid alone was the defect: it is the same for the whole process, so two
 * concurrent writers of the same file chose the same temp path, the first rename
 * moved it, and the second got ENOENT and lost its line. A counter is enough
 * because a temp path only has to be unique among the writes that can overlap,
 * and only writes from this process can.
 */
let nonce = 0;

/**
 * Writes a whole file, or leaves the old one exactly as it was.
 *
 * A reader of these files is an agent or James, not this process, so a partial
 * read is a brief read of a half written file rather than a crash. The rename is
 * what makes that impossible: it is atomic within a filesystem, and the temp file
 * is deliberately a sibling so it is always on the same one.
 *
 * The temp file is removed on failure. Without that a full disk or a killed
 * process would leave litter beside the real file that nothing sweeps, and a
 * unique suffix makes that unbounded rather than capped at one per process.
 */
export async function writeAtomic(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${nonce++}.tmp`;
  try {
    await writeFile(temp, body, "utf8");
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}
