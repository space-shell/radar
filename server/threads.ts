import type { ReviewThread } from "../shared/threads";
import { graphql, mutate } from "./api";
import { keyUrl, note as ledger } from "./ledger";
import { log } from "./log";
import { loadState } from "./state";

/** As many as one pull request realistically carries. Beyond this, read it on GitHub. */
const LIMIT = 100;

interface ThreadNode {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  comments: {
    totalCount: number;
    nodes: {
      author: { login: string } | null;
      body: string;
      url: string;
    }[];
  };
}

interface Payload {
  repository: {
    pullRequest: { reviewThreads: { nodes: ThreadNode[] } } | null;
  } | null;
}

const QUERY = `query($owner: String!, $name: String!, $number: Int!, $limit: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: $limit) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 1) {
            totalCount
            nodes { author { login } body url }
          }
        }
      }
    }
  }
}
`;

const RESOLVE = `mutation($id: ID!) {
  resolveReviewThread(input: { threadId: $id }) { thread { id isResolved } }
}
`;

const UNRESOLVE = `mutation($id: ID!) {
  unresolveReviewThread(input: { threadId: $id }) { thread { id isResolved } }
}
`;

async function subject(
  key: string,
): Promise<{ owner: string; name: string; number: number; url?: string }> {
  const state = await loadState();
  const record = state.intake.find((candidate) => candidate.key === key);
  if (!record) throw new Error("no such record");
  const [owner, name] = record.repo.split("/");
  if (!owner || !name) throw new Error(`${record.repo} is not owner/name`);
  return { owner, name, number: record.number, url: keyUrl(key) };
}

export interface ThreadList {
  threads: ReviewThread[];
  error?: string;
}

/**
 * Every review conversation on the pull request, unresolved first.
 *
 * Read live on each open rather than stored. A resolved flag cached on the record
 * would go stale the moment the author resolved one from GitHub, and the screen
 * exists to answer "what is still open", which a stale copy cannot.
 *
 * Failures come back as a reason rather than an exception, on the same rule the
 * rest of the plugin follows: a screen that cannot reach GitHub says so. R10.
 */
export async function listThreads(key: string): Promise<ThreadList> {
  try {
    const { owner, name, number } = await subject(key);
    const { data, errors } = await graphql<Payload>(QUERY, {
      owner,
      name,
      number,
      limit: LIMIT,
    });
    for (const error of errors) log(`threads ${key}: ${error.message}`);

    const nodes = data?.repository?.pullRequest?.reviewThreads.nodes;
    if (!nodes) {
      return {
        threads: [],
        error:
          errors[0]?.message ??
          "GitHub returned no review threads for this pull request",
      };
    }

    const threads = nodes.map((node): ReviewThread => {
      const first = node.comments.nodes[0];
      return {
        id: node.id,
        resolved: node.isResolved,
        outdated: node.isOutdated,
        path: node.path,
        line: node.line,
        author: first?.author?.login ?? null,
        body: first?.body ?? "",
        url: first?.url ?? "",
        comments: node.comments.totalCount,
      };
    });

    // Unresolved first, because the list exists to be worked through. Order
    // within each group is GitHub's, which is the order the threads were opened.
    return {
      threads: [
        ...threads.filter((thread) => !thread.resolved),
        ...threads.filter((thread) => thread.resolved),
      ],
    };
  } catch (error) {
    return {
      threads: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface ThreadResult {
  ok: boolean;
  error?: string;
}

/**
 * Marks one thread resolved, or puts it back.
 *
 * An outward GitHub write, and the only one in the plugin that is not a review:
 * it goes through `mutate` in `server/api.ts` beside `call`, so what reaches
 * GitHub is still readable from one file. AC-I1, AC-I2, AC-AP7.
 */
export async function setResolved(
  key: string,
  id: string,
  resolved: boolean,
): Promise<ThreadResult> {
  try {
    const { url } = await subject(key);
    await mutate(resolved ? RESOLVE : UNRESOLVE, { id });
    const what = resolved
      ? "resolved a review thread"
      : "reopened a review thread";
    log(`${key}: ${what}`);
    ledger({ source: "github", subject: key, what, url });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
