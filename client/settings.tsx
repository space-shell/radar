import type { PluginTheme } from "@getpaseo/plugin";
import {
  useRpc,
  useSettings,
  type PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsGroup,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useKeyboardAvoidance, type Measurable } from "./keyboard";
import {
  DEFAULT_AGENT,
  TASKS,
  TASK_LABELS,
  TASK_NOTES,
  agentFor,
  baseAgent,
  needsOwnAgent,
  radarSettings,
  readLegacyConfig,
  readProviders,
  readShippedPrompt,
  type AgentSpec,
  type ProviderOption,
  type RadarSettings,
  type Task,
} from "../shared/settings";
import { MultilineInput } from "./multiline";

/** The list the pickers are built from, read once and shared by all four tasks. */
function useProviders() {
  const read = useRpc(readProviders);
  return useQuery({
    queryKey: ["radar", "providers"],
    queryFn: () => read({}),
    staleTime: 5 * 60_000,
  });
}

function useShippedPrompt(task: Task) {
  const read = useRpc(readShippedPrompt);
  return useQuery({
    queryKey: ["radar", "shipped-brief", task],
    queryFn: () => read({ task }),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

function useLegacy() {
  const read = useRpc(readLegacyConfig);
  return useQuery({
    queryKey: ["radar", "legacy-config"],
    queryFn: () => read({}),
    staleTime: 60_000,
  });
}

/**
 * A picker built from whatever the daemon reported, with the stored value kept
 * selectable even when it was not in the list. A provider that is installed on
 * the other machine must not be silently rewritten to something else just
 * because this one cannot see it.
 */
function options(
  known: readonly { id: string; label: string }[],
  current: string,
) {
  const listed = known.map((entry) => ({
    label: entry.label,
    value: entry.id,
  }));
  if (current === "" || listed.some((entry) => entry.value === current)) {
    return listed;
  }
  return [
    ...listed,
    { label: `${current} (not installed here)`, value: current },
  ];
}

interface AgentPickerProps {
  spec: AgentSpec;
  providers: ProviderOption[];
  disabled: boolean;
  onChange(spec: AgentSpec): void;
}

function AgentPicker({
  spec,
  providers,
  disabled,
  onChange,
}: AgentPickerProps) {
  const provider = providers.find((entry) => entry.id === spec.provider);
  const model = provider?.models.find((entry) => entry.id === spec.model);

  return (
    <>
      <SettingsSelect
        label="Provider"
        value={spec.provider}
        disabled={disabled}
        options={options(
          providers.map((entry) => ({
            id: entry.id,
            label: entry.available
              ? entry.label
              : `${entry.label} (unavailable)`,
          })),
          spec.provider,
        )}
        onValueChange={(next) => {
          // The model belongs to the provider, so changing one invalidates the
          // other. Landing on the new provider's own default beats holding a
          // model it has never heard of.
          const chosen = providers.find((entry) => entry.id === next);
          const first = chosen?.models[0];
          onChange({
            provider: next,
            model: first?.id ?? "",
            thinking: first?.defaultThinking ?? "",
            mode: chosen?.defaultMode ?? "",
          });
        }}
      />
      <SettingsSelect
        label="Model"
        hint={model?.description ?? undefined}
        value={spec.model}
        disabled={disabled}
        options={options(provider?.models ?? [], spec.model)}
        onValueChange={(next) => {
          const chosen = provider?.models.find((entry) => entry.id === next);
          onChange({
            ...spec,
            model: next,
            thinking: chosen?.defaultThinking ?? "",
          });
        }}
      />
      <SettingsSelect
        label="Thinking"
        hint="The model's own default, unless one is named here."
        value={spec.thinking}
        disabled={disabled}
        options={[
          { label: "Default", value: "" },
          ...options(model?.thinking ?? [], spec.thinking),
        ]}
        onValueChange={(thinking) => onChange({ ...spec, thinking })}
      />
      <SettingsSelect
        label="Mode"
        hint="The provider's own default, unless one is named here."
        value={spec.mode}
        disabled={disabled}
        options={[
          { label: "Default", value: "" },
          ...options(provider?.modes ?? [], spec.mode),
        ]}
        onValueChange={(mode) => onChange({ ...spec, mode })}
      />
    </>
  );
}

interface TaskSectionProps {
  task: Task;
  draft: RadarSettings;
  providers: ProviderOption[];
  theme: PluginTheme;
  onChange(values: RadarSettings): void;
  onReveal(node: Measurable | null): void;
}

function TaskSection({
  task,
  draft,
  providers,
  theme,
  onChange,
  onReveal,
}: TaskSectionProps) {
  const shipped = useShippedPrompt(task);
  const config = draft.tasks[task];
  const own = config.agent !== null;
  const spec = agentFor(draft, task);

  const setTask = (patch: { prompt?: string; agent?: AgentSpec | null }) =>
    onChange({
      ...draft,
      tasks: { ...draft.tasks, [task]: { ...config, ...patch } },
    });

  const note = needsOwnAgent(draft, task)
    ? "This task runs on an agent of its own, created in the pull request's workspace the first time it is used."
    : task === "intake"
      ? "Every task without a model of its own runs on this agent."
      : "Answered by intake's agent. Nothing extra is created.";

  return (
    <SettingsSection title={TASK_LABELS[task]}>
      <SettingsRow label="What it does" hint={TASK_NOTES[task]} />
      {task === "intake" ? null : (
        <SettingsSwitch
          label="Use intake's agent"
          hint={note}
          value={!own}
          onValueChange={(inherit) =>
            setTask({ agent: inherit ? null : { ...baseAgent(draft) } })
          }
        />
      )}
      {task === "intake" ? <SettingsRow label="Agent" hint={note} /> : null}
      {task === "intake" || own ? (
        <AgentPicker
          spec={spec}
          providers={providers}
          disabled={false}
          onChange={(next) => setTask({ agent: next })}
        />
      ) : null}
      <MultilineInput
        label="Brief"
        hint={
          config.prompt === ""
            ? "Empty means the brief this plugin ships, shown greyed below. Anything typed here replaces it."
            : "Edited. Clear the field to go back to the brief this plugin ships."
        }
        lines={10}
        theme={theme}
        onReveal={onReveal}
        initialValue={config.prompt}
        placeholder={shipped.data?.text ?? "Loading the shipped brief"}
        onChangeText={(prompt) => setTask({ prompt })}
      />
      {config.prompt === "" ? null : (
        <SettingsAction
          label="Revert this brief"
          hint="Puts back the brief this plugin ships and drops the edit."
          actionLabel="Revert"
          onPress={() => setTask({ prompt: "" })}
        />
      )}
    </SettingsSection>
  );
}

/** A list edited as one line, which is how a handful of paths reads best. */
const joinList = (values: string[]) => values.join(", ");
const splitList = (text: string) =>
  text
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

/** A whole number, or the value left alone when what was typed is not one. */
const asInt = (text: string, fallback: number) => {
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

interface FormProps {
  values: RadarSettings;
  revision: string;
  saving: boolean;
  saveError: string | null;
  theme: PluginTheme;
  save(values: RadarSettings, revision: string): Promise<boolean>;
  reset(): Promise<boolean>;
}

/**
 * Holds what the fields were last seeded with.
 *
 * Every text field on this screen is uncontrolled, which is what keeps typing
 * from re-rendering the form and moving the cursor. The cost is that setting the
 * draft from code, which is what Discard and Import do, does not reach them: the
 * field would keep showing the old text and write it back on the next keystroke.
 * Remounting on a counter is what makes those two buttons true.
 */
function Form(props: FormProps) {
  const [seed, setSeed] = useState<{ count: number; values: RadarSettings }>({
    count: 0,
    values: props.values,
  });
  return (
    <Fields
      {...props}
      key={seed.count}
      values={seed.values}
      saved={props.values}
      reseed={(values) =>
        setSeed((current) => ({ count: current.count + 1, values }))
      }
    />
  );
}

interface FieldsProps extends FormProps {
  /** What is on disk, which is what Save is compared against. */
  saved: RadarSettings;
  reseed(values: RadarSettings): void;
}

/** The screen fills its host, and the keyboard takes its share of the bottom. */
const FILL = { flex: 1 } as const;

function Fields({
  values,
  saved,
  revision,
  saving,
  saveError,
  theme,
  save,
  reset,
  reseed,
}: FieldsProps) {
  const [draft, setDraft] = useState<RadarSettings>(values);
  const providers = useProviders();
  const legacy = useLegacy();
  const {
    inset,
    rootRef,
    viewportRef,
    scrollRef,
    onRootLayout,
    onViewportLayout,
    onScroll,
    reveal,
  } = useKeyboardAvoidance();

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved],
  );
  const patch = (next: Partial<RadarSettings>) =>
    setDraft((current) => ({ ...current, ...next }));

  const list = providers.data?.providers ?? [];
  const agentCount =
    1 + TASKS.filter((task) => needsOwnAgent(draft, task)).length;

  return (
    // A ten line brief with the save controls under it, on a screen whose only
    // scroll is this one. AC-AL5.
    <View
      ref={rootRef}
      onLayout={onRootLayout}
      style={inset > 0 ? [FILL, { paddingBottom: inset }] : FILL}
    >
      <View ref={viewportRef} onLayout={onViewportLayout} style={FILL}>
        <ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          <SettingsGroup title="Radar">
            <SettingsSection title="Intake">
              <SettingsSwitch
                label="Dry run"
                hint="Logs the launch it would make and creates nothing. The safe state to leave a new machine in."
                value={draft.dryRun}
                onValueChange={(dryRun) => patch({ dryRun })}
              />
              <SettingsInput
                label="Notification poll"
                hint="Seconds between notification checks. GitHub's own X-Poll-Interval wins when it asks for longer."
                initialValue={String(draft.notificationPollSeconds)}
                onChangeText={(text) =>
                  patch({
                    notificationPollSeconds: asInt(
                      text,
                      draft.notificationPollSeconds,
                    ),
                  })
                }
              />
              <SettingsInput
                label="Full search"
                hint="Seconds between full searches, which catch a review request that sent no notification."
                initialValue={String(draft.searchIntervalSeconds)}
                onChangeText={(text) =>
                  patch({
                    searchIntervalSeconds: asInt(
                      text,
                      draft.searchIntervalSeconds,
                    ),
                  })
                }
              />
              <SettingsInput
                label="Checkout roots"
                hint="Directories scanned for clones, comma separated. Every repository one level down is mapped by its origin."
                initialValue={joinList(draft.checkoutRoots)}
                onChangeText={(text) =>
                  patch({ checkoutRoots: splitList(text) })
                }
              />
              <SettingsInput
                label="Development environment"
                hint="The command that enters it, named in the prompt of every agent this plugin launches. Empty for none."
                initialValue={draft.setupCommand ?? ""}
                onChangeText={(text) =>
                  patch({ setupCommand: text.trim() === "" ? null : text })
                }
              />
            </SettingsSection>

            <SettingsSection
              title="Agents"
              info={
                <Text
                  style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}
                >
                  {agentCount === 1
                    ? "One agent per pull request."
                    : `${agentCount} agents per pull request, once every task has run.`}
                </Text>
              }
            >
              <SettingsRow
                label="How these are counted"
                hint="A task runs on intake's agent unless it is given a different model, so choosing the same model twice costs nothing. A task with its own model gets its own agent, in the pull request's own workspace, created the first time it runs."
              />
            </SettingsSection>

            {TASKS.map((task) => (
              <TaskSection
                key={task}
                task={task}
                draft={draft}
                providers={list}
                theme={theme}
                onChange={setDraft}
                onReveal={reveal}
              />
            ))}

            <SettingsSection title="Linear">
              <SettingsInput
                label="Workspace"
                hint="The slug in a Linear URL. Empty turns the Linear half off."
                initialValue={draft.linearWorkspace ?? ""}
                onChangeText={(text) =>
                  patch({
                    linearWorkspace: text.trim() === "" ? null : text.trim(),
                  })
                }
              />
              <SettingsInput
                label="Team keys"
                hint="Comma separated. A body naming ENG-1234 only becomes a link when ENG is listed here."
                initialValue={joinList(draft.linearTeamKeys)}
                onChangeText={(text) =>
                  patch({ linearTeamKeys: splitList(text) })
                }
              />
              <SettingsInput
                label="API key command"
                hint="The command that prints the key, as a command and its arguments separated by spaces. The key itself is never stored here, never logged and never shown back."
                initialValue={joinList(draft.linearKeyCommand)}
                onChangeText={(text) =>
                  patch({ linearKeyCommand: splitList(text) })
                }
              />
              <SettingsInput
                label="Linear poll"
                hint="Seconds between Linear notification checks."
                initialValue={String(draft.linearPollSeconds)}
                onChangeText={(text) =>
                  patch({
                    linearPollSeconds: asInt(text, draft.linearPollSeconds),
                  })
                }
              />
            </SettingsSection>

            <SettingsSection title="Binaries">
              <SettingsRow
                label="Why these are here"
                hint="A bare name is looked up on PATH, which is right when the daemon has one holding them. It does not reliably, so an absolute path belongs here rather than in the code."
              />
              <SettingsInput
                label="paseo"
                initialValue={draft.paseoPath}
                onChangeText={(paseoPath) => patch({ paseoPath })}
              />
              <SettingsInput
                label="gh"
                initialValue={draft.ghPath}
                onChangeText={(ghPath) => patch({ ghPath })}
              />
              <SettingsInput
                label="git"
                initialValue={draft.gitPath}
                onChangeText={(gitPath) => patch({ gitPath })}
              />
            </SettingsSection>

            {legacy.data?.values ? (
              <SettingsSection title="The old config.json">
                <SettingsAction
                  label="Import it"
                  hint={`${legacy.data.path} is what this plugin acts on until something is saved here. Importing copies it in, after which this file is ignored.`}
                  actionLabel="Import"
                  disabled={saving}
                  onPress={() => {
                    const parsed = radarSettings.schema.safeParse(
                      legacy.data?.values,
                    );
                    if (parsed.success) reseed(parsed.data);
                  }}
                />
              </SettingsSection>
            ) : null}

            <SettingsSection title="Saving">
              {saveError ? (
                <SettingsRow label="The last save failed" error={saveError} />
              ) : null}
              {providers.data?.error ? (
                <SettingsRow
                  label="The provider list is short"
                  error={providers.data.error}
                />
              ) : null}
              <SettingsAction
                label="Save"
                hint={dirty ? "Unsaved changes." : "Nothing to save."}
                actionLabel={saving ? "Saving" : "Save"}
                disabled={!dirty || saving}
                onPress={() => void save(draft, revision)}
              />
              <SettingsAction
                label="Discard"
                hint="Puts every field back to what is saved."
                actionLabel="Discard"
                disabled={!dirty || saving}
                onPress={() => reseed(saved)}
              />
              <SettingsAction
                label="Reset everything"
                hint="Back to the defaults, which is a dry run that creates nothing."
                actionLabel="Reset"
                disabled={saving}
                onPress={() => void reset()}
              />
            </SettingsSection>
          </SettingsGroup>
        </ScrollView>
      </View>
    </View>
  );
}

export function Settings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(radarSettings);
  const message = (text: string) => (
    <View style={{ padding: 24 }}>
      <Text style={{ color: theme.colors.foregroundMuted }}>{text}</Text>
    </View>
  );

  if (settings.status === "loading") return message("Reading the settings");
  if (settings.status === "error") return message(settings.error);
  if (settings.status === "invalid") {
    return (
      <View style={{ padding: 24, gap: 12 }}>
        <Text style={{ color: theme.colors.foreground }}>
          The saved settings do not match what this version of the plugin
          expects, so nothing is shown rather than a form that would overwrite
          them with guesses.
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted }}>
          {settings.error}
        </Text>
        <SettingsAction
          label="Reset to the defaults"
          hint="Discards the saved document. The plugin goes back to a dry run."
          actionLabel="Reset"
          onPress={() => void settings.reset()}
        />
      </View>
    );
  }

  return (
    <Form
      // Remounted on every revision, which is what reseeds the uncontrolled
      // text fields after a save or an edit made on another device.
      key={settings.revision}
      values={settings.values}
      revision={settings.revision}
      saving={settings.saving}
      saveError={settings.saveError}
      theme={theme}
      save={settings.save}
      reset={settings.reset}
    />
  );
}
