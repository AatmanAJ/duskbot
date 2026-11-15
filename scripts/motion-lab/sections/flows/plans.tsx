// the dusk cloud plans sheet: pick a plan (the price in the button changes), buy, checkout waits in the browser, paid,
// then "Setting up your new cloud" runs its steps to ready. Original renders the real ChooseScreen, PayScreen and SetupScreen.
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { CloudOffer } from "../../../../electron/cloud-home.mjs";
import { ChooseScreen } from "@/components/cloud-buy/ChooseScreen";
import { NightCard } from "@/components/cloud-buy/NightCard";
import { PayScreen } from "@/components/cloud-buy/PayScreen";
import { SetupScreen } from "@/components/cloud-buy/SetupScreen";
import { Badge, Heading, PRIMARY_WIDE, QUIET, SCREEN } from "@/components/cloud-buy/parts";
import { Archive, CalendarClock, ExternalLink, MonitorSmartphone } from "@/icons";
import { planCards, sharedPerks } from "@/lib/cloud-plan";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { ease, offset, reducedFade, spring, stagger } from "@lab/tokens";
import type { Item, LabProps } from "@lab/types";
import { Again, Arc, DrawCheck, Roll, Stretch, Swap, useFlow } from "./kit/kit";

const ALLOW = (cpus: number, memoryMb: number, diskGb: number, sleeps?: true) => ({ cpus, memoryMb, diskGb, maxDiskGb: diskGb, computers: 1, computerHours: 100, voiceCharacters: 0, snapshotDays: 7, ...(sleeps ? { sleeps } : {}) });
const OFFER: CloudOffer = {
  recommended: "pro",
  plans: [
    { tier: "starter", label: "Starter", amount: 1500, allowances: ALLOW(2, 4096, 40, true) },
    { tier: "pro", label: "Pro", amount: 4900, allowances: ALLOW(4, 8192, 80) },
    { tier: "max", label: "Max", amount: 14900, allowances: ALLOW(8, 16384, 160) },
  ],
};
const CARDS = planCards(OFFER);
const PERKS = sharedPerks(OFFER);
const PERK_ICON = { routines: CalendarClock, anywhere: MonitorSmartphone, backups: Archive } as const;
const STEPS = ["cloudHome.step.reserving", "cloudHome.step.storage", "cloudBuy.step.starting", "cloudHome.step.checking"] as const;
const STEP_KEYS = ["reserving", "storage", "starting", "checking"] as const;
const NAME = "My cloud";

type Screen = "choose" | "opening" | "pay" | "setup";
type P = { screen: Screen; tier: string; step: number };
const START: P = { screen: "choose", tier: "pro", step: 0 };
const bought: [number, (p: P) => P][] = [
  [1000, (p) => ({ ...p, screen: "pay" })],
  [2000, (p) => ({ ...p, screen: "setup", step: 0 })],
  ...[1, 2, 3, 4].map((step) => [850, (p: P) => ({ ...p, step })] as [number, (p: P) => P]),
];
const SCRIPT: [number, (p: P) => P][] = [
  [1100, (p) => ({ ...p, tier: "max" })], [1100, (p) => ({ ...p, tier: "starter" })], [1100, (p) => ({ ...p, tier: "pro" })],
  [900, (p) => ({ ...p, screen: "opening" })], ...bought,
];

function usePlans({ replayKey, speed }: LabProps) {
  const flow = useFlow<P>(START, replayKey, speed, SCRIPT);
  return {
    ...flow,
    pick: (tier: string) => flow.go((p) => ({ ...p, tier })),
    buy: (tier?: string) => flow.run((p) => ({ ...p, tier: tier ?? p.tier, screen: "opening" }), bought),
    back: () => flow.go((p) => ({ ...p, screen: "choose" })),
  };
}

