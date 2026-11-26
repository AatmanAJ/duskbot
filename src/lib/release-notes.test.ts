import { describe, expect, it } from "vitest";
import { notesForUpdate, updatedFrom } from "./release-notes";
import { parseChangelog } from "../../shared/release-notes";

function memory(): Storage {
  const map = new Map<string, string>();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value), removeItem: (key) => void map.delete(key), clear: () => map.clear(), key: () => null, get length() { return map.size; } };
}

describe("the line after an update", () => {
  it("comes once per update, never on a first install or a downgrade", () => {
    const store = memory();
    expect(updatedFrom("desktop", "0.2.31", store)).toBeNull();
    expect(updatedFrom("desktop", "0.2.31", store)).toBeNull();
    expect(updatedFrom("desktop", "0.2.32", store)).toBe("0.2.31");
    expect(updatedFrom("desktop", "0.2.32", store)).toBeNull();
    expect(updatedFrom("desktop", "0.2.30", store)).toBeNull();
    expect(updatedFrom("desktop", "dev", store)).toBeNull();
    expect(updatedFrom("desktop", "0.2.33", null)).toBeNull();
  });

  it("keeps each surface apart", () => {
    const store = memory();
    updatedFrom("desktop", "0.2.31", store);
    expect(updatedFrom("phone", "1.2.12", store)).toBeNull();
    expect(updatedFrom("phone", "1.2.13", store)).toBe("1.2.12");
  });

  it("has nothing to say when the changelog has nothing for this surface", () => {
    const releases = parseChangelog({ releases: [{ version: "0.2.32", items: [{ text: "phone only", area: "phone" }] }] });
    expect(notesForUpdate(releases, ["desktop"], "0.2.31", "0.2.32")).toEqual([]);
    expect(notesForUpdate([], ["desktop"], "0.2.31", "0.2.32")).toEqual([]);
    expect(notesForUpdate(releases, ["phone"], "0.2.31", "0.2.32").map((release) => release.version)).toEqual(["0.2.32"]);
  });
});
