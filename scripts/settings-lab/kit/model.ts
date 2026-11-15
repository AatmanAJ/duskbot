// the real settings, regrouped into plain-word categories. labels and hints are the app's own copy (src/locales/en.json),
// shortened where the original was long. every variant reads this one model; only the organisation and feel differ.
import type { IconName } from "@/components/Icon";

export type Hue = "blue" | "pink" | "orange" | "green" | "purple" | "yellow" | "teal" | "chrome" | "coral" | "silver";
export type Option = { value: string; label: string };

export type Row =
  | { kind: "switch"; id: string; title: string; hint?: string; icon?: IconName; when?: Cond }
  | { kind: "select"; id: string; title: string; hint?: string; icon?: IconName; options: Option[]; when?: Cond }
  | { kind: "segmented"; id: string; title: string; hint?: string; icon?: IconName; options: Option[]; when?: Cond }
  | { kind: "page"; page: PageId; title: string; hint?: string; icon?: IconName; count?: (v: Values) => string | number | undefined; when?: Cond }
  | { kind: "action"; id: string; title: string; hint?: string; icon?: IconName; button: string; done?: string; when?: Cond }
  | { kind: "link"; title: string; hint?: string; icon?: IconName }
  | { kind: "custom"; id: CustomId; when?: Cond };

export type Cond = (values: Values) => boolean;
export type Values = Record<string, string | boolean>;
export type Section = { title?: string; footnote?: string; rows: Row[] };

export type CustomId = "account" | "version" | "providers" | "places" | "usage" | "phone-code" | "plan";

export type PageId =
  | "about-you" | "import" | "providers" | "provider" | "keys" | "models" | "apps" | "app" | "templates" | "template"
  | "mcp" | "skills" | "vault" | "phone" | "places" | "add-place" | "elsewhere" | "where-bots-work" | "profiles"
  | "bot-access" | "activity" | "storage" | "archived" | "plan" | "breakdown" | "diagnostics" | "voice-engine";

export type Category = {
  id: string;
  title: string;
  /** one plain line on what lives here */
  blurb: string;
  icon: IconName;
  hue: Hue;
  sections: Section[];
};

export const hueVar = (hue: Hue) => `var(--identity-${hue})`;

const THEMES: Option[] = [
  { value: "system", label: "Follow system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "midnight", label: "Midnight" },
  { value: "atelier", label: "Atelier" },
  { value: "lagoon", label: "Lagoon" },
  { value: "linen", label: "Linen" },
  { value: "dusk", label: "Dusk" },
  { value: "meadow", label: "Meadow" },
];

const LANGUAGES: Option[] = [
  { value: "system", label: "Follow system" },
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "hi", label: "हिन्दी" },
  { value: "ja", label: "日本語" },
  { value: "pt", label: "Português (Brasil)" },
  { value: "zh", label: "简体中文" },
  { value: "it", label: "Italiano" },
  { value: "ko", label: "한국어" },
];

export const DEFAULTS: Values = {
  theme: "light",
  accent: "bot",
  style: "warm",
  language: "system",
  island: true,
  islandSize: "medium",
  dock: false,
  showOn: "current",
  talk: true,
  sendKey: "enter",
  busy: "add",
  quickUpdates: true,
  openAtLogin: true,
  notify: true,
  sound: true,
  soundName: "chime-b",
  stats: true,
  voiceEngine: "builtin",
  voiceLanguage: "auto",
  liveWords: true,
  tidy: true,
  helper: true,
  newModel: "claude-sonnet",
  reasoning: "default",
  awake: false,
  browser: true,
  serverSites: false,
  learn: true,
  shareSkills: "ask",
  keepAwakePhone: true,
};

