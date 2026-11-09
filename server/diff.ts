import { call, githubError } from "./api";
import type { Side } from "../shared/findings";

/** Three pages of 100. A pull request over 300 files is not reviewed line by line. */
const MAX_PAGES = 3;

interface FileRow {
  filename: string;
  patch?: string;
}

/** What `/compare` answers with, of the fields that decide a scope. */
interface CompareBody {
  /** `identical`, `ahead`, `behind` or `diverged`. */
  status?: string;
  total_commits?: number;
  files?: FileRow[];
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

/**
 * What two commits differ by, read as a range rather than as a pull request.
 *
 * `fault` and the rest are exclusive: a faulted range carries no files and no
 * commits, so a caller cannot half use one. Every fault is a sentence, because
 * the one thing a narrowed review must never do is narrow silently. AC-AQ7.
 */
export interface CommitRange {
  /** Every commentable line in the range, by path. The same shape `diffAnchors` gives. */
  anchors: Map<string, Anchors>;
  /** The paths the range touches, in GitHub's order. */
  files: string[];
  /** How many commits separate base from head. */
  commits: number;
  /** Why the range cannot be trusted, or null when it can. */
  fault: string | null;
}

function faulted(fault: string): CommitRange {
  return { anchors: new Map(), files: [], commits: 0, fault };
}

/**
 * The commits between two shas, and the lines they touch.
 *
 * A second entry point beside `diffAnchors` rather than a parameter on it: that
 * one answers "where may a comment be anchored on this pull request", which is
 * always the whole diff, and this one answers "what is new since the last round".
 * The `patch` field is the same on both endpoints, so `anchorsOf` parses either.
 *
 * A diverged status is a fault and not a range. It means the author rebased or
 * force pushed, so `base...head` is the difference between two histories rather
 * than the work added to one, and handing that over as "the new commits" would
 * be a lie the size of the branch. A base GitHub no longer holds is a fault for
 * the same reason, and neither throws: the caller's answer to both is to read
 * the whole diff and say why.
 */
export async function compareAnchors(
  repo: string,
  base: string,
  head: string,
): Promise<CommitRange> {
  const anchors = new Map<string, Anchors>();
  const files: string[] = [];
  let commits = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { status, body } = await call<CompareBody>(
      `/repos/${repo}/compare/${base}...${head}?per_page=100&page=${page}`,
      "GET",
    );
    if (status === 404) {
      return faulted("GitHub no longer holds one of the two commits");
    }
    if (status !== 200 || !body) {
      const detail = githubError(body);
      return faulted(
        detail
          ? `GitHub refused to compare the two commits: ${detail}`
          : `GitHub returned ${status} comparing the two commits`,
      );
    }
    if (body.status === "diverged") {
      return faulted(
        "the author rebased or force pushed since the base commit",
      );
    }

    commits = body.total_commits ?? 0;
    const rows = body.files ?? [];
    for (const file of rows) {
      files.push(file.filename);
      if (file.patch) anchors.set(file.filename, anchorsOf(file.patch));
    }
    if (rows.length < 100) break;
  }

  return { anchors, files, commits, fault: null };
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
