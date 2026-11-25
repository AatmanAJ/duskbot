import { isMacPlatform, SHORTCUT_GROUPS, shortcutKeysForPlatform } from "@/lib/keyboard-shortcuts";

const shortcutItem = (id: string) => SHORTCUT_GROUPS.flatMap((group) => group.items).find((entry) => entry.id === id);

export function shortcutLabel(id: string): string | undefined {
  const item = shortcutItem(id);
  return item ? shortcutKeysForPlatform(item).join(" ") : undefined;
}

export function shortcutInText(id: string, isMac: boolean = isMacPlatform()): string | undefined {
  const item = shortcutItem(id);
  return item ? shortcutKeysForPlatform(item, isMac).join(isMac ? "" : "+") : undefined;
}

export function ShortcutHint({ id }: { id: string }) {
  const label = shortcutLabel(id);
  if (!label) return null;
  return <kbd aria-hidden="true" className="shrink-0 rounded border border-transparent px-1.5 py-0.5 font-sans text-[11px] leading-none text-ink-secondary">{label}</kbd>;
}
