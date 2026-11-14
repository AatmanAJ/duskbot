// the motion lab's one token set (brief 2026-11 + designbookmark section 5). springs are mass 1.
// use from motion/react as `transition={spring.soft}` / `ease.out`, or in css via lib/tokens.css (--lab-*).

export const spring = {
  /** pointer-held, follows the finger */
  follow: { type: "spring", stiffness: 900, damping: 50, mass: 1 },
  /** opacity and small slides */
  fade: { type: "spring", stiffness: 420, damping: 32, mass: 1 },
  /** panels, sheets, sidebar */
  soft: { type: "spring", stiffness: 260, damping: 24, mass: 1 },
  /** release onto a value */
  settle: { type: "spring", stiffness: 280, damping: 22, mass: 1 },
  /** calm pop, direct acknowledgement only (copy, check, select) */
  pop: { type: "spring", stiffness: 520, damping: 26, mass: 1 },
  /** stretchy highlight: the edge facing the move */
  lead: { type: "spring", stiffness: 620, damping: 36, mass: 1 },
  /** stretchy highlight: the edge that catches up */
  trail: { type: "spring", stiffness: 190, damping: 19, mass: 1 },
  /** container width, lands first */
  width: { type: "spring", stiffness: 380, damping: 24, mass: 1 },
  /** container height, lands second */
  height: { type: "spring", stiffness: 300, damping: 22, mass: 1 },
  /** chat bubble size while streaming */
  bubble: { type: "spring", stiffness: 260, damping: 26, mass: 1 },
  /** message or bubble entering */
  enter: { type: "spring", stiffness: 300, damping: 22, mass: 1 },
  /** layout / layoutId moves */
  layout: { type: "spring", bounce: 0, visualDuration: 0.3 },
  /** navigation push (pop uses 0.34) */
  push: { type: "spring", bounce: 0, visualDuration: 0.42 },
} as const;

export const ease = {
  /** default for every tween */
  out: [0.22, 1, 0.36, 1],
  /** the alternate default */
  quint: [0.23, 1, 0.32, 1],
  /** content arriving after a container morph */
  outExpo: [0.16, 1, 0.3, 1],
  /** on-screen moves, check draws, keyboard glides */
  inOut: [0.65, 0, 0.35, 1],
  /** large surfaces, 500ms (vaul) */
  sheet: [0.32, 0.72, 0, 1],
  /** progress, spinners */
  linear: [0, 0, 1, 1],
} as const;

/** seconds, as motion takes them */
export const dur = {
  d75: 0.075, d120: 0.12, d150: 0.15, d200: 0.2, d250: 0.25, d320: 0.32, d420: 0.42, d500: 0.5,
  press: 0.075, exit: 0.12, fast: 0.15, swap: 0.2, expand: 0.25, settle: 0.32, push: 0.42, sheet: 0.5, draw: 0.45,
  /** a spinner shows at least this long before resolving */
  minWait: 0.8,
} as const;

/** seconds */
export const stagger = { in: 0.045, out: 0.025, letters: 0.018, words: 0.07, capTotal: 0.45 } as const;

/** px / scale */
export const offset = { swapIn: 8, swapOut: -6, rise: 12, blurIn: 4, blurOut: 2, pressScale: 0.97, menuScale: 0.96 } as const;

/** ms */
export const timing = { tooltipDelay: 400, tooltipWarm: 300, tooltipHide: 140, contentLag: 80, minWait: 800 } as const;

/** css cubic-bezier() string for an ease token */
export const cssEase = (e: readonly number[]) => `cubic-bezier(${e.join(",")})`;

/** a timer length at the lab's speed: ms(200, 0.5) === 400 */
export const ms = (value: number, speed: number) => value / (speed || 1);

/** reduced-motion stand-in: keep a short fade, drop travel and loops */
export const reducedFade = { duration: 0.15, ease: ease.out } as const;