export const CATEGORIES: Category[] = [
  {
    id: "you",
    title: "You",
    blurb: "Your name, account and what bots know about you",
    icon: "person",
    hue: "blue",
    sections: [
      { rows: [{ kind: "custom", id: "account" }] },
      {
        rows: [
          { kind: "page", page: "about-you", title: "About you", hint: "What every bot knows about you", icon: "pencil" },
          { kind: "page", page: "import", title: "Bring in from other apps", hint: "Bots, memory and skills from your other AI apps", icon: "arrow-down" },
        ],
      },
    ],
  },
  {
    id: "look",
    title: "How it looks",
    blurb: "Theme, colours, language and how bots talk",
    icon: "sun",
    hue: "pink",
    sections: [
      {
        footnote: "Your settings follow you across your computers.",
        rows: [
          { kind: "select", id: "theme", title: "Theme", hint: "Light, dark, or one of dusk bot's other looks", options: THEMES },
          { kind: "segmented", id: "accent", title: "Your message color", hint: "Whether your messages wear your bot's color", options: [{ value: "bot", label: "Bot color" }, { value: "neutral", label: "Neutral" }] },
          { kind: "segmented", id: "style", title: "Talking style", hint: "How every bot sounds when it writes to you", options: [{ value: "casual", label: "Casual" }, { value: "warm", label: "Warm" }, { value: "native", label: "Native" }] },
          { kind: "select", id: "language", title: "Language", hint: "Follows your system unless you pick one", options: LANGUAGES },
        ],
      },
      {
        title: "Around your screen",
        rows: [
          { kind: "switch", id: "island", title: "Show island", hint: "Your bots at the top of the screen, around the camera" },
          { kind: "select", id: "islandSize", title: "Island size", options: [{ value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }], when: (v) => v.island === true },
          { kind: "switch", id: "dock", title: "Show bot dock", hint: "Your bots on the right edge. It slides in when you point there" },
          { kind: "select", id: "showOn", title: "Show on", hint: "For the island and the bot dock", options: [{ value: "current", label: "The display you're using" }, { value: "builtin", label: "Built-in display" }, { value: "main", label: "Main display" }] },
        ],
      },
    ],
  },
  {
    id: "ai",
    title: "AI",
    blurb: "Connect ChatGPT, Claude and more",
    icon: "sparkle",
    hue: "orange",
    sections: [
      { title: "Connect an AI", rows: [{ kind: "custom", id: "providers" }] },
      {
        title: "New bots",
        rows: [
          { kind: "select", id: "newModel", title: "Model for new bots", options: [{ value: "claude-sonnet", label: "Claude Sonnet" }, { value: "gpt", label: "GPT-5" }, { value: "grok", label: "Grok 5" }, { value: "gemini", label: "Gemini 3 Pro" }] },
          { kind: "select", id: "reasoning", title: "Reasoning for new bots", options: [{ value: "default", label: "Provider default" }, { value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }] },
          { kind: "switch", id: "helper", title: "Show dusk bot in the sidebar", hint: "Your helper for everything in the app" },
        ],
      },
      {
        title: "More",
        rows: [
          { kind: "page", page: "models", title: "All models", hint: "Every model and provider", icon: "search" },
          { kind: "page", page: "keys", title: "API keys", hint: "Keys for providers you pay for yourself", icon: "key" },
        ],
      },
    ],
  },
  {
    id: "apps",
    title: "Apps and tools",
    blurb: "Gmail, Slack, GitHub, bot templates and skills",
    icon: "plug",
    hue: "green",
    sections: [
      {
        rows: [
          { kind: "page", page: "apps", title: "Connected apps", hint: "Gmail, Slack, GitHub and more for your bots", icon: "grid-plus" },
          { kind: "page", page: "templates", title: "Bot templates", hint: "Ready-made bots for everyday jobs", icon: "robot" },
          { kind: "page", page: "skills", title: "Skills", hint: "Know-how your bots can pick up", icon: "skills" },
          { kind: "page", page: "mcp", title: "MCP servers", hint: "Tool servers your bots can call", icon: "server" },
        ],
      },
      {
        title: "What bots learn",
        rows: [
          { kind: "switch", id: "learn", title: "Bots can write down new skills they learn" },
          { kind: "segmented", id: "shareSkills", title: "Share learned skills", options: [{ value: "off", label: "Off" }, { value: "ask", label: "Ask" }, { value: "auto", label: "Automatic" }] },
        ],
      },
    ],
  },
  {
    id: "voice",
    title: "Voice and typing",
    blurb: "Talk from any app, and how messages send",
    icon: "mic",
    hue: "purple",
    sections: [
      {
        rows: [
          { kind: "switch", id: "talk", title: "Talk to dusk bot from any app", hint: "Hold Fn, speak, let go" },
          { kind: "segmented", id: "sendKey", title: "Send messages with", hint: "The others start a new line", options: [{ value: "enter", label: "Enter" }, { value: "shift", label: "Shift+Enter" }, { value: "cmd", label: "⌘+Enter" }] },
          { kind: "select", id: "busy", title: "Sending while a bot works", options: [{ value: "add", label: "Add it to what the bot is doing" }, { value: "wait", label: "Send it when the bot is done" }] },
          { kind: "switch", id: "quickUpdates", title: "Quick updates while working", hint: "A short note when a bot starts a longer job" },
        ],
      },
      {
        title: "Speech to text",
        rows: [
          { kind: "select", id: "voiceEngine", title: "Engine", hint: "What turns your voice into words", options: [{ value: "builtin", label: "Built-in (Mac)" }, { value: "elevenlabs", label: "ElevenLabs" }, { value: "openai", label: "OpenAI" }, { value: "groq", label: "Groq" }, { value: "deepgram", label: "Deepgram" }, { value: "whisper", label: "whisper.cpp" }] },
          { kind: "switch", id: "liveWords", title: "Show words while you talk", hint: "Off sends each piece when you pause" },
          { kind: "switch", id: "tidy", title: "Tidy up what you said", hint: "Fixes punctuation and filler words, keeps your meaning" },
          { kind: "action", id: "mic-test", title: "Try it", hint: "Records 3 seconds and shows what it heard", button: "Test", done: "Heard: “book the 9:40 to Lisbon”" },
        ],
      },
    ],
  },
  {
    id: "notifications",
    title: "Notifications",
    blurb: "Alerts and sounds",
    icon: "bell",
    hue: "yellow",
    sections: [
      {
        rows: [
          { kind: "switch", id: "notify", title: "Notifications on this device" },
          { kind: "switch", id: "sound", title: "Play sound for notifications" },
          { kind: "select", id: "soundName", title: "Notification sound", options: [{ value: "blip", label: "Open blip" }, { value: "tick", label: "Tick" }, { value: "double", label: "Double tick" }, { value: "chime-a", label: "Chime A" }, { value: "chime-b", label: "Chime B" }], when: (v) => v.sound === true },
        ],
      },
    ],
  },
  {
    id: "devices",
    title: "Phone and computer",
    blurb: "Your phone, your computers and the cloud",
    icon: "laptop",
    hue: "teal",
    sections: [
      {
        rows: [
          { kind: "page", page: "phone", title: "Link your phone", hint: "Talk to your bots from anywhere", icon: "device-mobile" },
          { kind: "page", page: "places", title: "Where your bots live", hint: "This computer, your clouds and servers", icon: "cloud", count: () => "This Mac" },
          { kind: "page", page: "elsewhere", title: "Connect from elsewhere", hint: "Reach this dusk bot from another computer", icon: "link" },
        ],
      },
      {
        title: "This computer",
        rows: [
          { kind: "switch", id: "openAtLogin", title: "Open at login", hint: "Opens quietly when you sign in" },
          { kind: "switch", id: "awake", title: "Keep awake for scheduled automations" },
          { kind: "switch", id: "browser", title: "Built-in browser" },
          { kind: "switch", id: "serverSites", title: "Open sites on this server", hint: "Includes your local network" },
          { kind: "page", page: "profiles", title: "Browser profiles", hint: "Saved sign-ins your bots can reuse", count: () => 2 },
        ],
      },
    ],
  },
  {
    id: "privacy",
    title: "Privacy and safety",
    blurb: "Passwords, who can do what, your data",
    icon: "shield",
    hue: "chrome",
    sections: [
      {
        rows: [
          { kind: "page", page: "vault", title: "Vault", hint: "Logins and secrets bots can use, never see", icon: "vault", count: () => 4 },
          { kind: "page", page: "bot-access", title: "Bot access", hint: "Who on your team can use which bots", icon: "people" },
          { kind: "page", page: "activity", title: "Activity", hint: "What people and bots did, newest first", icon: "list-checks" },
        ],
      },
      {
        title: "Your data",
        rows: [
          { kind: "switch", id: "stats", title: "Share anonymous usage statistics", hint: "Never your messages, files or keys" },
          { kind: "page", page: "storage", title: "Storage and backups", hint: "Attachments, export and restore", icon: "database" },
          { kind: "page", page: "archived", title: "Archived bots", hint: "Bots you put away, ready to bring back", icon: "archive", count: () => 2 },
        ],
      },
    ],
  },
  {
    id: "plan",
    title: "Plan and usage",
    blurb: "How much you've used, and dusk cloud",
    icon: "chart-bars",
    hue: "coral",
    sections: [
      { title: "Your AI plans", footnote: "Included with the plans you signed in with. Each limit resets on its own.", rows: [{ kind: "custom", id: "usage" }] },
      {
        title: "Plan",
        rows: [
          { kind: "custom", id: "plan" },
          { kind: "page", page: "breakdown", title: "Usage breakdown", hint: "Usage by bot, model and day" },
        ],
      },
    ],
  },
  {
    id: "help",
    title: "Help and updates",
    blurb: "Version, shortcuts and getting help",
    icon: "question-circle",
    hue: "silver",
    sections: [
      { rows: [{ kind: "custom", id: "version" }] },
      {
        rows: [
          { kind: "link", title: "Help center" },
          { kind: "link", title: "Send feedback" },
          { kind: "action", id: "shortcuts", title: "Keyboard shortcuts", button: "Show" },
          { kind: "page", page: "diagnostics", title: "Diagnostics", hint: "Logs to send when something goes wrong" },
        ],
      },
    ],
  },
];

