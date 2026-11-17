import { PANEL_TABS, type PanelTab } from "@/components/bot-panel/page-registry";

const kind = () => globalThis.document?.documentElement?.dataset?.mobileApp;

/** The phone app installed from the App Store or Google Play (mountMobile marks <html data-mobile-app> from the native
 * platform, never from a setting). App Store guideline 3.1.1 and Play's payments policy: it shows no plan, price,
 * upgrade or link to buy, anywhere. */
export function storeApp(): boolean {
  const value = kind();
  return value === "ios" || value === "android";
}

/** Inside the phone app's own shell (installed, or its web preview), not a narrow desktop window. */
export function phoneApp(): boolean {
  return Boolean(kind());
}

/** Every app shows a bot's screen view and computer, the iPhone included. Known open
 * risk: App Store review may read it as a remote view of a computer under guideline 4.2.7. */
export function screenViewAllowed(): boolean {
  return true;
}

/** The bot and room panel tabs this app shows. */
export function panelTabs(): readonly PanelTab[] {
  return screenViewAllowed() ? PANEL_TABS : PANEL_TABS.filter((tab) => tab !== "computer");
}
