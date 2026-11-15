import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULTS, type Values } from "./model";

export type ConnectState = "off" | "connecting" | "on";

type Store = {
  values: Values;
  set: (id: string, value: string | boolean) => void;
  providers: Record<string, ConnectState>;
  connectProvider: (id: string) => void;
  disconnectProvider: (id: string) => void;
  apps: Record<string, ConnectState>;
  connectApp: (id: string) => void;
  disconnectApp: (id: string) => void;
  added: Record<string, boolean>;
  addTemplate: (id: string) => void;
  profile: { name: string; email: string; about: string };
  setProfile: (patch: Partial<Store["profile"]>) => void;
  /** the lab's skin follows the Theme row's light and dark */
  onTheme?: (dark: boolean) => void;
};

const Context = createContext<Store | null>(null);

/** how long a sign-in "takes" in the lab; a spinner always shows at least 800ms (motion brief) */
const CONNECT_MS = 1400;

export function SettingsProvider({ children, onTheme }: { children: ReactNode; onTheme?: (dark: boolean) => void }) {
  const [values, setValues] = useState<Values>(DEFAULTS);
  const [providers, setProviders] = useState<Record<string, ConnectState>>({ claude: "on" });
  const [apps, setApps] = useState<Record<string, ConnectState>>({ gmail: "on", github: "on", googlecalendar: "on" });
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [profile, setProfileState] = useState({ name: "Sidd", email: "sidd@dusk.bot", about: "Based in Bengaluru. Prefers short answers, window seats and dark mode." });
  const timers = useRef(new Map<string, number>());
  const theme = useRef(onTheme);
  theme.current = onTheme;

  const set = useCallback((id: string, value: string | boolean) => {
    setValues((current) => ({ ...current, [id]: value }));
    if (id === "theme" && (value === "light" || value === "dark")) theme.current?.(value === "dark");
  }, []);

  const later = (key: string, run: () => void) => {
    window.clearTimeout(timers.current.get(key));
    timers.current.set(key, window.setTimeout(run, CONNECT_MS / labSpeed()));
  };

  const store = useMemo<Store>(() => ({
    values,
    set,
    providers,
    connectProvider: (id) => {
      setProviders((current) => ({ ...current, [id]: "connecting" }));
      later(`p:${id}`, () => setProviders((current) => ({ ...current, [id]: "on" })));
    },
    disconnectProvider: (id) => {
      window.clearTimeout(timers.current.get(`p:${id}`));
      setProviders((current) => ({ ...current, [id]: "off" }));
    },
    apps,
    connectApp: (id) => {
      setApps((current) => ({ ...current, [id]: "connecting" }));
      later(`a:${id}`, () => setApps((current) => ({ ...current, [id]: "on" })));
    },
    disconnectApp: (id) => {
      window.clearTimeout(timers.current.get(`a:${id}`));
      setApps((current) => ({ ...current, [id]: "off" }));
    },
    added,
    addTemplate: (id) => setAdded((current) => ({ ...current, [id]: true })),
    profile,
    setProfile: (patch) => setProfileState((current) => ({ ...current, ...patch })),
  }), [values, set, providers, apps, added, profile]);

  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useSettings(): Store {
  const store = useContext(Context);
  if (!store) throw new Error("useSettings outside SettingsProvider");
  return store;
}

function labSpeed(): number {
  return Number(document.documentElement.style.getPropertyValue("--lab-speed")) || 1;
}
