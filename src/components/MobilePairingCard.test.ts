import { readFileSync } from "node:fs";
import en from "../locales/en.json";
import { describe, expect, it } from "vitest";

import type { MobileDevice } from "../../shared/mobile-link";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MobilePairingCard, newDeviceSince, platformLabelKey } from "./MobilePairingCard";

const device = (id: string, name = id): MobileDevice => ({
  id, name, platform: "ios", createdAt: 0, lastSeenAt: 0, expiresAt: 1, relay: false, push: null,
});

describe("mobile workspace pairing", () => {
  it("labels the native platforms and falls back to Phone", () => {
    expect(platformLabelKey("ios")).toBe("settings.mobile.ios");
    expect(platformLabelKey("android")).toBe("settings.mobile.android");
    expect(platformLabelKey("other")).toBe("settings.mobile.phone");
    expect(platformLabelKey("unknown")).toBe("settings.mobile.phone");
  });

  it("finds the first phone paired with an empty workspace", () => {
    const phone = device("new", "My phone");
    expect(newDeviceSince([], [phone])).toBe(phone);
  });

  it("detects a new id even when its name matches an existing phone", () => {
    const phone = device("new", "phone");
    expect(newDeviceSince(["old"], [device("old", "phone"), phone])).toBe(phone);
  });

  it("ignores reordering, renames and last-seen updates", () => {
    expect(newDeviceSince(["a", "b"], [
      { ...device("b", "Renamed"), lastSeenAt: 100 }, device("a"),
    ])).toBeNull();
  });

  it("does not mistake a revoked phone for a new pairing", () => {
    expect(newDeviceSince(["a", "b"], [device("b")])).toBeNull();
    expect(newDeviceSince(["a"], [])).toBeNull();
  });

  it("reports the first new phone when several arrive together", () => {
    const first = device("first");
    expect(newDeviceSince(["old"], [device("old"), first, device("second")])).toBe(first);
  });

  it("keeps the Mac companion out of remote workspace pairing", () => {
    const source = readFileSync(new URL("./MobilePairingCard.tsx", import.meta.url), "utf8");
    expect(source).toContain("const companion = remote ? null : companionBridge()");
    expect(source).toContain("request.companion = (await companion.start()).endpoints");
    expect(source).toContain('method: "POST", body: JSON.stringify(request)');
  });

  it("hands the phone page's pieces to server pairing, with the active workspace flag", () => {
    const source = readFileSync(new URL("./SettingsModal.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/pairing: <PhoneLinking remote=\{remoteActive\} cloudHome=\{cloudHome\} email=\{state\.config\?\.profile\?\.email\}>\{\(phone\) => <ServerPairingCard phone=\{phone\}/);
  });

  it("sends an iPhone to the App Store app, never to a Home Screen page the qr cannot open", () => {
    // the qr is a duskbot://pair link only the app opens: a phone without it gets nothing from the camera
    const words = en as Record<string, string>;
    for (const key of ["settings.mobile.scanSteps", "mobile.desktop.noStoreApp", "mobile.desktop.appStore"]) {
      expect(words[key]).toContain("App Store");
      expect(words[key]).not.toMatch(/home screen/i);
      expect(words[key]).not.toMatch(/not in the app store|app store and google play soon/i);
    }
    const source = readFileSync(new URL("./MobilePairingCard.tsx", import.meta.url), "utf8");
    expect(source).toContain('data-phone-app-store="" href={storeUrl("ios")}');
    expect(words["mobile.desktop.storesSoon"]).toBe("Google Play soon");
  });

  it("on a dusk cloud offers the App Store and the account sign-in, never a pairing code the cloud refuses", () => {
    const html = renderToStaticMarkup(createElement(MobilePairingCard, { remote: false, cloudHome: true, email: "owner@example.test" }));
    expect(html).toContain("data-phone-cloud");
    expect(html).toContain("Open the app and sign in with owner@example.test. Your cloud opens on its own, no code needed.");
    expect(html).toContain('href="https://apps.apple.com/app/id6834725640"');
    expect(html).toContain("QR code for dusk bot on the App Store");
    expect(html, "no qr or code tiles: createMobileLink refuses them on a cloud").not.toContain("data-pairing-tile");
    expect(html).not.toMatch(/home screen/i);
    const plain = renderToStaticMarkup(createElement(MobilePairingCard, { remote: false }));
    expect(plain).toContain("data-pairing-tile");
    expect(plain).not.toContain("data-phone-cloud");
  });
});
