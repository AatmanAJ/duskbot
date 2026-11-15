import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Icon, type IconName } from "@/components/Icon";
import { MausAvatar } from "@/components/Avatar";
import { CursorMark, PresetProviderMark, ProviderMark } from "@/components/ProviderIcons";
import { Toggle } from "@/components/ui/Toggle";
import { Segmented } from "@/components/ui/Segmented";
import type { MausColor } from "@/lib/mascot";
import type { StoredBodyId } from "../../../shared/bot-body";
import type { ProviderIconPreset } from "../../../shared/provider-icon";
import { ease, spring } from "@lab/tokens";
import { useLab } from "../shell/prefs";
import { APP_GROUPS, APPS, CATEGORIES, PROVIDERS, TEMPLATES, category, type App, type CustomId, type PageId, type Provider, type Template } from "./model";
import { useSettings, type ConnectState } from "./store";
import { useEnterStagger, useNav, type Route } from "./nav";
import { BusyButton, RowShell, SectionView } from "./rows";

const LOGOS = import.meta.glob("../../../src/assets/app-logos/*.svg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
export const logoUrl = (name: string) => LOGOS[`../../../src/assets/app-logos/${name}.svg`];

/* ---------- shared bits ---------- */

export function ProviderLogo({ provider, size = 26 }: { provider: Provider; size?: number }) {
  const { mark } = provider;
  if (mark.cursor) return <CursorMark size={size} />;
  if (mark.local) return <Icon name="server" size={size - 4} className="text-ink-secondary" />;
  if (mark.preset) return <PresetProviderMark preset={mark.preset as ProviderIconPreset} size={size} />;
  return <ProviderMark driverKind={mark.driver!} size={size} />;
}

export function AppLogo({ app, size = 28 }: { app: App; size?: number }) {
  const tile = app.logo.endsWith(".tile");
  return (
    <span className="kit-app-logo" data-tile={tile ? "" : undefined} style={{ width: size, height: size }}>
      <img src={logoUrl(app.logo)} alt="" width={tile ? size : size - 8} height={tile ? size : size - 8} />
    </span>
  );
}

export function Mascot({ color, body, size = 44 }: { color: string; body?: string; size?: number }) {
  return <MausAvatar color={color as MausColor} bodyId={body as StoredBodyId | undefined} size={size} animated={false} />;
}

/** a page's own little intro line */
export function Lead({ children }: { children: ReactNode }) {
  return <p className="kit-lead">{children}</p>;
}

function StateLabel({ state, on = "Connected" }: { state: ConnectState; on?: string }) {
  if (state === "on") return <span className="kit-state" data-on=""><Icon name="check" size={12} />{on}</span>;
  if (state === "connecting") return <span className="kit-state"><span className="kit-spinner" aria-hidden="true" />Connecting</span>;
  return null;
}

/** A detail sheet that grows out of the tile it belongs to: the shell morphs on a layout spring and its words follow
 * 80ms later. It sits over the page it came from, inside the same fixed box, and closes back into the tile. */
function MorphSheet({ layoutId, open, onClose, host, label, children }: { layoutId: string; open: boolean; onClose: () => void; host: HTMLElement | null; label: string; children: ReactNode }) {
  const { reduced } = useLab();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    close.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [open, onClose]);
  if (!host) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div key="sheet" className="kit-sheet-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
          <motion.div
            layoutId={reduced ? undefined : layoutId}
            role="dialog"
            aria-label={label}
            className="kit-sheet"
            transition={spring.layout}
            initial={reduced ? { opacity: 0 } : undefined}
            animate={reduced ? { opacity: 1 } : undefined}
            exit={reduced ? { opacity: 0 } : undefined}
            style={{ borderRadius: 18 }}
          >
            <motion.div
              className="kit-sheet-body"
              initial={{ opacity: 0, y: reduced ? 0 : 8, filter: reduced ? "none" : "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.24, ease: ease.out, delay: reduced ? 0 : 0.08 } }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
            >
              <button ref={close} type="button" className="kit-back" onClick={onClose} aria-label="Back">
                <Icon name="chevron-left" size={16} /><span className="kit-back-label">Back</span>
              </button>
              {children}
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    host,
  );
}

/** the layer this element lives in, where its sheet is drawn */
function useHost() {
  const anchor = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(anchor.current?.closest<HTMLElement>(".kit-layer, .kit-sheet-host") ?? null), []);
  return { anchor, host };
}

/* ---------- AI ---------- */

