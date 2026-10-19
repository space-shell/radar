import { execCommand } from "@getpaseo/plugin/server";
import { paseoBin } from "./binaries";

const PLUGIN_ID = "radar";

interface PluginRow {
  id: string;
  path: string;
}

let cached: string | null = null;

export async function pluginDirectory(): Promise<string> {
  if (cached) return cached;
  const { stdout } = await execCommand(
    await paseoBin(),
    ["plugin", "ls", "--json"],
    {
      timeout: 20_000,
    },
  );
  const rows = JSON.parse(stdout) as PluginRow[];
  const row = rows.find((candidate) => candidate.id === PLUGIN_ID);
  if (!row?.path) throw new Error(`plugin ${PLUGIN_ID} has no path`);
  cached = row.path;
  return cached;
}
