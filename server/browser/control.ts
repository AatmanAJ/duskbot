// Who may act in a bot's browser. A person holds only the tabs they took, switched to or opened while holding; the bot
// keeps working in the others. A bot call on a held tab waits for the hand-back, bounded and cancellable, and then does
// not run: the page may have changed under the person's hands. While the person answers a bot's own request to sign in,
// every bot call is refused outright, because they may be typing a password. Underneath, each tab keeps T3 Code's
// SessionControl, so a takeover drains running work, interrupts queued bot work and revokes refs.
import { BROWSER_CONTROL_REFUSAL, PersonHoldAnswer, personStillHolds, personTookTab, personUsedTab } from "../browser-refusals.ts";
import { BrowserControlInterrupted, type SessionControl } from "./session-control.ts";

export { BROWSER_CONTROL_REFUSAL };

/** The bots' single agent id: one conversation uses a browser at a time, so tabs belong to the profile. */
export const AGENT = "bot";

const HOLD_POLL_MS = 500;

export interface ControlledTab {
  readonly id?: string;
  readonly control: SessionControl;
}

export interface TakeResult {
  /** Bot work was running when the person asked: the page may have changed since they aimed. */
  waited: boolean;
  /** That work outlasted the drain and control was granted anyway; the profile is uncertain. */
  stale: boolean;
}

/** How a bot call waits on a held tab: until `until` (epoch ms), with `checkpoint` throwing once its turn was stopped. */
export interface HoldWait {
  until: number;
  checkpoint?: () => void;
}

/** What bot work touches: one tab, the browser beside its tabs (a new tab, the tab list), or every tab (closing it). */
export type Scope<T> = T | null | "every";

function named(tab: ControlledTab | null | "every"): string {
  return tab && tab !== "every" && tab.id ? `tab ${tab.id}` : "the browser";
}

export class ProfileControl<T extends ControlledTab = ControlledTab> {
  owner: string | null = null;
  /** The owner's takeover has drained: their input may run. */
  ready = false;
  releasing = false;
  stale = false;
  /** A bot call never answered, or a person left with input held: nothing new reaches the browser until a probe. */
  uncertain = false;
  /** The call that never answered; null when only a restart clears the uncertainty. */
  lostCall: string | null = null;
  /** The bot's call running now, which becomes the lost call if a person's takeover outlasts it. */
  call: string | null = null;
  closing = false;
  agents = 0;
  humans = 0;
  /** The tab the bot last acted on: its default while a person holds the one in front. */
  lastTab: T | null = null;
  readonly #tabs: () => readonly T[];
  readonly #takeoverMs: number;
  readonly #signingIn: () => boolean;
  readonly #listeners = new Set<() => void>();
  readonly #held = new Set<T>();
  readonly #working = new Map<ControlledTab, number>();

  constructor(tabs: () => readonly T[], { takeoverMs = 15_000, signingIn = () => false }: { takeoverMs?: number; signingIn?: () => boolean } = {}) {
    this.#tabs = tabs;
    this.#takeoverMs = takeoverMs;
    this.#signingIn = signingIn;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  changed(): void {
    for (const listener of this.#listeners) {
      try { listener(); } catch {}
    }
  }

