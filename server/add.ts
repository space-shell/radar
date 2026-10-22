import { execCommand } from "@getpaseo/plugin/server";
import { ghBin } from "./binaries";
import type { ReviewRequest } from "./github";
import { intake, intakeEnvironment } from "./intake";
import { log } from "./log";
import { dismissRecord } from "./actions";
import { loadState, updateState } from "./state";
import { loadConfig } from "./settings";
import { parsePullRequestLink } from "../shared/pr-link";
import { pullRequestUrl } from "../shared/inbox";

export interface AddResult {
  ok: boolean;
  error?: string;
  key?: string;
  already?: "present" | "restored";
}

interface PullRequestRow {
  number?: number;
  title?: string;
  url?: string;
  isDraft?: boolean;
  body?: string;
}

/** Long enough to read, short enough to sit in a toast. */
const REASON_LIMIT = 200;

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const line = text.split("\n").find((candidate) => candidate.trim()) ?? text;
  return line.trim().slice(0, REASON_LIMIT);
}

/**
 * What the record needs, read from GitHub rather than from the link.
 *
 * The title and the body are not in the URL, and both are load bearing: the
 * title names the workspace and the body is where the Linear issue is found. A
 * pull request that cannot be read is said so now, before anything is claimed,
 * because a mistyped number is the likeliest thing to be wrong with a paste.
 */
async function lookUp(repo: string, number: number): Promise<ReviewRequest> {
  const { stdout } = await execCommand(
    await ghBin(),
    [
      "pr",
      "view",
      String(number),
      "--repo",
      repo,
      "--json",
      "number,title,url,isDraft,body",
    ],
    { timeout: 30_000 },
  );
  const row = JSON.parse(stdout) as PullRequestRow;
  return {
    key: `${repo}#${number}`,
    repo,
    number,
    title: row.title ?? `#${number}`,
    url: row.url ?? pullRequestUrl({ repo, number }),
    isDraft: Boolean(row.isDraft),
    body: row.body ?? "",
  };
}

/**
 * Takes in a pull request James pasted.
 *
 * Everything that can refuse runs before anything is written: the parse, then
 * the duplicate check, then the read from GitHub. What is left cannot be
 * answered inside an RPC's thirty seconds, so the launch is started and not
 * waited for, and the screen holds a place for the row until it lands.
 *
 * The key is claimed in `seenPullRequests` before the launch rather than after
 * it, so a sweep running at the same moment, on a pull request that is also
 * review requested, cannot launch a second agent for it. A launch that throws
 * before writing its record gives the claim back, because a claimed key with no
 * record is a pull request nothing would ever take in again. AC-AK8.
 */
export async function addByLink(link: string): Promise<AddResult> {
  const parsed = parsePullRequestLink(link);
  if (!parsed.ok) return { ok: false, error: parsed.reason };

  const key = `${parsed.repo}#${parsed.number}`;
  const existing = (await loadState()).intake.find(
    (record) => record.key === key,
  );

  // Adding a record that is already there is not an error, and on a dismissed
  // one it is a clear instruction: he is asking for it back. AC-AK5.
  if (existing) {
    if (!existing.dismissedAt) return { ok: true, key, already: "present" };
    const restored = await dismissRecord(key, false);
    return restored.ok
      ? { ok: true, key, already: "restored" }
      : { ok: false, error: `${key} could not be restored` };
  }

  let request: ReviewRequest;
  try {
    request = await lookUp(parsed.repo, parsed.number);
  } catch (error) {
    return {
      ok: false,
      error: `GitHub cannot read ${key}: ${firstLine(error)}`,
    };
  }

  const claimed = await updateState((state) => {
    if (state.intake.some((record) => record.key === key)) return false;
    if (!state.seenPullRequests.includes(key)) state.seenPullRequests.push(key);
    return true;
  });
  if (!claimed) return { ok: true, key, already: "present" };

  const { dryRun } = await loadConfig();
  void (async () => {
    try {
      await intake(request, await intakeEnvironment(dryRun), "manual");
    } catch (error) {
      log(`manual intake of ${key} failed: ${String(error)}`);
      await updateState((state) => {
        if (state.intake.some((record) => record.key === key)) return;
        state.seenPullRequests = state.seenPullRequests.filter(
          (seen) => seen !== key,
        );
      });
    }
  })();

  log(`taking in ${key}, added by hand`);
  return { ok: true, key };
}
