import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "@/icons";
import { dur, ease, spring, stagger, timing } from "@lab/tokens";
import type { Item, LabProps } from "@lab/types";
import { EASE_OUT, GLIDE } from "../../../../apps/dashboard/src/ui/motion";
import { Dash, PixelBot } from "./kit/dash";
import { useDemo } from "./kit/demo";

type Look = "original" | "a" | "b";
const PEOPLE = [
  { id: "maya", name: "maya okafor", email: "maya@hey.com", color: "#f12b93", plan: "plus, monthly", seen: "2 h ago", visits: "41 visits" },
  { id: "theo", name: "theo lindqvist", email: "theo@fastmail.se", color: "#10a760", plan: "free", seen: "yesterday", visits: "12 visits" },
  { id: "ines", name: "inês duarte", email: "ines@proton.me", color: "#894ef0", plan: "pro, yearly", seen: "just now", visits: "88 visits" },
];

function Card({ look, person, onClose, reduced, byHand }: { look: Look; person: (typeof PEOPLE)[number]; onClose(): void; reduced: boolean; byHand: boolean }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!byHand) return;
    close.current?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose, byHand]);
  const panel = look === "original"
    ? { initial: { x: 48, opacity: 0 }, animate: { x: 0, opacity: 1 }, exit: { x: 48, opacity: 0, transition: { duration: 0.16, ease: EASE_OUT } }, transition: GLIDE }
    : look === "a"
      ? { initial: { x: "100%" }, animate: { x: 0 }, exit: { x: "100%", transition: { duration: dur.swap, ease: ease.out } }, transition: { duration: dur.sheet, ease: ease.sheet } }
      : { initial: { x: "100%" }, animate: { x: 0 }, exit: { x: "100%", transition: { duration: dur.swap, ease: ease.out } }, transition: spring.soft };
  const part = (i: number) => look !== "b" ? {} : {
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { ...spring.fade, delay: timing.contentLag / 1000 + i * stagger.in },
  };
  const Div = look === "b" ? motion.div : "div";
  return (
    <motion.div role="dialog" aria-modal="true" aria-label={person.name} className="panel" {...panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="meta">person</span>
        <button ref={close} type="button" className="x press hov" aria-label="close" onClick={onClose}><X size={16} strokeWidth={1.5} /></button>
      </div>
      <Div {...part(0)} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
        <motion.span style={{ display: "grid", placeItems: "center", width: 44, height: 44, borderRadius: 999, background: "var(--card)" }}
          {...(look === "b" ? { initial: reduced ? { opacity: 0 } : { scale: 0.9, opacity: 0 }, animate: { scale: 1, opacity: 1 }, transition: { ...spring.pop, delay: 0.12 } } : {})}>
          <PixelBot size={30} color={person.color} />
        </motion.span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 500, letterSpacing: "-0.03em" }}>{person.name}</div>
          <div className="meta">{person.email}</div>
        </div>
      </Div>
      <Div {...part(1)} style={{ marginTop: 14 }}>
        {[["plan", person.plan], ["last seen", person.seen], ["visits", person.visits]].map(([k, v]) => (
          <div key={k} className="row" style={{ justifyContent: "space-between" }}><span className="i3">{k}</span><span>{v}</span></div>
        ))}
      </Div>
      <Div {...part(2)} className="card" style={{ marginTop: 10, padding: "10px 12px", background: "var(--wash-lime)" }}>
        <div className="meta">billing</div>
        <div style={{ fontSize: 14, marginTop: 2 }}>paid $20 on nov 3. renews dec 3.</div>
      </Div>
    </motion.div>
  );
}

function Sheet({ look, replayKey, speed, reduced }: LabProps & { look: Look }) {
  const [open, setOpen] = useState<string | null>(null);
  const [byHand, setByHand] = useState(false);
  useDemo(replayKey, speed, [[600, () => { setByHand(false); setOpen("maya"); }], [2900, () => setOpen(null)]], () => setOpen(null));
  const person = PEOPLE.find((p) => p.id === open);
  return (
    <Dash reduced={reduced}>
      <motion.div style={{ padding: 16, transformOrigin: "50% 30%" }}
        animate={look === "b" && open && !reduced ? { scale: 0.985 } : { scale: 1 }} transition={spring.soft}>
        <div className="t-title" style={{ fontSize: 24 }}>people</div>
        <p className="sub">click someone to open their card.</p>
        <div style={{ marginTop: 12 }}>
          {PEOPLE.map((p) => (
            <button key={p.id} type="button" className="row press hov" style={{ width: "100%", textAlign: "start" }} onClick={() => { setByHand(true); setOpen(p.id); }}>
              <PixelBot size={22} color={p.color} /><span style={{ flex: 1 }}>{p.name}</span><span className="meta">{p.seen}</span>
            </button>
          ))}
        </div>
      </motion.div>
      <AnimatePresence>
        {person && (
          <motion.div key="scrim" className="scrim" aria-hidden onClick={() => setOpen(null)}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: look === "original" ? 0.2 : dur.expand, ease: EASE_OUT }} />
        )}
        {person && <Card key="card" look={look} person={person} onClose={() => setOpen(null)} reduced={reduced} byHand={byHand} />}
      </AnimatePresence>
    </Dash>
  );
}

export const dashSheet: Item = {
  id: "admin-sheet",
  title: "admin person-card sheet",
  surface: "admin",
  height: 340,
  loopMs: 4000,
  notes: {
    original: "sheet.tsx: scrim fades 200ms; panel slides 48px in with a fade on GLIDE (spring 0.32s, no bounce); exit 48px + fade, 160ms.",
    a: "the whole panel slides from the edge on the sheet curve (0.32,0.72,0,1), 500ms (Vaul's timing); out in 200ms ease-out; scrim 250ms. no fade on the panel, no content motion.",
    b: "panel slides from the edge on soft 260/24; the page behind settles to 98.5%; content rises 8px on 420/32 after 80ms, 45ms apart; avatar pops on 520/26. exit 200ms, no stagger.",
  },
  Original: (p) => <Sheet look="original" {...p} />,
  A: (p) => <Sheet look="a" {...p} />,
  B: (p) => <Sheet look="b" {...p} />,
};