export const category = (id: string) => CATEGORIES.find((entry) => entry.id === id)!;

export type Provider = { id: string; name: string; mark: { driver?: string; preset?: string; cursor?: boolean; local?: boolean }; how: "sign-in" | "key" | "local"; plan?: string };

export const PROVIDERS: Provider[] = [
  { id: "chatgpt", name: "ChatGPT", mark: { driver: "codex" }, how: "sign-in", plan: "ChatGPT Plus" },
  { id: "claude", name: "Claude", mark: { driver: "claudeAgent" }, how: "sign-in", plan: "Claude Max" },
  { id: "grok", name: "Grok", mark: { driver: "grokAgent" }, how: "sign-in", plan: "SuperGrok" },
  { id: "gemini", name: "Gemini", mark: { preset: "google" }, how: "sign-in", plan: "Google AI Pro" },
  { id: "cursor", name: "Cursor", mark: { cursor: true }, how: "sign-in", plan: "Cursor Pro" },
  { id: "copilot", name: "GitHub Copilot", mark: { driver: "copilotAgent" }, how: "sign-in", plan: "Copilot Pro" },
  { id: "openrouter", name: "OpenRouter", mark: { preset: "openrouter" }, how: "key" },
  { id: "local", name: "Local model", mark: { local: true }, how: "local" },
];

