import type { ComponentType } from "react";
import type { MobileSheet, OpenSheet } from "../sheets";
import { SettingsSheet } from "./SettingsSheet";
import { NotificationsSheet } from "./NotificationsSheet";
import { SearchSheet } from "./SearchSheet";
import { CreateBotSheet } from "./CreateBotSheet";
import { RoutinesSheet } from "./RoutinesSheet";
import { ConnectorsSheet } from "./ConnectorsSheet";
import { VaultSheet } from "./VaultSheet";

/** What every sheet page receives. A page renders its own `Sheet` so it chooses its height and header. */
export interface SheetPageProps<K extends MobileSheet["kind"] = MobileSheet["kind"]> {
  sheet: Extract<MobileSheet, { kind: K }>;
  open: boolean;
  onClose: () => void;
  onOpenSheet: OpenSheet;
  onOpenChat: (id: string) => void;
}

export const SHEET_PAGES: Partial<{ [K in MobileSheet["kind"]]: ComponentType<SheetPageProps<K>> }> = {
  settings: SettingsSheet,
  notifications: NotificationsSheet,
  search: SearchSheet,
  create: CreateBotSheet,
  routines: RoutinesSheet,
  connectors: ConnectorsSheet,
  vault: VaultSheet,
};
