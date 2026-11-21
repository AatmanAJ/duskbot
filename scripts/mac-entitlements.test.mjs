import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const plist = readFileSync(new URL("../build/entitlements.mac.plist", import.meta.url), "utf8");
const granted = (key) => new RegExp(`<key>${key.replaceAll(".", "\\.")}</key>\\s*<true/>`).test(plist);

describe("macOS entitlements", () => {
  // libffi in the x86_64 cua_driver_node_runtime.node (cua-driver 0.28.2) allocates its closures with plain mmap(PROT_EXEC),
  // which the hardened runtime refuses without this; it then retries forever on the main thread and the Intel app never opens
  it("let the Intel build's CUA runtime map executable memory", () => {
    expect(granted("com.apple.security.cs.allow-unsigned-executable-memory")).toBe(true);
  });

  it("keep the JIT and the grants the app already relies on", () => {
    for (const key of ["com.apple.security.cs.allow-jit", "com.apple.security.cs.disable-library-validation", "com.apple.security.device.audio-input"]) {
      expect(granted(key), key).toBe(true);
    }
  });
});
