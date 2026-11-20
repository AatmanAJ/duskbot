import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import completeLocales from "@/lib/complete-locales.json";
import { en, isCompleteLocale, localeChoices } from "./index";

describe("complete languages", () => {
  it("are English and the listed packs; every other choice is shown as partly translated", () => {
    expect(isCompleteLocale("en")).toBe(true);
    expect(isCompleteLocale("de")).toBe(true);
    expect(isCompleteLocale("es")).toBe(true);
    expect(isCompleteLocale("fr")).toBe(false);
    expect(localeChoices.filter(({ code }) => !isCompleteLocale(code)).length).toBeGreaterThan(5);
  });

  it.each(completeLocales)("%s translates every English string", (code) => {
    const pack = JSON.parse(readFileSync(new URL(`./${code}.json`, import.meta.url), "utf8")) as Record<string, string>;
    expect(Object.keys(en).filter((key) => !Object.hasOwn(pack, key))).toEqual([]);
  });
});
