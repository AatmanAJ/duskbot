const NOISE = new Set(["instruct", "versatile", "chat", "latest", "preview", "it", "hf", "free"]);

/** A model id reduced to what names the model itself: no vendor prefix, no `:free` or `:latest` tag, no packaging words. */
function core(id: string): string {
  const name = id.toLowerCase().split("/").at(-1)!.replace(/:[a-z0-9_.-]+$/, "");
  return name.split(/[^a-z0-9]+/).filter((word) => word && !NOISE.has(word)).join("");
}

/** The one model a server lists that `asked` clearly means, as when a bot saved OpenRouter's
 * "meta-llama/llama-3.3-70b-instruct" talks to Groq, which serves it as "llama-3.3-70b-versatile"; undefined when the
 * server has it under that very name, or when no single listed model matches. */
export function intendedModel(asked: string, listed: readonly string[]): string | undefined {
  if (listed.includes(asked)) return undefined;
  const wanted = core(asked);
  if (!wanted) return undefined;
  const matches = [...new Set(listed.filter((id) => core(id) === wanted))];
  return matches.length === 1 ? matches[0] : undefined;
}

/** A failed turn's words for a model its server does not have: the "'s model is unavailable" wording is what the
 * failure card reads as a model to switch. */
export function unavailableModelMessage(model: string, listed: readonly string[]): string {
  const shown = listed.slice(0, 5).map((id) => `"${id}"`).join(", ");
  const why = model.trim() ? `its server has no model named "${model.slice(0, 120)}"` : "no model is chosen for it and its server listed none";
  return `This AI's model is unavailable: ${why}. Pick another model for this bot${shown ? `, such as ${shown}` : ""}.`;
}

const UNKNOWN_MODEL = /\bHTTP 404\b|model[_ ]not[_ ](?:found|exist)|\bmodel not exist|\b(?:unknown|invalid|unsupported) model\b|\bdoes not exist\b|no endpoints found|模型不存在/i;

/** A provider's refusal that says it has no such model. */
export const namesUnknownModel = (error: Error): boolean => UNKNOWN_MODEL.test(error.message);

export const modelSwapNotice = (asked: string, used: string): string => `This AI's server has no model named "${asked}", so this reply uses its "${used}".`;
