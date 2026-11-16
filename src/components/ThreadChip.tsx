import { ChevronRight, MessagesSquare } from "../icons";
import { openThread, useDispatch, useStoreSelector, type Message } from "@/state/store";
import { useStoreRef } from "@/state/store-ref";
import { botById } from "@/state/store-index";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { BotAvatar } from "./Avatar";
import { HandoffReply } from "./HandoffReply";
import { HandoffRow } from "./HandoffRow";

export function ThreadChip({ message }: { message: Message }) {
  const dispatch = useDispatch();
  const store = useStoreRef();
  const ref = message.threadRef;
  const bot = useStoreSelector((state) => botById(state, ref?.botId));
  const tool = message.tool;
  if (!ref || !tool) return null;
  const direct = message.sentDirectly;
  if (message.handoff && tool.ok !== false && !direct) {
    return <HandoffRow message={message} />;
  }
  const label = !direct ? tool.name
    : direct.room ? t("chat.sentDirectlyNotInRoom", { name: direct.name, room: direct.room }) : t("chat.sentDirectly", { name: direct.name });
  return (
    <HandoffReply message={message}>
      <button
        type="button"
        data-thread-chip={ref.threadId}
        onClick={() => openThread(dispatch, ref, store.state())}
        title={t("chat.openThread", { title: ref.title })}
        className={cn("ui-pill", tool.ok === false && "text-danger")}
      >
        {bot ? <BotAvatar bot={bot} state="happy" size={16} animated={false} /> : <MessagesSquare size={13} aria-hidden="true" />}
        <span className="max-w-[480px] truncate">{label}</span>
        <ChevronRight size={13} />
      </button>
    </HandoffReply>
  );
}