export function ProviderGrid({ columns = 4 }: { columns?: number }) {
  const { providers, connectProvider, disconnectProvider } = useSettings();
  const [open, setOpen] = useState<string | null>(null);
  const { anchor, host } = useHost();
  const stagger = useEnterStagger();
  const picked = PROVIDERS.find((entry) => entry.id === open);
  const state = (id: string) => providers[id] ?? "off";
  return (
    <LayoutGroup id="providers">
      <div ref={anchor} className="kit-provider-grid" role="list" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {PROVIDERS.map((provider, index) => (
          <motion.div key={provider.id} role="listitem" {...stagger(index)}>
            <motion.button
              type="button"
              layoutId={`provider-${provider.id}`}
              transition={spring.layout}
              className="kit-provider dusk-press-soft"
              data-state={state(provider.id)}
              data-nav={`provider:${provider.id}`}
              style={{ borderRadius: 16 }}
              onClick={() => setOpen(provider.id)}
            >
              <motion.span layoutId={`provider-mark-${provider.id}`} transition={spring.layout} className="kit-provider-mark"><ProviderLogo provider={provider} /></motion.span>
              <span className="kit-provider-name">{provider.name}</span>
              <span className="kit-provider-state">
                {state(provider.id) === "off" ? <span className="kit-quiet">{provider.how === "key" ? "API key" : provider.how === "local" ? "On this computer" : "Sign in"}</span> : <StateLabel state={state(provider.id)} />}
              </span>
            </motion.button>
          </motion.div>
        ))}
      </div>
      <MorphSheet layoutId={`provider-${open}`} open={Boolean(picked)} onClose={() => setOpen(null)} host={host} label={picked?.name ?? ""}>
        {picked && (
          <div className="kit-detail">
            <motion.span layoutId={`provider-mark-${picked.id}`} transition={spring.layout} className="kit-detail-mark"><ProviderLogo provider={picked} size={44} /></motion.span>
            <h3 className="kit-detail-title">{picked.name}</h3>
            <p className="kit-detail-copy">
              {picked.how === "sign-in"
                ? `Use the ${picked.name} account you already have. You sign in on their own website, so your password stays with them.`
                : picked.how === "key"
                  ? "Paste a key from your OpenRouter account. It stays on this computer."
                  : "Point dusk bot at a model running on this computer, like Ollama or LM Studio."}
            </p>
            <ConnectButton
              state={state(picked.id)}
              label={picked.how === "sign-in" ? `Sign in with ${picked.name}` : picked.how === "key" ? "Add key" : "Find local models"}
              onConnect={() => connectProvider(picked.id)}
            />
            {state(picked.id) === "on" && (
              <motion.div className="kit-detail-after" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { ...spring.fade, delay: 0.1 } }}>
                <RowShell title="Signed in as" hint={picked.plan ?? "Local"}><span className="kit-row-value">sidd@dusk.bot</span></RowShell>
                <RowShell title="Models" hint="Your bots can pick any of them"><span className="kit-row-value">{picked.id === "claude" ? 6 : 9}</span></RowShell>
                <button type="button" className="kit-text-danger" onClick={() => disconnectProvider(picked.id)}>Disconnect {picked.name}</button>
              </motion.div>
            )}
          </div>
        )}
      </MorphSheet>
    </LayoutGroup>
  );
}

/** connect, then a spinner held at least 800ms, then a green "Connected" pill with its check */
function ConnectButton({ state, label, onConnect }: { state: ConnectState; label: string; onConnect: () => void }) {
  return (
    <BusyButton
      tone="primary"
      phase={state === "on" ? "done" : state === "connecting" ? "busy" : "idle"}
      label={label}
      busyLabel="Waiting for your browser"
      doneLabel="Connected"
      onClick={() => state === "off" && onConnect()}
    />
  );
}

function ModelsPage() {
  const [query, setQuery] = useState("");
  const rows = [
    ["Anthropic", 12], ["OpenAI", 18], ["Google Gemini", 9], ["xAI Grok", 6], ["Mistral", 14], ["DeepSeek", 5], ["Qwen", 11],
    ["Moonshot Kimi", 4], ["Groq", 22], ["Cerebras", 7], ["Together AI", 64], ["OpenRouter", 312], ["Ollama", 3], ["LM Studio", 2],
  ] as const;
  const shown = rows.filter(([name]) => name.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <SearchField value={query} onChange={setQuery} label="Search every model and provider" />
      <div className="kit-group">
        {shown.map(([name, count]) => (
          <RowShell key={name} title={name} hint={`${count} models`}><span className="kit-row-value">{name === "Anthropic" ? "Connected" : "Connect"}</span></RowShell>
        ))}
        {!shown.length && <Empty icon="search" title={`Nothing called “${query}”`} hint="Try a provider name, like Mistral or Groq." />}
      </div>
    </>
  );
}

