import { useAnimationFrame } from "motion/react";
import { useCallback, useRef, useState } from "react";

// the fake bot every chat variant talks to. it runs on the lab's clock (motion's frame loop, slowed by the speed
// control), so 0.25x and 0.1x stretch every stage: the send, the thinking, the tool line, each word and the finish.

export type Msg = {
  /** stable across the optimistic copy and the "server" copy, as the app's send:<sendId> row key */
  key: string;
  id: string;
  role: "user" | "bot";
  /** what has arrived so far */
  text: string;
  state: "sending" | "sent" | "streaming" | "done" | "stopped";
  /** the bot row of a turn that was stopped mid-stream */
  stopped?: boolean;
};

export type Phase = "idle" | "thinking" | "tool" | "streaming";
export type Kind = "sample" | "long" | "tool" | "fast";

type Script = { think: number; tool?: string; toolMs?: number; text: string; gap: [number, number] };

const SAMPLES = [
  "Sure. I moved the dentist to Thursday at 4pm and put a reminder an hour before. Want me to text Maya that Wednesday is free again?",
  "Done. The invoice for October is sent to Lena, and I set a follow up for next Tuesday if it is still unpaid.",
  "Here is the short version: the flight on Friday at 9:40 is the cheapest at 118 euros, and the 14:05 is only 20 more if you want a slower morning.",
];
const LONG =
  "Here is a plan for the week that keeps your mornings clear.\n\nMonday: clear the inbox before 10, then the two overdue invoices. I drafted both replies, they only need a look.\n\nTuesday: the pitch deck. I blocked 9 to 12 and moved the design sync to the afternoon so nothing cuts into it.\n\nWednesday and Thursday stay light on purpose. If the client call slips, it lands there.\n\nFriday: a quick review at 4, and I will send you a summary of what is done and what moved. Want me to put all of this in your calendar now?";
const TOOL_TEXT =
  "Three things stood out on the site. The pricing page takes 4 seconds to load on mobile, the signup form loses what you typed when you go back, and the footer links still point to the old docs. Want me to open issues for them?";
const FAST_TEXT = "Yes, it is booked. Table for two at 8.";

function scriptFor(kind: Kind, turn: number): Script {
  switch (kind) {
    case "long": return { think: 1400, text: LONG, gap: [30, 120] };
    case "tool": return { think: 900, tool: "Checking the site", toolMs: 2200, text: TOOL_TEXT, gap: [30, 130] };
    case "fast": return { think: 220, text: FAST_TEXT, gap: [20, 50] };
    default: return { think: 1200, text: SAMPLES[turn % SAMPLES.length]!, gap: [35, 140] };
  }
}

/** an engine's bursts: a few words at a time, uneven gaps, the odd stall */
function chunks(text: string, gap: [number, number], seed: number): Array<{ at: number; text: string }> {
  let state = seed;
  const rand = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const words = text.split(/(?<=\s)/);
  const out: Array<{ at: number; text: string }> = [];
  let at = 0;
  for (let i = 0; i < words.length;) {
    const size = 1 + Math.floor(rand() * (rand() < 0.15 ? 6 : 3));
    out.push({ at, text: words.slice(i, i + size).join("") });
    i += size;
    at += rand() < 0.06 ? 380 + rand() * 260 : gap[0] + rand() * (gap[1] - gap[0]);
  }
  return out;
}

export const SEED: Msg[] = [
  { key: "p1", id: "p1", role: "user", text: "Can you check if the dentist has anything this week?", state: "sent" },
  { key: "p2", id: "p2", role: "bot", text: "They have Wednesday at 9 and Thursday at 4. Wednesday clashes with your standup, so Thursday looks easier.", state: "done" },
  { key: "p3", id: "p3", role: "user", text: "Thursday then.", state: "sent" },
  { key: "p4", id: "p4", role: "bot", text: "Booked for Thursday at 4.", state: "done" },
  { key: "s0a", id: "s0a", role: "user", text: "Morning. What is on today?", state: "sent" },
  { key: "s0b", id: "s0b", role: "bot", text: "Morning. Two calls, the deck review at 2, and the October invoices are still open. Want me to start with the invoices?", state: "done" },
  { key: "s0c", id: "s0c", role: "user", text: "Yes, send the reminders. And find me a quiet hour for the deck.", state: "sent" },
  { key: "s0d", id: "s0d", role: "bot", text: "Reminders are out to Lena and Tom. I blocked 10 to 11 for the deck and moved the standup to 11:15.", state: "done" },
  { key: "s1", id: "s1", role: "user", text: "Can you find me a flight to Lisbon next Friday?", state: "sent" },
  { key: "s2", id: "s2", role: "bot", text: "I found 3 direct flights. The 09:40 is the cheapest at 118 euros and lands at 12:15. Want me to hold a seat?", state: "done" },
  { key: "s3", id: "s3", role: "user", text: "Yes, the 09:40 please. Window seat.", state: "sent" },
  { key: "s4", id: "s4", role: "bot", text: "Done. Seat 14A is held until 18:00 today.", state: "done" },
];

type Timed = { at: number; run: () => void };

