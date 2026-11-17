import { feature } from "@/lib/product-analytics";
import { useEffect, useState } from "react";
import { GitBranch, Wrench } from "../icons";
import { api, useStoreSelector, formatTime } from "@/state/store";
import { useStoreRef } from "@/state/store-ref";
import { BotAvatar } from "./Avatar";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { withoutCitationTraces } from "@/lib/citations";
import type { SearchHit } from "@/lib/search-hit";
import { landOnSearchHit } from "@/lib/focus-message";
import { friendlyError } from "@/lib/plain-error";

export const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

export function SearchResults({ query, onLanded }: { query: string; onLanded: () => void }) {
  const store = useStoreRef();
  const { dispatch } = store;
  const bots = useStoreSelector((s) => s.bots);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = query.trim();

  useEffect(() => {
    if (q.length < MIN_QUERY) {
      setHits(null);
      setError(null);
      return;
    }
    setHits(null);
    setError(null);
    let alive = true;
    const timer = setTimeout(() => {
      api(`/api/search?q=${encodeURIComponent(q)}&limit=40`)
        .then((r: { hits: SearchHit[] }) => alive && (feature("search_used"), setHits(r.hits), setError(null)))
        .catch((e: unknown) => alive && setError(friendlyError(e)));
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);

  if (q.length < MIN_QUERY) return null;

  const land = async (hit: SearchHit) => {
    try {
      await landOnSearchHit(hit, store.state(), dispatch);
      onLanded();
    } catch (e) {
      dispatch({ type: "error", message: friendlyError(e) });
    }
  };

  return (
    <div className="mt-2 border-t border-transparent pt-2">
      <div className="px-3 pb-1 text-[12px] font-medium leading-4 text-ink-secondary">
        {t("search.messages")}{hits ? ` · ${hits.length}${hits.length === 40 ? "+" : ""}` : ""}
      </div>
      {error && <div role="alert" className="px-3 py-2 text-[13px] leading-[18px] text-danger">{t("search.unavailable")}</div>}
      {hits && hits.length === 0 && !error && <div role="status" data-search-empty="" className="px-3 py-3 text-[13px] leading-[18px] tracking-[0.015em] text-ink/[0.56]">{t("search.none", { query: q })}</div>}
      {hits?.map((hit) => {
        const bot = hit.botId ? bots.find((b) => b.id === hit.botId) : undefined;
        const before = withoutCitationTraces(hit.snippet.slice(0, hit.matchStart));
        const match = hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength);
        const after = withoutCitationTraces(hit.snippet.slice(hit.matchStart + hit.matchLength));
        return (
          <button
            key={`${hit.threadId}:${hit.messageId}`}
            onClick={() => void land(hit)}
            className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-raised/60"
          >
            {bot ? (
              <BotAvatar bot={bot} state="idle" size={26} animated={false} />
            ) : (
              <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-raised text-[11px] text-ink-secondary">#</span>
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-1.5 text-[12px] text-ink-secondary">
                <span className="truncate font-medium text-ink">{hit.from ?? hit.name}</span>
                <span className="ml-auto shrink-0 tabular-nums">{formatTime(hit.at)}</span>
              </span>
              <span dir="auto" className={cn("mt-0.5 line-clamp-2 text-[13px] leading-snug", hit.role === "user" ? "text-ink" : "text-ink-secondary")}>
                {hit.kind === "activity" && <Wrench size={11} className="mr-1 inline text-ink-secondary" />}
                {before}
                <mark className="rounded-sm bg-accent/25 px-0.5 text-ink">{match}</mark>
                {after}
              </span>
              {!hit.onActivePath && (
                <span className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-secondary">
                  <GitBranch size={10} /> Other version
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
