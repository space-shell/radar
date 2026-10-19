import { execCommand } from "@getpaseo/plugin/server";
import { z } from "zod";
import type { LinearOpenIssue } from "../shared/linear";
import { loadConfig } from "./settings";

const ENDPOINT = "https://api.linear.app/graphql";

/**
 * fetch has no default timeout and ticks are serial, so one hung socket would stop
 * the poller for good. The same twenty seconds the GitHub poll allows itself. R8.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/** One page is a quarter of an hour of a busy workspace, and the poll is two minutes. */
const PAGE = 50;

/**
 * The key, held for the life of the daemon so a keychain prompt or a subprocess
 * is not paid on every poll.
 *
 * It is never logged, never written to state and never put in an error message.
 * Nothing in this module interpolates it into anything but the request header.
 */
let cachedKey: string | null = null;

/** Drops the cached key so the next poll re-reads it. Used after any 401. */
export function forgetKey(): void {
  cachedKey = null;
}

/**
 * Reads the key by running the command the config names, which is how the key
 * stays out of both this repository and the state directory. On this machine that
 * command asks the system keychain; on another it might ask a password manager,
 * and neither belongs in the source. An empty command means Linear is off, which
 * is the default: the radar's GitHub half runs without it.
 */
export async function linearKey(): Promise<string | null> {
  if (cachedKey) return cachedKey;

  const [command, ...args] = (await loadConfig()).linearKeyCommand;
  if (!command) return null;

  const { stdout } = await execCommand(command, args, { timeout: 15_000 });
  const key = stdout.trim();
  if (!key) throw new Error("the Linear key command returned nothing");

  cachedKey = key;
  return key;
}

const errorsSchema = z.object({
  errors: z.array(z.object({ message: z.string() })).optional(),
  data: z.unknown().optional(),
});

/**
 * One GraphQL request. Returns null when no key is configured, which is the
 * ordinary state of a machine that has not issued one, not a failure.
 *
 * The key goes in a bare `Authorization` header. Linear's own documentation is
 * explicit that a personal API key is sent without `Bearer`, which is reserved
 * for OAuth access tokens.
 */
async function query<T>(
  document: string,
  variables: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const key = await linearKey();
  if (!key) return null;

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: key },
      body: JSON.stringify({ query: document, variables }),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      forgetKey();
      throw new Error("Linear rejected the key");
    }
    if (!response.ok) throw new Error(`Linear returned ${response.status}`);

    const payload = errorsSchema.parse(await response.json());
    // A GraphQL error arrives with status 200, so the body is the only place it
    // shows. The first message is the one worth reading; the rest repeat it.
    if (payload.errors?.length)
      throw new Error(`Linear: ${payload.errors[0].message}`);

    return schema.parse(payload.data);
  } finally {
    clearTimeout(deadline);
  }
}

const NOTIFICATIONS = `
  query RadarNotifications($first: Int!, $filter: NotificationFilter) {
    notifications(first: $first, filter: $filter) {
      nodes {
        __typename
        id
        type
        createdAt
        actor { displayName }
        ... on IssueNotification {
          issue { identifier title url }
          comment { url }
        }
      }
    }
  }
`;

const notificationSchema = z.object({
  __typename: z.string(),
  id: z.string(),
  type: z.string(),
  createdAt: z.string(),
  actor: z.object({ displayName: z.string() }).nullish(),
  issue: z
    .object({ identifier: z.string(), title: z.string(), url: z.string() })
    .nullish(),
  comment: z.object({ url: z.string() }).nullish(),
});

const notificationsSchema = z.object({
  notifications: z.object({ nodes: z.array(notificationSchema) }),
});

/**
 * What each Linear notification type is, in the words the ledger uses. The map
 * covers the ones a reviewer actually receives; anything else falls through to
 * the type's own name with its camel case opened out, so a type Linear adds
 * reads as itself rather than as nothing at all.
 */
