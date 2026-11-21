import { useEffect, useState } from "react";

// the last picture of each bot's screen in this window, so its view coming back (another tab, the sheet opened again,
// the live screen reconnecting) starts on that picture instead of an empty frame
const pictures = new Map<string, string>();
const KEPT = 12;

export function rememberScreen(botId: string, threadId: string, picture: string | null | undefined): void {
  if (!picture) return;
  const key = `${botId}:${threadId}`;
  pictures.delete(key);
  pictures.set(key, picture);
  if (pictures.size > KEPT) pictures.delete(pictures.keys().next().value!);
}

export function lastScreen(botId: string, threadId: string): string | null {
  return pictures.get(`${botId}:${threadId}`) ?? null;
}

export function forgetScreens(): void {
  pictures.clear();
}

/** A picture that changes without a blank frame between: the next one is decoded before it replaces the one shown. */
export function SteadyImage({ src, alt, className, draggable }: { src: string; alt: string; className?: string; draggable?: boolean }) {
  const [shown, setShown] = useState(src);
  useEffect(() => {
    if (src === shown) return;
    let live = true;
    const next = new Image();
    next.src = src;
    const swap = () => { if (live) setShown(src); };
    if (typeof next.decode === "function") next.decode().then(swap, swap);
    else swap();
    return () => { live = false; };
  }, [src, shown]);
  return <img src={shown} alt={alt} draggable={draggable} className={className} />;
}
