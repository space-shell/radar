/**
 * Every Vercel host in a body, with whatever path follows it. The sticky preview
 * block the bot maintains is markdown, so the URL arrives inside a link.
 */
const VERCEL_URL =
  /https:\/\/([a-z0-9][a-z0-9.-]*\.vercel\.app)(\/[^\s)\]]*)?/gi;

/**
 * The preview deployment for this pull request, or null when the body names none.
 *
 * The bot publishes one host per project: `pr-<n>.<project>.vercel.app` for the web
 * app and `pr-<n>-<project>.<org>.vercel.app` for the rest. Only the first shape is
 * the application, so the prefix is matched exactly rather than by substring, which
 * would hand back the Storybook build. AC-F3.
 *
 * A null answer is not a reason to start a dev server. The stage reports the step as
 * not runnable instead.
 */
export function previewUrl(body: string, number: number): string | null {
  const prefix = `pr-${number}.`;
  for (const match of body.matchAll(VERCEL_URL)) {
    const host = match[1].toLowerCase();
    if (host.startsWith(prefix)) return `https://${host}${match[2] ?? ""}`;
  }
  return null;
}
