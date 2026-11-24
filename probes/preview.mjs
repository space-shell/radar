import "./guard.mjs";
import { previewLines, previews } from "../server/preview.ts";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`,
  );
};

/**
 * The deployment table the bot maintains, trimmed from the live body of
 * acme/web#10122 and kept byte faithful in the parts that matter: the bolded
 * first cell, the `href="` the path runs into, and the `vercel.com` build link in the
 * third cell, which is a vercel URL that is not a preview.
 */
const row = (name, url, project) =>
  `<tr><td><b>${name}</b></td><td><a href="${url}">${name} preview</a></td>` +
  `<td>✅ <a href="https://vercel.com/acme/${project}/EuJ1">Built in 52s</a></td></tr>`;

const TABLE = [
  "## Deployments",
  "<table><tbody>",
  row("🖥️ Web App (prod)", "https://pr-10122.acme.vercel.app/home", "web"),
  row("🔧 Admin (prod)", "https://pr-10122-admin.acme.vercel.app", "admin"),
  row("🖥️ Web App (dev)", "https://pr-10122-api.acme.vercel.app/home", "web"),
  row(
    "📖 Web Storybook",
    "https://pr-10122-web-storybook.acme.vercel.app",
    "storybook",
  ),
  "</tbody></table>",
].join("\n");

// AW1: every published preview, not just the application, and named as the body names it.
check(
  "AW1 every preview is returned, labelled, application first",
  previews(TABLE, 10122),
  [
    { label: "Web App (prod)", url: "https://pr-10122.acme.vercel.app/home" },
    { label: "Admin (prod)", url: "https://pr-10122-admin.acme.vercel.app" },
    {
      label: "Web App (dev)",
      url: "https://pr-10122-api.acme.vercel.app/home",
    },
    {
      label: "Web Storybook",
      url: "https://pr-10122-web-storybook.acme.vercel.app",
    },
  ],
);

// AW2: #10153 published only an admin build, and the stage was told there was none.
const ADMIN_ONLY = [
  "<table><tbody>",
  row(
    "🔧 Admin (prod)",
    "https://pr-10153-admin.acme.vercel.app/customers/1",
    "admin",
  ),
  "</tbody></table>",
].join("\n");

check(
  "AW2 a pull request with no application build still has its previews",
  previews(ADMIN_ONLY, 10153),
  [
    {
      label: "Admin (prod)",
      url: "https://pr-10153-admin.acme.vercel.app/customers/1",
    },
  ],
);

// AW3: the path stops at the quote. Two records reported the target as malformed
// because it ran on into `/home">Web`.
check(
  "AW3 the path terminates at the closing quote of the href",
  previews(
    row("🖥️ Web App (prod)", "https://pr-9916.acme.vercel.app/home", "web"),
    9916,
  ).map((preview) => preview.url),
  ["https://pr-9916.acme.vercel.app/home"],
);

check(
  "AW3 and at a markdown link's bracket",
  previews(
    "See [the preview](https://pr-77.acme.vercel.app/home) and say so.",
    77,
  ).map((preview) => preview.url),
  ["https://pr-77.acme.vercel.app/home"],
);

// AW4: the dev build is the one a destructive step can run against, so it has to
// survive with a label that says which it is.
check(
  "AW4 the dev build keeps the label that distinguishes it from prod",
  previews(TABLE, 10122)
    .filter((preview) => preview.label.includes("(dev)"))
    .map((preview) => preview.url),
  ["https://pr-10122-api.acme.vercel.app/home"],
);

// AW5: another pull request's deployment is not this one's, and a longer number that
// merely starts with ours is a different pull request.
const NEIGHBOURS = [
  "https://pr-999.acme.vercel.app/home",
  "https://pr-1012.acme.vercel.app/home",
  "https://pr-101223.acme.vercel.app/home",
  "https://pr-10122.acme.vercel.app/home",
].join("\n");

check(
  "AW5 only this pull request's hosts are returned",
  previews(NEIGHBOURS, 10122).map((preview) => preview.url),
  ["https://pr-10122.acme.vercel.app/home"],
);

check(
  "AW5 a host that is not vercel.app is not a preview",
  previews(
    "https://vercel.com/acme/web/EuJ1 and https://pr-5.acme.dev/home",
    5,
  ),
  [],
);

// AW6: the bot rewrites the block on every push and the same URL can appear twice.
check(
  "AW6 the same URL twice is one preview",
  previews(
    `${row("🖥️ Web App (prod)", "https://pr-5.acme.vercel.app", "web")}\n` +
      `${row("🖥️ Web App (prod)", "https://pr-5.acme.vercel.app", "web")}`,
    5,
  ).length,
  1,
);

// AW7: a body with no bolded cell still names its previews, off the host.
check(
  "AW7 an unlabelled preview is named from its host",
  previews(
    "https://pr-5.acme.vercel.app https://pr-5-web-storybook.acme.vercel.app",
    5,
  ),
  [
    { label: "Web App", url: "https://pr-5.acme.vercel.app" },
    {
      label: "web storybook",
      url: "https://pr-5-web-storybook.acme.vercel.app",
    },
  ],
);

// AW8: the prompt lines. The empty case still forbids a dev server, and the populated
// case tells the agent that choosing between them is its job.
check(
  "AW8 no preview forbids a dev server and claims nothing else",
  previewLines([]),
  [
    "Preview deployments: none published on this pull request. Do not start a dev server.",
  ],
);

const lines = previewLines(previews(TABLE, 10122));
check(
  "AW8 every preview reaches the prompt with its label",
  lines.filter((line) => line.startsWith("  ")).length,
  4,
);
check(
  "AW8 the prompt says none is the only target",
  lines.some((line) => line.includes("Use whichever of these serves")),
  true,
);
check(
  "AW8 the prompt no longer claims there is no preview when there is one",
  lines.some((line) => line.includes("none published")),
  false,
);

console.log(failures === 0 ? "\nall pass" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
