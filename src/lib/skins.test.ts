import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_SKIN_IDS, LOOK_BASES, SKINS, SKIN_IDS, SKIN_SCHEME, DEFAULT_SKIN_CHOICE, PRIOR_INSTALL_SKIN, THEME_SKINS, readSkinChoice, resolveSkin, skinBase } from "./skins";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../styles.css"),
  "utf8",
);

const looksCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../styles/signal.css"),
  "utf8",
);

const blocks = new Set(
  [...css.matchAll(/\[data-skin="([a-z-]+)"\]/g)].map(([, id]) => id),
);

describe("skins", () => {
  it("gives every base skin a stylesheet block", () => {
    for (const id of BASE_SKIN_IDS) expect(blocks).toContain(id);
  });

  it("registers every stylesheet block", () => {
    for (const id of blocks) expect(BASE_SKIN_IDS).toContain(id as (typeof BASE_SKIN_IDS)[number]);
  });

  it("gives every look a palette over the skin it wears, with the same tokens as that skin", () => {
    const tokens = (body: string) => new Set([...body.matchAll(/(--color-[\w-]+)\s*:/g)].map(([, name]) => name));
    for (const [look, base] of Object.entries(LOOK_BASES)) {
      const body = looksCss.match(new RegExp(`:root\\[data-skin="${base}"\\]\\[data-look="${look}"\\]\\s*\\{([^}]*)\\}`))?.[1];
      expect(body, look).toBeDefined();
      const baseBody = css.match(new RegExp(`\\[data-skin="${base}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      expect([...tokens(baseBody)].filter((name) => !tokens(body!).has(name)), look).toEqual([]);
      expect(body).toContain(`--code-color-scheme: ${SKIN_SCHEME[look as keyof typeof LOOK_BASES]};`);
      expect(SKIN_SCHEME[look as keyof typeof LOOK_BASES]).toBe(SKIN_SCHEME[base]);
      expect(skinBase(look as keyof typeof LOOK_BASES)).toBe(base);
    }
    expect(skinBase("meadow")).toBe("meadow");
  });

  it("defines the same tokens in every skin", () => {
    const tokensOf = (id: string) => {
      const body = css.match(new RegExp(`\\[data-skin="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name));
    };
    const reference = tokensOf(PRIOR_INSTALL_SKIN);
    expect(reference.size).toBeGreaterThan(15);
    expect(reference).toContain("--color-composer-ring");
    for (const id of BASE_SKIN_IDS) {
      expect([...reference].filter((t) => !tokensOf(id).has(t))).toEqual([]);
    }
  });

  it("tints a hovered menu row with ink at 6% in Midnight, Daylight and Grok, and with raised at 70% in every other skin", () => {
    for (const id of BASE_SKIN_IDS) {
      const body = css.match(new RegExp(`\\[data-skin="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      const token = (name: string) => body.match(new RegExp(`(?:^|\\s)${name}:\\s*([^;]+);`))?.[1]?.trim();
      const expected = ["midnight", "daylight", "grok", "grok-dark"].includes(id)
        ? `${token("--color-ink")}0f`
        : "color-mix(in srgb, var(--color-raised) 70%, transparent)";
      expect(token("--color-menu-hover"), id).toBe(expected);
    }
  });

  it("selects a code-only light or dark palette in every nearest skin", () => {
    for (const id of BASE_SKIN_IDS) {
      const body = css.match(new RegExp(`\\[data-skin="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      expect(body).toContain(`--code-color-scheme: ${SKIN_SCHEME[id]};`);
    }
    expect(css).toMatch(/\.chat-md \.shiki\s*\{\s*color-scheme:\s*var\(--code-color-scheme\);\s*\}/);
  });

  it("keys a rule for every dark skin off the root's data-scheme, never off a list of them", () => {
    const dark = BASE_SKIN_IDS.filter((id) => SKIN_SCHEME[id] === "dark");
    const src = join(dirname(fileURLToPath(import.meta.url)), "..");
    const listed = (readdirSync(src, { recursive: true }) as string[])
      .filter((file) => file.endsWith(".css"))
      .flatMap((file) => [...readFileSync(join(src, file), "utf8").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, selector]) => dark.every((id) => selector.includes(`[data-skin="${id}"]`)))
        .map(([, , body]) => `${file}: ${body.trim().split("\n")[0]}`));
    // the menu's tokens sit on the skin's own element, wherever in the page it is, which the root's scheme cannot say
    expect(listed).toEqual(["styles.css: --radius-menu: 12px;"]);
  });

  it("adds Meadow without moving or replacing the original eight", () => {
    expect(SKIN_IDS).toContain("meadow");
    expect(SKIN_IDS.slice(0, 8)).toEqual([
      "midnight", "atelier", "foundry", "lagoon", "graphite", "linen", "dusk", "daylight",
    ]);
    expect(PRIOR_INSTALL_SKIN).toBe("midnight");
  });

  it("follows the computer between Signal and Signal Dark by default", () => {
    expect(DEFAULT_SKIN_CHOICE).toBe("system");
    expect(THEME_SKINS).toEqual({ light: "signal", dark: "signal-dark" });
    expect(resolveSkin("system", false)).toBe("signal");
    expect(resolveSkin("system", true)).toBe("signal-dark");
    expect(resolveSkin("meadow", true)).toBe("meadow");
    expect(resolveSkin("grok", true)).toBe("grok");
  });

  it("keeps Meadow's own bubble light, in the page's ink", () => {
    expect(css).not.toMatch(/@scope \(\[data-skin="meadow"\]\) to \(\[data-skin\]\)\s*\{\s*\.bg-bubble-user\s*\{/);
    expect(css).toMatch(/\[data-skin="meadow"\] \{[^}]*--color-bubble-user-ink: #0f1a13;/);
  });

  it("adds Pop after Meadow with its own inverted bubble and sticker scope", () => {
    expect(SKIN_IDS.slice(0, 9)).toEqual([
      "midnight", "atelier", "foundry", "lagoon", "graphite", "linen", "dusk", "daylight", "meadow",
    ]);
    expect(SKIN_IDS[9]).toBe("pop");
    expect(css).toMatch(/@scope \(\[data-skin="pop"\]\) to \(\[data-skin\]\)\s*\{\s*\.bg-bubble-user\s*\{/);
    expect(css).toMatch(/@scope \(\[data-skin="pop"\]:not\(\[data-skin-preview\]\)\) to \(\[data-skin\]\)/);
  });

  it("adds Halloween last of the base skins, dark, with its atmosphere kept off the picker miniature", () => {
    expect(BASE_SKIN_IDS.at(-1)).toBe("halloween");
    expect(SKINS.find((s) => s.id === "halloween")?.name).toBe("Halloween");
    expect(css).toMatch(/@scope \(\[data-skin="halloween"\]:not\(\[data-skin-preview\]\)\) to \(\[data-skin\]\)\s*\{\s*main\.bg-app\s*\{/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\[data-skin="halloween"\] main\.bg-app::before/);
  });

  it("describes each skin exactly once", () => {
    expect(SKINS.map((s) => s.id).sort()).toEqual([...SKIN_IDS].sort());
    for (const skin of SKINS) {
      expect(skin.name.length).toBeGreaterThan(0);
      expect(skin.tagline.length).toBeGreaterThan(0);
    }
  });
});

describe("the move to Signal", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("moves a pinned Light or Dark from Grok's look to Signal's once", () => {
    store.set("dusk-skin-grok", "1");
    store.set("dusk-skin", "grok-dark");
    expect(readSkinChoice()).toBe("signal-dark");
    store.set("dusk-skin", "grok");
    expect(readSkinChoice()).toBe("grok");
  });

  it("keeps any other pick", () => {
    store.set("dusk-skin-grok", "1");
    store.set("dusk-skin", "foundry");
    expect(readSkinChoice()).toBe("foundry");
    expect(store.get("dusk-skin-signal")).toBe("1");
  });

  it("starts a new install on the system's Signal look, with nothing left to move", () => {
    expect(readSkinChoice()).toBe("system");
    store.set("dusk-skin", "grok");
    expect(readSkinChoice()).toBe("grok");
  });
});
