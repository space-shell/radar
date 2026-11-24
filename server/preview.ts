/**
 * Every Vercel host in a body, with whatever path follows it.
 *
 * The terminators matter. The bot writes the preview block as an HTML table, so a
 * URL arrives inside `href="..."` and the path runs straight into `">Web App (prod)
 * preview</a>`. A path that stopped only at whitespace swallowed that, and two runs
 * recorded the target as malformed and gave up on it.
 */
const VERCEL_URL =
  /https:\/\/([a-z0-9][a-z0-9.-]*\.vercel\.app)([^\s"'`<>)\]]*)?/gi;

/** The bolded first cell of a table row, which is what the bot names a preview. */
const LABEL = /<b>([^<]+)<\/b>/gi;

/** A label further away than this belongs to something else on the page. */
const LABEL_REACH = 240;

export interface Preview {
  /** What the pull request calls it, such as `Admin (prod)`. */
  label: string;
  url: string;
}

/** Drops the emoji and the padding the bot puts in front of a cell's name. */
function tidy(label: string): string {
  return label.replace(/^[^\p{L}(]+/u, "").trim();
}

/**
 * A name for a preview the body did not name, read off the host.
 *
 * `pr-10122-admin.acme.vercel.app` is the admin build and `pr-10122.acme.vercel.app`
 * is the application. Only the suffix tells them apart, so only the suffix is used.
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
 * cause of a verification step being recorded as not runnable: a change in web-admin,
 * in Storybook or behind the dev API has a preview built and waiting, and the stage
 * was told there was none. A step was then correctly refused against a preview that
 * does not serve the code under review. AC-AW1.
 *
 * The web application comes first when it is here, because a step that names no
 * surface means that one. The rest keep the order the body lists them in.
 *
 * An empty list is still not a reason to start a dev server. The stage reports the
 * steps that need one as not runnable instead.
 */
export function previews(body: string, number: number): Preview[] {
  const labels: { at: number; text: string }[] = [];
  for (const match of body.matchAll(LABEL)) {
    labels.push({ at: match.index, text: tidy(match[1]) });
  }

  const exact = `pr-${number}.`;
  const dashed = `pr-${number}-`;
  const found: Preview[] = [];
  const seen = new Set<string>();

  for (const match of body.matchAll(VERCEL_URL)) {
    const host = match[1].toLowerCase();
    if (!host.startsWith(exact) && !host.startsWith(dashed)) continue;
    const url = `https://${host}${match[2] ?? ""}`;
    if (seen.has(url)) continue;
    seen.add(url);

    const near = labels.filter(
      (label) =>
        label.at < match.index &&
        match.index - label.at < LABEL_REACH &&
        label.text.length > 0,
    );
    const nearest = near[near.length - 1];
    found.push({ label: nearest?.text ?? nameOf(host, number), url });
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
