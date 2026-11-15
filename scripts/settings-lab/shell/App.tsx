import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Icon } from "@/components/Icon";
import { dialogMotion } from "@/lib/motion-presets";
import { VARIANTS } from "../variants";
import chat from "../chat";
import { SettingsProvider } from "@kit/store";
import { setLabSpeed } from "./clock";
import { LabContext, useStored } from "./prefs";
import { AppReplica } from "./AppReplica";
import { CodeDrawer } from "./CodeDrawer";

const SPEEDS = [1, 0.5, 0.25, 0.1] as const;
const SLOW = 0.25;
/** app window sizes; the settings dialog is min(900, w - 32) by min(700, h - 96), as settings.css draws it */
const WINDOWS = [
  { id: "app", label: "1280 × 820", w: 1280, h: 820 },
  { id: "small", label: "960 × 660", w: 960, h: 660 },
] as const;

type Tab = "settings" | "chat";
type Entry = { id: string; n: number; name: string; idea: string; files: string[] };

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

const CHAT: Entry[] = chat.variants.map((variant, index) => ({ ...variant, n: index + 1, files: [variant.file] }));

// a deep link (#settings/3, #chat/2) seeds the stored choice before the first render
{
  const [where, n] = location.hash.replace("#", "").split("/");
  const list = where === "settings" ? VARIANTS : where === "chat" ? CHAT : null;
  const hit = list?.find((entry) => entry.n === Number(n));
  if (list) localStorage.setItem("settings-lab-tab", JSON.stringify(where));
  if (hit) localStorage.setItem(where === "settings" ? "settings-lab-variant" : "settings-lab-chat-variant", JSON.stringify(hit.id));
}

