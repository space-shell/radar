import { execCommand } from "@getpaseo/plugin/server";
import { ghBin } from "./binaries";

const NOTIFICATIONS_URL =
  "https://api.github.com/notifications?participating=true";

/**
 * fetch has no default timeout and ticks are serial, so one hung socket would stop
 * the poller for good. Twenty seconds against an endpoint that advertises a sixty
 * second interval. R8.
 */
const POLL_TIMEOUT_MS = 20_000;

export interface ReviewRequest {
  key: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  body: string;
}

export interface NotificationHint {
  changed: boolean;
  lastModified: string | null;
  pollSeconds: number | null;
  reviewRequested: boolean;
}

interface NotificationThread {
  reason: string;
  subject: { type: string };
}

interface SearchRow {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  body: string;
  repository: { nameWithOwner: string };
}

let cachedToken: string | null = null;

/**
 * Shared with the reaction writer, so one `gh auth token` call serves both.
 *
 * `GH_TOKEN` wins when it is set, which is what `gh` itself does. It is how the
 * live probes authenticate: the probe runner redirects HOME so a probe cannot
 * write to the real state directory, and `gh` then finds no stored credential
 * either. The token is read once by the runner, from the real HOME, and handed
 * down. It is never logged, here or there.
 */
export async function githubToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const supplied = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (supplied && supplied.trim().length > 0) {
    cachedToken = supplied.trim();
    return cachedToken;
  }
  const { stdout } = await execCommand(await ghBin(), ["auth", "token"], {
    timeout: 15_000,
  });
  cachedToken = stdout.trim();
  if (!cachedToken) throw new Error("gh auth token returned nothing");
  return cachedToken;
}

/** Drops the cached token so the next call re-reads it. Used after any 401. */
export function forgetToken(): void {
  cachedToken = null;
}

export async function pollNotifications(
  lastModified: string | null,
): Promise<NotificationHint> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await githubToken()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (lastModified) headers["If-Modified-Since"] = lastModified;

  // An explicit controller rather than AbortSignal.timeout, which this lib set does
  // not declare. The deadline covers reading the body too, not only the headers:
  // a stalled body would hang the tick just as a stalled connection would.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);

  try {
    const response = await fetch(NOTIFICATIONS_URL, {
      headers,
      signal: controller.signal,
    });
    const pollSeconds = Number(response.headers.get("x-poll-interval")) || null;

    if (response.status === 304) {
      return {
        changed: false,
        lastModified,
        pollSeconds,
        reviewRequested: false,
      };
    }

    if (response.status === 401) {
      forgetToken();
      throw new Error("GitHub rejected the token");
    }

    if (!response.ok)
      throw new Error(`GitHub notifications returned ${response.status}`);

    const threads = (await response.json()) as NotificationThread[];
    return {
      changed: true,
      lastModified: response.headers.get("last-modified") ?? lastModified,
      pollSeconds,
      reviewRequested: threads.some(
        (thread) =>
          thread.reason === "review_requested" &&
          thread.subject.type === "PullRequest",
      ),
    };
  } finally {
    clearTimeout(deadline);
  }
}

export async function searchReviewRequests(): Promise<ReviewRequest[]> {
  const { stdout } = await execCommand(
    await ghBin(),
    [
      "search",
      "prs",
      "--review-requested=@me",
      "--state=open",
      "--limit=50",
      "--json",
      "number,title,url,isDraft,body,repository",
    ],
    { timeout: 30_000 },
  );

  const rows = JSON.parse(stdout) as SearchRow[];
  return rows.map((row) => ({
    key: `${row.repository.nameWithOwner}#${row.number}`,
    repo: row.repository.nameWithOwner,
    number: row.number,
    title: row.title,
    url: row.url,
    isDraft: row.isDraft,
    body: row.body,
  }));
}

/** The body of one pull request, for records taken in before bodies were stored. */
export async function pullRequestBody(
  repo: string,
  number: number,
): Promise<string> {
  const { stdout } = await execCommand(
    await ghBin(),
    [
      "pr",
      "view",
      String(number),
      "--repo",
      repo,
      "--json",
      "body",
      "-q",
      ".body",
    ],
    { timeout: 30_000 },
  );
  return stdout;
}
