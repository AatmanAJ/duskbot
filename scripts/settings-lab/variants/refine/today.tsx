import { SettingsModal } from "@/components/SettingsModal";
import { RealStore } from "./stub";
import "./refine.css";

/** today's Settings, the app's own component, untouched */
export default function Today() {
  return (
    <div className="refine-host" data-refine="today">
      <RealStore><SettingsModal /></RealStore>
    </div>
  );
}
