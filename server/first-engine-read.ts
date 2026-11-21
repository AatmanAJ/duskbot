// On a cold start the engines' and the browser's binaries are read from a slow disk; work that reads them in the
// background (model catalogs, the browser's version) waits until the engine a first turn most likely needs is probed.
let held: Promise<void> = Promise.resolve();

/** Until the returned release runs, `afterFirstEngineRead()` waits. */
export function holdUntilFirstEngineRead(): () => void {
  let release!: () => void;
  held = new Promise<void>((resolve) => (release = resolve));
  return release;
}

export function afterFirstEngineRead(): Promise<void> {
  return held;
}

/** The longest a brand-new workspace's start waits on reading its engines before it listens. The desktop app stops a
 * server that has not answered within a minute, one engine's read may take that long, and the first bot is saved only
 * after this wait, so a longer wait would make every relaunch a first start that is stopped again. */
export const FIRST_START_ENGINE_WAIT_MS = 10_000;

/** Whether `work` settled within `ms`; it keeps running either way. */
export function settledBefore(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work.then(() => true, () => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
