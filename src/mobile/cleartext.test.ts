import { describe, expect, it, vi } from "vitest";
import { cleartextAllowed, CleartextRefused, guardCleartext } from "./cleartext";

describe("cleartextAllowed", () => {
  it("allows the hosts a computer is paired over", () => {
    for (const host of ["192.168.1.20", "10.0.0.5", "100.101.102.103", "[fe80::1]", "localhost", "macbook.local", "MacBook.Local.", "mac.tail1234.ts.net", "127.0.0.1"]) {
      expect(cleartextAllowed(host), host).toBe(true);
    }
  });

  it("refuses public names", () => {
    for (const host of ["dusk.bot", "example.com", "local", "ts.net", "evil.ts.net.example.com", "mac..local", "localhost.example.com", "1.2.3.4.example.com"]) {
      expect(cleartextAllowed(host), host).toBe(false);
    }
  });
});

describe("guardCleartext", () => {
  const base = () => "https://localhost/";
  const ok = () => vi.fn(async () => new Response("ok"));

  it("refuses http to a public name without sending", async () => {
    const send = ok();
    await expect(guardCleartext(send, base)("http://example.com/api/pair")).rejects.toBeInstanceOf(CleartextRefused);
    await expect(guardCleartext(send, base)(new Request("http://dusk.bot/x"))).rejects.toBeInstanceOf(TypeError);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends https, relative and local http requests unchanged", async () => {
    const send = ok();
    const guarded = guardCleartext(send, base);
    await guarded("https://dusk.bot/v1/x");
    await guarded("/api/health");
    await guarded("http://192.168.1.20:8787/api/pair", { method: "POST" });
    await guarded("http://mac.tail1234.ts.net:8787/api/health");
    expect(send).toHaveBeenCalledTimes(4);
    expect(send).toHaveBeenCalledWith("http://192.168.1.20:8787/api/pair", { method: "POST" });
  });
});
