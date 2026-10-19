import { call } from "./api";

/**
 * The acknowledgement, and the only GitHub write this plugin makes outside the
 * feedback wizard. Nothing here comments, reviews, approves or edits.
 * AC-D1, AC-I1, AC-I3.
 */
const CONTENT = "eyes";

interface Reaction {
  id: number;
  content: string;
  user: { login: string } | null;
}

let cachedViewer: string | null = null;

/** The account the token belongs to. `space-shell` today, read rather than assumed. D3. */
async function viewer(): Promise<string> {
  if (cachedViewer) return cachedViewer;
  const { status, body } = await call<{ login?: string }>("/user", "GET");
  if (status !== 200 || !body?.login)
    throw new Error(`GitHub returned ${status} for /user`);
  cachedViewer = body.login;
  return cachedViewer;
}

/** Pull requests are issues to this endpoint, so the PR number is the issue number. */
function reactionsPath(repo: string, number: number): string {
  return `/repos/${repo}/issues/${number}/reactions`;
}

/**
 * Adds the reaction. GitHub answers 201 when it creates one and 200 when this
 * account already left it, so acknowledging twice is a no-op rather than a
 * duplicate or an error. AC-D1, AC-D2, AC-D3.
 */
export async function addEyes(repo: string, number: number): Promise<void> {
  const { status } = await call(reactionsPath(repo, number), "POST", {
    content: CONTENT,
  });
  if (status === 200 || status === 201) return;
  throw new Error(`GitHub returned ${status} adding the reaction`);
}

/**
 * Removes this account's reaction, re-querying the live list and deleting by the id
 * GitHub returns. A stored id can therefore never go stale, and a reaction added by
 * hand in the web UI is removable. AC-D4.
 *
 * One page of 100. A pull request carrying more than 100 eyes reactions would need
 * paging, which has not been worth writing against a four-person review rota.
 */
export async function removeEyes(
  repo: string,
  number: number,
): Promise<boolean> {
  const login = await viewer();
  const path = reactionsPath(repo, number);

  const { status, body } = await call<Reaction[]>(
    `${path}?content=${CONTENT}&per_page=100`,
    "GET",
  );
  if (status !== 200 || !body)
    throw new Error(`GitHub returned ${status} listing reactions`);

  const mine = body.find((reaction) => reaction.user?.login === login);
  // Absent is the state the caller asked for, so there is nothing to report as failure.
  if (!mine) return false;

  const removal = await call(`${path}/${mine.id}`, "DELETE");
  if (removal.status !== 204) {
    throw new Error(`GitHub returned ${removal.status} removing the reaction`);
  }
  return true;
}
