import { t } from "@/lib/i18n";
import { useDispatch, type Bot, type Group } from "@/state/store";
import { CARD_ACTION, ChatErrorCard } from "./ChatErrorBanner";

/** Members the person stopped, said in the card above the composer with a way to bring each back. */
export function RoomHoldsBanner({ group, members }: { group: Group; members: Bot[] }) {
  const dispatch = useDispatch();
  const held = members.filter((member) => group.holds?.[member.id]);
  if (!held.length) return null;
  return (
    <div className="mb-2 w-full px-5" data-testid="room-holds">
      <ChatErrorCard
        tone="info"
        title={t("room.holds.banner", { names: held.map((member) => member.name).join(", ") })}
        actions={held.map((member) => (
          <button
            key={member.id}
            type="button"
            onClick={() => dispatch({ type: "setGroupHold", groupId: group.id, botId: member.id, held: false })}
            className={CARD_ACTION}
          >
            {t("room.holds.resume", { name: member.name })}
          </button>
        ))}
      />
    </div>
  );
}
