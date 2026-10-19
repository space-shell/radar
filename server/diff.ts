import { call } from "./api";
import type { Side } from "../shared/findings";

/** Three pages of 100. A pull request over 300 files is not reviewed line by line. */
const MAX_PAGES = 3;

interface FileRow {
  filename: string;
  patch?: string;
}

/** The lines a review comment may anchor to, per file, per side. */
export interface Anchors {
  RIGHT: Set<number>;
  LEFT: Set<number>;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Walks one file's patch and records every line number inside a hunk.
 *
 * Context lines count on both sides: GitHub accepts a comment on any line the
 * hunk carries, not only a changed one. Everything outside a hunk is off-diff
 * and is refused with a 422 that discards the whole review, which is what
 * AC-G12 exists to prevent.
 */
export function anchorsOf(patch: string): Anchors {
  const anchors: Anchors = { RIGHT: new Set(), LEFT: new Set() };
  let right = 0;
  let left = 0;

  for (const line of patch.split("\n")) {
    const hunk = HUNK.exec(line);
    if (hunk) {
      left = Number(hunk[1]);
      right = Number(hunk[3]);
      continue;
    }
    // Before the first hunk header there is nothing to number.
    if (right === 0 && left === 0) continue;

    if (line.startsWith("+")) {
      anchors.RIGHT.add(right++);
    } else if (line.startsWith("-")) {
      anchors.LEFT.add(left++);
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file" belongs to the line above it.
    } else {
      anchors.RIGHT.add(right++);
      anchors.LEFT.add(left++);
    }
  }

  return anchors;
}

/**
 * Every commentable line in the pull request, by path. A file GitHub sends with
 * no patch, because it is binary or too large, carries no anchors, so a finding
 * on it is reported as off-diff rather than posted and rejected.
 */
export async function diffAnchors(
  repo: string,
  number: number,
): Promise<Map<string, Anchors>> {
  const files = new Map<string, Anchors>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { status, body } = await call<FileRow[]>(
      `/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
      "GET",
    );
    if (status !== 200 || !body) {
      throw new Error(`GitHub returned ${status} listing the changed files`);
    }
    for (const file of body) {
      if (file.patch) files.set(file.filename, anchorsOf(file.patch));
    }
    if (body.length < 100) break;
  }

  return files;
}

/** Why this finding cannot be posted, or null when it can. */
export function anchorFault(
  anchors: Map<string, Anchors>,
  finding: { path: string; line: number; side: Side },
): string | null {
  const file = anchors.get(finding.path);
  if (!file) return `${finding.path} is not in the diff`;
  if (!file[finding.side].has(finding.line)) {
    return `${finding.path} line ${finding.line} is outside the diff on the ${finding.side} side`;
  }
  return null;
}
