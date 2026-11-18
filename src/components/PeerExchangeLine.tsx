import type { ReactNode } from "react";
import type { Bot } from "@/state/store";
import type { ExchangeSummary, PeerRef } from "@/lib/peer-exchange";
import { t } from "@/lib/i18n";
import { BotAvatar } from "./Avatar";
import { EventChip, EventLabel, EventLine } from "./EventLine";

function peerBot(peer: PeerRef, bots: readonly Pick<Bot, "id" | "name" | "color">[]) {
  return bots.find((bot) => bot.id === peer.id) ?? (peer.name ? bots.find((bot) => bot.name === peer.name) : undefined);
}

const EXCERPT_MAX = 160;

/** The peer's words on one line, without the leading @names it addressed. */
export function peerExcerpt(body: string | undefined, bots: readonly Pick<Bot, "name">[]): string {
  let text = (body ?? "").replace(/\s+/g, " ").trim();
  const names = bots.map((bot) => `@${bot.name}`).sort((a, b) => b.length - a.length);
  for (let lead = names.find((name) => text.startsWith(name)); lead; lead = names.find((name) => text.startsWith(name))) text = text.slice(lead.length).trimStart();
  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX - 1)}…` : text;
}

/** One run of bot-to-bot messages as grok draws it; a chip opens the messages under the line. */
export function PeerExchangeLine({ summary, bots, expanded, onToggle }: {
  summary: ExchangeSummary;
  bots: readonly Bot[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const chip = (peer: PeerRef): ReactNode => {
    const bot = peerBot(peer, bots);
    const name = bot?.name ?? peer.name;
    return (
      <EventChip
        key={peer.id ?? peer.name}
        wideGap
        leading={<BotAvatar bot={bot ?? { name, color: (peer.color ?? "blue") as Bot["color"] }} state="happy" size={16} motion="none" motionKey={0} animated={false} />}
        title={name}
        aria-expanded={expanded}
        aria-label={t(expanded ? "chat.event.hideExchange" : "chat.event.showExchange", { name })}
        onClick={onToggle}
      >
        {name}
      </EventChip>
    );
  };
  const crowd = (peers: readonly PeerRef[]): ReactNode => {
    const names = peers.map((peer) => peerBot(peer, bots)?.name ?? peer.name).join(", ");
    const lead = peerBot(peers[0]!, bots);
    return (
      <EventChip
        wideGap
        leading={<BotAvatar bot={lead ?? { name: peers[0]!.name, color: (peers[0]!.color ?? "blue") as Bot["color"] }} state="happy" size={16} motion="none" motionKey={0} animated={false} />}
        title={names}
        aria-expanded={expanded}
        aria-label={t(expanded ? "chat.event.hideExchange" : "chat.event.showExchange", { name: names })}
        onClick={onToggle}
      >
        {t("chat.event.botsMany", { count: peers.length })}
      </EventChip>
    );
  };
  const peersPart = (peers: readonly PeerRef[]): ReactNode => {
    if (peers.length >= 3) return crowd(peers);
    if (peers.length === 2) return <>{chip(peers[0]!)}<EventLabel tone="tertiary">{t("chat.event.and")}</EventLabel>{chip(peers[1]!)}</>;
    return peers[0] ? chip(peers[0]) : null;
  };
  if (summary.kind === "single" && summary.as === "answer") {
    return (
      <EventLine data-peer-exchange="answer">
        {chip(summary.peer)}
        <EventLabel>{t("chat.event.peerReplied")}</EventLabel>
      </EventLine>
    );
  }
  const label = summary.kind === "single"
    ? t(summary.direction === "inbound" ? "chat.event.messageFrom"
      : summary.as === "reply" ? "chat.event.respondedTo" : summary.as === "ask" ? "chat.event.askedPeer" : "chat.event.messaged")
    : summary.kind === "fanout" ? t("chat.event.messaged") : t("chat.event.messagesWith", { count: summary.count });
  const said = summary.kind === "single" && summary.direction === "inbound" ? peerExcerpt(summary.body, bots) : "";
  return (
    <EventLine data-peer-exchange={summary.kind === "single" && summary.as ? summary.as : summary.kind}>
      <EventLabel>{label}</EventLabel>
      {summary.kind === "single" ? chip(summary.peer) : peersPart(summary.peers)}
      {said && <span dir="auto" data-peer-said="" title={said} className="min-w-0 max-w-[min(28rem,60%)] truncate text-ink-tertiary">{said}</span>}
    </EventLine>
  );
}
