import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Every task that costs an agent turn. Feedback is absent on purpose: submitting a
 * review is an API call, not a turn, so there is no model to choose for it.
 */
export const TASKS = ["intake", "qa", "verification", "summary"] as const;
export type Task = (typeof TASKS)[number];

export const TASK_LABELS: Record<Task, string> = {
  intake: "Intake",
  qa: "QA",
  verification: "Verification",
  summary: "Summary",
};

export const TASK_NOTES: Record<Task, string> = {
  intake:
    "The agent created when a review request arrives. It reads the diff and reports once. Every other task inherits this agent unless it is given one of its own.",
  qa: "Reviews the code and writes the findings file the feedback wizard reads.",
  verification:
    "Walks the pull request description's own steps against the preview deployment.",
  summary: "The four-field reading of the diff on the detail view.",
};

export const agentSpecSchema = z.object({
  /** The provider id, as `paseo provider ls` reports it. */
  provider: z.string().min(1),
  /** The model id within that provider, not its display name. */
  model: z.string().min(1),
  /** A thinking option the model offers. Empty means the model's own default. */
  thinking: z.string().default(""),
  /** A mode the provider offers. Empty means the provider's own default. */
  mode: z.string().default(""),
});

export type AgentSpec = z.infer<typeof agentSpecSchema>;

/**
 * What intake launched with before any of this was configurable. Kept as the
 * default so upgrading the plugin changes no behaviour on its own.
 */
export const DEFAULT_AGENT: AgentSpec = {
  provider: "claude",
  model: "claude-opus-5",
  thinking: "xhigh",
  mode: "auto",
};

const taskSchema = z
  .object({
    /**
     * The brief, when it has been edited here. Empty means the file the plugin
     * ships is used unchanged, which is what keeps a `git pull` able to improve a
     * brief nobody has touched.
     */
    prompt: z.string().default(""),
    /**
     * Null is the default, and the default means two different things by design.
     * For intake it is `DEFAULT_AGENT`. For every other task it is whatever intake
     * resolved to, which is the inheritance that keeps one agent per record.
     */
    agent: agentSpecSchema.nullable().default(null),
  })
  // `prefault` rather than `default`: the value is parsed, so each key inside
  // still gets its own default and a task absent from the document is filled in.
  .prefault({});

/**
 * Everything about one machine that the code would otherwise have to assume.
 *
 * This replaces `config.json`, which survives only as the fallback read before
 * the host can answer and by the probes, which run with no host at all. The
 * settings screen offers a one-press import of a file left over from then.
 */
export const radarSettings = defineSettings({
  id: "radar",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Logs the launch it would run and creates nothing. */
    dryRun: z.boolean().default(true),
    /** The notification poll floor. GitHub's own `X-Poll-Interval` wins when longer. */
    notificationPollSeconds: z.number().int().min(10).max(3600).default(60),
    /** How often a full search runs regardless of notifications. */
    searchIntervalSeconds: z.number().int().min(60).max(86_400).default(600),
    /**
     * The three binaries the plugin shells out to. A bare name is resolved on PATH,
     * which is the right default; the plugin subprocess does not reliably inherit a
     * PATH holding them, so an absolute path belongs here rather than in the code.
     */
    paseoPath: z.string().min(1).default("paseo"),
    ghPath: z.string().min(1).default("gh"),
    gitPath: z.string().min(1).default("git"),
    /**
     * Directories scanned for checkouts. Every git repository one level down maps
     * its origin to its path. A leading `~/` is expanded by the server, so the
     * default names no machine and this schema stays free of `node:os`.
     */
    checkoutRoots: z.array(z.string().min(1)).default(["~/work"]),
    /**
     * The Linear workspace slug, and the team keys worth linking. A body naming
     * `ENG-1234` only becomes a link when `ENG` is listed here, so an unrelated
     * capitalised word cannot turn into a dead issue link.
     */
    linearWorkspace: z.string().nullable().default(null),
    linearTeamKeys: z.array(z.string().min(1)).default([]),
    /**
     * The shell command that enters this machine's development environment, named
     * in the prompt of every agent the plugin launches.
     */
    setupCommand: z.string().nullable().default(null),
    /**
     * The command that prints the Linear personal API key, as argv rather than a
     * shell line, so nothing is quoted or interpreted. Empty means Linear is off.
     *
     * A command rather than the key itself, because a key in a settings document
     * is a key in a backup. The key is never read into this document, never
     * logged, and never returned to the screen.
     */
    linearKeyCommand: z.array(z.string().min(1)).default([]),
    linearPollSeconds: z.number().int().min(30).max(86_400).default(120),
    tasks: z
      .object({
        intake: taskSchema,
        qa: taskSchema,
        verification: taskSchema,
        summary: taskSchema,
      })
      .prefault({}),
  }),
});

