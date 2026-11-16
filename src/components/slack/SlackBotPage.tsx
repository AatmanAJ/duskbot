import { useState } from "react";
import { t } from "@/lib/i18n";
import { openSettings } from "@/lib/open-settings";
import { useDispatch, type Bot } from "@/state/store";
import { Card, FormField, ItemRow, NavRow, NoteRow, pillCls, pillPrimaryCls, rowCls } from "../ListRows";
import { textFieldCls } from "../ui/GrokDialog";
import { useSlackBot, useSlackWorkspace } from "./use-slack";

function httpsUrl(value: string | undefined): string | null {
  try { return value && new URL(value).protocol === "https:" ? value : null; }
  catch { return null; }
}

export function SlackBotPage({ bot }: { bot: Bot }) {
  return <SlackBotContent key={bot.id} bot={bot} />;
}

function SlackBotContent({ bot }: { bot: Bot }) {
  const dispatch = useDispatch();
  const workspace = useSlackWorkspace();
  const slack = useSlackBot(bot.id);
  const [link, setLink] = useState("");
  const [token, setToken] = useState("");
  const [confirm, setConfirm] = useState(false);
  const { status, error, busy } = slack;
  if (!workspace.available || !slack.available) return null;
  // loaded but not ready means its secure storage is unavailable: say so instead of loading for ever
  if (!workspace.status?.ready || !status) return <Card><NoteRow>{t(workspace.status && !workspace.status.ready ? "slack.notReady" : "slack.loading")}</NoteRow>{(error || workspace.error) && <NoteRow tone="danger">{error || workspace.error}</NoteRow>}</Card>;
  if (workspace.status.state !== "connected") return <Card>
    <NoteRow>{t("slack.bot.connectFirst")}</NoteRow>
    <NavRow title={t("slack.bot.connections")} onClick={() => dispatch(openSettings("connections"))} />
    {workspace.error && <NoteRow tone="danger">{workspace.error}</NoteRow>}
  </Card>;
  const name = bot.name;
  const handle = status.handle ?? name;
  const team = status.teamName ?? status.teamId ?? "";
  const online = status.state === "online" || status.state === "offline";
  const appTokenUrl = httpsUrl(status.appTokenUrl);
  const openUrl = httpsUrl(status.openUrl);
  const tokenStep = status.state === "installed" || status.state === "error";
  return <Card>
    {(status.state === "not_linked" || status.state === "provisioned") && <>
      <ItemRow title={t("slack.title")} hint={t("slack.bot.hint", { name })}>
        <button type="button" className={pillPrimaryCls} disabled={busy} onClick={() => void slack.provision().then((url) => { if (url) window.open(url, "_blank", "noopener,noreferrer"); })}>{t("slack.bot.add")}</button>
      </ItemRow>
      {status.state === "provisioned" && <>
        <NoteRow>{t("slack.bot.waiting")}</NoteRow>
        <form onSubmit={(event) => { event.preventDefault(); if (link.trim() && !busy) void slack.finishWithLink(link.trim()).then((ok) => { if (ok) setLink(""); }); }}>
          <NoteRow>{t("slack.bot.pasteHint")}</NoteRow>
          <div className={rowCls}>
            <input type="text" aria-label={t("slack.bot.link")} autoComplete="off" spellCheck={false} dir="ltr" className={textFieldCls} value={link} onChange={(event) => setLink(event.target.value)} />
            <button type="submit" className={pillCls} disabled={busy || !link.trim()}>{t("slack.continue")}</button>
          </div>
        </form>
      </>}
    </>}
    {status.state === "error" && <NoteRow tone="danger">{status.error || t("slack.error.generic")}</NoteRow>}
    {tokenStep && <>
      <NoteRow>{t("slack.bot.oneMore")}</NoteRow>
      <NoteRow>{appTokenUrl ? <a href={appTokenUrl} target="_blank" rel="noopener noreferrer">{t("slack.bot.tokenStep1", { name })}</a> : t("slack.bot.tokenStep1", { name })}</NoteRow>
      <NoteRow>{t("slack.bot.tokenStep2")}</NoteRow>
      <NoteRow>{t("slack.bot.tokenStep3")}</NoteRow>
      <form onSubmit={(event) => { event.preventDefault(); if (token.trim() && !busy) void slack.setAppToken(token).then((ok) => { if (ok) setToken(""); }); }}>
        <div className={rowCls}>
          <div className="min-w-0 flex-1"><FormField label={t("slack.bot.appToken")}>
            <input type="password" aria-label={t("slack.bot.appToken")} placeholder={t("slack.bot.appTokenPlaceholder")} autoComplete="off" spellCheck={false} dir="ltr" className={textFieldCls} value={token} onChange={(event) => setToken(event.target.value)} />
          </FormField></div>
          <button type="submit" className={pillPrimaryCls} disabled={busy || !token.trim()}>{t("slack.save")}</button>
        </div>
      </form>
    </>}
    {online && <>
      <ItemRow title={t(status.state === "online" ? "slack.bot.onlineAs" : "slack.bot.offlineAs", { handle, team })}>
        <span className={pillCls}>{t(status.state === "online" ? "slack.state.online" : "slack.state.offline")}</span>
      </ItemRow>
      {openUrl && <NavRow title={t("slack.bot.open")} external onClick={() => window.open(openUrl, "_blank", "noopener,noreferrer")} />}
      <NoteRow>{status.state === "offline" ? t("slack.bot.reconnecting") : t("slack.bot.invite", { handle, name })}</NoteRow>
    </>}
    {status.state !== "not_linked" && (confirm ? <ItemRow title={t("slack.bot.removeConfirm", { name })} tone="danger">
      <button type="button" className={pillCls} disabled={busy} onClick={() => void slack.remove().then(() => setConfirm(false))}>{t("slack.remove")}</button>
      <button type="button" className={pillCls} disabled={busy} onClick={() => setConfirm(false)}>{t("slack.cancel")}</button>
    </ItemRow> : <NavRow title={t("slack.bot.remove")} danger drill={false} disabled={busy} onClick={() => setConfirm(true)} />)}
    {error && <NoteRow tone="danger">{error}</NoteRow>}
  </Card>;
}
