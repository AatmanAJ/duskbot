import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";

/** `enabled`: usage counts and crash reports as the person sees them. `notes`: session notes, null until there is an
 * answer (no notes). `askUsage`: the account service places them where usage counts need a yes first (the EU, the EEA,
 * the UK, Switzerland, or nowhere it can tell) and they have not answered, so `enabled` reads off. `askNotes`: notes are
 * off, the person never answered about them (here or on the account) and has started really using dusk bot
 * (`realUse`), so the app asks, once: showing the ask records "no" until they say yes. */
export interface UsageSignalsChoice { enabled: boolean; notes: boolean | null; askUsage: boolean; askNotes: boolean }
/** what the account service says with each report answer; `notesAnswered`: the person answered about notes themselves */
export interface AccountChoice { optOut: boolean; notes?: boolean; notesAnswered?: boolean; askUsage?: boolean }
interface RealUse { turns: number; days: string[]; routine: boolean }
/** someone really using dusk bot, not just looking around: REAL_USE_TURNS finished turns with a reply over
 * REAL_USE_DAYS different days, or one routine that ran and worked */
export const REAL_USE_TURNS = 10, REAL_USE_DAYS = 2;
export const realUse = (use: RealUse) => use.routine || (use.turns >= REAL_USE_TURNS && use.days.length >= REAL_USE_DAYS);

/** "help improve dusk bot" (usage counts and, on the desktop, crash reports) and its separate "session notes" answer.
 * Counts are on unless the person turns them off (or DUSK_USAGE_SIGNALS=off), except where the account service says
 * to ask first; notes need an explicit yes and run only while counts are on too. Nothing is recorded or sent until the
 * workspace belongs to a dusk bot account: whoever signed in agreed to the terms and privacy policy.
 *
 * Both are the account's switches too. A change made here is kept as pending until a report to the account service
 * gets through, and the account's own state comes back on every report answer: the account turned off turns this off,
 * the account turned back on (after being seen off) turns it back on. `onOff` hears every turn to off, made here or on
 * the account, so what was already sent can be deleted. */
