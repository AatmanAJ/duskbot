import { createContext, type ComponentType } from "react";
import type { Bot } from "@/state/store";

/** The model row a host draws in place of the panel's own, as the phone draws its settings row and a picker sheet. */
export const ModelRowSlot = createContext<ComponentType<{ bot: Bot }> | null>(null);
