import { lazyScreen } from "../lazy-screen";

export const ConnectAiDialog = lazyScreen("ConnectAiDialog", async () => (await import("./ConnectAi")).ConnectAiDialog);