/** the sheet at its real width (460px), scaled down to the column so all three read the same */
function Sheet({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.8);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setScale(Math.min(1, element.clientWidth / 460)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={host} className="relative h-full w-full overflow-hidden bg-app">
    <div className="origin-top-left text-ink" style={{ width: 460, transform: `scale(${scale})` }}>{children}</div>
  </div>;
}

const buyLabel = (tier: string) => {
  const card = CARDS.find((c) => c.tier === tier)!;
  return { name: card.name, price: card.price, text: t("cloudBuy.buy", { plan: card.name, price: card.price }) };
};

function Original(props: LabProps) {
  const { state, buy, back, auto, replay } = usePlans(props);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const radio = host.current?.querySelector<HTMLInputElement>(`[data-plan-pick="${state.tier}"]`);
    if (radio && !radio.checked) radio.click();
  }, [state.tier, state.screen]);
  const step = state.step;
  return <Sheet>
    <div ref={host}>
      {(state.screen === "choose" || state.screen === "opening") &&
        <ChooseScreen offer={OFFER} busy={state.screen === "opening"} signedOut={false} notice={null} onStart={(tier) => buy(tier)} onSignIn={() => {}} />}
      {state.screen === "pay" && <PayScreen plan={state.tier} offer={OFFER} browser="checkout" late={false} link email="sam@example.com" busy={false}
        copied={false} failed={false} onReopen={() => {}} onCopy={() => {}} onChangePlan={back} />}
      {state.screen === "setup" && <SetupScreen started={{ tier: state.tier, trial: null }} received={false} step={STEP_KEYS[Math.min(step, 3)]!} slow={false} ready={step >= 4}
        name={NAME} typed="" color="blue" counting={null} busy={false} openFailed={false} onName={() => {}} onColor={() => {}} onOpen={replay} onNotNow={() => {}} />}
    </div>
    <Again show={!auto} onClick={replay} />
  </Sheet>;
}

/** the plan rows as the real radiogroup, with the highlight drawn by the variant (`marker`) */
function Rows({ tier, onPick, marker }: { tier: string; onPick: (tier: string) => void; marker: (box: { top: number; height: number }) => ReactNode }) {
  const index = CARDS.findIndex((c) => c.tier === tier);
  const group = useId();
  const items = useRef<(HTMLLIElement | null)[]>([]);
  const [boxes, setBoxes] = useState<{ top: number; height: number }[]>([]);
  useLayoutEffect(() => { setBoxes(items.current.map((li) => ({ top: li?.offsetTop ?? 0, height: li?.offsetHeight ?? 0 }))); }, []);
  const box = boxes[index];
  return <ul role="radiogroup" aria-label={t("cloudBuy.choose")} className="relative -mx-1.5 flex flex-col gap-1 rounded-[16px] bg-ink/[0.03] p-1.5">
    {box && marker(box)}
    {CARDS.map((card, i) => {
      const picked = card.tier === tier;
      return <li key={card.tier} ref={(li) => { items.current[i] = li; }} className="relative">
        <label className={cn("grid min-h-[52px] cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-[12px] px-4 py-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus",
          !picked && "transition-colors duration-150 hover:bg-ink/[0.03]")}>
          <input type="radio" name={group} checked={picked} onChange={() => onPick(card.tier)} className="peer sr-only" />
          <span aria-hidden="true" className={cn("grid size-[18px] place-items-center rounded-full transition-colors duration-150", picked ? "bg-ink" : "bg-ink/[0.1]")}>
            <motion.span className="size-1.5 rounded-full bg-app" initial={false} animate={{ scale: picked ? 1 : 0.3, opacity: picked ? 1 : 0 }} transition={spring.pop} />
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-medium leading-5">{card.name}</span>
            <span className="block truncate text-[13px] leading-[18px] text-ink-secondary">{card.promise}</span>
          </span>
          <span className="text-[15px] leading-5 tabular-nums">{card.price}<span className="text-[13px] text-ink-tertiary">{t("cloudBuy.perMonth")}</span></span>
        </label>
      </li>;
    })}
  </ul>;
}

function Head() {
  return <>
    <div className="-mx-4 -mt-3">
      <NightCard>
        <p className="text-[13px] leading-[18px] text-(--cloud-night-ink-quiet)">{t("pro.name")}</p>
        <h2 className="mt-1 max-w-[min(300px,56%)] text-[19px] font-medium leading-6 tracking-[-0.01em] [text-wrap:balance]">{t("cloudBuy.headline")}</h2>
      </NightCard>
    </div>
    <ul className="flex flex-wrap justify-between gap-x-4 gap-y-2 px-0.5">
      {PERKS.map((perk) => { const Icon = PERK_ICON[perk.key]; return <li key={perk.key} className="flex items-center gap-2 text-[13px] leading-[18px] text-ink-secondary"><Icon size={16} strokeWidth={1.75} aria-hidden="true" className="text-ink-tertiary" />{perk.text}</li>; })}
    </ul>
  </>;
}