export function App() {
  const [tab, setTab] = useStored<Tab>("settings-lab-tab", "settings");
  const [settingsId, setSettingsId] = useStored<string>("settings-lab-variant", VARIANTS[0]!.id);
  const [chatId, setChatId] = useStored<string>("settings-lab-chat-variant", CHAT[0]!.id);
  const [dark, setDark] = useStored<boolean>("settings-lab-dark", false);
  const [speed, setSpeed] = useStored<number>("settings-lab-speed", 1);
  const [reduced, setReduced] = useStored<boolean>("settings-lab-reduced", false);
  const [windowId, setWindowId] = useStored<string>("settings-lab-window", "app");
  const [open, setOpen] = useState(true);
  const [code, setCode] = useState(false);
  const [replayKey, setReplayKey] = useState(0);

  const entries: Entry[] = tab === "settings" ? VARIANTS : CHAT;
  const currentId = tab === "settings" ? settingsId : chatId;
  const current = entries.find((entry) => entry.id === currentId) ?? entries[0]!;
  const pick = (id: string) => {
    if (tab === "settings") { setSettingsId(id); setOpen(true); } else setChatId(id);
  };
  const settingsVariant = VARIANTS.find((entry) => entry.id === settingsId) ?? VARIANTS[0]!;
  const chatVariant = chat.variants.find((entry) => entry.id === chatId) ?? chat.variants[0]!;
  const win = WINDOWS.find((entry) => entry.id === windowId) ?? WINDOWS[0];

  useEffect(() => { history.replaceState(null, "", `#${tab}/${current.n}`); }, [tab, current.n]);

  useEffect(() => {
    document.documentElement.dataset.skin = dark ? "grok-dark" : "grok";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);
  useEffect(() => setLabSpeed(speed), [speed]);
  useEffect(() => { document.documentElement.dataset.reducedMotion = String(reduced); }, [reduced]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
      const hit = entries.find((entry) => String(entry.n) === event.key);
      if (hit) pick(hit.id);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const node = stage.current;
    if (!node) return;
    const fit = () => setScale(Math.min(1, (node.clientWidth - 32) / win.w, (node.clientHeight - 32) / win.h));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(node);
    return () => watch.disconnect();
  }, [win.w, win.h]);

  const dialogW = Math.min(900, win.w - 32);
  const dialogH = Math.min(700, win.h - 96);
  const motionSet = dialogMotion(reduced);
  const slow = speed <= SLOW;

  return (
    <LabContext.Provider value={{ reduced, speed, dark }}>
      <MotionConfig reducedMotion={reduced ? "always" : "never"}>
        <SettingsProvider onTheme={setDark}>
          <div className="lab-root" data-slow={slow ? "" : undefined}>
            <header className="lab-bar">
              <div className="lab-bar-row">
                <div className="lab-seg lab-tabs" role="tablist" aria-label="lab">
                  {(["settings", "chat"] as const).map((value) => (
                    <button key={value} type="button" role="tab" aria-selected={tab === value} className="lab-seg-btn lab-tab" onClick={() => setTab(value)}>
                      {value === "settings" ? "Settings" : "Chat"}
                    </button>
                  ))}
                </div>
                <div className="lab-variants" role="tablist" aria-label="variants">
                  {entries.map((entry) => (
                    <button key={entry.id} type="button" role="tab" aria-selected={entry.id === current.id} className="lab-variant" onClick={() => pick(entry.id)}>
                      <span className="lab-variant-n">{entry.n}</span>
                      <span>{entry.name}</span>
                    </button>
                  ))}
                </div>
                <div className="lab-bar-tools">
                  <button type="button" className="lab-btn" onClick={() => { setReplayKey((key) => key + 1); setOpen(true); }}>
                    <Icon name="refresh" size={14} />replay
                  </button>
                  <button type="button" className="lab-btn lab-slow" aria-pressed={slow} onClick={() => setSpeed(slow ? 1 : SLOW)}>
                    <Icon name="hourglass" size={14} />Slow mode
                  </button>
                  <div className="lab-seg" role="radiogroup" aria-label="speed">
                    {SPEEDS.map((value) => (
                      <button key={value} type="button" role="radio" aria-checked={speed === value} className="lab-seg-btn" onClick={() => setSpeed(value)}>{value}x</button>
                    ))}
                  </div>
                  <button type="button" className="lab-btn" aria-pressed={reduced} onClick={() => setReduced((value) => !value)}>Reduced motion</button>
                  <div className="lab-seg" role="radiogroup" aria-label="theme">
                    <button type="button" role="radio" aria-checked={!dark} className="lab-seg-btn" onClick={() => setDark(false)} aria-label="Light"><Icon name="sun" size={14} /></button>
                    <button type="button" role="radio" aria-checked={dark} className="lab-seg-btn" onClick={() => setDark(true)} aria-label="Dark"><Icon name="moon" size={14} /></button>
                  </div>
                  {tab === "settings" && (
                    <div className="lab-seg" role="radiogroup" aria-label="window size">
                      {WINDOWS.map((entry) => (
                        <button key={entry.id} type="button" role="radio" aria-checked={entry.id === win.id} className="lab-seg-btn" onClick={() => setWindowId(entry.id)}>{entry.label}</button>
                      ))}
                    </div>
                  )}
                  <button type="button" className="lab-btn" aria-pressed={code} onClick={() => setCode((value) => !value)}>
                    <Icon name="code" size={14} />View code
                  </button>
                </div>
              </div>
              <p className="lab-idea"><b>{current.n}. {current.name}</b>{current.idea}{slow && <span className="lab-slow-note">slow mode, {speed}x</span>}</p>
            </header>

            <main ref={stage} className="lab-stage">
              <div className="lab-window" style={{ width: win.w, height: win.h, transform: `scale(${scale})` }}>
                {tab === "settings" ? (
                  <>
                    <AppReplica onOpenSettings={() => setOpen(true)} />
                    <AnimatePresence>
                      {open && (
                        <div className="lab-scrim" key="settings">
                          <motion.div aria-hidden="true" className="lab-backdrop" {...motionSet.scrim} onMouseDown={() => setOpen(false)} />
                          <motion.div
                            role="dialog"
                            aria-modal="true"
                            aria-label="Settings"
                            className="lab-dialog"
                            data-settings-look="simple"
                            style={{ width: dialogW, height: dialogH }}
                            {...motionSet.sheet}
                          >
                            <button type="button" className="lab-dialog-close" aria-label="Close settings" onClick={() => setOpen(false)}>
                              <Icon name="close" size={14} />
                            </button>
                            <settingsVariant.Component key={`${settingsVariant.id}:${replayKey}`} />
                          </motion.div>
                        </div>
                      )}
                    </AnimatePresence>
                  </>
                ) : (
                  <chatVariant.Component key={chatVariant.id} speed={speed} reduced={reduced} skin={dark ? "grok-dark" : "grok"} replayKey={replayKey} />
                )}
              </div>
            </main>
            <CodeDrawer open={code} files={current.files} onClose={() => setCode(false)} />
          </div>
        </SettingsProvider>
      </MotionConfig>
    </LabContext.Provider>
  );
}