export type RadarSettings = z.infer<typeof radarSettings.schema>;

/** The `provider/model` string both the CLI and the SDK take. */
export const providerString = (spec: AgentSpec) =>
  `${spec.provider}/${spec.model}`;

export function sameAgent(a: AgentSpec, b: AgentSpec): boolean {
  return (
    a.provider === b.provider &&
    a.model === b.model &&
    a.thinking === b.thinking &&
    a.mode === b.mode
  );
}

/** What intake runs as, which is also what every other task falls back to. */
export const baseAgent = (settings: RadarSettings): AgentSpec =>
  settings.tasks.intake.agent ?? DEFAULT_AGENT;

export function agentFor(settings: RadarSettings, task: Task): AgentSpec {
  const base = baseAgent(settings);
  if (task === "intake") return base;
  return settings.tasks[task].agent ?? base;
}

/**
 * Whether this task needs an agent of its own, which is the only thing that makes
 * the agent count grow. A task configured with intake's own settings is answered
 * by intake's agent however it was written, so choosing the same model twice costs
 * nothing.
 */
export function needsOwnAgent(settings: RadarSettings, task: Task): boolean {
  if (task === "intake") return false;
  return !sameAgent(agentFor(settings, task), baseAgent(settings));
}

/** Anything the screen offers as a choice: an id to store, a label to show. */
export const choiceSchema = z.object({ id: z.string(), label: z.string() });
export type Choice = z.infer<typeof choiceSchema>;

/** One model a provider offers, as the settings screen needs to show it. */
export const modelOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** "Latest release", and the like. Null when the provider offers none. */
  description: z.string().nullable(),
  thinking: z.array(choiceSchema),
  defaultThinking: z.string().nullable(),
});

export const providerOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Only a ready provider can run a turn. An unavailable one is shown greyed. */
  available: z.boolean(),
  modes: z.array(choiceSchema),
  defaultMode: z.string().nullable(),
  models: z.array(modelOptionSchema),
});

export type ProviderOption = z.infer<typeof providerOptionSchema>;

/**
 * What the pickers are built from, read from `paseo provider` rather than a list
 * in this file, so a model released after this plugin was written is selectable.
 */
export const readProviders = defineRpc({
  name: "radar.settings.providers",
  input: z.object({}),
  output: z.object({
    providers: z.array(providerOptionSchema),
    /** Why the list is empty or short, when something went wrong reading it. */
    error: z.string().nullable(),
  }),
});

/**
 * The brief as the plugin ships it. The editor shows it as the placeholder when
 * nothing has been written over it, and Revert puts it back.
 */
export const readShippedPrompt = defineRpc({
  name: "radar.settings.prompt",
  input: z.object({ task: z.enum(TASKS) }),
  output: z.object({ text: z.string(), error: z.string().nullable() }),
});

/**
 * The legacy `config.json`, offered for import once. Present means the file is
 * there and holds at least one value the settings document does not.
 */
export const readLegacyConfig = defineRpc({
  name: "radar.settings.legacy",
  input: z.object({}),
  output: z.object({
    /** The file's values, already validated against the schema. */
    values: z.record(z.string(), z.unknown()).nullable(),
    path: z.string(),
    error: z.string().nullable(),
  }),
});