function KeysPage() {
  const groups: Array<[string, string, string[]]> = [
    ["AI providers", "Keys for the models your bots run on.", ["Anthropic", "OpenAI", "OpenRouter"]],
    ["Voice and calls", "Voices for spoken replies and live calls.", ["ElevenLabs", "Deepgram"]],
    ["Computers and browser", "Cloud desktops, your own server and website logins.", ["Browserbase"]],
    ["Apps and tools", "Connected apps and research.", ["Composio", "Firecrawl"]],
  ];
  const [set, setSet] = useState<Record<string, boolean>>({ OpenRouter: true });
  return (
    <>
      {groups.map(([title, hint, names]) => (
        <section key={title} className="kit-section">
          <h3 className="kit-section-title">{title} <span className="kit-quiet">· {names.filter((name) => set[name]).length} connected</span></h3>
          <p className="kit-footnote kit-footnote-top">{hint}</p>
          <div className="kit-group">
            {names.map((name) => (
              <RowShell key={name} title={name} hint={set[name] ? "Connected" : "Not connected"}>
                <button type="button" className="kit-pill dusk-press" onClick={() => setSet((was) => ({ ...was, [name]: !was[name] }))}>{set[name] ? "Change" : "Set up"}</button>
              </RowShell>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

/* ---------- apps and templates ---------- */

export function SearchField({ value, onChange, label, autoFocus }: { value: string; onChange: (value: string) => void; label: string; autoFocus?: boolean }) {
  return (
    <label className="kit-search">
      <Icon name="search" size={15} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={label} aria-label={label} autoFocus={autoFocus} />
      {value && <button type="button" className="kit-search-clear" aria-label="Clear search" onClick={() => onChange("")}><Icon name="close" size={12} /></button>}
    </label>
  );
}

export function Empty({ icon, title, hint }: { icon: IconName; title: string; hint: string }) {
  return (
    <div className="kit-empty">
      <Icon name={icon} size={18} />
      <strong>{title}</strong>
      <span>{hint}</span>
    </div>
  );
}

function AppsPage() {
  const nav = useNav();
  const { apps, connectApp, disconnectApp } = useSettings();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string>("All");
  const [open, setOpen] = useState<string | null>(null);
  const { anchor, host } = useHost();
  const picked = APPS.find((entry) => entry.id === open);
  const shown = APPS.filter((app) => (group === "All" || app.group === group) && `${app.name} ${app.blurb}`.toLowerCase().includes(query.toLowerCase()));
  const state = (id: string) => apps[id] ?? "off";
  return (
    <LayoutGroup id="apps">
      <div ref={anchor} className="kit-stack-gap">
        <button type="button" className="kit-banner dusk-press-soft" data-nav="page:templates" onClick={() => nav.push({ page: "templates", title: "Bot templates" })}>
          <span className="kit-banner-art" aria-hidden="true">
            <Mascot color="green" body="loaf" size={30} /><Mascot color="purple" body="hoot" size={30} /><Mascot color="pink" body="drip" size={30} />
          </span>
          <span className="kit-row-text">
            <span className="kit-row-title">Bot templates</span>
            <span className="kit-row-hint">Ready-made bots that already know which apps to use</span>
          </span>
          <Icon name="chevron-right" size={14} className="kit-chevron" />
        </button>
        <SearchField value={query} onChange={setQuery} label="Search across apps and skills" />
        <Chips options={APP_GROUPS as unknown as string[]} value={group} onChange={setGroup} />
        <motion.div layout="position" className="kit-group" transition={spring.layout}>
          <AnimatePresence initial={false} mode="popLayout">
            {shown.map((app) => (
              <motion.button
                key={app.id}
                layout="position"
                type="button"
                className="kit-row kit-row-button"
                data-nav={`app:${app.id}`}
                onClick={() => setOpen(app.id)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.18 } }}
                exit={{ opacity: 0, transition: { duration: 0.08 } }}
                transition={spring.layout}
              >
                <motion.span layoutId={`app-logo-${app.id}`} transition={spring.layout}><AppLogo app={app} /></motion.span>
                <span className="kit-row-text">
                  <span className="kit-row-title">{app.name}</span>
                  <span className="kit-row-hint">{app.blurb}</span>
                </span>
                {state(app.id) !== "off" ? <StateLabel state={state(app.id)} /> : <span className="kit-row-value">Connect</span>}
                <Icon name="chevron-right" size={14} className="kit-chevron" />
              </motion.button>
            ))}
          </AnimatePresence>
          {!shown.length && <Empty icon="search" title={`No apps match “${query}”`} hint="Try Gmail, Slack or GitHub. Over 1,700 apps connect through dusk bot." />}
        </motion.div>
      </div>
      <MorphSheet layoutId={`app-logo-${open}`} open={Boolean(picked)} onClose={() => setOpen(null)} host={host} label={picked?.name ?? ""}>
        {picked && (
          <div className="kit-detail">
            <motion.span layoutId={`app-logo-${picked.id}`} transition={spring.layout} className="kit-detail-mark"><AppLogo app={picked} size={52} /></motion.span>
            <h3 className="kit-detail-title">{picked.name}</h3>
            <p className="kit-detail-copy">{picked.blurb}. Your bots ask before they send or change anything.</p>
            <BusyButton
              tone="primary"
              phase={state(picked.id) === "on" ? "done" : state(picked.id) === "connecting" ? "busy" : "idle"}
              label={`Connect ${picked.name}`}
              busyLabel="Waiting for your browser"
              doneLabel="Connected"
              onClick={() => state(picked.id) === "off" && connectApp(picked.id)}
            />
            {state(picked.id) === "on" && (
              <motion.div className="kit-detail-after" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { ...spring.fade, delay: 0.1 } }}>
                <h4 className="kit-section-title">Which bots can use it</h4>
                <div className="kit-group">
                  {(["Nova", "Quill", "Juno"] as const).map((name, index) => <BotAccessRow key={name} name={name} color={(["blue", "purple", "pink"] as const)[index]!} />)}
                </div>
                <button type="button" className="kit-text-danger" onClick={() => disconnectApp(picked.id)}>Disconnect {picked.name}</button>
              </motion.div>
            )}
          </div>
        )}
      </MorphSheet>
    </LayoutGroup>
  );
}

function BotAccessRow({ name, color }: { name: string; color: MausColor }) {
  const [on, setOn] = useState(name !== "Juno");
  return (
    <div className="kit-row">
      <Mascot color={color} size={22} />
      <span className="kit-row-text"><span className="kit-row-title" id={`bot-${name}`}>{name}</span></span>
      <Toggle checked={on} aria-labelledby={`bot-${name}`} onClick={() => setOn(!on)} />
    </div>
  );
}

/** filter chips whose highlight slides between them: front edge stiff, back edge catching up */
export function Chips({ options, value, onChange }: { options: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <div className="kit-chips-wrap">
      <Segmented aria-label="Filter" value={value} options={options.map((option) => ({ value: option, label: option }))} onChange={onChange} />
    </div>
  );
}

function TemplatesPage() {
  const { added, addTemplate } = useSettings();
  const [open, setOpen] = useState<string | null>(null);
  const { anchor, host } = useHost();
  const stagger = useEnterStagger();
  const picked = TEMPLATES.find((entry) => entry.id === open);
  return (
    <LayoutGroup id="templates">
      <div ref={anchor}>
        <Lead>Pick one and it joins your sidebar, already set up. You can change anything later.</Lead>
        <div className="kit-template-grid" role="list">
          {TEMPLATES.map((template, index) => (
            <motion.div key={template.id} role="listitem" {...stagger(index)}>
              <motion.button
                type="button"
                layoutId={`template-${template.id}`}
                transition={spring.layout}
                className="kit-template dusk-press-soft"
                data-nav={`template:${template.id}`}
                style={{ borderRadius: 16 }}
                onClick={() => setOpen(template.id)}
              >
                <motion.span layoutId={`template-mascot-${template.id}`} transition={spring.layout}><Mascot color={template.color} body={template.body} size={40} /></motion.span>
                <span className="kit-template-name">{template.name}</span>
                <span className="kit-row-hint">{template.title}</span>
                {added[template.id] && <span className="kit-state" data-on=""><Icon name="check" size={12} />Added</span>}
              </motion.button>
            </motion.div>
          ))}
        </div>
      </div>
      <MorphSheet layoutId={`template-${open}`} open={Boolean(picked)} onClose={() => setOpen(null)} host={host} label={picked?.name ?? ""}>
        {picked && <TemplateDetail template={picked} added={Boolean(added[picked.id])} onAdd={() => addTemplate(picked.id)} />}
      </MorphSheet>
    </LayoutGroup>
  );
}

function TemplateDetail({ template, added, onAdd }: { template: Template; added: boolean; onAdd: () => void }) {
  const [phase, setPhase] = useState<"idle" | "busy" | "done">(added ? "done" : "idle");
  const { speed } = useLab();
  useEffect(() => {
    if (phase !== "busy") return;
    const timer = window.setTimeout(() => { setPhase("done"); onAdd(); }, 900 / speed);
    return () => window.clearTimeout(timer);
  }, [phase, speed, onAdd]);
  return (
    <div className="kit-detail">
      <motion.span layoutId={`template-mascot-${template.id}`} transition={spring.layout} className="kit-detail-mark"><Mascot color={template.color} body={template.body} size={72} /></motion.span>
      <h3 className="kit-detail-title">{template.name}</h3>
      <p className="kit-quiet">{template.title}</p>
      <p className="kit-detail-copy">{template.blurb}</p>
      <BusyButton tone="primary" phase={phase} label={`Add ${template.name}`} busyLabel="Setting up" doneLabel="Added to your bots" onClick={() => phase === "idle" && setPhase("busy")} />
    </div>
  );
}

/* ---------- small data pages ---------- */

function Rows({ rows }: { rows: Array<[string, string?, ReactNode?]> }) {
  return (
    <div className="kit-group">
      {rows.map(([title, hint, end]) => <RowShell key={title} title={title} hint={hint}>{end}</RowShell>)}
    </div>
  );
}

const value = (text: string) => <span className="kit-row-value">{text}</span>;
const pill = (text: string) => <button type="button" className="kit-pill dusk-press">{text}</button>;

function AboutYouPage() {
  const { profile, setProfile } = useSettings();
  return (
    <div className="kit-form">
      <div className="kit-avatar-row">
        <span className="kit-avatar">{profile.name.slice(0, 1)}</span>
        {pill("Choose photo")}
      </div>
      <label className="kit-field"><span>Your name</span><input value={profile.name} placeholder="Your name" onChange={(event) => setProfile({ name: event.target.value })} /></label>
      <label className="kit-field"><span>Email</span><input value={profile.email} placeholder="you@example.com" onChange={(event) => setProfile({ email: event.target.value })} /></label>
      <label className="kit-field">
        <span>About me</span>
        <textarea rows={3} value={profile.about} onChange={(event) => setProfile({ about: event.target.value })} />
        <small>Shared with every bot in private and group chats. Saved automatically.</small>
      </label>
      <section className="kit-section">
        <h3 className="kit-section-title">Added by your bots</h3>
        <p className="kit-footnote kit-footnote-top">Facts your bots learned from your own messages. Remove anything that's wrong and it won't come back.</p>
        <FactList />
      </section>
    </div>
  );
}

function FactList() {
  const [facts, setFacts] = useState(["Flies out of Bengaluru", "Likes window seats", "Works on dusk bot", "Drinks oat flat whites"]);
  const { reduced } = useLab();
  return (
    <div className="kit-group">
      <AnimatePresence initial={false}>
        {facts.map((fact) => (
          <motion.div
            key={fact}
            className="kit-fold"
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0, transition: { height: { duration: 0.2, ease: ease.out }, opacity: { duration: 0.1 } } }}
          >
            <RowShell title={fact}>
              <button type="button" className="kit-icon-button" aria-label={`Remove “${fact}”`} onClick={() => setFacts((all) => all.filter((entry) => entry !== fact))}><Icon name="close" size={13} /></button>
            </RowShell>
          </motion.div>
        ))}
      </AnimatePresence>
      {!facts.length && <Empty icon="sparkle" title="Nothing yet" hint="As you chat, bots add small facts here." />}
    </div>
  );
}

function ImportPage() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  return (
    <>
      <Lead>Bots, memory and skills from your other AI apps. Nothing changes in those apps.</Lead>
      <div className="kit-group">
        {[["Claude", "3 projects and 41 memories"], ["ChatGPT", "Memory and 2 custom GPTs"], ["Hermes Agent", "2 bots and 9 skills"]].map(([name, hint]) => (
          <RowShell key={name} title={name!} hint={hint}>
            <BusyButton phase={done[name!] ? "done" : "idle"} label="Import" doneLabel="Imported" onClick={() => setDone((was) => ({ ...was, [name!]: true }))} />
          </RowShell>
        ))}
      </div>
    </>
  );
}

function PhonePage() {
  const cells = useMemo(() => qrCells(), []);
  return (
    <div className="kit-phone">
      <div className="kit-qr" aria-label="Pairing code to scan" role="img">
        {cells.map((on, index) => <span key={index} data-on={on ? "" : undefined} />)}
      </div>
      <h3 className="kit-detail-title">Scan with your phone's camera</h3>
      <p className="kit-quiet kit-waiting"><span className="kit-pulse" aria-hidden="true" />Waiting for your phone</p>
      {pill("Copy link instead")}
      <p className="kit-footnote">App Store and Google Play soon.</p>
      <section className="kit-section kit-wide">
        <h3 className="kit-section-title">Paired devices</h3>
        <Rows rows={[["Sidd's iPhone", "Full access · last seen today", value("Remove")]]} />
      </section>
    </div>
  );
}

function qrCells() {
  const n = 25;
  let seed = 7;
  const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const finder = (x: number, y: number) => {
    for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]] as const) {
      const dx = x - fx, dy = y - fy;
      if (dx >= 0 && dx < 7 && dy >= 0 && dy < 7) return dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
    }
    return null;
  };
  return Array.from({ length: n * n }, (_, index) => finder(index % n, Math.floor(index / n)) ?? random() > 0.52);
}

