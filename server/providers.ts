import type { ProviderOption } from "../shared/settings";
import type { Paseo } from "./turn";

/**
 * What the model pickers are built from.
 *
 * Read from the daemon rather than from a list in this plugin, so a model
 * released after this was written is selectable without an edit here. The
 * snapshot carries providers, their modes and every model's thinking options in
 * one call, which is why it is preferred over `listModels` per provider.
 *
 * Discovery is lazy, so a cold daemon answers an immediate read with nothing.
 * `waitForReady` is what makes the first open of the screen show a full list
 * rather than an empty one that fills in if you leave and come back.
 */
export async function readProviderOptions(
  paseo: Paseo,
): Promise<{ providers: ProviderOption[]; error: string | null }> {
  let snapshot;
  try {
    snapshot = await paseo.providers.waitForReady({ timeoutMs: 20_000 });
  } catch {
    // A discovery that has not finished is not a reason to show nothing: what
    // has been found already is enough to pick a model that is installed.
    try {
      snapshot = await paseo.providers.snapshot();
    } catch (error) {
      return { providers: [], error: String(error) };
    }
  }

  const providers = snapshot.entries.map((entry): ProviderOption => {
    const models = (entry.models ?? [])
      // A model the provider marks unselectable cannot be launched, so offering
      // it would be offering a configuration that fails at the turn.
      .filter((model) => model.isSelectable !== false)
      .map((model) => ({
        id: model.id,
        label: model.label,
        description: model.description ?? null,
        thinking: (model.thinkingOptions ?? []).map((option) => ({
          id: option.id,
          label: option.label,
        })),
        defaultThinking: model.defaultThinkingOptionId ?? null,
      }));

    return {
      id: entry.provider,
      label: entry.label ?? entry.provider,
      available: entry.status === "ready",
      modes: (entry.modes ?? []).map((mode) => ({
        id: mode.id,
        label: mode.label,
      })),
      defaultMode: entry.defaultModeId ?? null,
      models,
    };
  });

  return { providers, error: null };
}
