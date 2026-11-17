import { DefaultBotHideRow } from "../DefaultBotControls";
import { phoneAppEnabled } from "@/lib/feature-flags";

import type { Bot } from "@/state/store";
import { useStoreRef } from "@/state/store-ref";
import type { MausMotion, MausState } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { BOT_PROFILE_LIMITS } from "../../../shared/bot-profile";
import { BotProfileAvatarCard } from "../BotProfileAvatarCard";
import { Field, inputCls } from "./field";
import type { BotPatch } from "./useBotSettingsDerived";
import { useBotEditor } from "./BotEditorContext";
import { PackageProvenance } from "./PackageProvenance";
import { ProposalStatus } from "./ProposalStatus";
import { randomBotName } from "@/lib/random-bot-name";
import { t } from "@/lib/i18n";

export type IdentityPart = "avatar" | "provenance" | "name" | "title" | "blurb";

export function IdentitySection({
  bot,
  patch,
  activeState,
  mascotMotion,
  namePlaceholder,
  parts,
}: {
  bot: Bot;
  patch: (patch: BotPatch) => void;
  activeState: MausState;
  mascotMotion: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
  namePlaceholder?: string;
  parts?: readonly IdentityPart[];
}) {
  const { draft } = useBotEditor();
  const store = useStoreRef();
  const shows = (part: IdentityPart) => !parts || parts.includes(part);

  return (
    <div className="flex flex-col gap-4">
      {shows("avatar") && <BotProfileAvatarCard bot={bot} activeState={activeState} mascotMotion={mascotMotion} onPatch={patch} />}
      {shows("provenance") && <PackageProvenance bot={bot} />}

      {shows("name") && <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <label htmlFor={`bot-name-${bot.id}`} className="text-[13px] text-ink-secondary">{t("botSettings.identity.name")}</label>
          {draft && <div className="flex flex-wrap gap-1">
            {(["female", "male"] as const).map(kind => <button
              key={kind}
              type="button"
              className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-full px-2 text-[12px] leading-4 tracking-[0.01em] text-ink/68 hover:bg-ink/[0.035] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
              onClick={() => patch({ name: randomBotName(kind, bot.name, store.state().bots.map(existing => existing.name)) })}
            >{t(kind === "female" ? "newBot.randomFemaleName" : "newBot.randomMaleName")}</button>)}
          </div>}
        </div>
        <ProposalStatus bot={bot} kind="chief" />
        <input
          id={`bot-name-${bot.id}`}
          className={inputCls}
          maxLength={BOT_PROFILE_LIMITS.name}
          value={bot.name}
          placeholder={namePlaceholder}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </div>}
      {shows("title") && <Field label={t("botSettings.identity.title")}>
        <ProposalStatus bot={bot} kind="chief" />
        <input
          className={inputCls}
          maxLength={BOT_PROFILE_LIMITS.title}
          placeholder={t("botSettings.identity.titlePlaceholder")}
          value={bot.title}
          onChange={(e) => patch({ title: e.target.value })}
        />
      </Field>}
      {shows("blurb") && <div className="block">
        <label htmlFor={`bot-instructions-${bot.id}`} className="mb-1.5 block text-[13px] text-ink-secondary">
          {t("botSettings.identity.blurb")}
        </label>
        <ProposalStatus bot={bot} kind="chief" />
        <textarea
          id={`bot-instructions-${bot.id}`}
          className={cn(inputCls, "min-h-[72px] resize-y leading-relaxed")}
          maxLength={BOT_PROFILE_LIMITS.description}
          placeholder={t("botSettings.identity.blurbPlaceholder")}
          aria-label={t("botSettings.identity.blurb")}
          value={bot.description}
          onChange={(e) => patch({ description: e.target.value })}
        />
        <div className="mt-1.5 flex items-start justify-between gap-3 text-[11px] text-ink-secondary">
          <span>{t(phoneAppEnabled() ? "botSettings.identity.blurbHelp" : "botSettings.identity.blurbHelpNoPhone")}</span>
          {bot.description.length > 3_000 && (
            <span className="shrink-0 tabular-nums">
              {bot.description.length.toLocaleString()} / {BOT_PROFILE_LIMITS.description.toLocaleString()}
            </span>
          )}
        </div>
      </div>}

      <DefaultBotHideRow bot={bot} />
    </div>
  );
}
