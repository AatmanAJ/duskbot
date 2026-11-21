// Words spoken on a Live call are never logged: such a turn shows `text=(spoken)`.

import { redactSecretsInText } from "../shared/redact.ts";

export interface TurnStartLog {
  botId: string;
  text: string;
  images: number;
  depth: number;
  card: boolean;
  spoken: boolean;
}

const LOGGED_CHARS = 70;
/** Security: masking runs before the cut, over enough text to hold a whole key that starts in the logged part
 * (a PEM private key block is the longest), so the cut never leaves the front of a key unmasked. */
const MASKED_CHARS = 16_384;

export function turnStartLogLine(turn: TurnStartLog): string {
  const text = turn.spoken ? "(spoken)" : JSON.stringify(redactSecretsInText(turn.text.slice(0, MASKED_CHARS)).slice(0, LOGGED_CHARS));
  return `[dusk-turn] bot=${turn.botId} text=${text} images=${turn.images} depth=${turn.depth} card=${turn.card}`;
}
