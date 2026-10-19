import type { IntakeRecord } from "../shared/inbox";

/** Bare elapsed span, no suffix, for the clock badge. */
export function since(iso: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export const age = (iso: string) => `${since(iso)} ago`;

export function issueKey(url: string): string {
  return url.split("/").pop() ?? "Linear";
}

/** `owner/web#9470` reads as `web#9470` in a toast, where width is scarce. */
export function shortKey(key: string): string {
  return key.split("/").pop() ?? key;
}

/**
 * The one state summary. The inbox row and the detail footer both render this, so a
 * record can never read as one thing on the row and another on the detail. AC-J12.
 */
export function recordMeta(record: IntakeRecord): string {
  const parts = [record.state, record.repo, age(record.firstSeen)];
  if (record.dismissedAt) parts.push(`dismissed ${age(record.dismissedAt)}`);
  return parts.join(" · ");
}
