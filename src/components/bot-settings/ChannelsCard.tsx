import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/plain-error";
import { api, type Bot } from "@/state/store";
import { MESSENGER_LABELS, type MessengerPlatform, type MessengerStatus, type MessengersStatus } from "../../../shared/messengers";

const buttonCls = "rounded-lg bg-card px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";
const HELP: Record<MessengerPlatform, string> = { telegram: "https://t.me/BotFather", discord: "https://discord.com/developers/applications" };

/** Channels: the bot's own Telegram and Discord bots, so people message it there. */
export function ChannelsCard({ bot, className }: { bot: Bot; className?: string }) {
  const [view, setView] = useState<MessengersStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = `/api/bots/${encodeURIComponent(bot.id)}/messengers`;

  useEffect(() => {
    let cancelled = false;
    setView(null);
    api<MessengersStatus>(path).then((loaded) => { if (!cancelled) setView(loaded); }).catch(() => { if (!cancelled) setError(t("channels.loadError")); });
    return () => { cancelled = true; };
  }, [path]);

  const replace = (next: MessengerStatus) => setView((old) => old && { ...old, platforms: old.platforms.map((one) => (one.platform === next.platform ? next : one)) });

  return (
    <div className={cn("rounded-xl bg-card p-4", className)} data-testid="channels">
      <div className="text-[15px] font-medium text-ink">{t("channels.title")}</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">{t("channels.hint", { name: bot.name })}</div>
      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
      {view && (
        <div className="mt-3 flex flex-col gap-3">
          {view.platforms.map((status) => <PlatformRow key={status.platform} path={path} status={status} onChange={replace} />)}
        </div>
      )}
    </div>
  );
}

function PlatformRow({ path, status, onChange }: { path: string; status: MessengerStatus; onChange(next: MessengerStatus): void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = MESSENGER_LABELS[status.platform];
  const base = `${path}/${status.platform}`;

  const run = async (request: () => Promise<MessengerStatus>) => {
    setBusy(true);
    setError(null);
    try { onChange(await request()); setToken(""); }
    catch (failure) { setError(friendlyError(failure, t("channels.error", { app: label }))); }
    finally { setBusy(false); }
  };
  const connect = () => run(() => api<MessengerStatus>(base, { method: "PUT", body: JSON.stringify({ token: token.trim() }) }));
  const disconnect = () => run(() => api<MessengerStatus>(base, { method: "DELETE" }));
  const letIn = (id: string) => run(() => api<MessengerStatus>(`${base}/allowed`, { method: "POST", body: JSON.stringify({ id }) }));
  const remove = (id: string) => run(() => api<MessengerStatus>(`${base}/allowed/${encodeURIComponent(id)}`, { method: "DELETE" }));

  if (status.state === "not_connected") {
    return (
      <div className="rounded-lg bg-control p-3" data-testid={`channels-${status.platform}`}>
        <div className="text-[14px] text-ink">{label}</div>
        <div className="mt-0.5 text-[12px] text-ink-secondary">
          {t(status.platform === "telegram" ? "channels.telegram.how" : "channels.discord.how")}{" "}
          <a href={HELP[status.platform]} target="_blank" rel="noreferrer" className="text-ink underline-offset-2 hover:underline">{t(status.platform === "telegram" ? "channels.telegram.open" : "channels.discord.open")}</a>
        </div>
        <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (token.trim()) void connect(); }}>
          <label className="sr-only" htmlFor={`channels-token-${status.platform}`}>{t("channels.token", { app: label })}</label>
          <input
            id={`channels-token-${status.platform}`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={t("channels.token", { app: label })}
            className="min-w-0 flex-1 rounded-lg bg-card px-3 py-1.5 text-[13px] text-ink placeholder:text-ink-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
          <button type="submit" disabled={busy || !token.trim()} className={buttonCls}>{busy ? t("channels.connecting") : t("channels.connect")}</button>
        </form>
        {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
      </div>
    );
  }

  const stateLine = status.state === "online" ? t("channels.online") : status.state === "error" ? status.error ?? t("channels.error", { app: label }) : t("channels.starting");
  return (
    <div className="rounded-lg bg-control p-3" data-testid={`channels-${status.platform}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[14px] text-ink">{label} · {status.openUrl ? <a href={status.openUrl} target="_blank" rel="noreferrer" className="hover:underline">{status.handle}</a> : status.handle}</div>
          <div className={cn("mt-0.5 text-[12px]", status.state === "error" ? "text-danger" : "text-ink-secondary")}>{stateLine}</div>
        </div>
        <button type="button" onClick={() => void disconnect()} disabled={busy} className={buttonCls}>{t("channels.disconnect")}</button>
      </div>
      {status.pairUrl ? (
        <ClaimLink url={status.pairUrl} />
      ) : status.pairCode ? (
        <div className="mt-2 text-[12px] text-ink-secondary">{t("channels.claimCode", { app: label })} <span className="font-mono text-ink">{status.pairCode}</span></div>
      ) : null}
      {(status.owner || status.allowed.length > 0) && (
        <ul className="mt-2 flex flex-col gap-1 text-[13px] text-ink">
          {status.owner && <li>{t("channels.ownerLine", { name: status.owner.name ?? status.owner.id })}</li>}
          {status.allowed.map((one) => (
            <li key={one.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{one.kind === "chat" ? t("channels.groupLine", { name: one.name ?? one.id }) : one.name ?? one.id}</span>
              <button type="button" onClick={() => void remove(one.id)} disabled={busy} className="text-[12px] text-ink-secondary hover:text-ink">{t("channels.remove")}</button>
            </li>
          ))}
        </ul>
      )}
      {status.knocked.length > 0 && (
        <div className="mt-2">
          <div className="text-[12px] text-ink-secondary">{t("channels.knocked")}</div>
          <ul className="mt-1 flex flex-col gap-1 text-[13px] text-ink">
            {status.knocked.map((one) => (
              <li key={one.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{one.kind === "chat" ? t("channels.groupLine", { name: one.name }) : one.name}</span>
                <button type="button" onClick={() => void letIn(one.id)} disabled={busy} className={buttonCls}>{t("channels.letIn")}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
    </div>
  );
}

/** The one-tap claim link, opened or copied; the long address itself is never laid out. */
function ClaimLink({ url }: { url: string }) {
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const copy = async () => {
    setCopied((await copyText(url)) === "copied" ? "copied" : "failed");
    window.setTimeout(() => setCopied(null), 1500);
  };
  return (
    <div className="mt-2" data-testid="channels-claim">
      <div className="text-[12px] text-ink-secondary">{t("channels.claimLink")}</div>
      <div className="mt-2 flex flex-wrap gap-2">
      <a href={url} target="_blank" rel="noreferrer" className={buttonCls}>{t("channels.openInTelegram")}</a>
      <button type="button" onClick={() => void copy()} className={buttonCls}>
        {copied === "copied" ? t("channels.copied") : copied === "failed" ? t("channels.copyFailed") : t("channels.copyLink")}
      </button>
      </div>
    </div>
  );
}
