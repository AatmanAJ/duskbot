/** Every sheet the phone shell can show. One at a time; a sheet's inner pages navigate inside it. */
export type MobileSheet =
  | { kind: "profile"; id: string }
  | { kind: "computer"; botId: string }
  | { kind: "settings"; page?: string }
  | { kind: "notifications" }
  | { kind: "search" }
  | { kind: "create" }
  | { kind: "routines"; botId?: string }
  | { kind: "connectors" }
  | { kind: "vault" };

export type OpenSheet = (sheet: MobileSheet) => void;
