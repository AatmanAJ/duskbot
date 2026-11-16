import { useEffect } from "react";

import { openBotSettings } from "@/lib/open-settings";
import { useDispatch, type Bot, type Group } from "@/state/store";
import type { RoomDialog } from "./RoomModals";

/** The room's settings live on Settings' Bots page with this group chat picked: asking for a page of them opens
 * Settings there and hands back at once. */
export function RoomSheet({ initial, group, onClose }: { initial: RoomDialog; group: Group; members: Bot[]; onClose: () => void }) {
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch(openBotSettings({ kind: "group", id: group.id, row: initial }));
    onClose();
  }, [dispatch, group.id, initial, onClose]);
  return null;
}