export type App = { id: string; name: string; blurb: string; logo: string; group: string };

export const APPS: App[] = [
  { id: "gmail", name: "Gmail", blurb: "Read and send email", logo: "gmail.tile", group: "Communication" },
  { id: "googlecalendar", name: "Google Calendar", blurb: "See your schedule, and add or change events", logo: "google-calendar.tile", group: "Productivity" },
  { id: "googledrive", name: "Google Drive", blurb: "Browse and manage files", logo: "google-drive.tile", group: "Productivity" },
  { id: "slack", name: "Slack", blurb: "Post updates and read channels", logo: "slack", group: "Communication" },
  { id: "github", name: "GitHub", blurb: "Issues, pull requests, and code", logo: "github", group: "Code" },
  { id: "notion", name: "Notion", blurb: "Pages and databases", logo: "notion.tile", group: "Productivity" },
  { id: "googledocs", name: "Google Docs", blurb: "Read and write documents", logo: "google-docs.tile", group: "Productivity" },
  { id: "googlesheets", name: "Google Sheets", blurb: "Read and update spreadsheets", logo: "googlesheets", group: "Productivity" },
  { id: "outlook", name: "Outlook", blurb: "Mail and calendar", logo: "outlook", group: "Communication" },
  { id: "linear", name: "Linear", blurb: "Issues and project tracking", logo: "linear.tile", group: "Code" },
  { id: "figma", name: "Figma", blurb: "Files and comments", logo: "figma.tile", group: "Design" },
  { id: "dropbox", name: "Dropbox", blurb: "Files and folders", logo: "dropbox", group: "Productivity" },
  { id: "hubspot", name: "HubSpot", blurb: "CRM search & updates", logo: "hubspot.tile", group: "Productivity" },
  { id: "discord", name: "Discord", blurb: "Messages and channels", logo: "discord", group: "Communication" },
  { id: "stripe", name: "Stripe", blurb: "Payments and customers", logo: "stripe.tile", group: "Productivity" },
  { id: "x", name: "X (Twitter)", blurb: "Post and read on X", logo: "x.tile", group: "Communication" },
  { id: "canva", name: "Canva", blurb: "Designs and brand kits", logo: "canva", group: "Design" },
  { id: "sentry", name: "Sentry", blurb: "Errors and alerts", logo: "sentry.tile", group: "Code" },
  { id: "onepassword", name: "1Password", blurb: "Logins your bots can type in", logo: "1password.tile", group: "Password managers" },
];

