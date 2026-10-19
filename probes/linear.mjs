import "./guard.mjs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { STATE_DIR, statePath, configPath, loadState } from "../server/state.ts";
import { describe, forgetKey, linearKey, openIssues, pollLinear } from "../server/linear.ts";
import { sweepLinear } from "../server/radar.ts";
import { OPEN_PATH, ledgerPath } from "../server/ledger.ts";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

await rm(STATE_DIR, { recursive: true, force: true });
await mkdir(STATE_DIR, { recursive: true });

const config = async (extra = {}) => {
  await writeFile(configPath, JSON.stringify({ dryRun: false, linearKeyCommand: ["/bin/echo", "lin_api_probe"], ...extra }, null, 2));
  forgetKey();
};

// The transport, stubbed. Every call is recorded so the request itself is testable.
const calls = [];
let reply = null;
globalThis.fetch = async (url, init) => {
  calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
  const next =
    typeof reply === "function"
      ? reply(JSON.parse(init.body).query.includes("RadarNotifications") ? "notifications" : "issues")
      : reply;
  return {
    ok: next.status === undefined || next.status < 400,
    status: next.status ?? 200,
    json: async () => next.body,
  };
};

const notification = (id, type, createdAt, overrides = {}) => ({
  __typename: "IssueNotification",
  id,
  type,
  createdAt,
  actor: { displayName: "A Colleague" },
  issue: { identifier: "ENG-1182", title: "Fix the status bar", url: "https://linear.app/w/issue/ENG-1182" },
  comment: null,
  ...overrides,
});

const page = (nodes) => ({ body: { data: { notifications: { nodes } } } });
const issues = (nodes) => ({ body: { data: { issues: { nodes } } } });

// T1. No key configured is Linear off, not Linear broken.
await config({ linearKeyCommand: [] });
check("T1 no key reads as no key", await linearKey(), null);
check("T1 a poll with no key returns null", await pollLinear(null), null);
check("T1 nothing was requested", calls.length, 0);

// T2. The key comes from the command, and the header is bare.
await config();
check("T2 the key is read from the command", await linearKey(), "lin_api_probe");
reply = page([notification("n1", "issueAssignedToYou", "2026-10-16T09:00:00.000Z")]);
await pollLinear(null);
check("T2 the endpoint", calls[0].url, "https://api.linear.app/graphql");
check("T2 Authorization carries the key with no scheme", calls[0].headers.Authorization, "lin_api_probe");
check("T2 no cursor means no filter", calls[0].body.variables.filter, undefined);

// T3. A cursor becomes a createdAt filter.
calls.length = 0;
await pollLinear("2026-10-16T08:00:00.000Z");
check("T3 the cursor is a gt filter", calls[0].body.variables.filter, { createdAt: { gt: "2026-10-16T08:00:00.000Z" } });

// T4. The shape of an engagement.
calls.length = 0;
reply = page([
  notification("n2", "issueCommentMention", "2026-10-16T09:05:00.000Z", { comment: { url: "https://linear.app/w/issue/ENG-1182#comment-1" } }),
  notification("n1", "issueAssignedToYou", "2026-10-16T09:00:00.000Z"),
]);
const poll = await pollLinear(null);
check("T4 both were taken", poll.engagements.length, 2);
check("T4 oldest first", poll.engagements.map((e) => e.id), ["n1", "n2"]);
check("T4 the subject is the issue key", poll.engagements[0].issue, "ENG-1182");
check("T4 the actor is named, never addressed", poll.engagements[0].what, "assigned to you by A Colleague");
check("T4 a comment links to the comment", poll.engagements[1].url, "https://linear.app/w/issue/ENG-1182#comment-1");
check("T4 the cursor is the newest in the page", poll.newest, "2026-10-16T09:05:00.000Z");

