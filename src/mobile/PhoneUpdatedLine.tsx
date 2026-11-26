// After the phone app updated: "Updated to 1.2.12" with What's new, once, when the changelog has lines for the phone. The
// app's own version (1.2.x) is not a release's (0.2.x), so the notes are the releases since the last ones this phone said.
import { useEffect, useState } from "react";
import { Toast } from "@/components/ui/Toast";
import { t } from "@/lib/i18n";
import { PHONE_AREAS, loadReleases, notesForUpdate, updatedFrom } from "@/lib/release-notes";
import { usePlatform } from "./platform";

const RELEASE_KEY = "dusk-whats-new:phone-release";

export function PhoneUpdatedLine({ onOpen }: { onOpen: () => void }) {
  const platform = usePlatform();
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!updatedFrom("phone", platform.appVersion)) return;
    let active = true;
    void loadReleases({ native: platform.native }).then((all) => {
      const newest = all[0]?.version;
      if (!active || !newest) return;
      let said: string | null = null;
      try { said = localStorage.getItem(RELEASE_KEY); localStorage.setItem(RELEASE_KEY, newest); } catch { /* says the newest only */ }
      const notes = notesForUpdate(all, PHONE_AREAS, said, newest).filter((release) => said || release.version === newest);
      if (notes.length) setVersion(platform.appVersion);
    });
    return () => { active = false; };
  }, [platform.appVersion, platform.native]);
  if (!version) return null;
  return <Toast text={t("updates.updated", { version })} onDone={() => setVersion(null)}
    action={{ label: t("whatsNew.title"), onClick: () => { setVersion(null); onOpen(); } }} />;
}
