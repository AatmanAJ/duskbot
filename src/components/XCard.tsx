import { useCallback, useEffect, useRef, useState } from "react";

import { api, useDispatch, useStoreSelector, type ConfigStatus } from "@/state/store";
import { activeLocale, t } from "@/lib/i18n";
import { xResearchAction } from "@/lib/cloud-plan";
import { keyRemoved, keySaved, keySaveFailure, keyTestResult } from "@/lib/product-events";
import { isXConnectorStatus, type XConnectorStatus, type XIncludedUsage } from "../../shared/x-connector";
import { looksLikeKey, saveCredential, tregVerdict } from "./keys/key-save";
import { useCloudPlan } from "./ProIntroduction";
import { KitActions, KitBody, KitButton, KitField, KitLink, KitStatus, KitText } from "./connect-apps/detail-kit";
import { friendlyError } from "@/lib/plain-error";

const TREG_URL = "https://treg.to";

const day = (iso: string) => new Intl.DateTimeFormat(activeLocale(), { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(iso));
const number = (value: number) => value.toLocaleString(activeLocale());

/** The plan's included calls this month in words: "312 of 5,000 X calls this month", or that they are used up and when they come back. */
export function xUsageLines(usage: XIncludedUsage): { line: string; usedUp: boolean } {
  const counts = { used: number(usage.calls), max: number(usage.max) };
  if (usage.trialEndsAt) {
    return usage.usedUp
      ? { line: t("apps.x.usedUpTrial", { date: day(usage.trialEndsAt) }), usedUp: true }
      : { line: t("apps.x.usageTrial", counts), usedUp: false };
  }
  return usage.usedUp
    ? { line: t("apps.x.usedUp", { date: day(usage.resetsAt) }), usedUp: true }
    : { line: `${t("apps.x.usage", counts)} ${t("apps.x.resets", { date: day(usage.resetsAt) })}`, usedUp: false };
}

/** X (Twitter) on its Connect Apps page: included with a Cloud plan, or the person's own treg key, which is used first. */
export function XCard({ refreshKey = 0, onConnection }: {
  refreshKey?: number;
  /** true while bots have the X tools, false otherwise, null until the server has answered */
  onConnection?: (connected: boolean | null) => void;
}) {
  const dispatch = useDispatch();
  const [status, setStatus] = useState<XConnectorStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [addingOwn, setAddingOwn] = useState(false);
  const mounted = useRef(true);
  const saveAfterPaste = useRef(false);
  const connecting = xResearchAction(useCloudPlan()?.view ?? null) === "connecting";
  const ownConfigured = useStoreSelector((s) => s.config?.treg?.configured === true);
  const includedHeld = useStoreSelector((s) => s.config?.xResearch?.included === true);

  const load = useCallback(async (refresh = false): Promise<void> => {
    try {
      const response = await api(`/api/x/status${refresh ? "?refresh=1" : ""}`);
      if (!mounted.current) return;
      if (!isXConnectorStatus(response)) throw new Error("unexpected X status");
      setStatus(response);
      setLoadFailed(false);
    } catch {
      if (mounted.current) setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load(refreshKey > 0);
    return () => { mounted.current = false; };
  }, [load, refreshKey, ownConfigured, includedHeld]);

  useEffect(() => {
    onConnection?.(status ? status.using !== null : null);
  }, [status, onConnection]);

  const applied = (config: ConfigStatus) => {
    dispatch({ type: "configStatus", config });
    return load(true);
  };

  const test = async () => {
    setBusy("test");
    setVerdict(null);
    try {
      const result = await api("/api/keys/test", { method: "POST", body: JSON.stringify({ provider: "treg" }) });
      if (mounted.current) setVerdict(tregVerdict(result));
      return keyTestResult(result);
    } catch (cause) {
      if (mounted.current) setVerdict(friendlyError(cause));
      return keyTestResult(null);
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const save = async () => {
    const value = key.trim();
    if (busy || !value) return;
    if (!looksLikeKey(value)) return setError(t("keys.notAKey"));
    setBusy("save");
    setError(null);
    setVerdict(null);
    try {
      await applied(await saveCredential("treg", value, !ownConfigured));
      if (!mounted.current) return;
      setKey("");
      setAddingOwn(false);
      keySaved("treg", "apps", await test());
    } catch (cause) {
      if (mounted.current) setError(friendlyError(cause));
      keySaved("treg", "apps", keySaveFailure(cause));
    } finally {
      if (mounted.current) setBusy((current) => (current === "save" ? null : current));
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy("remove");
    setError(null);
    setVerdict(null);
    try {
      await applied(await saveCredential("treg", "", false));
      keyRemoved("treg", "apps");
    } catch (cause) {
      if (mounted.current) setError(friendlyError(cause));
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  useEffect(() => {
    if (!saveAfterPaste.current) return;
    saveAfterPaste.current = false;
    void save();
  });

  const using = status?.using ?? null;
  const usage = status?.usage ? xUsageLines(status.usage) : null;
  const showForm = status !== null && using !== "own" && (using === null || addingOwn || usage?.usedUp === true);
  const description = status === null ? t("apps.x.description")
    : using === "own" ? t("apps.x.own")
      : using === "included" ? t("apps.x.included")
        : connecting && !status.unavailable ? t("apps.x.connecting") : t("apps.x.addKey");

  return (
    <KitBody data-app-tile="x" data-x-state={status === null ? "loading" : using ?? "none"}>
      {status === null
        ? (loadFailed
          ? <KitActions><KitButton variant="secondary" onClick={() => void load(true)}>{t("connectors.action.retry")}</KitButton></KitActions>
          : <KitStatus>{t("common.checking")}</KitStatus>)
        : <KitText>{description}</KitText>}
      {using === "own" && <KitText>{status?.included ? t("apps.x.ownFirst") : t("apps.x.ownBilled")}</KitText>}
      {using === "included" && usage && <span data-x-usage><KitStatus tone={usage.usedUp ? "warning" : "quiet"}>{usage.line}</KitStatus></span>}
      {using === "own" && (
        <KitActions>
          <KitButton variant="secondary" disabled={busy !== null} onClick={() => void test()}>{busy === "test" ? t("common.checking") : t("keys.test")}</KitButton>
          <KitButton variant="secondary" tone="danger" disabled={busy !== null} onClick={() => void remove()}>{t("apps.x.remove")}</KitButton>
        </KitActions>
      )}
      {using === "included" && !showForm && <KitLink onClick={() => { setAddingOwn(true); setError(null); }}>{t("apps.x.useOwnKey")}</KitLink>}
      {showForm && (
        <form data-x-key-form className="ca-kit" style={{ alignSelf: "stretch" }} onSubmit={(event) => { event.preventDefault(); void save(); }}>
          {using === null && <KitText>{t("apps.x.addKeyHelp")}</KitText>}
          <KitField label={t("keys.treg.label")} type="password" autoComplete="off" spellCheck={false} placeholder={t("keys.treg.placeholder")} value={key}
            disabled={busy === "save"} onChange={(event) => { setError(null); setKey(event.target.value); }} onPaste={() => { saveAfterPaste.current = true; }} />
          <KitActions>
            <KitButton type="submit" disabled={busy !== null || !key.trim()}>{busy === "save" ? t("connectApps.connecting") : t("common.save")}</KitButton>
            <a href={TREG_URL} target="_blank" rel="noopener noreferrer" className="ca-kit-link">{t("keys.treg.link")}</a>
          </KitActions>
        </form>
      )}
      {verdict && <KitStatus>{verdict}</KitStatus>}
      {error && <KitStatus tone="danger">{error}</KitStatus>}
    </KitBody>
  );
}
