import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { ComputerTab } from "../bot-panel/ComputerTab";
import { PanelEmpty, PanelSections } from "../bot-panel/rows";

const stay = () => {};
const none: readonly Bot[] = [];

function MemberComputer({ bot, cloudFor }: { bot: Bot; cloudFor: readonly Bot[] }) {
  const derived = useBotSettingsDerived(bot);
  return (
    <div data-room-screen={bot.id} className="has-[>[data-panel-tabpanel]:empty]:hidden">
      <ComputerTab bot={bot} derived={derived} onOpen={stay} cloudFor={cloudFor} />
    </div>
  );
}

/** The bot panel's Computer tab for each member, one after another, and one cloud card for the whole group, after the last. */
export function RoomComputerTab({ members }: { members: Bot[] }) {
  if (members.length === 0) return <PanelEmpty data-panel-empty="screens" art="computer" title={t("empty.screens.title")}>{t("room.panel.computer.empty")}</PanelEmpty>;
  return (
    <PanelSections data-panel-tabpanel="computer">
      {members.map((member, index) => <MemberComputer key={member.id} bot={member} cloudFor={index === members.length - 1 ? members : none} />)}
    </PanelSections>
  );
}
