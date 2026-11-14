import type { FC } from "react";

/** what every column gets. `replayKey` bumps on replay: key your root on it, or restart in an effect on it.
 * `speed` is 1, 0.5 or 0.25: motion/react and css animations are already slowed globally, use it only for your own
 * timers (setTimeout/setInterval) via `ms(value, speed)` from lib/tokens. `reduced` mirrors the reduced-motion toggle. */
export type LabProps = { replayKey: number; speed: number; reduced: boolean };

export type Item = {
  id: string;
  title: string;
  /** where it lives in the app, e.g. "chat", "composer", "dashboard" */
  surface: string;
  /** one short line per column: what moves, values, license source if any */
  notes: { original: string; a: string; b: string };
  Original: FC<LabProps>;
  A: FC<LabProps>;
  B: FC<LabProps>;
  /** optional: stage height in px (default 320) */
  height?: number;
  /** optional: auto-loop period in ms at 1x (default 3200) */
  loopMs?: number;
};

export type Section = {
  id: string;
  title: string;
  items: Item[];
  /** optional: nav order, lower first (default 100) */
  order?: number;
};
