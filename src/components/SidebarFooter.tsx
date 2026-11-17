import { useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { setSidebarFooterSlot } from "@/lib/sidebar-footer-slot";
import { useDispatch, useStoreSelector } from "@/state/store";

import { AccountMoveStatus, useAccountMoveLine } from "./AccountMove";
import { CloudRoomCard } from "./CloudRoomCard";
import { SidebarCloudCard } from "./CloudUpsell";
import { CloudUsageCard } from "./CloudUsageMeter";
import { endCloudHowTo, useWorkspacePlace, type WorkspacePlace } from "./DesktopWorkspaceSwitcher";
import { ConnectAppsButton, useSidebarApps } from "./SidebarConnectApps";
import { SidebarProfileMenu, useSimpleAccount, type ArchivedBots } from "./SidebarProfileMenu";
import { SidebarSpot } from "./SidebarSpot";

export function useSimplePlace(): WorkspacePlace {
  const dispatch = useDispatch();
  const cloudHome = useStoreSelector((s) => s.config?.cloudHome === true);
  const howTo = useStoreSelector((s) => s.cloudHowTo);
  return useWorkspacePlace({ cloudHome, howTo, onMenuClosed: () => endCloudHowTo(dispatch) });
}

export function SidebarPlaceStatus({ place, className }: { place: WorkspacePlace; className?: string }) {
  if (place.error) return <p role="alert" className={cn("text-[12px] text-danger", className)}>{place.error}</p>;
  if (place.waking) return <p role="status" data-cloud-waking className={cn("text-[12px] text-ink-secondary", className)}>{place.waking}</p>;
  return null;
}

export function SidebarFooter({ owner = null, archived }: { owner?: string | null; archived?: ArchivedBots }) {
  const cloudHome = useStoreSelector((s) => s.config?.cloudHome === true);
  const place = useSimplePlace();
  const account = useSimpleAccount(place, owner, archived);
  const move = useAccountMoveLine(cloudHome);
  const apps = useSidebarApps();
  const [appsEngaged, setAppsEngaged] = useState(false);
  const footer = useRef<HTMLDivElement>(null);
  // The move's words open the account menu just below them, where the move's row is.
  const openAccount = () => footer.current?.querySelector("[data-sidebar-account]")?.closest("button")?.click();
  return (
    <div ref={footer} data-sidebar-footer="simple" className="px-4 pb-4">
      <SidebarCloudCard />
      <CloudRoomCard />
      <CloudUsageCard />
      <SidebarPlaceStatus place={place} className="mb-2 px-1" />
      <AccountMoveStatus kind={move.kind} place={move.place} retry={move.retry} onOpen={openAccount} className="ps-1" />
      <div ref={setSidebarFooterSlot} data-sidebar-footer-slot="" className="empty:hidden" />
      <SidebarSpot className="mb-2.5" />
      <div className="flex items-center gap-1.5" onPointerLeave={() => setAppsEngaged(false)}>
        {apps.connected ? <>
          <div className="me-auto min-w-0"><SidebarProfileMenu simple={account} named nameHidden={appsEngaged} /></div>
          <ConnectAppsButton circle apps={apps} engaged={appsEngaged} onEngage={setAppsEngaged} />
        </> : <>
          <SidebarProfileMenu simple={account} />
          <ConnectAppsButton circle={false} apps={apps} />
        </>}
      </div>
    </div>
  );
}