/** the picked plan's machine in one small line, swapped as the plan changes */
function Spec({ tier, reduced }: { tier: string; reduced: boolean }) {
  const spec = CARDS.find((c) => c.tier === tier)?.spec ?? "";
  return <p aria-live="polite" className="-mt-2 px-2.5 text-[12px] leading-4 tabular-nums text-ink-tertiary"><Swap id={spec} reduced={reduced} className="justify-items-start">{spec}</Swap></p>;
}

/** a checklist row's mark: done pops in green and draws its check, now turns, next is an empty ring */
function Mark({ state, reduced, green }: { state: "done" | "now" | "next"; reduced: boolean; green?: boolean }) {
  return <span className="relative grid size-5 place-items-center">
    <AnimatePresence initial={false} mode="popLayout">
      {state === "done"
        ? <motion.span key="done" className={cn("grid size-5 place-items-center rounded-full", green ? "bg-success text-white" : "bg-ink text-app")}
          initial={{ opacity: 0, scale: reduced ? 1 : 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={reduced ? reducedFade : spring.pop}>
          <DrawCheck size={12} strokeWidth={3} reduced={reduced} delay={0.1} draw={0.25} /></motion.span>
        : state === "now"
          ? <motion.span key="now" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.08 } }}><Arc size={18} reduced={reduced} /></motion.span>
          : <motion.span key="next" className="size-[18px] rounded-full border-[1.5px] border-ink/15" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />}
    </AnimatePresence>
  </span>;
}

function Checklist({ items, reduced, green, highlight }: { items: { key: string; state: "done" | "now" | "next"; title: string; detail?: string | null }[]; reduced: boolean;
  green?: boolean; highlight?: boolean }) {
  const scope = useId();
  return <LayoutGroup id={scope}><ol className="relative flex flex-col gap-0.5">
    {items.map((item, i) => <li key={item.key} aria-current={item.state === "now" ? "step" : undefined} className="relative grid grid-cols-[20px_minmax(0,1fr)] items-start gap-3 rounded-[12px] px-3 py-2.5">
      {highlight !== false && item.state === "now" && <motion.span layoutId="now-row" className="absolute inset-0 -z-0 rounded-[12px] bg-ink/[0.04]" transition={reduced ? { duration: 0 } : spring.layout} />}
      <span className="relative"><Mark state={item.state} reduced={reduced} green={green} /></span>
      <motion.span className="relative min-w-0" initial={{ opacity: 0, y: reduced ? 0 : 4 }} animate={{ opacity: 1, y: 0 }} transition={reduced ? reducedFade : { ...spring.fade, delay: i * stagger.in }}>
        <span className={cn("block text-[14px] leading-5 transition-colors duration-200", item.state === "next" ? "text-ink-secondary" : "text-ink")}>{item.title}</span>
        {item.detail && <span className="block text-[13px] leading-[18px] text-ink-secondary">{item.detail}</span>}
      </motion.span>
    </li>)}
  </ol></LayoutGroup>;
}

function payItems(tier: string, paid: boolean) {
  const { name, price } = buyLabel(tier);
  return [
    { key: "in", state: "done" as const, title: t("cloudBuy.pay.signedIn"), detail: "sam@example.com" },
    { key: "pay", state: paid ? "done" as const : "now" as const, title: t("cloudBuy.pay.waiting"), detail: t("cloudBuy.pay.planPaid", { plan: name, price }) },
    { key: "setup", state: paid ? "now" as const : "next" as const, title: t("cloudBuy.pay.setup"), detail: t("cloudBuy.pay.setupHint") },
  ];
}
const setupItems = (step: number) => STEPS.map((key, i) => ({ key, title: t(key, { name: NAME }), state: i < step ? "done" as const : i === step ? "now" as const : "next" as const }));