export function PlacesList() {
  const [current, setCurrent] = useState("mac");
  const places = [
    { id: "mac", name: "This Mac", hint: "Online", icon: "laptop" as IconName },
    { id: "cloud", name: "dusk cloud", hint: "Online · keeps going when this Mac sleeps", icon: "cloud" as IconName },
    { id: "server", name: "Your server", hint: "Offline or asleep", icon: "server" as IconName },
  ];
  return (
    <div className="kit-group">
      {places.map((place) => (
        <RowShell key={place.id} title={place.name} hint={place.hint} icon={place.icon}>
          {current === place.id ? <span className="kit-state" data-on="">Current</span> : <button type="button" className="kit-pill dusk-press" disabled={place.id === "server"} onClick={() => setCurrent(place.id)}>Switch</button>}
        </RowShell>
      ))}
    </div>
  );
}

function PlacesPage() {
  const nav = useNav();
  return (
    <>
      <Lead>This computer, your clouds and your servers. Switch to the one you want to use.</Lead>
      <PlacesList />
      <div className="kit-group">
        <button type="button" className="kit-row kit-row-button" data-nav="page:add-place" onClick={() => nav.push({ page: "add-place", title: "Add a place" })}>
          <span className="kit-row-icon" aria-hidden="true"><Icon name="plus" size={15} /></span>
          <span className="kit-row-text"><span className="kit-row-title">Add a cloud or your own server</span><span className="kit-row-hint">dusk cloud, or a server you rent or keep at home</span></span>
          <Icon name="chevron-right" size={14} className="kit-chevron" />
        </button>
      </div>
      <section className="kit-section">
        <h3 className="kit-section-title">Install on your vps</h3>
        <ol className="kit-steps">
          <li>Copy the one line we make for you.</li>
          <li>Paste it into your server's terminal and press enter.</li>
          <li>This app sees the server answer and moves your bots in.</li>
        </ol>
        <div>{pill("Get the install line")}</div>
      </section>
    </>
  );
}

