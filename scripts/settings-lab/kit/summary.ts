import { CATEGORIES, PROVIDERS, type Values } from "./model";
import type { ConnectState } from "./store";

/** the one short value a category shows on its row or card, so you can see the state without opening it */
export function summary(id: string, values: Values, providers: Record<string, ConnectState>, apps: Record<string, ConnectState>): string {
  switch (id) {
    case "you": return "Sidd";
    case "look": return CATEGORIES[1]!.sections[0]!.rows.flatMap((row) => (row.kind === "select" && row.id === "theme" ? row.options : [])).find((option) => option.value === values.theme)?.label ?? "";
    case "ai": {
      const on = PROVIDERS.filter((provider) => providers[provider.id] === "on");
      return on.length === 0 ? "Connect one" : on.length === 1 ? `${on[0]!.name}` : `${on.length} connected`;
    }
    case "apps": return `${Object.values(apps).filter((state) => state === "on").length} connected`;
    case "voice": return values.talk ? "Hold Fn" : "Off";
    case "notifications": return values.notify ? "On" : "Off";
    case "devices": return "This Mac";
    case "privacy": return "4 in vault";
    case "plan": return "Free";
    case "help": return "1.42.0";
    default: return "";
  }
}
