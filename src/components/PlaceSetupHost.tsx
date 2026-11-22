import { closePlaceSetup, usePlaceSetupOpen } from "@/lib/place-setup";
import { useStore } from "@/state/store";
import { PlaceSetupSheet } from "./lazy-screens";

/** The add-a-place sheet in the app window, wherever it was asked for. */
export function PlaceSetupHost() {
  const open = usePlaceSetupOpen();
  const { dispatch } = useStore();
  return open ? <PlaceSetupSheet onClose={closePlaceSetup} start={open.start} onBuy={() => dispatch({ type: "openCloudAdd", source: "app_settings" })} /> : null;
}
