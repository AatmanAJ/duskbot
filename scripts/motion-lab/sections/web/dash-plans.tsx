import { useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { dur, ease, offset, spring, stagger } from "@lab/tokens";
import type { Item, LabProps } from "@lab/types";
import { SPRING as DASH_SPRING } from "../../../../apps/dashboard/src/ui/motion";
import meadow from "../../../../apps/dashboard/src/art/p-meadow.webp";
import peaks from "../../../../apps/dashboard/src/art/p-peaks.webp";
import { Dash, Drums, RollText, StretchPill } from "./kit/dash";
import { useDemo } from "./kit/demo";

type Look = "original" | "a" | "b";
type Iv = "month" | "year";
const PLANS = [{ id: "plus", art: meadow, monthly: 20 }, { id: "pro", art: peaks, monthly: 50 }];
const perMonth = (m: number, iv: Iv) => iv === "year" ? Math.round((m * 10) / 12) : m;
const subOf = (m: number, iv: Iv) => iv === "year" ? `per month · $${m * 10}/yr billed yearly` : "per month, + tax where applicable";

function Swap({ look, text }: { look: Look; text: string }) {
  if (look === "original") return <>{text}</>;
  return (
    <span style={{ display: "inline-grid" }}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span key={text} style={{ gridArea: "1 / 1" }}
          initial={look === "a" ? { opacity: 0 } : { opacity: 0, y: offset.swapIn, filter: "blur(3px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={look === "a" ? { opacity: 0 } : { opacity: 0, y: offset.swapOut, filter: "blur(2px)" }}
          transition={{ duration: look === "a" ? dur.fast : dur.swap, ease: ease.out }}>{text}</motion.span>
      </AnimatePresence>
    </span>
  );
}

function Plans({ look, replayKey, speed, reduced }: LabProps & { look: Look }) {
  const [iv, setIv] = useState<Iv>("month");
  const pill = `iv${useId()}`;
  const seg = useRef<HTMLDivElement>(null);
  useDemo(replayKey, speed, [[1100, () => setIv("year")], [2600, () => setIv("month")]], () => setIv("month"));
  const enter = (i: number) => look === "original"
    ? { initial: { opacity: 0, y: 12, scale: 0.985 }, animate: { opacity: 1, y: 0, scale: 1 }, transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] as const, delay: i * 0.05 } }
    : look === "a"
      ? { initial: reduced ? { opacity: 0 } : { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: dur.expand, ease: ease.out, delay: i * stagger.in } }
      : { initial: reduced ? { opacity: 0 } : { opacity: 0, y: offset.rise }, animate: { opacity: 1, y: 0 }, transition: { ...spring.enter, delay: i * stagger.in } };
  return (
    <Dash reduced={reduced}>
      <div key={replayKey} style={{ padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-0.03em" }}>plans and billing</span>
          <div ref={seg} className="seg" role="radiogroup" aria-label="billing period">
            {look === "b" && <StretchPill box={seg} target={iv} reduced={reduced} />}
            {(["month", "year"] as Iv[]).map((v) => (
              <button key={v} data-key={v} type="button" role="radio" aria-checked={iv === v} className="hov-link" onClick={() => setIv(v)}>
                {look !== "b" && iv === v && <motion.span layoutId={pill} className="pill" transition={look === "original" ? DASH_SPRING : spring.fade} />}
                <span>{v === "month" ? "monthly" : "yearly"}</span>
                {v === "year" && (look === "b"
                  ? <motion.span className="i4" style={{ transformOrigin: "100% 50%" }} animate={iv === "year" && !reduced ? { scale: [1, 1.08, 1] } : { scale: 1 }} transition={{ duration: 0.32, ease: ease.out }}>2 months free</motion.span>
                  : <span className="i4">2 months free</span>)}
              </button>
            ))}
          </div>
        </div>
        <div className="plans">
          {PLANS.map((p, i) => (
            <motion.article key={p.id} className="plan" {...enter(i)}>
              <img src={p.art} alt="" width={800} height={354} draggable={false} />
              <div className="b">
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><span style={{ fontSize: 20, fontWeight: 500, letterSpacing: "-0.035em" }}>{p.id}</span><span className="i3" style={{ fontSize: 13 }}>dusk cloud</span></div>
                <div className="price">
                  {look === "original" ? `$${perMonth(p.monthly, iv)}` : look === "a" ? <RollText text={`$${perMonth(p.monthly, iv)}`} distance={10} blur={3} /> : <Drums text={`$${perMonth(p.monthly, iv)}`} reduced={reduced} />}
                </div>
                <p className="i3" style={{ margin: "6px 0 0", fontSize: 12.5, minHeight: 36 }}><Swap look={look} text={subOf(p.monthly, iv)} /></p>
                <button type="button" className="btn press hov">get {p.id}</button>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </Dash>
  );
}

export const dashPlans: Item = {
  id: "billing-plans",
  title: "billing plan cards and period toggle",
  surface: "dashboard billing",
  height: 360,
  loopMs: 4000,
  notes: {
    original: "Billing.tsx: cards enter 12px up from .985, 420ms ease-out, 50ms apart (.enter); toggle pill on SPRING 0.26s/0.08; price and billing line swap instantly.",
    a: "cards rise 8px, 250ms ease-out, 45ms apart; only the price digits that change rise in (10px, 3px blur); the billing line crossfades 150ms; pill on 420/32.",
    b: "cards rise 12px on the enter spring 300/22, 45ms apart; price on digit wheels (260/22+2i, 45ms apart, masked); billing line rises 8px out of a 3px blur; '2 months free' nudges once; stretchy toggle pill.",
  },
  Original: (p) => <Plans look="original" {...p} />,
  A: (p) => <Plans look="a" {...p} />,
  B: (p) => <Plans look="b" {...p} />,
};
