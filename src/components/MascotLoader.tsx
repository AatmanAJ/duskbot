import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { MASCOT_INK } from "@/lib/mascot";
import {
  APPEAR_AFTER_MS, ARRIVE_MS, BEAT_MS, arrivePose, beatPose, blinking, cheerPose, idleBob, loadingFace, loadingLaunch, loadingLineAt, napPose,
  pickBeat, still, wakePose, type LoadingCrew, type LoadingFace, type LoaderBeat, type LoaderEyes, type LoaderPose,
} from "@/lib/mascot-loading";
import type { LocaleKey } from "@/locales";
import CREW_SPRITES from "../../electron/resources/startup-crew.json";

const TICK_MS = 200;
const HAPPY_MS = 300;
const EXIT_MS = 240;
/** what comes next starts arriving once the mascot is mostly gone, so the two never sit on top of each other */
const HANDOFF_MS = 110;
const EASE_OUT = "cubic-bezier(.22, 1, .36, 1)";
// the canvas around the 16-pixel sprite, in sprite pixels: room to hop in from the right, to jump, and for the z's
const PAD_X = 24, PAD_TOP = 12, PAD_BOTTOM = 2;
const Z = ["####", "..#.", ".#..", "####"];

type Sprite = { body: string; eyes: Record<LoaderEyes, string> };
const SPRITES = CREW_SPRITES as Record<LoadingCrew, Sprite>;

const cells = (d: string): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1/g)) for (let i = 0; i < Number(m[3]); i++) out.push([Number(m[1]) + i, Number(m[2])]);
  return out;
};

const tiles = new Map<string, HTMLCanvasElement>();
/** One pose of one crew member painted once into a 16-pixel tile, then drawn up with nearest-neighbour scaling. */
function tile(crew: LoadingCrew, eyes: LoaderEyes, look: number, body: string): HTMLCanvasElement {
  const key = `${crew}:${eyes}:${look}:${body}`;
  const known = tiles.get(key);
  if (known) return known;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const g = canvas.getContext("2d")!;
  const sprite = SPRITES[crew];
  g.fillStyle = body;
  for (const [x, y] of cells(sprite.body)) g.fillRect(x, y, 1, 1);
  g.fillStyle = "#fff";
  for (const [x, y] of cells(sprite.eyes[eyes] ?? sprite.eyes.idle)) g.fillRect(x + look, y, 1, 1);
  tiles.set(key, canvas);
  return canvas;
}

/**
 * The one whole-screen wait: one of the startup card's crew in this launch's colour, alive while it waits (it hops in,
 * blinks, looks about, hops, naps if it runs long), a short line that changes now and then, and a cheer and a hop away
 * once `leaving`, after which `onGone` runs. A wait shorter than a moment never shows it. `waking`: the computer is
 * still starting, so the mascot naps first and wakes up. `naps` false keeps it awake however long the wait runs.
 */
