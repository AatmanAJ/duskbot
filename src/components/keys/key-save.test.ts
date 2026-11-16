import { expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/state/store", async (importOriginal) => (await import("@/testing/store-mock")).withStoreHooks(await (async (original) => ({ ...await original<typeof import("@/state/store")>(), api }))(importOriginal)));
vi.mock("@/lib/product-events", () => ({ keyTestResult: () => "unverified" }));

import { checkKey } from "./key-save";

it("names a refused address instead of an unknown status", async () => {
  api.mockResolvedValueOnce({ ok: false, reason: "address" });
  const check = await checkKey("openaiCompat");
  expect(check.ok).toBe(false);
  expect(check.text).toContain("https");
  expect(check.text).not.toContain("?");
});