  /** The tabs the person holds now, oldest first. */
  heldTabs(): T[] {
    if (this.owner === null) return [];
    const open = this.#tabs();
    return [...this.#held].filter((tab) => open.includes(tab));
  }

  holds(tab: Scope<ControlledTab>): boolean {
    if (this.owner === null) return false;
    if (tab === "every") return true;
    return tab !== null && this.#held.has(tab as T);
  }

  /** The person answers a bot's own request to sign in: the bot's calls are refused, not held back. */
  get signingIn(): boolean {
    return this.owner !== null && this.#signingIn();
  }

  /**
   * Bot work. On a held tab it waits for the hand-back when given `wait`, and then answers that the person used the tab
   * instead of running; without `wait` it is refused. A person's takeover of its tab during it stops its answer.
   */
  async agent<R>(tab: Scope<T>, run: () => Promise<R>, wait?: HoldWait): Promise<R> {
    await this.heldBack(tab, wait);
    if (this.closing) throw new Error("The browser is closing. Try again shortly.");
    const one = tab !== null && tab !== "every" ? tab : null;
    this.agents++;
    if (one) this.#working.set(one, (this.#working.get(one) ?? 0) + 1);
    try {
      const result = one ? await one.control.agent(AGENT, run) : await run();
      if (this.holds(tab)) throw this.#taken(tab);
      if (one) this.lastTab = one;
      return result;
    } catch (error) {
      if (error instanceof BrowserControlInterrupted && this.holds(tab)) throw this.#taken(tab);
      throw error;
    } finally {
      this.agents--;
      if (one) {
        const left = (this.#working.get(one) ?? 1) - 1;
        if (left > 0) this.#working.set(one, left);
        else this.#working.delete(one);
      }
      this.changed();
    }
  }

  /** Throws what `agent` would answer on `tab` while a person holds it, running nothing; returns when it is free. */
  async heldBack(tab: Scope<T>, wait?: HoldWait): Promise<void> {
    if (this.signingIn) throw new Error(BROWSER_CONTROL_REFUSAL);
    if (!this.holds(tab)) return;
    if (!wait) throw new Error(BROWSER_CONTROL_REFUSAL);
    await this.#waitOut(tab, wait);
  }

  #taken(tab: Scope<T>): Error {
    return this.signingIn ? new Error(BROWSER_CONTROL_REFUSAL) : new PersonHoldAnswer(personTookTab(named(tab)));
  }

  /** Until the person lets go of `tab`; the call never runs after, since the page may have changed under their hands. */
  async #waitOut(tab: Scope<T>, wait: HoldWait): Promise<never> {
    const started = Date.now();
    throw await new Promise<Error>((resolve) => {
      const answer = (): Error | null => {
        try { wait.checkpoint?.(); } catch (error) { return error instanceof Error ? error : new Error(String(error)); }
        if (this.signingIn) return new Error(BROWSER_CONTROL_REFUSAL);
        if (tab !== null && tab !== "every" && !this.#tabs().includes(tab)) return new BrowserControlInterrupted("This browser tab is closed.", "closed");
        if (!this.holds(tab) && !this.releasing) return new PersonHoldAnswer(personUsedTab(named(tab)));
        if (Date.now() >= wait.until) return new PersonHoldAnswer(personStillHolds(named(tab), Date.now() - started));
        return null;
      };
      const check = () => {
        const found = answer();
        if (!found) return;
        off();
        clearInterval(timer);
        resolve(found);
      };
      const off = this.onChange(check);
      const timer = setInterval(check, HOLD_POLL_MS);
      timer.unref?.();
      check();
    });
  }

  canControl(owner: string): boolean {
    return Boolean(owner) && this.owner === owner && this.ready && !this.releasing && !this.closing;
  }

  /**
   * Reserves `tab` at once, then waits up to the drain for the bot's work on it; past it, control is granted anyway. The
   * bot's work in other tabs goes on.
   */
  async take(owner: string, tab: T | null): Promise<TakeResult> {
    if (!owner) throw new Error("Browser control requires an owner.");
    if (this.closing || this.releasing) throw new Error("Browser control is changing. Try again shortly.");
    if (this.owner !== null && this.owner !== owner) throw new Error("Another person controls this browser.");
    if (this.owner === owner && this.ready) {
      if (tab) await this.hold(owner, tab);
      return { waited: false, stale: this.stale };
    }
    const waited = tab ? this.#working.has(tab) : this.agents > 0;
    this.owner = owner;
    this.ready = false;
    if (tab) this.#held.add(tab);
    this.changed();
    const held = [...this.#held];
    const drained = Promise.all(held.map((one) => one.control.take(owner).catch(() => undefined)));
    const idle = this.#until(() => held.every((one) => !this.#working.has(one)));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), this.#takeoverMs); timer.unref?.(); });
    const done = await Promise.race([Promise.all([drained, idle]).then(() => true), late]);
    clearTimeout(timer);
    if (this.owner !== owner || this.closing) throw new Error("Browser control request was cancelled.");
    if (!done) {
      this.stale = true;
      if (!this.uncertain) {
        this.uncertain = true;
        this.lostCall = this.call ?? "browser";
      }
    }
    this.ready = true;
    this.changed();
    return { waited, stale: !done };
  }

  /** The holder moved to another tab: it is theirs too, once the bot's work on it drained. */
  async hold(owner: string, tab: T): Promise<void> {
    if (this.owner !== owner || this.#held.has(tab)) return;
    this.#held.add(tab);
    this.changed();
    await tab.control.take(owner).catch(() => undefined);
  }

  /** A tab that opens while a person holds the browser is theirs when they opened it, or a tab they hold did. */
  adopt(tab: T, from: { person?: boolean; opener?: ControlledTab | null } = {}): void {
    const owner = this.owner;
    if (owner === null || !(from.person || (from.opener && this.#held.has(from.opener as T)))) return;
    this.#held.add(tab);
    this.changed();
    void tab.control.take(owner).catch(() => undefined);
  }

  /**
   * Lets go of the held tabs once the person's pending input has run, releasing what they held; bots wait for that. Work
   * that never ends (a hung page) cannot keep the person holding it: past the drain the browser is let go, uncertain.
   */
  async release(owner: string, releaseInput: (tab: T) => Promise<boolean>): Promise<void> {
    if (!owner || this.owner !== owner) return;
    this.ready = false;
    this.releasing = true;
    this.changed();
    let clean = true;
    try {
      clean = await this.#drain(this.heldTabs(), (tab) => {
        let released = true;
        return tab.control.disconnect(owner, async () => { released = await releaseInput(tab).catch(() => false); }).then(() => released, () => true);
      });
    } finally {
      if (this.owner === owner) {
        this.owner = null;
        this.#held.clear();
        this.stale = false;
        if (!clean && !this.uncertain) {
          this.uncertain = true;
          this.lostCall = null;
        }
      }
      this.releasing = false;
      this.changed();
    }
  }

  /**
   * One of the person's views went while they keep the browser: what it pressed is let go once the input queued on each
   * held tab has run, as on a hand-back. A page that never takes it leaves the browser uncertain.
   */
  async letGo(owner: string, releaseInput: (tab: T) => Promise<boolean>): Promise<void> {
    if (!owner || this.owner !== owner) return;
    const clean = await this.#drain(this.heldTabs(), (tab) => tab.control.system(() => releaseInput(tab)).catch(() => true));
    if (clean || this.uncertain) return;
    this.uncertain = true;
    this.lostCall = null;
    this.changed();
  }

  /** `work` on each tab, false when one failed or outlasted the drain. */
  async #drain(tabs: readonly T[], work: (tab: T) => Promise<boolean>): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const drained = Promise.all(tabs.map(work)).then((results) => results.every(Boolean));
      const late = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), this.#takeoverMs); timer.unref?.(); });
      return await Promise.race([drained, late]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** A person's input beside the bot's work, taking no hold: refused only while someone holds the browser or it closes. */
  async shared<R>(run: () => Promise<R>): Promise<R> {
    if (this.owner !== null) throw new Error("Another person controls this browser.");
    if (this.closing) throw new Error("The browser is closing. Try again shortly.");
    return run();
  }

  /** The holder's input on `tab`, which becomes theirs too when it was not. */
  async human<R>(owner: string, tab: T, run: () => Promise<R>): Promise<R> {
    if (!this.canControl(owner)) throw new Error("Take control of this browser before interacting.");
    await this.hold(owner, tab);
    this.humans++;
    try {
      return await tab.control.human(owner, run);
    } finally {
      this.humans--;
      this.changed();
    }
  }

  latch(call: string): void {
    if (this.closing || this.uncertain) return;
    this.uncertain = true;
    this.lostCall = call;
    this.changed();
  }

  settle(): void {
    this.uncertain = false;
    this.lostCall = null;
    this.changed();
  }

  #until(condition: () => boolean): Promise<void> {
    if (condition()) return Promise.resolve();
    return new Promise((resolve) => {
      const off = this.onChange(() => {
        if (!condition()) return;
        off();
        resolve();
      });
    });
  }
}