const WHAT: Record<string, string> = {
  issueAssignedToYou: "assigned to you",
  issueUnassignedFromYou: "unassigned from you",
  issueNewComment: "new comment",
  issueCommentMention: "mentioned in a comment",
  issueMention: "mentioned",
  issueStatusChanged: "status changed",
  issueBlocking: "marked as blocking",
  issueDue: "due",
  issueSubscribed: "subscribed",
  issueCommentReaction: "reaction on a comment",
  issueEmojiReaction: "reaction",
  issuePriorityUrgent: "priority raised to urgent",
};

export function describe(type: string): string {
  const known = WHAT[type];
  if (known) return known;
  return type
    .replace(/^issue/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
}

export interface LinearEngagement {
  /** The notification id, which is what dedupes a re-poll. */
  id: string;
  issue: string;
  title: string;
  what: string;
  url: string;
  createdAt: string;
}

/**
 * The authenticated user's notifications, newest first, narrowed to the ones
 * about an issue.
 *
 * Only `IssueNotification` is taken. The other dozen implementations carry no
 * issue, so they have no subject the ledger could name and no link worth
 * following back later; counting them is enough to show they were seen.
 */
export interface LinearPoll {
  engagements: LinearEngagement[];
  /** Notifications about something other than an issue. Counted, not recorded. */
  skipped: number;
  /**
   * The newest `createdAt` in the page, counting the skipped ones. The cursor has
   * to move past those too, or every poll re-reads the same ones for ever.
   */
  newest: string | null;
}

export async function pollLinear(
  since: string | null,
): Promise<LinearPoll | null> {
  const filter = since ? { createdAt: { gt: since } } : undefined;
  const data = await query(
    NOTIFICATIONS,
    { first: PAGE, filter },
    notificationsSchema,
  );
  if (!data) return null;

  const engagements: LinearEngagement[] = [];
  let skipped = 0;
  let newest: string | null = null;

  for (const node of data.notifications.nodes) {
    if (!newest || node.createdAt > newest) newest = node.createdAt;
    if (!node.issue) {
      skipped += 1;
      continue;
    }
    const actor = node.actor?.displayName;
    engagements.push({
      id: node.id,
      issue: node.issue.identifier,
      title: node.issue.title,
      // Who is waiting, never what to say back to them.
      what: actor ? `${describe(node.type)} by ${actor}` : describe(node.type),
      url: node.comment?.url ?? node.issue.url,
      createdAt: node.createdAt,
    });
  }

  // Oldest first, so a batch lands in the ledger in the order it happened.
  engagements.reverse();
  return { engagements, skipped, newest };
}

const OPEN_ISSUES = `
  query RadarOpenIssues($first: Int!) {
    issues(
      first: $first
      orderBy: updatedAt
      filter: {
        assignee: { isMe: { eq: true } }
        state: { type: { nin: ["completed", "canceled", "duplicate"] } }
      }
    ) {
      nodes {
        identifier
        title
        url
        updatedAt
        state { name }
      }
    }
  }
`;

const openIssuesSchema = z.object({
  issues: z.object({
    nodes: z.array(
      z.object({
        identifier: z.string(),
        title: z.string(),
        url: z.string(),
        updatedAt: z.string(),
        state: z.object({ name: z.string() }),
      }),
    ),
  }),
});

/**
 * The issues assigned to James that are neither done nor dropped.
 *
 * Asked for directly rather than inferred from the notifications, because an
 * issue is outstanding whether or not anything happened to it this week, and a
 * notification stream cannot say which ones were closed while nobody looked.
 */
export async function openIssues(): Promise<LinearOpenIssue[] | null> {
  const data = await query(OPEN_ISSUES, { first: PAGE }, openIssuesSchema);
  if (!data) return null;

  return data.issues.nodes.map((node) => ({
    identifier: node.identifier,
    title: node.title,
    url: node.url,
    state: node.state.name,
    updatedAt: node.updatedAt,
  }));
}