function AddPlacePage() {
  return (
    <>
      <Lead>Where should your bots live, besides this computer?</Lead>
      <Rows rows={[
        ["dusk cloud", "Your bots keep working when this computer is off", pill("Start free trial")],
        ["A server you rent", "Paste one line on it and your bots move in", pill("Set up")],
        ["A computer at home", "Pair with its address and six-digit code", pill("Pair")],
      ]} />
    </>
  );
}

function ElsewherePage() {
  const [address, setAddress] = useState("");
  const [phase, setPhase] = useState<"idle" | "busy" | "done">("idle");
  const { speed } = useLab();
  useEffect(() => {
    if (phase !== "busy") return;
    const timer = window.setTimeout(() => setPhase("done"), 1200 / speed);
    return () => window.clearTimeout(timer);
  }, [phase, speed]);
  return (
    <>
      <section className="kit-section">
        <h3 className="kit-section-title">Your servers</h3>
        <Rows rows={[["This computer", "Local bots and conversations", value("Current")], ["New environment", "Its own bots, conversations and data folder", pill("Create")]]} />
      </section>
      <section className="kit-section">
        <h3 className="kit-section-title">Connect to a server</h3>
        <div className="kit-form">
          <label className="kit-field">
            <span>Server address or pairing link</span>
            <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="https://my-server.example.com/pair/…" />
            <small>Run npx duskbot pair on the server and paste the link it prints.</small>
          </label>
          <div>
            <BusyButton tone="primary" phase={phase} label="Connect" busyLabel="Connecting" doneLabel="Connected" disabled={!address.trim()} onClick={() => setPhase("busy")} />
          </div>
        </div>
      </section>
      <section className="kit-section">
        <h3 className="kit-section-title">Connect to another computer</h3>
        <Rows rows={[["Pair with another desktop", "Its address and six-digit code", pill("Pair")]]} />
      </section>
    </>
  );
}

