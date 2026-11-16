// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { chooseAccountOrigin, chosenAccountOrigin, environmentName, PREVIEW_ORIGIN, PRODUCTION_ORIGIN } from "./environment";
import { mobileAccountOrigin } from "./AccountGate";
import { placeLine } from "../sheets/SettingsSheet";

const memory = () => { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) }; };
beforeEach(() => { vi.stubGlobal("localStorage", memory()); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("a store build signs in to dusk.bot unless someone testing chose the preview stack, and can go back", () => {
  const store = memory();
  expect(chosenAccountOrigin(store)).toBe(PRODUCTION_ORIGIN);
  chooseAccountOrigin(PREVIEW_ORIGIN, store);
  expect(chosenAccountOrigin(store)).toBe(PREVIEW_ORIGIN);
  chooseAccountOrigin(PRODUCTION_ORIGIN, store);
  expect(chosenAccountOrigin(store)).toBe(PRODUCTION_ORIGIN);
});

it("the native app follows that choice, and a build's configured origin still wins", () => {
  expect(mobileAccountOrigin(true, new URLSearchParams())).toBe(PRODUCTION_ORIGIN);
  chooseAccountOrigin(PREVIEW_ORIGIN);
  expect(mobileAccountOrigin(true, new URLSearchParams())).toBe(PREVIEW_ORIGIN);
  vi.stubEnv("VITE_DUSK_ACCOUNT_ORIGIN", "https://configured.example");
  expect(mobileAccountOrigin(true, new URLSearchParams())).toBe("https://configured.example");
});

it("names every stack but dusk.bot's own, so a linked place says which servers it is on", () => {
  expect(environmentName(PRODUCTION_ORIGIN)).toBeNull();
  expect(environmentName(PREVIEW_ORIGIN)).toBe("Preview");
  expect(environmentName("http://127.0.0.1:9000")).toBe("127.0.0.1:9000");
  const cloud = { origin: "https://dbe8ba878381340a6f57a.dusk.bot" };
  expect(placeLine(cloud, null)).toBe("dusk cloud");
  expect(placeLine(cloud, "Preview")).toBe("dusk cloud · Preview");
  expect(placeLine({ origin: "https://192.168.1.4:5331" }, null)).toBe("Computer");
});
