// One bot call per browser at a time, from its first page read to its last, so another call's console clear never lands
// between an action and its read, and fill_login's typing never shares the browser with a capture.

/** The call holding a browser's lane and when it took it. */
export interface LaneHolder { call: string; since: number }

/** A call that gave up waiting, with what held the lane when it did. */
export type LaneGaveUp = (gaveUp: { session: string; call: string; waitedMs: number; holder: LaneHolder | null }) => void;

export class BrowserLanes {
  private lanes = new Map<string, Promise<void>>();
  private holders = new Map<string, LaneHolder>();

  private readonly onGaveUp?: LaneGaveUp;
  private readonly now: () => number;

  constructor(onGaveUp?: LaneGaveUp, now: () => number = Date.now) {
    this.onGaveUp = onGaveUp;
    this.now = now;
  }

  held(session: string): boolean { return this.lanes.has(session); }

  holder(session: string): LaneHolder | null { return this.holders.get(session) ?? null; }

  /** Waits at most `waitMs` for earlier calls; null, without running `fn`, when the wait ran out. */
  async run<T>(session: string, fn: () => Promise<T>, waitMs: number, call = "browser"): Promise<T | null> {
    const previous = this.lanes.get(session);
    let release!: () => void;
    const mine = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous ? previous.then(() => mine) : mine;
    this.lanes.set(session, tail);
    const leave = () => { if (this.lanes.get(session) === tail) this.lanes.delete(session); };
    if (previous) {
      const started = this.now();
      let timer: NodeJS.Timeout | undefined;
      const ready = await Promise.race([previous.then(() => true), new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), waitMs); timer.unref(); })]);
      clearTimeout(timer);
      // Gave up: later calls still wait for the earlier one, not for this.
      if (!ready) {
        release();
        void tail.then(leave);
        try { this.onGaveUp?.({ session, call, waitedMs: this.now() - started, holder: this.holder(session) }); } catch { /* reporting never fails the call */ }
        return null;
      }
    }
    const holding: LaneHolder = { call, since: this.now() };
    this.holders.set(session, holding);
    try { return await fn(); } finally {
      if (this.holders.get(session) === holding) this.holders.delete(session);
      release();
      leave();
    }
  }
}
