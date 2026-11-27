/**
 * Every https host in a body, with whatever path follows it. Which of them are
 * previews is decided afterwards, by `accepted`.
 *
 * The terminators matter. The bot writes the preview block as an HTML table, so a
 * URL arrives inside `href="..."` and the path runs straight into `">Web App (prod)
 * preview</a>`. A path that stopped only at whitespace swallowed that, and two runs
 * recorded the target as malformed and gave up on it.
 *
 * The host has to end where the host ends. Anyone who can edit a pull request body
 * chooses what this reads, and the result is where a browser signed into real
 * accounts is sent. Without the boundary, `https://pr-5.acme.vercel.app@evil.example`
 * matched as a vercel host with the path `@evil.example`, and a URL parser reads that
 * as userinfo followed by the host `evil.example`; `.vercel.app.evil.example` was the
 * same trick with a dot. The lookahead admits only what can follow a host: a path, a
 * query, a fragment, a terminator, or a full stop or colon that is not itself the start
 * of more host. A path then has to open with `/`, `?` or `#`, so nothing else can be
 * glued onto the host either. The host never ends in a dot or a dash, so a full stop
 * closing a sentence is left to the lookahead rather than taken into the host.
 */
const HOST_URL =
  /https:\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?=[/?#\s"'`<>)\],;!]|[.:](?![a-z0-9-])|$)([/?#][^\s"'`<>)\]\\]*)?/gi;

/** What a configured preview host template may be written with. */
const TEMPLATE = /^[a-z0-9.*{}-]+$/;

/** Sentence punctuation a URL written in prose ends with, which is not part of it. */
const TRAILING = /[.,;:!?]+$/;

/** The bolded first cell of a table row, which is what the bot names a preview. */
const LABEL = /<b>([^<]+)<\/b>/gi;

/** A table row opening or closing. A label on the other side of one names another row. */
const ROW_EDGE = /<\/?tr[\s>]/i;

/** A label further away than this belongs to something else on the page. */
const LABEL_REACH = 240;

export interface Preview {
  /** What the pull request calls it, such as `Admin (prod)`. */
  label: string;
  url: string;
}

/**
 * Drops the emoji and the padding the bot puts in front of a cell's name.
 *
 * Digits stay. `3D Viewer` is a name, and stripping everything up to the first letter
 * recorded it as `D Viewer`.
 */
function tidy(label: string): string {
  return label.replace(/^[^\p{L}\p{N}(]+/u, "").trim();
}

/**
 * The URL as a browser would read it, or null when that is not this host.
 *
 * The regex is the gate and this is the check behind it: whatever the pattern lets
 * through, the URL that leaves this module parses to exactly the host that matched,
 * over https, on the default port, with no credentials in front of it.
 */
function confirmed(host: string, path: string): string | null {
  const url = `https://${host}${path}`;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (parsed.hostname !== host) return null;
    if (
      parsed.port !== "" ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return url;
}

/**
 * A configured preview host as a pattern for this pull request's number, or null
 * when it cannot be one.
 *
 * Not every preview is a vercel deployment: a pull request can also publish, say, an
 * MCP server at a host of its own, and the body names it like any other. Which hosts
 * those are belongs to the machine, so they come from settings rather than from this
 * file. `{n}` is the pull request number and is required, since a template without it
 * would accept every other pull request's deployment as this one's. `*` stands for
 * exactly one label and never a dot, so a template cannot be widened into a suffix
 * that any domain can end with. A `*` touching `{n}` is refused, because it would let
 * `pr-9812` pass for pull request 812. Anything else is matched literally.
 */
function hostPattern(template: string, number: number): RegExp | null {
  const text = template.trim().toLowerCase();
  if (!TEMPLATE.test(text) || !text.includes("{n}") || !text.includes(".")) {
    return null;
  }
  if (text.includes("*{n}") || text.includes("{n}*")) return null;
  const filled = text.split("{n}").join(String(number));
  if (filled.includes("{") || filled.includes("}")) return null;
  const source = filled
    .split("*")
    .map((part) => part.replace(/\./g, "\\."))
    .join("[a-z0-9-]+");
  return new RegExp(`^${source}$`);
}

/**
 * A name for a preview the body did not name, read off the host.
 *
 * `pr-812-admin.acme.vercel.app` is the admin build and `pr-812.acme.vercel.app` is
 * the application. Only the suffix tells them apart, so only the suffix is used.
 */
function nameOf(host: string, number: number): string {
  const prefix = `pr-${number}`;
  const rest = host.slice(prefix.length).split(".")[0] ?? "";
  if (rest.length === 0) return "Web App";
  return rest.replace(/^-/, "").replace(/-/g, " ");
}

/**
 * Every preview deployment this pull request published, named as the body names it.
 *
 * All of them, not just the application. The earlier version returned the single
 * `pr-<n>.` host and called the rest noise, and that one decision was the largest
 * cause of a verification step being recorded as not runnable: a change in an admin
 * app, in Storybook or behind the dev API has a preview built and waiting, and the stage
 * was told there was none. A step was then correctly refused against a preview that
 * does not serve the code under review. AC-AW1.
 *
 * The web application comes first when it is here, because a step that names no
 * surface means that one. The rest keep the order the body lists them in.
 *
 * A vercel host counts when it starts `pr-<n>.` or `pr-<n>-`. Any other host counts
 * only when it matches one of `extraHosts`, the configured templates `hostPattern`
 * reads, and is named off the host itself when its row carries no label.
 *
 * An empty list is still not a reason to start a dev server. The stage reports the
 * steps that need one as not runnable instead.
 */
export function previews(
  body: string,
  number: number,
  extraHosts: string[] = [],
): Preview[] {
  const labels: { at: number; text: string }[] = [];
  for (const match of body.matchAll(LABEL)) {
    labels.push({ at: match.index, text: tidy(match[1]) });
  }

  const exact = `pr-${number}.`;
  const dashed = `pr-${number}-`;
  const configured = extraHosts
    .map((template) => hostPattern(template, number))
    .filter((pattern): pattern is RegExp => pattern !== null);
  const vercel = (host: string) =>
    host.endsWith(".vercel.app") &&
    (host.startsWith(exact) || host.startsWith(dashed));

  const found: Preview[] = [];
  const seen = new Set<string>();

  for (const match of body.matchAll(HOST_URL)) {
    const host = match[1].toLowerCase();
    const isVercel = vercel(host);
    if (!isVercel && !configured.some((pattern) => pattern.test(host))) {
      continue;
    }
    const url = confirmed(host, (match[2] ?? "").replace(TRAILING, ""));
    if (url === null || seen.has(url)) continue;
    seen.add(url);

    // Only this URL's own row can name it. A row with no bolded cell otherwise took
    // the label of the row above, which named a different build.
    const near = labels.filter(
      (label) =>
        label.at < match.index &&
        match.index - label.at < LABEL_REACH &&
        label.text.length > 0 &&
        !ROW_EDGE.test(body.slice(label.at, match.index)),
    );
    const nearest = near[near.length - 1];
    found.push({
      label: nearest?.text ?? (isVercel ? nameOf(host, number) : host),
      url,
    });
  }

  found.sort((left, right) => {
    const first = left.url.startsWith(`https://${exact}`) ? 0 : 1;
    const second = right.url.startsWith(`https://${exact}`) ? 0 : 1;
    return first - second;
  });
  return found;
}

/**
 * The prompt's account of where the change can be seen.
 *
 * Named rather than listed bare, because picking the right one is the agent's first
 * decision and the host alone does not always say which build it is.
 */
export function previewLines(list: Preview[]): string[] {
  if (list.length === 0) {
    return [
      "Preview deployments: none published on this pull request. Do not start a dev server.",
    ];
  }
  return [
    "Preview deployments published on this pull request:",
    ...list.map((preview) => `  ${preview.label}: ${preview.url}`),
    "Use whichever of these serves the code this pull request changes. A step is short of a target only when none of them does.",
  ];
}
