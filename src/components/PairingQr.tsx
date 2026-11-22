import { lazyScreen } from "./lazy-screen";

export const PairingQr = lazyScreen("PairingQr", async () => (await import("qrcode.react")).QRCodeSVG);
