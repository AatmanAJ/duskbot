import type { CdpSession } from "./connection.ts";
import { staleRefError } from "./errors.ts";

/** A DOM node the agent can name: the frame it lives in, the session that owns that frame, and Chrome's node id. */
export interface NodeHandle {
  frameId: string;
  session: CdpSession;
  backendNodeId: number;
}

/** How a snapshot named a ref's element: its accessible role and name, and which of the frame's elements with both it was. */
export interface RefLocator {
  role: string;
  name: string;
  nth: number;
  count: number;
}

/** Ref numbers come from one counter per browser, so a ref from one tab never names an element in another. */
export class RefCounter {
  #next = 1;

  take(): number {
    return this.#next++;
  }
}

const REF = /^(?:aria-ref\s*=\s*)?@?(e\d+)$/;

/** "@e12", "e12" and "aria-ref=e12" all name e12; anything else is not a ref. */
export function parseRef(text: string): string | null {
  return REF.exec(text.trim())?.[1] ?? null;
}

const nodeKey = (handle: Pick<NodeHandle, "session" | "backendNodeId">) => `${handle.session.id ?? ""}|${handle.backendNodeId}`;

/** One tab's refs. An element keeps its ref across snapshots while its node lives; a number is never given out twice. */
export class RefTable {
  readonly #counter: RefCounter;
  readonly #byRef = new Map<string, NodeHandle>();
  readonly #byNode = new Map<string, string>();
  readonly #locators = new Map<string, RefLocator>();

  constructor(counter: RefCounter) {
    this.#counter = counter;
  }

  get size(): number {
    return this.#byRef.size;
  }

  refFor(handle: NodeHandle): string {
    const key = nodeKey(handle);
    const existing = this.#byNode.get(key);
    if (existing) return existing;
    const ref = `e${this.#counter.take()}`;
    this.#byRef.set(ref, handle);
    this.#byNode.set(key, ref);
    return ref;
  }

  locate(ref: string, locator: RefLocator): void {
    if (this.#byRef.has(ref)) this.#locators.set(ref, locator);
  }

  locator(ref: string): RefLocator | undefined {
    return this.#locators.get(ref);
  }

  /** The page put a new element where the ref's was (a re-render): the ref names the new one from now on. */
  move(ref: string, backendNodeId: number): NodeHandle & { ref: string } {
    const handle = this.#byRef.get(ref);
    if (!handle) throw staleRefError(ref);
    const moved = { ...handle, backendNodeId };
    if (this.#byNode.get(nodeKey(handle)) === ref) this.#byNode.delete(nodeKey(handle));
    this.#byRef.set(ref, moved);
    if (!this.#byNode.has(nodeKey(moved))) this.#byNode.set(nodeKey(moved), ref);
    return { ...moved, ref };
  }

  /** Throws the stale-ref error for a ref this tab never gave out or has since revoked. */
  resolve(text: string): NodeHandle & { ref: string } {
    const ref = parseRef(text);
    const handle = ref ? this.#byRef.get(ref) : undefined;
    if (!ref || !handle) throw staleRefError(ref ?? text.trim());
    return { ...handle, ref };
  }

  forget(ref: string): void {
    const handle = this.#byRef.get(ref);
    if (!handle) return;
    this.#byRef.delete(ref);
    if (this.#byNode.get(nodeKey(handle)) === ref) this.#byNode.delete(nodeKey(handle));
    this.#locators.delete(ref);
  }

  /** A main-frame navigation, a control change or a resolved dialog. */
  invalidateAll(): void {
    this.#byRef.clear();
    this.#byNode.clear();
    this.#locators.clear();
  }

  invalidateFrames(frameIds: ReadonlySet<string>): void {
    for (const [ref, handle] of this.#byRef) if (frameIds.has(handle.frameId)) this.forget(ref);
  }

  invalidateSession(session: CdpSession): void {
    for (const [ref, handle] of this.#byRef) if (handle.session === session) this.forget(ref);
  }
}
