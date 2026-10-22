/**
 * What a pasted pull request link resolves to.
 *
 * A reason rather than a thrown error, because every rejection here is something
 * James can fix by pasting something else, and the screen says which one.
 */
export type ParsedLink =
  { ok: true; repo: string; number: number } | { ok: false; reason: string };

/** Owner and repository names, in the characters GitHub itself allows. */
const SEGMENT = "[A-Za-z0-9._-]+";
const PULL = new RegExp(`^(${SEGMENT})/(${SEGMENT})/pull/([0-9]+)(?:[/?#]|$)`);
const ISSUE = new RegExp(`^(${SEGMENT})/(${SEGMENT})/issues/[0-9]+(?:[/?#]|$)`);
const SHORT = new RegExp(`^(${SEGMENT})/(${SEGMENT})#([0-9]+)$`);
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

const EMPTY = "Paste a pull request link.";
const FOREIGN = "Only github.com pull requests can be taken in.";
const AN_ISSUE = "That is an issue, not a pull request.";
const SHAPE =
  "Not a pull request link. Expected https://github.com/owner/repo/pull/123.";

/**
 * A pull request link, in whichever of its shapes was to hand.
 *
 * The address bar gives `https://github.com/owner/repo/pull/123`, often with
 * `/files` or a `#discussion_r...` anchor still attached; the GitHub UI and `gh`
 * both say `owner/repo#123`; a link quoted in a message arrives without its
 * scheme. All four mean one pull request, so all four are read rather than
 * asking James to tidy the string before pasting it.
 *
 * The short form is tested first and whole, because `#` separates the number
 * there and is a fragment everywhere else.
 *
 * A leading host is only treated as a host when the path does not already read
 * as a pull request, since an owner may carry a dot too: `foo.bar/web/pull/1`
 * is owner `foo.bar`, not a host nobody recognises.
 */
export function parsePullRequestLink(input: string): ParsedLink {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: EMPTY };

  const short = SHORT.exec(trimmed);
  if (short) return numbered(`${short[1]}/${short[2]}`, short[3]);

  let path = trimmed.replace(SCHEME, "").replace(/^www\./, "");
  if (!PULL.test(path) && !ISSUE.test(path)) {
    const host = path.split("/")[0];
    if (host.indexOf(".") !== -1) {
      if (host.toLowerCase() !== "github.com")
        return { ok: false, reason: FOREIGN };
      path = path.slice(host.length + 1);
    }
  }

  if (ISSUE.test(path)) return { ok: false, reason: AN_ISSUE };

  const pull = PULL.exec(path);
  if (!pull) return { ok: false, reason: SHAPE };
  return numbered(`${pull[1]}/${pull[2]}`, pull[3]);
}

/** A number GitHub could have issued. Anything else is a typo, not a record. */
function numbered(repo: string, digits: string): ParsedLink {
  const number = Number(digits);
  if (!Number.isSafeInteger(number) || number <= 0)
    return { ok: false, reason: SHAPE };
  return { ok: true, repo, number };
}