export const APP_GROUPS = ["All", "Productivity", "Communication", "Design", "Code", "Password managers"] as const;

export type Template = { id: string; name: string; title: string; blurb: string; color: string; body: string; group: string };

export const TEMPLATES: Template[] = [
  { id: "alfie", name: "Alfie", title: "Personal assistant", blurb: "Handles errands, lookups, reminders and first drafts, and only checks with you before anything goes out.", color: "green", body: "loaf", group: "Everyday" },
  { id: "clem", name: "Clem", title: "Planner", blurb: "Plans your day and week from your calendar and tasks, and keeps follow-ups from slipping.", color: "yellow", body: "mochi", group: "Everyday" },
  { id: "letty", name: "Letty", title: "Email assistant", blurb: "Sorts your inbox, flags what needs you, spots scams, and drafts replies for you to approve.", color: "blue", body: "cheep", group: "Everyday" },
  { id: "quinn", name: "Quinn", title: "Researcher", blurb: "Digs through the web and your files, checks claims against good sources, and returns a dated, sourced brief.", color: "purple", body: "hoot", group: "Work" },
  { id: "edie", name: "Edie", title: "Writer and editor", blurb: "Drafts, edits and rewrites in your voice, so it reads like a person wrote it, not a template.", color: "pink", body: "drip", group: "Writing" },
  { id: "ada", name: "Ada", title: "Coding partner", blurb: "Works inside a project folder: reads the code, makes small changes, runs the tests, explains what changed.", color: "cyan", body: "boxo", group: "Work" },
  { id: "vera", name: "Vera", title: "Data analyst", blurb: "Answers questions about spreadsheets and CSVs with numbers, tables and charts you can check.", color: "teal", body: "pip", group: "Work" },
  { id: "penny", name: "Penny", title: "Bookkeeper", blurb: "Sorts receipts, categorises transactions, reconciles accounts and drafts invoices. Not a tax adviser.", color: "brown", body: "tofu", group: "Personal" },
  { id: "hugo", name: "Hugo", title: "Customer support", blurb: "Drafts customer replies, triages tickets and writes help articles, in your policies and tone.", color: "coral", body: "hearty", group: "Work" },
  { id: "kiki", name: "Kiki", title: "Social media manager", blurb: "Plans your posts, previews each one, and posts through your connected apps when you say so.", color: "red", body: "starry", group: "Sales" },
  { id: "marco", name: "Marco", title: "Travel planner", blurb: "Plans trips day by day around your budget and pace, checks entry rules, and keeps the details in one place.", color: "blue", body: "wisp", group: "Personal" },
  { id: "hazel", name: "Hazel", title: "Study tutor", blurb: "Explains topics step by step, quizzes you, and plans revision around what you keep forgetting.", color: "purple", body: "sprout", group: "Personal" },
];

/** every row as one flat list, for search */
export type Indexed = { category: Category; row: Row; title: string; hint?: string };
export function searchIndex(): Indexed[] {
  const out: Indexed[] = [];
  for (const entry of CATEGORIES) {
    for (const section of entry.sections) {
      for (const row of section.rows) {
        if (row.kind === "custom") continue;
        out.push({ category: entry, row, title: row.title, hint: row.hint });
      }
    }
  }
  return out;
}
