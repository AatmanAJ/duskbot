import { lazyScreen } from "../lazy-screen";

export const ShareBotDialog = lazyScreen("ShareBotDialog", async () => (await import("./ShareBotDialog")).ShareBotDialog);
