const FILES = import.meta.glob<string>("../../assets/app-logos/*.svg", { eager: true, import: "default", query: "?no-inline" });

export interface AppLogo {
  src: string;
  /** A bare mark set inside the tile rather than a whole tile that fills it. */
  padded?: boolean;
  /** The tile's own paint behind a mark that needs it. */
  background?: string;
  /** The mark's share of the tile when it isn't the usual 68%. */
  scale?: number;
}

const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIASES: Record<string, string> = {
  twitter: "x", xtwitter: "x", jira: "atlassian", confluence: "atlassian", shopify: "shopifymerchant",
  onepassword: "1password", apollo: "apolloio", gohighlevel: "highlevel",
};

const LOGOS = new Map<string, AppLogo>(Object.entries(FILES).map(([path, src]) => {
  const file = path.split("/").pop()!;
  const tile = file.endsWith(".tile.svg");
  return [key(file.replace(/(\.tile)?\.svg$/, "")), tile ? { src } : { src, padded: true }];
}));

/** The tile or brand mark we keep for an app, by its id or its name. */
export function appLogo(...names: Array<string | null | undefined>): AppLogo | undefined {
  for (const name of names) {
    if (!name) continue;
    const id = key(name);
    const found = LOGOS.get(ALIASES[id] ?? id);
    if (found) return found;
  }
  return undefined;
}
