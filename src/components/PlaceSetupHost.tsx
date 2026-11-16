import { closePlaceSetup, usePlaceSetupOpen } from "@/lib/place-setup";
import { useDispatch } from "@/state/store";
import { PlaceSetup } from "./PlaceSetup";

/** The add-a-place sheet in the app window, wherever it was asked for. */
export function PlaceSetupHost() {
  const open = usePlaceSetupOpen();
  const dispatch = useDispatch();
  return open ? <PlaceSetup onClose={closePlaceSetup} start={open.start} onBuy={() => dispatch({ type: "openCloudAdd", source: "app_settings" })} /> : null;
}
