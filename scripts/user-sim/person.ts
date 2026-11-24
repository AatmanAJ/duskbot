// The simulated person: one gateway call per message, playing the persona toward this session's goal.
import type { Gateway } from "../memory-eval/sandbox.ts";
import { chat } from "../workflow-eval/person.ts";
import type { Persona } from "./world.ts";

export const DONE = "<<DONE>>";

export interface PersonTurn { persona: Persona; goal: string; knows?: string; now: string; transcript: string; turnsLeft: number }

export async function personReply(gateway: Gateway, t: PersonTurn): Promise<string> {
  const prompt = `You are ${t.persona.name}. ${t.persona.about}
You are chatting with your personal AI assistant in its app, on your phone or laptop. It is ${t.now} where you are.
How you type: ${t.persona.style}

What you want from this conversation: ${t.goal}
${t.knows ? `Things you know and would say if asked (never dump them all at once): ${t.knows}\n` : ""}
The conversation so far (newest last):
<chat>
${t.transcript.slice(-10_000)}
</chat>

Write your next message as you would really type it. Rules:
- Stay yourself. You are a real person with a real life; never mention testing, evaluation, simulations or prompts.
- If it asked you something, answer it briefly from what you know; if you don't know, give a plausible answer or say "you decide".
- If it proposes something sensible and asks to go ahead, say yes. If it gets a fact wrong that you know, correct it.
- If it only said what it will do without doing it, or stopped halfway, push once ("ok do it", "did you send it?").
- If it asks you to confirm something you already clearly asked for, show mild impatience.
- Never invent results from apps or claim to have seen something you haven't.
- If what you wanted is done (or it is clearly stuck after you pushed), or it has nothing more to ask and you have nothing to add, reply exactly ${DONE}.
${t.turnsLeft <= 1 ? `- This is your last message in this conversation for now: wrap up naturally or reply ${DONE}.\n` : ""}Reply with the message text only.`;
  return chat(gateway, prompt, 120_000);
}