// T5. A notification with no issue is counted, not recorded, and still moves the cursor.
reply = page([
  { __typename: "ProjectNotification", id: "p1", type: "projectUpdateCreated", createdAt: "2026-10-16T10:00:00.000Z", actor: { displayName: "A Colleague" } },
  notification("n3", "issueNewComment", "2026-10-16T09:30:00.000Z"),
]);
const mixed = await pollLinear(null);
check("T5 only the issue one is recorded", mixed.engagements.map((e) => e.id), ["n3"]);
check("T5 the other is counted", mixed.skipped, 1);
check("T5 the cursor passes it", mixed.newest, "2026-10-16T10:00:00.000Z");

// T6. An unknown type still reads as something.
check("T6 a known type", describe("issueStatusChanged"), "status changed");
check("T6 an unknown type opens its own camel case", describe("issueSomethingQuiteNew"), "something quite new");

// T7. A GraphQL error arrives with status 200 and must not pass as data.
reply = { body: { errors: [{ message: "Access denied" }] } };
let caught = null;
await pollLinear(null).catch((error) => (caught = error.message));
check("T7 a 200 error throws", caught, "Linear: Access denied");

// T8. A 401 throws and forgets the key, so the next call re-reads it.
reply = { status: 401, body: {} };
caught = null;
await pollLinear(null).catch((error) => (caught = error.message));
check("T8 a 401 is named", caught, "Linear rejected the key");
calls.length = 0;
reply = page([]);
await pollLinear(null);
check("T8 the key was re-read, not cached from before", calls[0].headers.Authorization, "lin_api_probe");

// T9. The sweep: ledger lines, the cursor, and the standing list.
await rm(STATE_DIR, { recursive: true, force: true });
await mkdir(STATE_DIR, { recursive: true });
await config();
const when = new Date(2026, 9, 16, 9, 5);
reply = (which) =>
  which === "notifications"
    ? page([notification("n1", "issueCommentMention", when.toISOString())])
    : issues([{ identifier: "ENG-1182", title: "Fix the status bar", url: "https://linear.app/w/issue/ENG-1182", updatedAt: "2026-10-14T09:00:00.000Z", state: { name: "In Review" } }]);

await sweepLinear();
const week = await readFile(ledgerPath(when), "utf8");
check("T9 one ledger line", week.split("\n").filter((line) => line.startsWith("- ")).length, 1);
check(
  "T9 the line reads as what happened",
  week.split("\n").find((line) => line.startsWith("- ")),
  `- 09:05 linear ENG-1182 mentioned in a comment by A Colleague, Fix the status bar <https://linear.app/w/issue/ENG-1182>`,
);

const after = await loadState();
check("T9 the cursor moved", after.lastLinearAt, when.toISOString());
check("T9 the id is remembered", after.linearSeen, ["n1"]);
check("T9 the open list is cached", after.linearOpen.map((i) => i.identifier), ["ENG-1182"]);

const open = await readFile(OPEN_PATH, "utf8");
check("T9 OPEN.md has both headings", [open.includes("## Review requests"), open.includes("## Linear")], [true, true]);
check("T9 the issue is listed with its state", open.includes("**ENG-1182** Fix the status bar"), true);
check("T9 no review request is invented", open.includes("Nothing outstanding."), true);

// T10. A re-poll that returns the same notification writes nothing twice.
await sweepLinear();
const again = await readFile(ledgerPath(when), "utf8");
check("T10 still one line", again.split("\n").filter((line) => line.startsWith("- ")).length, 1);
check("T10 the id list did not grow", (await loadState()).linearSeen, ["n1"]);

// T11. An issue that left the open list leaves OPEN.md.
reply = (which) => (which === "notifications" ? page([]) : issues([]));
await sweepLinear();
const emptied = await readFile(OPEN_PATH, "utf8");
check("T11 the standing list empties", emptied.includes("Nothing assigned, or no Linear key configured."), true);

console.log(failures === 0 ? "\nall clear" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