function VaultPage() {
  const [tab, setTab] = useState("all");
  const items = [
    { name: "github.com", kind: "logins", hint: "Saved from a chat · used yesterday", twofa: true },
    { name: "Notion", kind: "logins", hint: "Added here · used 3 days ago" },
    { name: "Stripe API key", kind: "secrets", hint: "Saved from a chat · not used yet" },
    { name: "Lufthansa", kind: "logins", hint: "From 1Password · used last week" },
  ].filter((item) => tab === "all" || item.kind === tab);
  return (
    <>
      <Segmented aria-label="Show" value={tab} options={[{ value: "all", label: "All" }, { value: "logins", label: "Logins" }, { value: "secrets", label: "Secrets" }]} onChange={setTab} />
      <div className="kit-group">
        {items.map((item) => (
          <RowShell key={item.name} title={item.name} hint={item.hint} icon={item.kind === "secrets" ? "key" : "lock"}>
            {item.twofa && <span className="kit-tag">2FA</span>}
          </RowShell>
        ))}
      </div>
      <section className="kit-section">
        <h3 className="kit-section-title">1Password</h3>
        <Rows rows={[["Connected to Personal", "38 logins with a website", value("Manage")]]} />
      </section>
      <p className="kit-footnote">Bots never see your passwords or saved secrets. dusk bot types them in for them.</p>
    </>
  );
}

function BotAccessPage() {
  const [by, setBy] = useState("bot");
  return (
    <>
      <Lead>Which bots everyone in Dusk Labs can use, and which only the people added to them.</Lead>
      <Segmented aria-label="List by" value={by} options={[{ value: "bot", label: "By bot" }, { value: "person", label: "By person" }]} onChange={setBy} />
      <Rows rows={by === "bot"
        ? [["Nova", "Everyone can use it"], ["Quill", "Only people added · 3 people"], ["Tally", "Only people added · 1 person"]]
        : [["Sidd", "Admin · every bot"], ["Maya", "Nova, Quill"], ["Arjun", "Nova"]]} />
      <p className="kit-footnote">Admins can always edit every bot.</p>
    </>
  );
}

function ActivityPage() {
  return (
    <>
      <Rows rows={[
        ["Quill changed its instructions", "Maya · 10 minutes ago"],
        ["Nova connected Google Calendar", "Sidd · 1 hour ago"],
        ["Tally exported a report", "Tally · yesterday"],
        ["Arjun joined the team", "Sidd · 2 days ago"],
      ]} />
      <p className="kit-footnote">Kept for 90 days.</p>
    </>
  );
}

function StoragePage() {
  return (
    <>
      <section className="kit-section">
        <h3 className="kit-section-title">Attachments</h3>
        <div className="kit-group">
          <RowShell title="1.2 GB of 5 GB used" hint="Files you send are kept for 30 days">{pill("Clear")}</RowShell>
          <div className="kit-meter-pad"><Meter value={0.24} hue="var(--identity-chrome)" /></div>
        </div>
      </section>
      <section className="kit-section">
        <h3 className="kit-section-title">Backups</h3>
        <Rows rows={[["Export full backup", "Everything, protected by a password", pill("Export")], ["Import backup", "An encrypted .duskbackup file, checked first", pill("Import")]]} />
      </section>
    </>
  );
}

