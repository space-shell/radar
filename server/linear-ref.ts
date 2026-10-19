const ISSUE_URL =
  /https:\/\/linear\.app\/([^/\s]+)\/issue\/([A-Z][A-Z0-9]*-\d+)/;
const ISSUE_KEY = /\b([A-Z][A-Z0-9]*)-(\d+)\b/g;

export interface LinearNaming {
  /** The workspace slug a bare issue key belongs to. Null disables that path. */
  workspace: string | null;
  /** The team prefixes worth linking, so a capitalised word cannot become a link. */
  teamKeys: readonly string[];
}

/**
 * The Linear issue a pull request body points at, or null when it names none.
 *
 * A body carrying a full Linear URL is taken at its word, workspace included: a
 * link to another workspace is a link to another workspace, and rewriting the slug
 * would point it somewhere that does not exist. Only the bare-key path needs the
 * configured workspace, because a bare `ENG-1234` says nothing about where it lives.
 */
export function linearRef(
  body: string | undefined,
  naming: LinearNaming,
): string | null {
  if (!body) return null;

  const direct = ISSUE_URL.exec(body);
  if (direct) return `https://linear.app/${direct[1]}/issue/${direct[2]}`;

  if (!naming.workspace) return null;
  const teams = new Set(naming.teamKeys);
  for (const match of body.matchAll(ISSUE_KEY)) {
    if (teams.has(match[1])) {
      return `https://linear.app/${naming.workspace}/issue/${match[1]}-${match[2]}`;
    }
  }
  return null;
}