export function createUsageSignalsSwitch(dataDir: string, env: NodeJS.ProcessEnv = process.env, onOff?: (what: "usage" | "notes") => void) {
  const file = join(dataDir, "usage-signals.json");
  let on = true;
  // the salt for hashing bot, chat and routine ids in usage records; it never leaves this file
  let salt = "";
  // a local change the account has not heard yet (true is off), and the account's last answer
  let push: boolean | null = null, seen: boolean | null = null;
  // a workspace the account service has answered for; an account's answer recorded before this flag counts too
  let account = false;
  // the person answered about usage counts here; the account's last ask-first flag
  let answered = false, ask = false;
  let notes: boolean | null = null, notesPush: boolean | null = null, notesAnswered = false;
  let use: RealUse = { turns: 0, days: [], routine: false };
  try {
    const saved = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    on = saved.enabled !== false;
    if (typeof saved.salt === "string" && /^[A-Za-z0-9_-]{22,}$/.test(saved.salt)) salt = saved.salt;
    if (typeof saved.push === "boolean") push = saved.push;
    if (typeof saved.seen === "boolean") seen = saved.seen;
    account = saved.account === true || seen !== null;
    answered = saved.answered === true;
    ask = saved.ask === true;
    if (typeof saved.notes === "boolean") notes = saved.notes;
    if (typeof saved.notesPush === "boolean") notesPush = saved.notesPush;
    notesAnswered = saved.notesAnswered === true;
    const u = saved.use as Partial<RealUse> | undefined;
    if (u && typeof u === "object") use = { turns: Number.isSafeInteger(u.turns) ? u.turns! : 0, days: Array.isArray(u.days) ? u.days.filter((day): day is string => typeof day === "string").slice(-REAL_USE_DAYS) : [], routine: u.routine === true };
  } catch {}
  const write = () => writeFileAtomic(file, JSON.stringify({ enabled: on, salt, ...(account ? { account } : {}), ...(push !== null ? { push } : {}), ...(seen !== null ? { seen } : {}),
    ...(answered ? { answered } : {}), ...(ask ? { ask } : {}), ...(notes !== null ? { notes } : {}), ...(notesPush !== null ? { notesPush } : {}), ...(notesAnswered ? { notesAnswered } : {}), use }), { mode: 0o600 });
  const save = () => { try { write(); } catch {} };
  const asking = () => ask && !answered;
  const chosen = () => on && env.DUSK_USAGE_SIGNALS !== "off" && !asking();
  const off = (what: "usage" | "notes") => { try { onOff?.(what); } catch {} };
  const choice = (): UsageSignalsChoice => ({ enabled: chosen(), notes, askUsage: asking(), askNotes: account && chosen() && notes !== true && !notesAnswered && realUse(use) });
  return {
    /** whether usage signals are recorded and sent: the switch is on and the workspace has signed in */
    enabled: () => chosen() && account,
    /** whether session notes are written and sent: a yes to notes, with usage counts on */
    notesEnabled: () => chosen() && account && notes === true,
    /** the switches as the person sees them; counts read on by default even before sign-in */
    choice,
    /** the person's own usage setting, without the ask-first default, for following them to their other places */
    setting: () => on,
    signedIn: () => account,
    /** the person's choice in this app; the account is told with the next report */
    set(next: { enabled?: boolean; notes?: boolean }) {
      const wasUsage = chosen(), wasNotes = chosen() && notes === true;
      if (typeof next.enabled === "boolean") { on = next.enabled; push = !on; answered = true; }
      if (typeof next.notes === "boolean") { notes = next.notes; notesPush = notes; notesAnswered = true; }
      write();
      if (wasUsage && !chosen()) off("usage");
      else if (wasNotes && !(chosen() && notes === true)) off("notes");
    },
    /** what the next report tells the account: true is off, null when nothing changed here */
    pending: (): boolean | null => push,
    /** the notes answer the next report carries, null when the account has it */
    notesPending: (): boolean | null => notesPush,
    /** a report carrying these values got through */
    pushed(value: boolean, notesValue: boolean | null = null) {
      let changed = false;
      if (push === value) { push = null; seen = value; changed = true; }
      if (notesValue !== null && notesPush === notesValue) { notesPush = null; changed = true; }
      if (changed) save();
    },
    /** the account's switches as its report answer gave them; returns the choice when it changed it */
    fromAccount(answer: boolean | AccountChoice): UsageSignalsChoice | null {
      const from: AccountChoice = typeof answer === "boolean" ? { optOut: answer } : answer;
      const wasUsage = chosen(), wasNotes = chosen() && notes === true, before_ = JSON.stringify(choice());
      let dirty = false;
      if (!account) { account = true; dirty = true; }
      if (typeof from.askUsage === "boolean" && from.askUsage !== ask) { ask = from.askUsage; dirty = true; }
      if (notesPush === null && from.notes !== undefined) {
        // an answer given here before the account kept one goes up; otherwise the account's answer is the answer
        if (from.notesAnswered === false && notesAnswered && notes !== null) { notesPush = notes; dirty = true; }
        else if (typeof from.notes === "boolean" && from.notes !== notes) { notes = from.notes; dirty = true; }
        if (from.notesAnswered === true && !notesAnswered) { notesAnswered = true; dirty = true; }
      }
      // while the account asks first, its opt-out only stands for "not answered"
      if (push === null && !from.askUsage) {
        const before = seen;
        // a choice made before the account was told about it is told now
        if (!on && before === null) { push = true; dirty = true; }
        else {
          if (seen !== from.optOut) { seen = from.optOut; dirty = true; }
          if (from.optOut && on) { on = false; dirty = true; }
          else if (!from.optOut && before === true && !on) { on = true; dirty = true; }
        }
      }
      if (dirty) save();
      if (wasUsage && !chosen()) off("usage");
      else if (wasNotes && !(chosen() && notes === true)) off("notes");
      const now_ = choice();
      return JSON.stringify(now_) !== before_ ? now_ : null;
    },
    /** a finished turn with a reply, or a routine run that worked; counted here only, for `askNotes` */
    used(what: "turn" | "routine", at = Date.now()) {
      if (realUse(use)) return;
      if (what === "routine") use.routine = true;
      else { use.turns++; const day = new Date(at).toISOString().slice(0, 10); if (!use.days.includes(day)) use.days = [...use.days, day].slice(-REAL_USE_DAYS); }
      save();
    },
    salt(): string {
      if (!salt) { salt = randomBytes(18).toString("base64url"); save(); }
      return salt;
    },
  };
}
export type UsageSignalsSwitch = ReturnType<typeof createUsageSignalsSwitch>;
