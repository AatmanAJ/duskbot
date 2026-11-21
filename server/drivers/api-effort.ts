import type { EffortLevel, ModelCatalog } from "../contracts.ts";

/** An API engine's reasoning effort: every level any of its models takes, and the levels of one model (none when it
 * takes no effort, so it is never sent one). */
export interface ModelEffort {
  levels: readonly EffortLevel[];
  forModel(model: string): readonly EffortLevel[] | undefined;
}

/** The level a turn asked for, when `model` takes it. */
export function chosenEffort(effort: ModelEffort | undefined, model: string, requested: EffortLevel | undefined): EffortLevel | undefined {
  return requested && effort?.forModel(model)?.includes(requested) ? requested : undefined;
}

/** The catalog with each model's own levels on it, so a picker offers a level only where the model takes one. */
export function withModelEfforts(catalog: ModelCatalog, effort: ModelEffort): ModelCatalog {
  return {
    ...catalog,
    options: catalog.options.map((option) => {
      const levels = effort.forModel(option.id);
      return levels?.length ? { ...option, effortLevels: levels } : option;
    }),
  };
}

const STANDARD: readonly EffortLevel[] = ["low", "medium", "high"];
const WITH_XHIGH: readonly EffortLevel[] = ["low", "medium", "high", "xhigh"];

/** OpenAI's reasoning models (the o series and the gpt-5 family, not its `-chat` aliases) take low, medium and high:
 * https://platform.openai.com/docs/guides/reasoning */
export function openAiEffortLevels(model: string): readonly EffortLevel[] | undefined {
  const id = model.replace(/^openai\//, "");
  return /^(o\d|gpt-5)/.test(id) && !/-chat\b/.test(id) ? STANDARD : undefined;
}

/** Gemini's OpenAI-compatible endpoint maps `reasoning_effort` onto thinking for 2.5 and later:
 * https://ai.google.dev/gemini-api/docs/openai */
export function geminiEffortLevels(model: string): readonly EffortLevel[] | undefined {
  return /^(models\/)?gemini-(2\.5|[3-9])/.test(model) ? STANDARD : undefined;
}

/** xAI takes `reasoning_effort` on grok-4.5 and later (xhigh from 4.6) and on grok-3-mini (low, high); grok-4 and
 * grok-4-fast have none: https://docs.x.ai/docs/guides/reasoning */
export function xaiEffortLevels(model: string): readonly EffortLevel[] | undefined {
  const version = /^grok-4\.(\d+)/.exec(model)?.[1];
  if (version !== undefined) return Number(version) >= 6 ? WITH_XHIGH : Number(version) >= 5 ? STANDARD : undefined;
  return model.startsWith("grok-3-mini") ? ["low", "high"] : undefined;
}