export function MascotLoader({ leaving = false, onExit, onGone, waking = false, naps = true, size = 80, first, className, lineClassName }: {
  leaving?: boolean;
  /** the hop away starts: what comes next can arrive under it */
  onExit?: () => void;
  onGone?: () => void;
  waking?: boolean;
  naps?: boolean;
  /** the mascot's box in CSS pixels; drawn at the nearest whole multiple of its 16-pixel grid */
  size?: number;
  /** a line said before any of the playful ones, while it is still true */
  first?: string;
  className?: string;
  lineClassName?: string;
}) {
  const [look] = useState(() => loadingLaunch());
  const reduced = useReducedMotion() ?? false;
  const canvas = useRef<HTMLCanvasElement>(null);
  const gone = useRef(onGone);
  gone.current = onGone;
  const exit = useRef(onExit);
  exit.current = onExit;
  const dozeFrom = useRef<number | null>(null);
  const [shown, setShown] = useState(look.seen && !leaving);
  const [phase, setPhase] = useState<"waiting" | "happy" | "exit">("waiting");
  const read = (): { face: LoadingFace; line: LocaleKey } => {
    const elapsed = performance.now() - look.start;
    const face = naps ? loadingFace(elapsed, look.mood, dozeFrom.current) : look.mood;
    return { face, line: loadingLineAt(elapsed, face) };
  };
  const [now, setNow] = useState(read);
  const unit = Math.max(2, Math.round(size / 16));
  const scene = useRef({ face: now.face, faceAt: performance.now(), phase, phaseAt: 0, arriveAt: null as number | null, reduced });
  scene.current.reduced = reduced;
  if (scene.current.face !== now.face) Object.assign(scene.current, { face: now.face, faceAt: performance.now() });
  if (scene.current.phase !== phase) Object.assign(scene.current, { phase, phaseAt: performance.now() });

  useEffect(() => {
    if (!waking || dozeFrom.current !== null) return;
    dozeFrom.current = performance.now() - look.start;
    setNow(read());
  }, [waking]);

  useEffect(() => {
    if (shown) return;
    const timer = setTimeout(() => {
      look.seen = true;
      scene.current.arriveAt = performance.now();
      setShown(true);
    }, APPEAR_AFTER_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  useEffect(() => {
    if (phase !== "waiting") return;
    const timer = setInterval(() => {
      const next = read();
      setNow((was) => (was.face === next.face && was.line === next.line ? was : next));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (!leaving) return;
    if (!shown) { exit.current?.(); gone.current?.(); return; }
    setPhase("happy");
    const hop = setTimeout(() => setPhase("exit"), HAPPY_MS);
    const next = setTimeout(() => exit.current?.(), HAPPY_MS + HANDOFF_MS);
    const done = setTimeout(() => gone.current?.(), HAPPY_MS + EXIT_MS);
    return () => { clearTimeout(hop); clearTimeout(next); clearTimeout(done); };
  }, [leaving]);

  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext("2d");
    if (!el || !g) return;
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const px = unit * dpr;
    el.width = (16 + PAD_X * 2) * px;
    el.height = (PAD_TOP + 16 + PAD_BOTTOM) * px;
    g.imageSmoothingEnabled = false;
    const body = MASCOT_INK[look.color];
    const zInk = getComputedStyle(el).color;
    const t0 = performance.now();
    let beat: { kind: LoaderBeat; start: number } | null = null;
    let wasFace = scene.current.face;
    let drawn = "", frame = 0;

    const pose = (at: number): LoaderPose => {
      const s = scene.current;
      if (s.phase === "happy") return cheerPose(at - s.phaseAt);
      if (s.phase === "exit") return beatPose("hop", at - s.phaseAt + 60, "happy");
      if (s.arriveAt !== null && at - s.arriveAt < ARRIVE_MS + 140) {
        const ms = at - s.arriveAt;
        return ms < ARRIVE_MS ? arrivePose(ms) : beatPose("hop", 370 + ms - ARRIVE_MS);
      }
      if (s.face !== wasFace) { wasFace = s.face; beat = null; }
      if (s.face === "sleeping") return napPose(at - s.faceAt);
      if (s.face === "waking") return wakePose(at - s.faceAt);
      if (s.face === "happy") return cheerPose(at - s.faceAt);
      if (!beat || at >= beat.start + BEAT_MS[beat.kind]) {
        const next = pickBeat(s.face);
        beat = { kind: next.beat, start: at + next.gap };
      }
      const p = at >= beat.start ? beatPose(beat.kind, at - beat.start) : { ...beatPose("look", 2000), y: idleBob(at - t0) };
      if (p.eyes === "idle" && blinking(at - t0)) p.eyes = "sleeping";
      return p;
    };

    const draw = (at: number) => {
      const p = scene.current.reduced ? still(pose(at)) : pose(at);
      const w = Math.round(16 * px * p.sx), h = Math.round(16 * px * p.sy);
      const x = Math.round(PAD_X * px + p.x * px + (16 * px - w) / 2);
      const y = Math.round((PAD_TOP + 16) * px - h + p.y * px);
      const zs = p.z.map((z) => Math.round(z * 24) / 24);
      const key = `${p.eyes}${p.look}${x},${y},${w},${h}${p.flip}${p.alpha.toFixed(2)}${zs.join()}`;
      if (key === drawn) return;
      drawn = key;
      g.clearRect(0, 0, el.width, el.height);
      g.globalAlpha = p.alpha;
      const sprite = tile(look.crew, p.eyes, p.look, body);
      if (p.flip) { g.save(); g.translate(x * 2 + w, 0); g.scale(-1, 1); g.drawImage(sprite, x, y, w, h); g.restore(); }
      else g.drawImage(sprite, x, y, w, h);
      const cell = Math.max(1, Math.round(px / 2));
      g.fillStyle = zInk;
      for (const z of zs) {
        g.globalAlpha = Math.sin(z * Math.PI) * 0.8;
        const zx = Math.round((PAD_X + 13 + z * 4) * px), zy = Math.round((PAD_TOP + 2 - z * 10) * px);
        Z.forEach((row, r) => { for (let c = 0; c < 4; c++) if (row[c] === "#") g.fillRect(zx + c * cell, zy + r * cell, cell, cell); });
      }
      g.globalAlpha = 1;
    };

    const loop = () => { draw(performance.now()); frame = requestAnimationFrame(loop); };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [unit, look]);

  const line = first && now.line === "loading.line.loading" ? first : t(now.line);
  const exiting = phase === "exit";
  const box = unit * 16;

  return (
    <div data-mascot-loader={phase} data-loader-face={phase === "waiting" ? now.face : "happy"} className={cn("relative flex flex-col items-center", className)}
      style={{ width: box, height: box, opacity: shown && !exiting ? 1 : 0, transition: `opacity ${exiting ? EXIT_MS : 200}ms ${EASE_OUT}` }}>
      <span role="status" className="sr-only">{t("loading.status")}</span>
      <canvas ref={canvas} aria-hidden className="pointer-events-none absolute text-ink-tertiary"
        style={{ left: -PAD_X * unit, top: -PAD_TOP * unit, width: (16 + PAD_X * 2) * unit, height: (PAD_TOP + 16 + PAD_BOTTOM) * unit, imageRendering: "pixelated" }} />
      <span aria-hidden style={{ opacity: exiting ? 0 : 1, transition: "opacity 120ms ease-out" }} className={cn("absolute left-1/2 top-full mt-7 grid h-[22px] w-[260px] -translate-x-1/2 place-items-center text-[16px] font-medium leading-[22px] text-ink-secondary", lineClassName)}>
        <AnimatePresence initial={false}>
          <motion.span
            key={line}
            className="col-start-1 row-start-1 whitespace-nowrap"
            initial={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateY(8px)", filter: "blur(4px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)", filter: "blur(0px)" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateY(-6px)", filter: "blur(4px)" }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            {line}
          </motion.span>
        </AnimatePresence>
      </span>
    </div>
  );
}
