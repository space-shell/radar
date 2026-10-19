import "./guard.mjs";
import { summaryFileSchema } from "../shared/summary.ts";

const base = {
  version: 1,
  key: "owner/web#9999",
  generatedAt: "2026-10-16T09:00:00.000Z",
  headline: "Caches the company lookup, cutting the dashboard query count from 340 to 6.",
  changes: ["12 files, +310 / -88, all under apps/web/src/features/dashboard."],
  risk: "The map has no eviction, so a request touching 10k companies holds 10k entries.",
  scope: "ENG-1182 asked for the dashboard only. The change also touches the settings header.",
};

const cases = [
  ["clean", base],
  ["em dash", { ...base, headline: "Caches the lookup — cutting queries." }],
  ["vague", { ...base, risk: "A significant improvement to throughput." }],
  ["vague -ly", { ...base, risk: "Throughput improves substantially under load." }],
  ["hedge", { ...base, scope: "It's possible that the ticket covers this." }],
  ["just", { ...base, scope: "The ticket just covers the dashboard." }],
  ["second person", { ...base, risk: "Check your own callers before merging." }],
  ["empty changes", { ...base, changes: [] }],
  ["seven changes", { ...base, changes: Array.from({ length: 7 }, (_, i) => `line ${i}`) }],
  ["blank risk", { ...base, risk: "   " }],
  ["over length", { ...base, headline: "x".repeat(201) }],
  ["banned in a change", { ...base, changes: ["A notable refactor of the loader."] }],
];

for (const [name, value] of cases) {
  const result = summaryFileSchema.safeParse(value);
  const detail = result.success
    ? "accepted"
    : result.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; ");
  console.log(`${name.padEnd(20)} ${result.success ? "PASS" : "FAIL"}  ${detail}`);
}
