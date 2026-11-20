import type { Ref } from "react";

import { t } from "@/lib/i18n";
import { responderShortLabel } from "@/lib/room-responder";
import type { Bot, Group } from "@/state/store";
import { groupUsageSummary } from "../GroupUsageChip";
import { roomWorkingFolder } from "../RoomWorkingFolder";
import { ModelSelectRow } from "../native/ModelSelectRow";
import { UsageMeterRow } from "../native/UsageMeter";
import { Card, ItemRow, NavRow, PanelSections } from "../bot-panel/rows";
import type { RoomDialog } from "./RoomModals";

export type RoomPage = "models";
export type RoomTarget = RoomDialog | RoomPage;

export interface RoomRowsProps {
  group: Group;
  members: Bot[];
  onOpen: (target: RoomTarget) => void;
  onMembers: () => void;
  membersRef: Ref<HTMLButtonElement>;
}

/** Who answers, where the bots work, the room's brief and who is in it: the rows both Details and Advanced lead with. */
export function RoomRows({ group, members, onOpen, onMembers, membersRef }: RoomRowsProps) {
  const folder = roomWorkingFolder(group);
  return (
    <>
      <NavRow
        data-panel-page="responder"
        title={t("room.panel.whoResponds")}
        value={responderShortLabel(group, members)}
        onClick={() => onOpen("responder")}
      />
      <NavRow
        data-panel-page="folder"
        title={t("room.folder.title")}
        value={folder?.name ?? t("room.panel.folder.own")}
        tooltip={folder?.path}
        onClick={() => onOpen("folder")}
      />
      <NavRow
        data-panel-page="instructions"
        title={t("room.panel.instructions")}
        value={group.bulletin.trim() ? undefined : t("botPanel.none")}
        onClick={() => onOpen("instructions")}
      />
      <NavRow
        ref={membersRef}
        data-panel-row="members"
        title={t("room.panel.members")}
        value={String(members.length)}
        onClick={onMembers}
      />
    </>
  );
}

export function GroupUsageRow({ group }: { group: Group }) {
  const usage = groupUsageSummary(group.usage);
  if (!usage) return null;
  return (
    <ItemRow data-panel-row="room-usage" title={t("room.panel.chatUsage")}>
      <span title={usage.title} className="shrink-0 text-[13px] leading-[18px] tracking-[0.015em] tabular-nums text-ink-secondary">{usage.short}</span>
    </ItemRow>
  );
}

/** Each member's own model, one level down from Details. */
export function PerBotModels({ members }: { members: Bot[] }) {
  return (
    <Card>
      <div className="[&_[data-tour=model]>span:first-child]:flex! [&_[data-provider-mark]]:opacity-100!">
        {members.map((member) => (
          <div key={member.id} data-room-model={member.id}>
            <ModelSelectRow bot={member} threadId={member.threadId} title={member.name} withThinking />
          </div>
        ))}
      </div>
    </Card>
  );
}

function ModelsCard({ group, members, onOpen }: { group: Group; members: Bot[]; onOpen: (target: RoomTarget) => void }) {
  const engines = [...new Set(members.map((member) => member.modelSelection?.instanceId).filter(Boolean))];
  return (
    <Card anchor="model">
      <NavRow data-panel-page="models" title={t("room.panel.perBot")} onClick={() => onOpen("models")} />
      <GroupUsageRow group={group} />
      {engines.map((engine) => <UsageMeterRow key={engine} engine={engine} />)}
    </Card>
  );
}

/** The room's Details tab, in the bot panel's Details anatomy. */
export function RoomDetailsTab(props: RoomRowsProps) {
  return (
    <PanelSections data-panel-tabpanel="details">
      <Card>
        <RoomRows {...props} />
      </Card>
      {props.members.length > 0 && <ModelsCard group={props.group} members={props.members} onOpen={props.onOpen} />}
    </PanelSections>
  );
}
