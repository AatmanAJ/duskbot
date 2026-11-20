import { createContext } from "react";
import type { KeyId } from "./key-catalog";

/** A key just saved is "checking" until the provider answers the key check, then "failed" or, once it works, null. */
export type KeyCheckState = "checking" | "failed";

/** Where a key row tells the AI grid around it how its key's check is going, so the grid never calls an AI connected
 * on a key nobody has checked. A check still running when its row closes reports when it ends. */
export const KeyCheckReport = createContext<((id: KeyId, state: KeyCheckState | null) => void) | null>(null);
