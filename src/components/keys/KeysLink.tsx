import { useDispatch } from "@/state/store";
import { t } from "@/lib/i18n";
import type { KeyId } from "./key-catalog";
import { openKeySettings } from "./key-focus";

export function KeysLink({ id, purpose }: { id: KeyId; purpose?: KeyId }) {
  const dispatch = useDispatch();
  if (typeof window !== "undefined" && window.duskDesktop?.remoteClient?.active === true) return null;
  return (
    <button type="button" data-keys-link={purpose ?? id} onClick={() => dispatch(openKeySettings(id, purpose))}
      className="cursor-pointer font-medium text-accent-text hover:underline">
      {t("keys.openPage")}
    </button>
  );
}
