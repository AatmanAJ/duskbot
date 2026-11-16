import { useState } from "react";
import { claudeUserMcpEnabled, claudeUserSkillsEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { api, useStore, useDispatch, type ConfigStatus } from "@/state/store";
import { Switch } from "./SettingsPrimitives";

type Feature = "claudeUserMcp" | "claudeUserSkills";

function ClaudeConfigSwitch({ feature, enabled, prefix }: { feature: Feature; enabled: boolean; prefix: "mcp.claude" | "mcp.claudeSkills" }) {
  const dispatch = useDispatch();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { [feature]: !enabled } }),
      });
      dispatch({ type: "configStatus", config });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 flex items-start justify-between gap-4 rounded-2xl border border-transparent bg-card px-4 py-4 sm:px-5 in-data-[connect-apps]:mt-3 in-data-[connect-apps]:rounded-[14px] in-data-[connect-apps]:border-transparent in-data-[connect-apps]:bg-transparent in-data-[connect-apps]:px-0 in-data-[connect-apps]:py-3 in-data-[connect-apps]:sm:px-0 in-data-[settings-look=simple]:mt-0 in-data-[settings-look=simple]:min-h-12 in-data-[settings-look=simple]:items-center in-data-[settings-look=simple]:rounded-none! in-data-[settings-look=simple]:border-0! in-data-[settings-look=simple]:bg-transparent! in-data-[settings-look=simple]:px-3.5! in-data-[settings-look=simple]:py-2.5!">
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-ink in-data-[settings-look=simple]:text-[13px] in-data-[settings-look=simple]:leading-[18px] in-data-[settings-look=simple]:font-normal in-data-[connect-apps]:text-[13px] in-data-[connect-apps]:leading-[18px] in-data-[connect-apps]:font-normal">{t(`${prefix}.title` as LocaleKey)}</div>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary in-data-[settings-look=simple]:hidden in-data-[connect-apps]:mt-0 in-data-[connect-apps]:leading-4 in-data-[connect-apps]:text-ink/[0.56]">{t(`${prefix}.desc` as LocaleKey)}</p>
        {failed && <p role="alert" className="mt-1 text-[12px] text-danger">{t("mcp.claude.error")}</p>}
      </div>
      <Switch
        checked={enabled}
        aria-label={t(`${prefix}.aria` as LocaleKey)}
        disabled={saving}
        onClick={() => void toggle()}
        className="mt-0.5 shrink-0 disabled:opacity-50 in-data-[settings-look=simple]:mt-0"
      />
    </div>
  );
}

/** What Claude bots take from this machine's own Claude Code setup: its MCP servers, and its skills. */
export function ClaudeCodeSwitches() {
  const { state } = useStore();
  return (
    <>
      <ClaudeConfigSwitch feature="claudeUserMcp" enabled={claudeUserMcpEnabled(state.config)} prefix="mcp.claude" />
      <ClaudeConfigSwitch feature="claudeUserSkills" enabled={claudeUserSkillsEnabled(state.config)} prefix="mcp.claudeSkills" />
    </>
  );
}
