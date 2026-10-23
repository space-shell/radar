import { forgetToken, githubToken } from "./github";

const API = "https://api.github.com";
const GRAPHQL = `${API}/graphql`;
/** fetch has no default timeout, and a press must not hang the screen. R8. */
const TIMEOUT_MS = 20_000;

export interface GithubResponse<T> {
  status: number;
  body: T | null;
}

/**
 * One request against the REST API, with the body read inside the deadline rather
 * than after it, so a stalled body cannot outlive the timeout the way a stalled
 * connection cannot. R8.
 *
 * Every outward GitHub write in the plugin goes through here, which is what makes
 * AC-I1 and AC-I2 checkable by reading one file.
 */
export async function call<T>(
  path: string,
  method: string,
  payload?: unknown,
): Promise<GithubResponse<T>> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${await githubToken()}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(payload === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });

    if (response.status === 401) forgetToken();

    // A 204 carries nothing, and an error page is not always JSON.
    const text = await response.text();
    if (!text) return { status: response.status, body: null };
    try {
      return { status: response.status, body: JSON.parse(text) as T };
    } catch {
      return { status: response.status, body: null };
    }
  } finally {
    clearTimeout(deadline);
  }
}

export interface GraphqlResponse<T> {
  data: T | null;
  /** Per-field failures. A deleted pull request nulls its alias and lands here. */
  errors: { message: string }[];
}

/** The transport both GraphQL helpers share. Neither is reachable without one. */
async function send<T>(
  document: string,
  variables: Record<string, unknown>,
): Promise<GraphqlResponse<T>> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(GRAPHQL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${await githubToken()}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ query: document, variables }),
    });

    if (response.status === 401) forgetToken();
    if (!response.ok) {
      throw new Error(`GitHub GraphQL returned ${response.status}`);
    }

    const payload = (await response.json()) as {
      data?: T;
      errors?: { message?: unknown }[];
    };
    return {
      data: payload.data ?? null,
      errors: (payload.errors ?? []).map((entry) => ({
        message:
          typeof entry.message === "string" ? entry.message : "unnamed error",
      })),
    };
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * One GraphQL read, sharing the token and the deadline with `call`.
 *
 * Reads only. The document is refused unless it opens with `query`, and `mutate`
 * refuses anything that is not a `mutation`, so which of the two a document is
 * cannot be decided by the caller getting it wrong.
 *
 * Partial failures are returned rather than thrown. One pull request deleted out
 * from under the inbox must not cost the other forty their status.
 */
export function graphql<T>(
  document: string,
  variables: Record<string, unknown> = {},
): Promise<GraphqlResponse<T>> {
  if (!document.trimStart().startsWith("query")) {
    throw new Error("the GraphQL helper takes queries only");
  }
  return send<T>(document, variables);
}

/**
 * One GraphQL write, for the things REST has no endpoint for.
 *
 * The second outward write path, and the reason it exists is `resolveReviewThread`:
 * resolving a review thread is a GraphQL mutation and nothing else. It lives here
 * beside `call` rather than inside `server/threads.ts` so AC-I1 and AC-I2 stay
 * checkable by reading one file: every request that changes something on GitHub is
 * either `call` or this.
 *
 * Errors are thrown rather than returned. A mutation has one subject, so a partial
 * failure is a failure, and the caller has a press to answer.
 */
export async function mutate<T>(
  document: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  if (!document.trimStart().startsWith("mutation")) {
    throw new Error("the GraphQL write helper takes mutations only");
  }
  const { data, errors } = await send<T>(document, variables);
  if (errors.length > 0) {
    throw new Error(errors.map((entry) => entry.message).join("; "));
  }
  if (!data) throw new Error("GitHub returned no data");
  return data;
}

/** The message GitHub sent, for a failure James has to act on rather than a code. */
export function githubError(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const payload = body as { message?: unknown; errors?: unknown };
  const parts: string[] = [];
  if (typeof payload.message === "string") parts.push(payload.message);
  if (Array.isArray(payload.errors)) {
    for (const entry of payload.errors) {
      const detail =
        entry && typeof entry === "object"
          ? ((entry as { message?: unknown }).message ??
            (entry as { field?: unknown }).field)
          : entry;
      if (typeof detail === "string") parts.push(detail);
    }
  }
  return parts.length > 0 ? parts.join(": ") : null;
}
