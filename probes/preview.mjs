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
 * The deployment table the bot maintains, trimmed from a live pull request body and
 * kept byte faithful in the parts that matter: the bolded
 * first cell, the `href="` the path runs into, and the `vercel.com` build link in the
 * third cell, which is a vercel URL that is not a preview.
 */
const row = (name, url, project) =>
  `<tr><td><b>${name}</b></td><td><a href="${url}">${name} preview</a></td>` +
  `<td>✅ <a href="https://vercel.com/acme/${project}/EuJ1">Built in 52s</a></td></tr>`;

const TABLE = [
  "## Deployments",
  "<table><tbody>",
  row("🖥️ Web App (prod)", "https://pr-812.acme.vercel.app/home", "web"),
  row("🔧 Admin (prod)", "https://pr-812-admin.acme.vercel.app", "admin"),
  row("🖥️ Web App (dev)", "https://pr-812-api.acme.vercel.app/home", "web"),
  row(
    "📖 Web Storybook",
    "https://pr-812-web-storybook.acme.vercel.app",
    "storybook",
  ),
  "</tbody></table>",
].join("\n");

// AW1: every published preview, not just the application, and named as the body names it.
check(
  "AW1 every preview is returned, labelled, application first",
  previews(TABLE, 812),
  [
    { label: "Web App (prod)", url: "https://pr-812.acme.vercel.app/home" },
    { label: "Admin (prod)", url: "https://pr-812-admin.acme.vercel.app" },
    {
      label: "Web App (dev)",
      url: "https://pr-812-api.acme.vercel.app/home",
    },
    {
      label: "Web Storybook",
      url: "https://pr-812-web-storybook.acme.vercel.app",
    },
  ],
);

// AW2: one pull request published only an admin build, and the stage was told there was none.
const ADMIN_ONLY = [
  "<table><tbody>",
  row(
    "🔧 Admin (prod)",
    "https://pr-853-admin.acme.vercel.app/customers/1",
    "admin",
  ),
  "</tbody></table>",
].join("\n");

check(
  "AW2 a pull request with no application build still has its previews",
  previews(ADMIN_ONLY, 853),
  [
    {
      label: "Admin (prod)",
      url: "https://pr-853-admin.acme.vercel.app/customers/1",
    },
  ],
);

// AW3: the path stops at the quote. Two records reported the target as malformed
// because it ran on into `/home">Web`.
check(
  "AW3 the path terminates at the closing quote of the href",
  previews(
    row("🖥️ Web App (prod)", "https://pr-716.acme.vercel.app/home", "web"),
    716,
  ).map((preview) => preview.url),
  ["https://pr-716.acme.vercel.app/home"],
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
  previews(TABLE, 812)
    .filter((preview) => preview.label.includes("(dev)"))
    .map((preview) => preview.url),
  ["https://pr-812-api.acme.vercel.app/home"],
);

// AW5: another pull request's deployment is not this one's, and a longer number that
// merely starts with ours is a different pull request.
const NEIGHBOURS = [
  "https://pr-99.acme.vercel.app/home",
  "https://pr-81.acme.vercel.app/home",
  "https://pr-8123.acme.vercel.app/home",
  "https://pr-812.acme.vercel.app/home",
].join("\n");

check(
  "AW5 only this pull request's hosts are returned",
  previews(NEIGHBOURS, 812).map((preview) => preview.url),
  ["https://pr-812.acme.vercel.app/home"],
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

const lines = previewLines(previews(TABLE, 812));
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

// AW9: whoever edits a pull request body chooses what this reads, and the URL it
// returns is where a browser signed into real accounts goes. Nothing that a URL
// parser would send to another host may come back.
const hostOf = (list) => list.map((preview) => new URL(preview.url).hostname);

check(
  "AW9 userinfo after the vercel host is not a preview",
  previews("https://pr-5.acme.vercel.app@evil.example/home", 5),
  [],
);
check(
  "AW9 a vercel host continued into another domain is not a preview",
  previews("https://pr-5.acme.vercel.app.evil.example/home", 5),
  [],
);
check(
  "AW9 a port on the host is not a preview",
  previews("https://pr-5.acme.vercel.app:8443/home", 5),
  [],
);
check(
  "AW9 a backslash cannot carry the path onto another host",
  hostOf(previews("https://pr-5.acme.vercel.app/home\\@evil.example", 5)),
  ["pr-5.acme.vercel.app"],
);
check(
  "AW9 credentials in front of the vercel host are not a preview",
  previews("https://evil.example@pr-5.acme.vercel.app/home", 5),
  [],
);
check(
  "AW9 every returned URL parses to the host that matched",
  hostOf(previews(TABLE, 812)),
  [
    "pr-812.acme.vercel.app",
    "pr-812-admin.acme.vercel.app",
    "pr-812-api.acme.vercel.app",
    "pr-812-web-storybook.acme.vercel.app",
  ],
);

// AW10: a URL written in prose ends at the prose, not at the punctuation after it.
check(
  "AW10 trailing sentence punctuation is not part of the URL",
  previews(
    "Try https://pr-5.acme.vercel.app/home, then https://pr-5-admin.acme.vercel.app. " +
      "Or https://pr-5-api.acme.vercel.app/x?y=1; and https://pr-5-docs.acme.vercel.app:",
    5,
  ).map((preview) => preview.url),
  [
    "https://pr-5.acme.vercel.app/home",
    "https://pr-5-admin.acme.vercel.app",
    "https://pr-5-api.acme.vercel.app/x?y=1",
    "https://pr-5-docs.acme.vercel.app",
  ],
);

// AW11: a name that starts with a digit keeps it.
check(
  "AW11 a label starting with a digit keeps the digit",
  previews(
    row("🧊 3D Viewer", "https://pr-5-viewer.acme.vercel.app", "viewer"),
    5,
  ),
  [{ label: "3D Viewer", url: "https://pr-5-viewer.acme.vercel.app" }],
);

// AW12: a row with no bolded cell is named off its host, not after the row above.
check(
  "AW12 a label never crosses into another table row",
  previews(
    row("🖥️ Web App (prod)", "https://pr-5.acme.vercel.app", "web") +
      '<tr><td></td><td><a href="https://pr-5-admin.acme.vercel.app">x</a></td></tr>',
    5,
  ),
  [
    { label: "Web App (prod)", url: "https://pr-5.acme.vercel.app" },
    { label: "admin", url: "https://pr-5-admin.acme.vercel.app" },
  ],
);

console.log(failures === 0 ? "\nall pass" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
