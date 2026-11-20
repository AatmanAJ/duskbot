import { X } from "@/icons";
import type { AppFlow } from "../data/app-connect";
import { appLink, openApp } from "../lib/app-link";
import { AnimatePresence, EASE_OUT, m, SPRING } from "./motion";

const LINES: Partial<Record<AppFlow["phase"], (flow: AppFlow) => [string, string]>> = {
  waiting: (f) => [`connecting ${f.label}`, `asking ${f.workspaceName} for the sign-in`],
  redirecting: (f) => [`connecting ${f.label}`, `opening ${f.label}'s sign-in`],
  finishing: (f) => [`finishing ${f.label}`, `waiting for ${f.workspaceName} to see it`],
  failed: (f) => [`${f.label} isn't connected`, f.message ?? "try again in a minute."],
};

function Card({ flow, onDismiss }: { flow: AppFlow; onDismiss(): void }) {
  const [title, line] = LINES[flow.phase]!(flow);
  const failed = flow.phase === "failed";
  return (
    <m.div data-connect-pill={flow.phase} className="pop pointer-events-auto w-[min(320px,calc(100vw-24px))] rounded-[22px] bg-pop px-3.5 py-3" style={{ boxShadow: "var(--pop-shadow)", originX: 1, originY: 0 }}
      initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.16, ease: EASE_OUT } }} transition={SPRING}>
      <div className="flex items-start gap-2.5">
        {!failed && <span className="spin mt-0.5 size-4 shrink-0 rounded-full border-2 border-track border-t-ink" aria-hidden />}
        <div className="min-w-0 flex-1" role={failed ? "alert" : "status"}>
          <div className="truncate text-14 font-medium text-ink">{title}</div>
          <div className={failed ? "text-13 text-ink-3" : "truncate text-13 text-ink-3"}>{line}</div>
          {failed && <button type="button" onClick={() => openApp(appLink.connect(flow.slug))} className="text-link mt-1.5 text-13">connect it in the app instead</button>}
        </div>
        {failed && <button type="button" onClick={onDismiss} aria-label="close" className="press hover-ghost -me-1.5 -mt-1 grid size-9 shrink-0 place-items-center rounded-full text-ink-3"><X size={16} strokeWidth={1.5} /></button>}
      </div>
    </m.div>
  );
}

/** the website's app sign-ins in the corner while they run, and the one that failed with the way through the app */
export function ConnectPill({ flows, onDismiss }: { flows: Record<string, AppFlow>; onDismiss(key: string): void }) {
  const shown = Object.values(flows).filter((flow) => flow.action === "connect" && LINES[flow.phase]);
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-30 flex flex-col items-end gap-2 max-lg:right-3 max-lg:top-[calc(60px+env(safe-area-inset-top))]">
      <AnimatePresence initial={false}>{shown.map((flow) => <Card key={flow.key} flow={flow} onDismiss={() => onDismiss(flow.key)} />)}</AnimatePresence>
    </div>
  );
}
