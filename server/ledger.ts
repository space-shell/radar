import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { pullRequestUrl, statusNote, type IntakeRecord } from "../shared/inbox";
import type { LinearOpenIssue } from "../shared/linear";
import { currentNode, STAGE_LABELS } from "../shared/review";
import { log } from "./log";
import { loadState, STATE_DIR } from "./state";

export const LEDGER_DIR = join(STATE_DIR, "ledger");
export const OPEN_PATH = join(STATE_DIR, "OPEN.md");

/** Fixed rather than from `toLocaleDateString`, so no ICU build can change a heading. */
const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type LedgerSource = "github" | "linear";

export interface Engagement {
  source: LedgerSource;
  /** What it happened to: `owner/repo#9457`, or a Linear issue key. */
  subject: string;
  /** What happened, in the fewest words that still say it. No prose. */
  what: string;
  url?: string;
  /** Defaults to now. Passed only by the probes, so a week boundary is testable. */
  at?: Date;
}

/**
 * The ISO-8601 week-numbering year and week, which is not the calendar year: the
 * 29th of December 2025 belongs to 2026-W01, and writing it to a 2025 file would
 * put the same week in two places.
 *
 * Local calendar date, mapped onto UTC noon arithmetic so no daylight saving
 * change can shift a day across a boundary.
 */
export function isoWeek(date: Date): string {
  const thursday = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  // ISO weeks run Monday to Sunday and are named by the year their Thursday is in.
  const weekday = (thursday.getUTCDay() + 6) % 7;
  thursday.setUTCDate(thursday.getUTCDate() - weekday + 3);

  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);

  const week =
    1 + Math.round((thursday.getTime() - firstThursday.getTime()) / WEEK_MS);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * The link for a record key. `owner/repo#9457` is the key's only shape, and
 * it is composed by the same builder the screen uses, so the two cannot drift.
 */
export function keyUrl(key: string): string | undefined {
  const [repo, number] = key.split("#");
  if (!repo || !number || !/^\d+$/.test(number)) return undefined;
  return pullRequestUrl({ repo, number: Number(number) });
}

export function ledgerPath(date: Date): string {
  return join(LEDGER_DIR, `${isoWeek(date)}.md`);
}

const pad = (value: number) => String(value).padStart(2, "0");

function dayHeading(date: Date): string {
  return `## ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${DAYS[date.getDay()]}`;
}

function entry(event: Engagement, date: Date): string {
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const link = event.url ? ` <${event.url}>` : "";
  return `- ${time} ${event.source} ${event.subject} ${event.what}${link}`;
}

/** Serialises appends, so two events landing together cannot interleave. */
let queue: Promise<unknown> = Promise.resolve();

function serialise<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Appends one line, under the day's heading, to the week's file.
 *
 * Append-only by construction: nothing here reads a past line in order to change
 * it, and the only read is of the current file to decide whether today's heading
 * is already there.
 *
 * It records what happened and where to find it. It never records what to say
 * about it: drafting a reply on James' behalf is not this plugin's to do, in the
 * ledger or anywhere else.
 */
export async function record(event: Engagement): Promise<void> {
  const date = event.at ?? new Date();
  const path = ledgerPath(date);
  const heading = dayHeading(date);

  await serialise(async () => {
    await mkdir(LEDGER_DIR, { recursive: true });
    let existing = "";
    try {
      existing = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const opening = existing.length === 0 ? `# ${isoWeek(date)}\n` : "";
    const day = existing.includes(heading) ? "" : `\n${heading}\n\n`;
    await appendFile(path, `${opening}${day}${entry(event, date)}\n`, "utf8");
  });
}

/** What the line says, when something fails rather than happens. */
export function outcome(
  note: string | undefined,
  error: string | null,
): string {
  if (error) return `failed: ${error}`;
  return note ?? "done";
}

function openLine(record: IntakeRecord): string {
  const node = currentNode(record);
  // An archived session has no next stage, whatever the pipeline last recorded.
  // A row whose agent is gone and whose pull request merged was still reading
  // "Acknowledge" here, off a pipeline that never started, which named work that
  // cannot be done and is not wanted.
  const stage =
    node && record.state !== "archived" ? STAGE_LABELS[node] : "settled";
  const days = Math.floor(
    (Date.now() - Date.parse(record.firstSeen)) / 86_400_000,
  );
  const links = [`<${pullRequestUrl(record)}>`];
  if (record.linearUrl) links.push(`<${record.linearUrl}>`);
  // The pull request's own state leads: a merged one is still listed, because it
  // is still undismissed, but it must not read as work outstanding. AC-M5.
  const note = statusNote(record.pr);
  // "tracked", not "open": next to a merged badge, "open 1d" contradicts itself.
  const facts = [stage, record.state, `tracked ${days}d`];
  if (note) facts.unshift(note.label);
  return `- **${record.key}** ${record.title}\n  - ${facts.join(", ")}\n  - ${links.join(" ")}`;
}

/** One Linear issue still assigned, in the same shape as a pull request line. */
function issueLine(issue: LinearOpenIssue): string {
  const days = Math.floor(
    (Date.now() - Date.parse(issue.updatedAt)) / 86_400_000,
  );
  // "quiet", not "tracked": Linear gives the last touch, where a record gives the
  // day the radar first saw it, and the two numbers must not read as the same one.
  return `- **${issue.identifier}** ${issue.title}\n  - ${issue.state}, quiet ${days}d\n  - <${issue.url}>`;
}

/**
 * Rewrites the standing list from state, every time. Regenerating rather than
 * amending is what makes it deduped by construction: there is no second copy of
 * the truth to drift.
 *
 * Both halves of the radar, under their own headings. Local state only: this runs
 * after every ledger line, and a network call on each would make a log line cost a
 * round trip. The Linear sweep refreshes its half before calling here.
 */
export async function writeOpen(): Promise<void> {
  const state = await loadState();
  // One rule, and it is the inbox's rule: undismissed means outstanding. Dismiss
  // is the only gesture that closes a row, so a row that has not had it is still
  // on the list whatever its session did. Excluding `archived` here made the two
  // surfaces disagree, and Restore was the press that showed it: a row put back
  // on the screen deliberately stayed absent from the file meant to outlast the
  // screen. `openLine` already leads with the pull request's own state, so a
  // merged and archived row reads as settled rather than as work. AC-M5.
  const open = state.intake.filter((candidate) => !candidate.dismissedAt);

  const body = [
    "# Open",
    "",
    `_Regenerated ${new Date().toISOString()} by the radar plugin. Edits here are overwritten._`,
    "",
    "## Review requests",
    "",
    open.length === 0
      ? "Nothing outstanding."
      : open.map(openLine).join("\n\n"),
    "",
    "## Linear",
    "",
    state.linearOpen.length === 0
      ? "Nothing assigned, or no Linear key configured."
      : state.linearOpen.map(issueLine).join("\n\n"),
    "",
  ].join("\n");

  await mkdir(STATE_DIR, { recursive: true });
  const temp = `${OPEN_PATH}.${process.pid}.tmp`;
  await writeFile(temp, body, "utf8");
  await rename(temp, OPEN_PATH);
}

/**
 * The call site every hook uses. A ledger that cannot be written is a failure to
 * log, never a failure of the acknowledgement, the review or the press that
 * caused it, so nothing here is allowed to throw upward.
 */
export function note(event: Engagement): void {
  void record(event)
    .then(() => writeOpen())
    .catch((error) => log(`ledger write failed: ${String(error)}`));
}
