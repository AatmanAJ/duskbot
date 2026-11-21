import { useEffect, useRef, type MouseEvent, type MutableRefObject, type ReactNode } from "react";
import { X } from "@/icons";
import { EASE_OUT, GLIDE, m } from "../ui/motion";
import { withBase } from "../lib/router";
import { useAdminRole } from "./api";

/** which card a url param opens: the money card from revenue, or the person card from anywhere else */
export type CardParam = "customer" | "person";

/** the page's own url with a card open on someone, so the link can be shared */
export function cardHref(param: CardParam, id: string) {
  const url = new URL(window.location.href);
  for (const other of ["customer", "person"]) url.searchParams.delete(other);
  url.searchParams.set(param, id);
  return url.pathname + url.search;
}
const notify = () => window.dispatchEvent(new PopStateEvent("popstate"));
/** opens a card in place: a history entry of its own, so back closes it, and no scroll jump */
export function openCard(param: CardParam, id: string) {
  window.history.pushState({ card: param }, "", cardHref(param, id));
  notify();
}
export function closeCard(param: CardParam) {
  if ((window.history.state as { card?: string } | null)?.card === param) { window.history.back(); return; }
  const url = new URL(window.location.href);
  url.searchParams.delete(param);
  window.history.replaceState(null, "", url.pathname + url.search);
  notify();
}

/** a row that opens a card here; a new tab or window still gets the shareable url */
export function CardLink({ param, id, className, children, title }: { param: CardParam; id: string; className?: string; children: ReactNode; title?: string }) {
  const role = useAdminRole();
  const go = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openCard(param, id);
  };
  if (role !== "owner") return <span className={className} title={title}>{children}</span>;
  return <a href={withBase(cardHref(param, id))} onClick={go} className={className} title={title}>{children}</a>;
}
/** a person anywhere in the admin: opens their card over the page you're on */
export const PersonLink = (props: { id: string; className?: string; children: ReactNode; title?: string }) => <CardLink param="person" {...props} />;

/** the sheet from the right edge both cards sit in: escape, the scrim and back close it, focus stays inside */
export function SidePanel({ label, titleId, onClose, pending, wide, children }: {
  label: string; titleId: string; onClose(): void; children: ReactNode; wide?: boolean;
  /** a confirm step in progress takes escape first, so escape never skips past it */
  pending?: MutableRefObject<(() => void) | null>;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("[data-close]")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); if (pending?.current) pending.current(); else onClose(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>("button:not(:disabled), input, select, textarea, a[href]")];
      if (!items.length) return;
      const [a, z] = [items[0]!, items[items.length - 1]!];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = overflow; back?.focus({ preventScroll: true }); };
  }, [onClose, pending]);
  return (
    <div className="fixed inset-0 z-50">
      <m.div className="absolute inset-0" style={{ background: "var(--scrim)" }} onClick={onClose} aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE_OUT }} />
      <m.div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={`absolute inset-y-0 right-0 flex flex-col overflow-y-auto overscroll-contain rounded-s-[28px] bg-pop px-6 pb-8 pt-5 max-sm:rounded-none max-sm:px-4 ${wide ? "w-[min(720px,100vw)]" : "w-[min(540px,100vw)]"}`}
        style={{ boxShadow: "var(--pop-shadow)" }}
        initial={{ x: 48, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 48, opacity: 0, transition: { duration: 0.16, ease: EASE_OUT } }} transition={GLIDE}>
        <div className="flex items-center justify-between gap-3">
          <span className="t-meta">{label}</span>
          <button data-close type="button" onClick={onClose} aria-label="close" className="press hover-ghost -me-2 grid size-11 shrink-0 place-items-center rounded-full text-ink-3"><X size={18} strokeWidth={1.5} /></button>
        </div>
        {children}
      </m.div>
    </div>
  );
}
