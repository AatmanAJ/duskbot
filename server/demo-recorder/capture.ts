import { randomUUID } from "node:crypto";

import { sanitiseDemoEvent, type RawDemoEvent } from "./events.ts";
import { demoDrainExpression, demoForgetExpression, demoRecordingScript } from "./page-script.ts";
import type { DemoPagePort } from "./ports.ts";

export const DEMO_POLL_MS = 300;
const MAX_EVENTS = 20_000;
/** A page's whole queue, at the most it keeps, in reads of the size the script answers. */
const MAX_READS = 20;

export interface DemoCaptureOptions {
  /** How often the page is read while recording. */
  pollMs?: number;
  /** Takes anything the Vault holds out of a recorded value, whatever field it was typed into. */
  scrub?: (text: string) => string;
  log?: (line: string) => void;
  /** Told of each batch of new events. */
  onEvents?: (events: RawDemoEvent[]) => void;
}

/** What a read of the page answered, whether the browser handed back the JSON text or the value it parses to. */
function drained(answer: unknown): { installed: boolean; events: unknown[]; more: boolean } | null {
  let value = answer;
  for (let depth = 0; depth < 2 && typeof value === "string"; depth++) {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== "object") return null;
  const drain = value as { installed?: unknown; events?: unknown; more?: unknown };
  return { installed: drain.installed === true, events: Array.isArray(drain.events) ? drain.events : [], more: drain.more === true };
}

/** Records what a person does on the page in front, by reading the recorder script's queue. */
export class DemoCapture {
  readonly #port: Pick<DemoPagePort, "evaluate" | "everyDocument">;
  readonly #options: DemoCaptureOptions;
  readonly #events: RawDemoEvent[] = [];
  /** Tells this recording's events from anything an earlier one left in a page. */
  readonly #take = randomUUID();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #running = false;
  #reading: Promise<RawDemoEvent[]> = Promise.resolve([]);
  #stopDocuments: (() => void) | null = null;
  #failed = false;

  constructor(port: Pick<DemoPagePort, "evaluate" | "everyDocument">, options: DemoCaptureOptions = {}) {
    this.#port = port;
    this.#options = options;
  }

  /** Installs the script and starts reading. */
  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    if (this.#port.everyDocument) {
      try { this.#stopDocuments = await this.#port.everyDocument(demoRecordingScript(this.#take)); }
      catch (error) { this.#options.log?.(`show it once: the recorder could not be added to new pages (${error instanceof Error ? error.name : "error"})`); }
    }
    await this.drain();
    this.#schedule();
  }

  #schedule(): void {
    if (!this.#running) return;
    this.#timer = setTimeout(() => {
      void this.drain().finally(() => this.#schedule());
    }, this.#options.pollMs ?? DEMO_POLL_MS);
    this.#timer.unref?.();
  }

  async #read(): Promise<RawDemoEvent[]> {
    const read: unknown[] = [];
    try {
      let answer = drained(await this.#port.evaluate(demoDrainExpression(this.#take)));
      if (answer && !answer.installed) {
        await this.#port.evaluate(demoRecordingScript(this.#take));
        answer = drained(await this.#port.evaluate(demoDrainExpression(this.#take)));
      }
      read.push(...(answer?.events ?? []));
      for (let again = 0; answer?.more && again < MAX_READS; again++) {
        answer = drained(await this.#port.evaluate(demoDrainExpression(this.#take)));
        read.push(...(answer?.events ?? []));
      }
      this.#failed = false;
    } catch (error) {
      if (!this.#failed) this.#options.log?.(`show it once: the page could not be read (${error instanceof Error ? error.name : "error"})`);
      this.#failed = true;
    }
    const fresh = read.map((event) => sanitiseDemoEvent(event, this.#options.scrub)).filter((event): event is RawDemoEvent => event !== null);
    if (!fresh.length) return [];
    this.#events.push(...fresh.slice(0, Math.max(0, MAX_EVENTS - this.#events.length)));
    try { this.#options.onEvents?.(fresh); } catch {}
    return fresh;
  }

  /** Reads the page now, returning what is new. One read at a time. */
  drain(): Promise<RawDemoEvent[]> {
    const next = this.#reading.then(() => this.#read(), () => this.#read());
    this.#reading = next.catch(() => []);
    return next;
  }

  /** Reads once more and stops, after which the page keeps nothing; answers everything recorded. */
  async stop(): Promise<RawDemoEvent[]> {
    if (!this.#running) return this.events();
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    await this.drain();
    try { this.#stopDocuments?.(); } catch {}
    this.#stopDocuments = null;
    try { await this.#port.evaluate(demoForgetExpression()); } catch {}
    return this.events();
  }

  events(): RawDemoEvent[] {
    return [...this.#events];
  }
}