/** a screen inside the sheet: the box springs to the new height (spring.height) while the new screen fades up after it */
function Screens({ id, reduced, children, lift = offset.swapIn }: { id: string; reduced: boolean; children: ReactNode; lift?: number }) {
  return <motion.div layout={!reduced} transition={spring.height} className="overflow-hidden">
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div key={id} initial={{ opacity: 0, y: reduced ? 0 : lift, filter: reduced ? "none" : "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, transition: { duration: 0.12, ease: ease.out } }} transition={reduced ? reducedFade : { ...spring.fade, delay: 0.08 }}>
        {children}
      </motion.div>
    </AnimatePresence>
  </motion.div>;
}

function SetupBody({ step, tier, reduced, bar }: { step: number; tier: string; reduced: boolean; bar: ReactNode }) {
  const ready = step >= 4;
  return <div className={SCREEN}>
    <div className="flex flex-col gap-3">
      <Badge>{t("cloudBuy.setup.badgePaid", { plan: buyLabel(tier).name })}</Badge>
      <Swap id={ready ? "r" : "s"} reduced={reduced} className="justify-items-start">
        <Heading title={ready ? t("cloudBuy.ready.title", { name: NAME }) : t("cloudBuy.setup.title")} sub={<span className="whitespace-normal">{ready ? t("cloudBuy.ready.sub") : t("cloudBuy.setup.sub")}</span>} />
      </Swap>
    </div>
    <div className="flex flex-col gap-3">{bar}<Checklist items={setupItems(step)} reduced={reduced} green={ready} /></div>
    <div className="flex justify-end">
      <motion.button type="button" className="ui-button ui-button-primary ui-button-pill" disabled={!ready}
        animate={{ opacity: ready ? 1 : 0.5 }} transition={{ duration: 0.2 }}>{t("cloudBuy.setup.open", { name: NAME })}</motion.button>
    </div>
  </div>;
}

/** A: the highlight slides between rows (one shared element, spring.layout .3s, no bounce); the price in the button rolls
 * only the digits that change; buy shows an arc and "Opening checkout…"; each screen fades up 8px while the sheet springs to
 * its height; checklist marks pop and draw; the progress bar fills on spring.soft */
function A(props: LabProps) {
  const { state, pick, buy, back, auto, replay } = usePlans(props);
  const r = props.reduced;
  const { name, price } = buyLabel(state.tier);
  const choosing = state.screen === "choose" || state.screen === "opening";
  const id = choosing ? "choose" : state.screen;
  return <Sheet>
    <Screens id={id} reduced={r}>
      {choosing && <div className={SCREEN}>
        <Head />
        <Rows tier={state.tier} onPick={pick} marker={(box) => <motion.span aria-hidden="true" className="absolute inset-x-1.5 top-0 rounded-[12px] bg-menu" initial={false}
          animate={{ y: box.top, height: box.height }} transition={r ? { duration: 0 } : spring.layout} />} />
        <Spec tier={state.tier} reduced={r} />
        <button type="button" className={PRIMARY_WIDE} disabled={state.screen === "opening"} onClick={() => buy()} aria-busy={state.screen === "opening" || undefined}>
          <Swap id={state.screen === "opening" ? "busy" : "buy"} reduced={r}>
            {state.screen === "opening" ? <><Arc size={15} reduced={r} />Opening checkout…</>
              : <span className="inline-flex items-baseline">Get&nbsp;<Swap id={name} reduced={r}>{name}</Swap>&nbsp;for&nbsp;<Roll value={price} reduced={r} stagger={0} />/month</span>}
          </Swap>
        </button>
        <p className="text-[12px] leading-4 text-ink-tertiary">{t("cloudBuy.terms")}</p>
      </div>}
      {state.screen === "pay" && <div className={SCREEN}>
        <Heading title={t("cloudAdd.browserTitle")} sub={t("cloudBuy.pay.sub")} />
        <Checklist items={payItems(state.tier, false)} reduced={r} />
        <div className="flex items-center gap-2"><button type="button" className={QUIET}><ExternalLink size={14} aria-hidden="true" />{t("cloudAdd.reopenCheckout")}</button>
          <button type="button" onClick={back} className="ms-1 px-1 py-1 text-[13px] font-medium underline decoration-ink/30 underline-offset-[3px]">{t("cloudAdd.changePlan")}</button></div>
      </div>}
      {state.screen === "setup" && <SetupBody step={state.step} tier={state.tier} reduced={r}
        bar={<div role="progressbar" aria-label={t("cloudBuy.setup.progress")} aria-valuenow={state.step * 25} className="h-1 overflow-hidden rounded-full bg-ink/10">
          <motion.div className="h-full origin-left rounded-full bg-ink" initial={{ scaleX: 0 }} animate={{ scaleX: state.step / 4 }} transition={r ? reducedFade : spring.soft} />
        </div>} />}
    </Screens>
    <Again show={!auto} onClick={replay} />
  </Sheet>;
}

/** B: the highlight stretches between rows (front edge 620/36, back 190/19); the price rolls digit by digit 45ms apart on
 * 260/(22+2i); buy collapses the button into a 48px circle with an arc (spring.width), checkout and paid tick through a
 * checklist whose current-row tint slides; setup fills one bar that turns green at ready while its checks draw */
function B(props: LabProps) {
  const { state, pick, buy, back, auto, replay } = usePlans(props);
  const r = props.reduced;
  const { name, price } = buyLabel(state.tier);
  const choosing = state.screen === "choose" || state.screen === "opening";
  const id = choosing ? "choose" : state.screen;
  const opening = state.screen === "opening";
  const ready = state.step >= 4;
  return <Sheet>
    <Screens id={id} reduced={r} lift={offset.rise}>
      {choosing && <div className={SCREEN}>
        <Head />
        <Rows tier={state.tier} onPick={pick} marker={(box) => <Stretch vertical left={box.top} right={box.top + box.height} reduced={r} className="inset-x-1.5 rounded-[12px] bg-menu" />} />
        <Spec tier={state.tier} reduced={r} />
        <div className="flex justify-center">
          <motion.button type="button" disabled={opening} onClick={() => buy()} aria-busy={opening || undefined} aria-label={opening ? "Opening checkout" : undefined}
            className="ui-button ui-button-primary ui-button-pill ui-button-lg overflow-hidden !px-0" initial={false}
            animate={{ width: opening ? 48 : 412 }} transition={r ? { duration: 0 } : spring.width}>
            <Swap id={opening ? "busy" : "buy"} reduced={r}>
              {opening ? <Arc size={18} reduced={r} />
                : <span className="inline-flex items-baseline">Get&nbsp;<Swap id={name} reduced={r} rise={offset.rise}>{name}</Swap>&nbsp;for&nbsp;<Roll value={price} reduced={r} />/month</span>}
            </Swap>
          </motion.button>
        </div>
        <motion.p animate={{ opacity: opening ? 0 : 1 }} className="text-[12px] leading-4 text-ink-tertiary">{t("cloudBuy.terms")}</motion.p>
      </div>}
      {state.screen === "pay" && <div className={SCREEN}>
        <Heading title={t("cloudAdd.browserTitle")} sub={t("cloudBuy.pay.sub")} />
        <Checklist items={payItems(state.tier, false)} reduced={r} />
        <div className="flex items-center gap-2"><button type="button" className={QUIET}><ExternalLink size={14} aria-hidden="true" />{t("cloudAdd.reopenCheckout")}</button>
          <button type="button" onClick={back} className="ms-1 px-1 py-1 text-[13px] font-medium underline decoration-ink/30 underline-offset-[3px]">{t("cloudAdd.changePlan")}</button></div>
      </div>}
      {state.screen === "setup" && <SetupBody step={state.step} tier={state.tier} reduced={r}
        bar={<div role="progressbar" aria-label={t("cloudBuy.setup.progress")} aria-valuenow={state.step * 25} className="relative h-1.5 overflow-hidden rounded-full bg-ink/10">
          <motion.div className="absolute inset-y-0 start-0 w-full origin-left rounded-full" initial={{ scaleX: 0 }}
            animate={{ scaleX: Math.max(0.04, state.step / 4), backgroundColor: ready ? "var(--color-success)" : "var(--color-ink)" }}
            transition={r ? reducedFade : { scaleX: { type: "spring", stiffness: 160, damping: 22 }, backgroundColor: { duration: 0.3 } }} />
        </div>} />}
    </Screens>
    <Again show={!auto} onClick={replay} />
  </Sheet>;
}

export const plans: Item = {
  id: "flows-cloud-plans",
  title: "dusk cloud plans sheet",
  surface: "cloud buy sheet (ChooseScreen, PayScreen, SetupScreen)",
  height: 470,
  loopMs: 11000,
  notes: {
    original: "real ChooseScreen, PayScreen, SetupScreen (scaled to the column): the picked row's tint and radio change in 150ms; the button's price just changes; buy only disables it; each screen is a hard cut; the setup bar's width eases 500ms and the turning ring is the only motion in the checklist.",
    a: "calm: highlight slides on spring.layout (.3s, no bounce); only changed price digits roll (drums 260/22); plan name swaps 8px/blur 4; buy shows an arc + \"Opening checkout…\"; screens fade up 8px +80ms while the sheet springs to height (300/22); checks pop (520/26) and draw; bar scaleX on spring.soft. (A and B leave out setup's name/colour column to keep the progress in view.)",
    b: "alive: two-edge stretch highlight (620/36 front, 190/19 back); drums roll 45ms apart on 260/(22+2i) (DesignBookmark plan switch, look only); buy collapses to a 48px circle with an arc (spring.width 380/24); screens rise 12px; the now-row tint slides; the bar fills on 160/22 and turns green at ready.",
  },
  Original, A, B,
};