function ArchivedPage() {
  const [bots, setBots] = useState([{ name: "Basil", color: "green" }, { name: "Moss", color: "teal" }]);
  return (
    <div className="kit-group">
      <AnimatePresence initial={false}>
        {bots.map((bot) => (
          <motion.div key={bot.name} className="kit-fold" exit={{ height: 0, opacity: 0, transition: { duration: 0.2, ease: ease.out } }}>
            <div className="kit-row">
              <Mascot color={bot.color} size={24} />
              <span className="kit-row-text"><span className="kit-row-title">{bot.name}</span><span className="kit-row-hint">Archived last month</span></span>
              <button type="button" className="kit-pill dusk-press" onClick={() => setBots((all) => all.filter((entry) => entry !== bot))}>Bring back</button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      {!bots.length && <Empty icon="archive" title="No archived bots" hint="Bots you put away show up here, ready to bring back." />}
    </div>
  );
}

function SkillsPage() {
  return (
    <>
      <Lead>Skills your bots can use. Everything stays on this computer.</Lead>
      <Rows rows={[["Trip planning", "Every bot", value("Nova")], ["Weekly money report", "Tally", value("Tally")], ["Launch post style", "Quill", value("Quill")]]} />
      <div>{pill("Import a skill")}</div>
    </>
  );
}

function McpPage() {
  return (
    <>
      <Lead>Tool servers your bots can call.</Lead>
      <Rows rows={[["context7", "Library docs · 2 tools", value("On")], ["firecrawl", "Web pages to text · 4 tools", value("On")]]} />
      <div>{pill("Add a server")}</div>
    </>
  );
}

function ProfilesPage() {
  return (
    <>
      <Rows rows={[["Shared", "Built-in · used by Nova, Juno · 6 signed-in sites", value("Rename")], ["Work Chrome", "My Chrome · not in use", value("Rename")]]} />
      <div>{pill("New profile")}</div>
      <p className="kit-footnote">You can keep up to 20 shared profiles.</p>
    </>
  );
}

function WhereBotsWorkPage() {
  return <Rows rows={[["This Mac", "Your bots can use the screen, apps and browser", value("On")], ["Cloud desktop", "A computer in dusk cloud for long jobs", pill("Set up")]]} />;
}

function PlanPage() {
  const [plan, setPlan] = useState("pro");
  const plans = { starter: ["Starter", "$15"], pro: ["Pro", "$49"], max: ["Max", "$99"] } as const;
  return (
    <>
      <Lead>dusk cloud keeps your bots and routines running, even when this computer is off.</Lead>
      <Segmented aria-label="Plan" value={plan} options={Object.entries(plans).map(([id, [label]]) => ({ value: id, label }))} onChange={setPlan} />
      <div className="kit-price">
        <SwapNumber text={plans[plan as keyof typeof plans][1]} />
        <span className="kit-quiet">a month, 7-day free trial</span>
      </div>
      <div>{pill("Start free trial")}</div>
      <p className="kit-footnote">dusk bot on this computer stays free for noncommercial use.</p>
    </>
  );
}

function SwapNumber({ text }: { text: string }) {
  const { reduced } = useLab();
  return (
    <span className="kit-swap kit-price-n">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={text}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: reduced ? { duration: 0.15 } : spring.fade }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, filter: "blur(2px)", transition: { duration: 0.12 } }}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function BreakdownPage() {
  const rows: Array<[string, number]> = [["Nova", 0.42], ["Quill", 0.27], ["Tally", 0.16], ["Juno", 0.09], ["Rivet", 0.06]];
  return (
    <>
      <Lead>Last 7 days, by bot.</Lead>
      <div className="kit-group">
        {rows.map(([name, share]) => (
          <div key={name} className="kit-row kit-row-meter">
            <span className="kit-row-title">{name}</span>
            <Meter value={share} hue="var(--identity-coral)" />
            <span className="kit-row-value">{Math.round(share * 100)}%</span>
          </div>
        ))}
      </div>
    </>
  );
}

function DiagnosticsPage() {
  const [phase, setPhase] = useState<"idle" | "busy" | "done">("idle");
  const { speed } = useLab();
  useEffect(() => {
    if (phase !== "busy") return;
    const timer = window.setTimeout(() => setPhase("done"), 1000 / speed);
    return () => window.clearTimeout(timer);
  }, [phase, speed]);
  return (
    <Rows rows={[
      ["Export diagnostics", "Logs to send when something goes wrong", <BusyButton key="x" phase={phase} label="Export" busyLabel="Exporting" doneLabel="Saved to Downloads" onClick={() => setPhase("busy")} />],
      ["Usage log", "App actions and errors from the last 7 days. No messages or passwords.", value("Open")],
    ]} />
  );
}

/** a share bar that grows from the start on a settle spring the first time it shows */
export function Meter({ value, hue }: { value: number; hue: string }) {
  const { reduced } = useLab();
  return (
    <span className="kit-meter" aria-hidden="true">
      <motion.span
        style={{ background: hue, originX: 0 }}
        initial={reduced ? false : { scaleX: 0 }}
        animate={{ scaleX: value }}
        transition={reduced ? { duration: 0 } : { ...spring.settle, delay: 0.1 }}
      />
    </span>
  );
}

/* ---------- custom rows inside categories ---------- */

function AccountCard() {
  const { profile } = useSettings();
  const nav = useNav();
  return (
    <div className="kit-row kit-account">
      <span className="kit-avatar">{profile.name.slice(0, 1)}</span>
      <button type="button" className="kit-row-text kit-account-who" data-nav="page:about-you" onClick={() => nav.push({ page: "about-you", title: "About you" })}>
        <span className="kit-row-title">{profile.name || "Add your name"}</span>
        <span className="kit-row-hint">{profile.email}</span>
      </button>
      <button type="button" className="kit-pill dusk-press">Add account</button>
      <button type="button" className="kit-pill dusk-press">Sign out</button>
    </div>
  );
}

function VersionRow() {
  const [phase, setPhase] = useState<"idle" | "busy" | "done">("idle");
  const { speed } = useLab();
  useEffect(() => {
    if (phase !== "busy") return;
    const timer = window.setTimeout(() => setPhase("done"), 1100 / speed);
    return () => window.clearTimeout(timer);
  }, [phase, speed]);
  return (
    <RowShell title="dusk bot 1.42.0" hint={phase === "done" ? "You're on the latest version" : "Updates install by themselves when you're away"} icon="cloud-download">
      <BusyButton phase={phase} label="Check for updates" busyLabel="Checking" doneLabel="Up to date" onClick={() => setPhase("busy")} />
    </RowShell>
  );
}

function UsageCards() {
  const { providers } = useSettings();
  const connected = PROVIDERS.filter((provider) => providers[provider.id] === "on" && provider.plan);
  if (!connected.length) return <Empty icon="chart-bars" title="No usage limits to show" hint="Signed-in plans like Claude or ChatGPT report them." />;
  return (
    <>
      {connected.map((provider, index) => {
        const used = [0.62, 0.18, 0.35, 0.5][index % 4]!;
        return (
          <div key={provider.id} className="kit-row kit-row-meter">
            <ProviderLogo provider={provider} size={18} />
            <span className="kit-row-text"><span className="kit-row-title">{provider.name} usage</span><span className="kit-row-hint">Resets in {index ? "3 days" : "2 hours"}</span></span>
            <Meter value={used} hue="var(--identity-coral)" />
            <span className="kit-row-value">{Math.round(used * 100)}%</span>
          </div>
        );
      })}
    </>
  );
}

function PlanRow() {
  const nav = useNav();
  return (
    <RowShell title="dusk cloud" hint="Keeps your bots running, even when this computer is off" icon="cloud">
      <button type="button" className="kit-pill dusk-press" data-tone="primary" data-nav="page:plan" onClick={() => nav.push({ page: "plan", title: "dusk cloud" })}>Compare plans</button>
    </RowShell>
  );
}

function ProvidersInline() {
  return <div className="kit-pad"><ProviderGrid /></div>;
}

export const CUSTOM: Record<CustomId, () => ReactNode> = {
  account: AccountCard,
  version: VersionRow,
  providers: ProvidersInline,
  places: PlacesList,
  usage: UsageCards,
  plan: PlanRow,
  "phone-code": PhonePage,
};

/* ---------- the registry ---------- */

const PAGES: Record<PageId, () => ReactNode> = {
  "about-you": AboutYouPage,
  import: ImportPage,
  providers: () => <ProviderGrid />,
  provider: () => <ProviderGrid />,
  keys: KeysPage,
  models: ModelsPage,
  apps: AppsPage,
  app: AppsPage,
  templates: TemplatesPage,
  template: TemplatesPage,
  mcp: McpPage,
  skills: SkillsPage,
  vault: VaultPage,
  phone: PhonePage,
  places: PlacesPage,
  "add-place": AddPlacePage,
  elsewhere: ElsewherePage,
  "where-bots-work": WhereBotsWorkPage,
  profiles: ProfilesPage,
  "bot-access": BotAccessPage,
  activity: ActivityPage,
  storage: StoragePage,
  archived: ArchivedPage,
  plan: PlanPage,
  breakdown: BreakdownPage,
  diagnostics: DiagnosticsPage,
  "voice-engine": () => null,
};

/** a category's sections, in order */
export function CategoryBody({ id }: { id: string }) {
  const entry = category(id);
  return (
    <div className="kit-page">
      {entry.sections.map((section, index) => <SectionView key={index} section={section} category={entry} index={index} />)}
    </div>
  );
}

/** what a route shows below its header */
export function PageBody({ route }: { route: Route }) {
  if (route.page === "category") return <CategoryBody id={route.id!} />;
  if (route.page === "home") return null;
  const Page = PAGES[route.page];
  return <div className="kit-page"><Page /></div>;
}

export { CATEGORIES };
