import { useState, type KeyboardEvent } from "react";
import { track } from "@/lib/analytics";
import { useDispatch, useStoreShallow } from "@/state/store";
import { t } from "@/lib/i18n";
import { BotPickerList } from "./BotPickerList";
import { fieldLabelCls, GrokDialog, mdPrimaryCls, mdSecondaryCls, textFieldCls } from "./ui/GrokDialog";

/** Sidebar → New channel: name it, optionally file it under a context, pick its bots. */
export function NewRoomPanel({ onClose }: { onClose: () => void }) {
  const dispatch = useDispatch();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const bots = useStoreShallow((s) => s.bots.filter((b) => !b.hidden));
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const create = () => {
    if (!picked.size) return;
    dispatch({
      type: "createGroup",
      memberIds: [...picked],
      name: name.trim() || undefined,
    });
    track("room_created", { members: picked.size, context: false });
    onClose();
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") create();
  };
  return (
    <GrokDialog
      title={t("sidebar.newChannel.title")}
      width={360}
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className={mdSecondaryCls}>{t("common.cancel")}</button>
        <button type="button" onClick={create} disabled={!picked.size} className={mdPrimaryCls}>{t("sidebar.newChannel.create")}</button>
      </>}
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className={fieldLabelCls}>{t("sidebar.newChannel.nameLabel")}</span>
          <input data-autofocus autoFocus maxLength={100} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={onKey} placeholder={t("sidebar.newChannel.namePlaceholder")} className={textFieldCls} />
        </label>
        <div className="flex flex-col gap-1">
          <span className={fieldLabelCls}>{t("sidebar.newChannel.botsLabel")}</span>
          <div className="rounded-[10px] border border-transparent p-1">
            <BotPickerList bots={bots} picked={picked} onToggle={toggle} emptyHint={t("sidebar.newChannel.emptyHint")} />
          </div>
        </div>
      </div>
    </GrokDialog>
  );
}
