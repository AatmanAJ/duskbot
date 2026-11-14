import { useId, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Bot, ChartNoAxesColumn, Cloud, CreditCard, House } from "@/icons";
import { ease, spring, stagger } from "@lab/tokens";
import type { Item, LabProps } from "@lab/types";
import { EASE_OUT } from "../../../../apps/dashboard/src/ui/motion";
import { Dash, RollText, StretchPill } from "./kit/dash";
import { useDemo } from "./kit/demo";

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const NAV = [
  { to: "home", icon: <House {...ICON} /> },
  { to: "dusk cloud", icon: <Cloud {...ICON} /> },
  { to: "bots", icon: <Bot {...ICON} /> },
  { to: "plans and billing", icon: <CreditCard {...ICON} /> },
  { to: "usage", icon: <ChartNoAxesColumn {...ICON} /> },
];
const PAGES: Record<string, { sub: string; rows: string[] }> = {
  home: { sub: "your bots, your cloud, one place.", rows: ["nova is working", "2 routines ran today", "dusk cloud is awake"] },
  "dusk cloud": { sub: "a computer we host for your bots.", rows: ["plus, 2 vcpu, 4 gb ram", "awake 14 h this week", "frankfurt"] },
  bots: { sub: "eight bots, three working now.", rows: ["nova · travel", "juno · inbox", "rivet · code"] },
  "plans and billing": { sub: "keep your bots working, laptop open or shut.", rows: ["plus, monthly", "next charge on dec 3", "visa ending 4242"] },
  usage: { sub: "this month so far.", rows: ["412 messages", "31 routine runs", "9.4 gb relay"] },
};
const DEMO = ["dusk cloud", "bots", "home"];

type Look = "original" | "a" | "b";

function Page({ look, path, reduced }: { look: Look; path: string; reduced: boolean }) {
  const page = PAGES[path]!;
  if (look === "original") {
    return (
      <motion.div key={path} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: EASE_OUT }}>
        <Body path={path} page={page} />
      </motion.div>
    );
  }
  if (look === "a") {
    return (
      <motion.div key={path} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15, ease: ease.out }}>
        <Body path={path} page={page} />
      </motion.div>
    );
  }
  const rise = (i: number) => ({
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { ...spring.fade, delay: 0.06 + i * stagger.in },
  });
  return (
    <div>
      <div className="t-title"><RollText text={path} distance={8} blur={3} /></div>
      <motion.p key={`s${path}`} className="sub" {...rise(0)}>{page.sub}</motion.p>
      <div style={{ marginTop: 16 }}>
        {page.rows.map((r, i) => <motion.div key={`${path}${r}`} className="row" {...rise(i + 1)}>{r}</motion.div>)}
      </div>
    </div>
  );
}

function Body({ path, page }: { path: string; page: { sub: string; rows: string[] } }) {
  return (
    <>
      <div className="t-title">{path}</div>
      <p className="sub">{page.sub}</p>
      <div style={{ marginTop: 16 }}>{page.rows.map((r) => <div key={r} className="row">{r}</div>)}</div>
    </>
  );
}

function Shell({ look, replayKey, speed, reduced }: LabProps & { look: Look }) {
  const [path, setPath] = useState("home");
  const pill = `nav${useId()}`;
  const nav = useRef<HTMLElement>(null);
  useDemo(replayKey, speed, DEMO.map((p, i) => [700 + i * 1100, () => setPath(p)]), () => setPath("home"));
  const link = (to: string, icon: ReactNode) => {
    const on = path === to;
    return (
      <a key={to} data-key={to} href="#" aria-current={on ? "page" : undefined} className="hov-side"
        onPointerDown={(e) => { if (e.button === 0) setPath(to); }} onClick={(e) => { e.preventDefault(); setPath(to); }}>
        {look !== "b" && on && <motion.span layoutId={pill} className="pill"
          transition={look === "original" ? { type: "spring", visualDuration: 0.2, bounce: 0 } : spring.fade} />}
        <span>{icon}</span><span>{to}</span>
      </a>
    );
  };
  return (
    <Dash reduced={reduced}>
      <div className="shell">
        <aside className="side">
          <div className="brand"><i aria-hidden />dusk bot</div>
          <nav ref={nav} className="nav" aria-label="dashboard" style={{ position: "relative" }}>
            {look === "b" && <StretchPill box={nav} target={path} reduced={reduced} />}
            {NAV.map((n) => link(n.to, n.icon))}
          </nav>
        </aside>
        <main className="main"><Page look={look} path={path} reduced={reduced} /></main>
      </div>
    </Dash>
  );
}

export const dashPage: Item = {
  id: "dash-page",
  title: "dashboard page change and nav pill",
  surface: "dashboard",
  height: 360,
  loopMs: 4400,
  notes: {
    original: "Shell.tsx: pill layoutId on spring 0.2s/0 bounce, set on pointer-down. PageIn: page rises 8px and fades, 240ms ease-out (0.22,1,0.36,1), no exit.",
    a: "pill on fade 420/32. the page only fades in, 150ms ease-out, no travel: nothing moves under your eye on a page you visit often.",
    b: "pill stretches: the leading edge on 620/36, the trailing edge on 190/19 (clip-path, no layout). title swaps only the changed letters (8px, 3px blur); sub and rows rise 8px on 420/32, 45ms stagger.",
  },
  Original: (p) => <Shell look="original" {...p} />,
  A: (p) => <Shell look="a" {...p} />,
  B: (p) => <Shell look="b" {...p} />,
};
