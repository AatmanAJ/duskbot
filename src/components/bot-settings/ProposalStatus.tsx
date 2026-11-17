import { t } from "@/lib/i18n";
import { useStoreSelector, type Bot } from "@/state/store";
import { useBotEditor } from "./BotEditorContext";

/** The Chief of Staff oversees every bot, as server/peer-roster.ts grants it for proposals. */
function chiefCovers(bot: Bot, bots: ReadonlyArray<Bot>): boolean {
  return bots.some((candidate) => candidate.id !== bot.id && Boolean(candidate.chiefOfStaff));
}

export function ProposalStatus({ bot, kind }: { bot: Bot; kind: "chief" | "owner" }) {
  const { draft } = useBotEditor();
  const covered = useStoreSelector((s) => chiefCovers(bot, s.bots));
  if (draft || !covered) return null;
  return (
    <div className="mt-1 text-[12px] leading-snug text-ink-secondary">
      {t(kind === "chief" ? "botSettings.proposal.chief" : "botSettings.proposal.owner")}
    </div>
  );
}