export interface FakeBot {
  messages: Msg[];
  phase: Phase;
  tool: string | null;
  /** the turn that just ended was stopped by the person */
  stopped: boolean;
  busy: boolean;
  /** the key the reply of the running turn will have, so a bubble drawn before its first word is the same row */
  nextReplyKey: string;
  send: (text: string, kind?: Kind) => void;
  stop: () => void;
  /** send a long reply and stop it a little way into the words */
  stopDemo: () => void;
  reset: () => void;
}

export function useFakeBot(): FakeBot {
  const [messages, setMessages] = useState<Msg[]>(SEED);
  const [phase, setPhase] = useState<Phase>("idle");
  const [tool, setTool] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const now = useRef(0);
  const queue = useRef<Timed[]>([]);
  const turn = useRef(0);
  const live = useRef<string | null>(null);
  const [nextReplyKey, setNextReplyKey] = useState("reply-1");

  // lab time: motion's frame loop runs at the lab's speed
  useAnimationFrame((_, delta) => {
    now.current += Math.min(delta, 100);
    if (!queue.current.length) return;
    const due = queue.current.filter((item) => item.at <= now.current);
    if (!due.length) return;
    queue.current = queue.current.filter((item) => item.at > now.current);
    for (const item of due) item.run();
  });
  const at = (ms: number, run: () => void) => queue.current.push({ at: now.current + ms, run });

  const finish = useCallback((key: string, state: "done" | "stopped") => {
    setMessages((rows) => rows.map((row) => row.key === key ? { ...row, state, stopped: state === "stopped" } : row));
    setPhase("idle");
    setTool(null);
    live.current = null;
  }, []);

  const send = useCallback((text: string, kind: Kind = "sample") => {
    const body = text.trim();
    if (!body) return;
    queue.current = [];
    if (live.current) finish(live.current, "stopped");
    const n = ++turn.current;
    const sendKey = `send-${n}`;
    const script = scriptFor(kind, n);
    setStopped(false);
    setMessages((rows) => [...rows, { key: sendKey, id: `optimistic-${n}`, role: "user", text: body, state: "sending" }]);
    // the server's copy replaces the optimistic one under the same key: same row, no remount
    at(140, () => setMessages((rows) => rows.map((row) => row.key === sendKey ? { ...row, id: `m-${n}`, state: "sent" } : row)));
    at(kind === "fast" ? 60 : 240, () => setPhase("thinking"));
    let t = script.think;
    if (script.tool) {
      at(script.think * 0.6, () => { setPhase("tool"); setTool(script.tool!); });
      t += script.toolMs ?? 0;
    }
    const replyKey = `reply-${n}`;
    setNextReplyKey(replyKey);
    at(t, () => {
      live.current = replyKey;
      setTool(null);
      setPhase("streaming");
      setMessages((rows) => [...rows, { key: replyKey, id: `r-${n}`, role: "bot", text: "", state: "streaming" }]);
    });
    const parts = chunks(script.text, script.gap, n * 97 + 13);
    for (const part of parts) {
      at(t + 1 + part.at, () => setMessages((rows) => rows.map((row) => row.key === replyKey ? { ...row, text: row.text + part.text } : row)));
    }
    at(t + (parts.at(-1)?.at ?? 0) + 160, () => finish(replyKey, "done"));
  }, [finish]);

  const stop = useCallback(() => {
    if (!live.current && phase === "idle") return;
    queue.current = [];
    setStopped(true);
    if (live.current) finish(live.current, "stopped");
    else { setPhase("idle"); setTool(null); }
  }, [finish, phase]);

  const stopDemo = useCallback(() => {
    if (phase !== "idle") { stop(); return; }
    send("Plan my week, keep the mornings clear", "long");
    const after = now.current + 1400 + 1300;
    queue.current.push({ at: after, run: () => {
      queue.current = [];
      setStopped(true);
      if (live.current) finish(live.current, "stopped");
    } });
  }, [phase, send, stop, finish]);

  const reset = useCallback(() => {
    queue.current = [];
    live.current = null;
    setMessages(SEED);
    setPhase("idle");
    setTool(null);
    setStopped(false);
  }, []);

  return { messages, phase, tool, stopped, busy: phase !== "idle", nextReplyKey, send, stop, stopDemo, reset };
}

/** Words revealed at a steady cadence (one per `minWordMs` of lab time) however the engine bursts; a backlog of more
 * than three words drains within about `drainMs`. */
export function useSteadyWords(text: string, { minWordMs = 38, drainMs = 320 } = {}): { shown: number; total: number } {
  const words = text.split(/(?<=\s)/).filter(Boolean);
  const [shown, setShown] = useState(0);
  const carry = useRef(0);
  const target = useRef(words.length);
  target.current = words.length;
  useAnimationFrame((_, delta) => {
    if (shown >= target.current) { carry.current = 0; return; }
    const behind = target.current - shown;
    // a short backlog keeps the steady cadence; a long one drains within about drainMs
    const perWord = behind <= 3 ? minWordMs : Math.max(8, Math.min(minWordMs, drainMs / behind));
    carry.current += Math.min(delta, 100);
    const step = Math.floor(carry.current / perWord);
    if (step > 0) {
      carry.current -= step * perWord;
      setShown((count) => Math.min(target.current, count + step));
    }
  });
  return { shown: Math.min(shown, words.length), total: words.length };
}
