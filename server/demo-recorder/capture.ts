import type { RawDemoEvent } from "./events.ts";
import type { DemoPagePort } from "./ports.ts";

export interface DemoCaptureOptions {
  /** How often the page is read while recording. */
  pollMs?: number;
  /** Takes anything the Vault holds out of a recorded value, whatever field it was typed into. */
  scrub?: (text: string) => string;
  log?: (line: string) => void;
  /** Told of each batch of new events. */
  onEvents?: (events: RawDemoEvent[]) => void;
}

/** Records what a person does on the page in front, by reading the recorder script's queue. */
export class DemoCapture {
  constructor(_port: Pick<DemoPagePort, "evaluate">, _options: DemoCaptureOptions = {}) {}

  /** Installs the script and starts reading. */
  start(): Promise<void> {
    throw new Error("not built");
  }

  /** Reads the page now, returning what is new. */
  drain(): Promise<RawDemoEvent[]> {
    throw new Error("not built");
  }

  /** Reads once more and stops; answers everything recorded. */
  stop(): Promise<RawDemoEvent[]> {
    throw new Error("not built");
  }

  events(): RawDemoEvent[] {
    throw new Error("not built");
  }
}
