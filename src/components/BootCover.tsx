import { useEffect, useState } from "react";
import { WindowDragStrip } from "./DesktopCapabilities";
import { MascotLoader } from "./MascotLoader";

type Phase = "loading" | "closing" | "fading" | "gone";
const FADE_MS = 300;

/** Covers the window while it first connects with the loading mascot; once the app has something to show the mascot
 * hops away and the cover fades over the app. From the closing on, clicks reach the app under it. A window that opens
 * with its bots already there never shows it. */
export function BootCover({ busy, first }: { busy: boolean; first?: string }) {
  const [phase, setPhase] = useState<Phase>(busy ? "loading" : "gone");

  useEffect(() => {
    if (!busy && phase === "loading") setPhase("closing");
  }, [busy, phase]);

  useEffect(() => {
    if (phase !== "fading") return;
    const done = window.setTimeout(() => setPhase("gone"), FADE_MS);
    return () => clearTimeout(done);
  }, [phase]);

  if (phase === "gone") return null;
  return (
    <div data-boot-cover={phase} aria-hidden={phase !== "loading" || undefined}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-app transition-opacity ease-out data-[boot-cover=closing]:pointer-events-none data-[boot-cover=fading]:pointer-events-none data-[boot-cover=fading]:opacity-0 motion-reduce:transition-none"
      style={{ transitionDuration: `${FADE_MS}ms` }}>
      <WindowDragStrip />
      <MascotLoader size={64} first={first} leaving={phase !== "loading"} lineClassName="text-[14px] leading-5 text-ink"
        onExit={() => setPhase((now) => (now === "closing" ? "fading" : now))} />
    </div>
  );
}
