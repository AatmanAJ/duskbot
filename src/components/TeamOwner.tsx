// A teammate's face, and this person's Needs you.
import { useEffect, useState } from "react";
import { Bell } from "../icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api, useStoreSelector, openThread } from "@/state/store";
import { botById } from "@/state/store-index";
import { useStoreRef } from "@/state/store-ref";
import { askingWhom, pictureOf, refreshNeedsYou, useTeamPeople, type TeamPerson } from "@/state/team-people";
import type { NeedsYouItem } from "../../shared/today";
import { useInboxSupport } from "@/state/inbox";
import { MENU_SHEET } from "./menu-recipe";

const initial = (person: TeamPerson) => person.name.trim().charAt(0).toUpperCase() || "?";
const HUES = ["bg-[#5B8DEF]", "bg-[#E0745B]", "bg-[#4FAF7F]", "bg-[#B26BD9]", "bg-[#D9A23B]", "bg-[#3BA7B8]"];
const hueOf = (email: string) => HUES[[...email].reduce((sum, char) => sum + char.charCodeAt(0), 0) % HUES.length];

/** A teammate's picture, or their initial when they have none or it fails to load. */
export function PersonFace({ person, size = 18 }: { person: TeamPerson; size?: number }) {
  const picture = pictureOf(person, useTeamPeople());
  const [failed, setFailed] = useState<string | null>(null);
  if (picture && failed !== picture) {
    return <img src={picture} alt="" aria-hidden="true" draggable={false} data-person-picture={person.email} onError={() => setFailed(picture)}
      style={{ width: size, height: size }} className="inline-block shrink-0 rounded-full bg-raised object-cover" />;
  }
  return <span aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
    className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none text-white", hueOf(person.email))}>{initial(person)}</span>;
}

/** A tag or passed message is done once its person opens it, even in a shared chat someone else already read. */
function readConversation(groups: ReadonlyArray<{ id: string; threadId: string; tasks?: ReadonlyArray<{ threadId: string }> }>, botId: string, threadId: string) {
  const group = groups.find((one) => one.threadId === threadId || one.tasks?.some((task) => task.threadId === threadId));
  void (group ? api(`/api/groups/${group.id}/read`, { method: "POST" }) : api(`/api/bots/${botId}/read`, { method: "POST", body: JSON.stringify({ threadId }) }))
    .then(() => refreshNeedsYou()).catch(() => {});
}

/** A Needs you line's title, after the face of the teammate it is from. */
export function NeedsYouTitle({ item, title }: { item: NeedsYouItem; title: string }) {
  const from = item.kind === "message" && item.fromEmail ? { email: item.fromEmail, name: item.from, role: "member" } : null;
  if (!from) return <span className="w-full truncate text-[13px] text-ink">{title}</span>;
  return <span className="flex w-full min-w-0 items-center gap-1.5 text-[13px] text-ink"><PersonFace person={from} size={16} /><span className="min-w-0 truncate">{title}</span></span>;
}

/** One thing that needs this person, opening its conversation. */
export function NeedsYouLine({ item, onOpened }: { item: NeedsYouItem; onOpened?: () => void }) {
  const store = useStoreRef();
  const botId = "botId" in item ? item.botId : item.botIds[0]!;
  const botName = useStoreSelector((s) => botById(s, botId)?.name) ?? t("needsYou.aBot");
  const title = item.kind === "message" ? t("needsYou.message", { name: item.from })
    : item.kind === "question" ? t("needsYou.asking", { bot: botName }) : t("needsYou.fix", { bot: botName });
  const text = "text" in item ? item.text : "";
  return <button type="button" role="menuitem"
    onClick={() => {
      onOpened?.();
      if (!item.threadId) return;
      const state = store.state();
      openThread(store.dispatch, { botId, threadId: item.threadId }, state);
      if (item.kind === "message") readConversation(state.groups, botId, item.threadId);
    }}
    className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-menu-hover">
    <NeedsYouTitle item={item} title={title} />
    {text && <span className="w-full truncate text-[12px] text-ink-secondary">{text}</span>}
  </button>;
}

/** For a server older than this page, where the person has no inbox: what the bots ask of them, newest first. */
export function NeedsYouButton({ compact = false }: { compact?: boolean }) {
  const team = useTeamPeople();
  const support = useInboxSupport();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!(event.target instanceof Element) || !event.target.closest("[data-needs-you]")) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  const items = team?.needsYou ?? [];
  if (support !== "no" || !team || items.length === 0) return null;
  const label = t("needsYou.count", { count: items.length });
  return (
    <div data-needs-you className={cn("relative", compact ? "px-1" : "px-2 pb-1")}>
      <button type="button" aria-expanded={open} aria-haspopup="menu" aria-label={label} title={label} onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium text-warning hover:bg-raised/60">
        <Bell size={15} aria-hidden="true" className="shrink-0" />
        {!compact && <span className="min-w-0 flex-1 truncate">{t("needsYou.title")}</span>}
        <span className="rounded-full bg-warning px-1.5 text-[11px] font-semibold tabular-nums text-panel">{items.length}</span>
      </button>
      {open && (
        <div role="menu" aria-label={t("needsYou.title")} className={cn("absolute left-2 right-2 top-full z-40 mt-1 max-h-[340px] overflow-y-auto", MENU_SHEET)}>
          {items.map((item) => <NeedsYouLine key={`${item.kind}:${item.id}`} item={item} onOpened={() => setOpen(false)} />)}
        </div>
      )}
    </div>
  );
}

/** Above an open question or approval in a shared team chat: whose answer it waits for. */
export function AskingLine({ botId, threadId }: { botId: string; threadId: string }) {
  const team = useTeamPeople();
  const bot = useStoreSelector((s) => botById(s, botId));
  if (!team || !bot) return null;
  const person = askingWhom(bot, bot.tasks?.find((task) => task.threadId === threadId), team);
  if (!person) return null;
  return <div data-asking={person.email} className="mb-1.5 flex items-center gap-1.5 text-[12px] text-ink-secondary">
    <PersonFace person={person} size={14} />{person.you ? t("owner.askingYou") : t("owner.asking", { name: person.name })}
  </div>;
}
