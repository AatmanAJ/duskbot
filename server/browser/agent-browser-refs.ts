// agent-browser 0.37.0 keeps one ref map for the whole browser and clears it on every tab switch, even to the tab already
// in front (handle_tab_switch), so a conversation sent back to its own tab after another conversation or the person used
// the browser holds refs the engine no longer knows ("Unknown ref: e5"). Its next snapshot numbers from e1 again, so an
// old number could name a different element. A conversation's refs are carried across such a switch: the snapshot it
// last read is taken again with the same arguments, and each old ref maps to the element with the same role and name at
// the same place among those, when the page has exactly as many of them as before.

import { RefusedCall } from "../browser-refusals.ts";

type Refs = Map<string, { role: string; name: string }>;

interface Shot {
  args: Record<string, unknown>;
  refs: Refs;
  /** Old ref to the engine's current one, while the engine's numbering is not the one the conversation read. */
  carried: Map<string, string> | null;
}

export type SnapshotRpc = (args: Record<string, unknown>) => Promise<unknown>;

const REF = /^\s*(?:@|ref=)?(e\d+)\s*$/u;
const LINE = /^\s*- ([^\s"[\]]+)(?: "((?:[^"\\]|\\.)*)")?.*\[ref=(e\d+)\]/u;
/** Calls after which the conversation's refs name nothing on the page it is on. */
const RESETS = new Set(["agent_browser_back", "agent_browser_forward", "agent_browser_reload", "agent_browser_tab_new",
  "agent_browser_tab_switch", "agent_browser_tab_close", "agent_browser_close"]);

/** The snapshot the runtime adds to an open's answer. */
const OPEN_SNAPSHOT: Readonly<Record<string, unknown>> = { compact: true };

const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null);

function failed(result: unknown): boolean {
  const shown = record(result);
  return !shown || shown.isError === true;
}

/** The refs a snapshot (or an open, which carries one) printed, in their order. */
export function refsOf(result: unknown): Refs | null {
  if (failed(result)) return null;
  const refs: Refs = new Map();
  const data = record(record(record(record(result)?.structuredContent)?.response)?.data);
  for (const [ref, value] of Object.entries(record(data?.refs) ?? {})) {
    const entry = record(value);
    if (entry && /^e\d+$/u.test(ref)) refs.set(ref, { role: String(entry.role ?? ""), name: String(entry.name ?? "") });
  }
  if (!refs.size) {
    const content = record(result)?.content;
    for (const part of Array.isArray(content) ? content : []) {
      const text = record(part)?.type === "text" ? record(part)?.text : undefined;
      if (typeof text !== "string") continue;
      for (const line of text.split("\n")) {
        const item = LINE.exec(line);
        if (!item) continue;
        let name = item[2] ?? "";
        try { name = JSON.parse(`"${name}"`) as string; } catch {}
        refs.set(item[3]!, { role: item[1]!, name });
      }
    }
  }
  const order = (ref: string) => Number(ref.slice(1));
  return refs.size ? new Map([...refs].sort(([a], [b]) => order(a) - order(b))) : null;
}

function groups(refs: Refs): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const [ref, { role, name }] of refs) {
    const key = `${role}\u0000${name}`;
    grouped.set(key, [...(grouped.get(key) ?? []), ref]);
  }
  return grouped;
}

/** Old refs to fresh ones by role, name and place among the same, only where the counts agree. */
export function translateRefs(old: Refs, fresh: Refs): Map<string, string> {
  const now = groups(fresh);
  const map = new Map<string, string>();
  for (const [key, refs] of groups(old)) {
    const matched = now.get(key);
    if (matched?.length === refs.length) refs.forEach((ref, i) => map.set(ref, matched[i]!));
  }
  return map;
}

export const carriedRefMissing = (ref: string) =>
  `The browser went back to this conversation's tab after another conversation or the person used it, which resets refs, and ${ref} from your last snapshot has no single match on the page now. Take a fresh snapshot and use its refs.`;

export class CarriedRefs {
  readonly #shots = new Map<string, Shot>();

  #key(session: string, threadId: string): string {
    return `${session}\u0000${threadId}`;
  }

  /** After a call: a snapshot or an open is what the conversation now holds refs from; a page change leaves it none. */
  saw(session: string, threadId: string, tool: string, args: unknown, result: unknown): void {
    const key = this.#key(session, threadId);
    if (RESETS.has(tool) || (tool === "agent_browser_click" && record(args)?.newTab === true)) {
      if (!failed(result)) this.#shots.delete(key);
      return;
    }
    if (tool !== "agent_browser_snapshot" && tool !== "agent_browser_open") return;
    if (tool === "agent_browser_open") this.#shots.delete(key);
    const refs = refsOf(result);
    if (!refs) return;
    this.#shots.set(key, { args: tool === "agent_browser_open" ? OPEN_SNAPSHOT : { ...(record(args) ?? {}) }, refs, carried: null });
  }

  /** The engine cleared its refs by switching to this conversation's tab: snapshot again and map the old refs over. */
  async restore(session: string, threadId: string, snapshot: SnapshotRpc): Promise<void> {
    const shot = this.#shots.get(this.#key(session, threadId));
    if (!shot) return;
    const fresh = refsOf(await snapshot(shot.args).catch(() => null));
    shot.carried = fresh ? translateRefs(shot.refs, fresh) : new Map();
  }

  /** A call's arguments with an old ref swapped for the engine's current one; throws when the ref has no match now. */
  carry(session: string, threadId: string, params: unknown): unknown {
    const shot = this.#shots.get(this.#key(session, threadId));
    const args = record(record(params)?.arguments);
    const selector = args?.selector;
    if (!shot?.carried || typeof selector !== "string") return params;
    const ref = REF.exec(selector)?.[1];
    if (!ref) return params;
    const now = shot.carried.get(ref);
    if (!now) throw new RefusedCall(carriedRefMissing(ref));
    return { ...record(params), arguments: { ...args, selector: `@${now}` } };
  }

  forgetThread(session: string, threadId: string): void {
    this.#shots.delete(this.#key(session, threadId));
  }

  forget(session: string): void {
    for (const key of this.#shots.keys()) if (key.startsWith(`${session}\u0000`)) this.#shots.delete(key);
  }
}
