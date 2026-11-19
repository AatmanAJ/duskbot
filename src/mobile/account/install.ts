import type { MobilePlatform } from "../platform";
import { createConnectionStore } from "../connection/connections";

export const INSTALLED_KEY = "dusk.mobile.installed";

const claims = new WeakMap<MobilePlatform, Promise<boolean>>();

/** True once, on the first launch of an install that holds no places: a new install, or the app deleted and installed
 * again. iOS deletes an app's UserDefaults (Capacitor Preferences) with it but keeps its Keychain items, so a sign-in
 * from before the delete can still be there; Android drops both unless a backup restores them. A phone updated from a
 * build without the marker keeps its places and is not a new install. */
export function claimFreshInstall(platform: MobilePlatform): Promise<boolean> {
  const existing = claims.get(platform);
  if (existing) return existing;
  const claim = (async () => {
    if (await platform.prefs.get(INSTALLED_KEY)) return false;
    const places = await createConnectionStore(platform).list().catch(() => []);
    await platform.prefs.set(INSTALLED_KEY, "1");
    return places.length === 0;
  })().catch(() => false);
  claims.set(platform, claim);
  return claim;
}
