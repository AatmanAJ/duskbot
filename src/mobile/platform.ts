import { createContext, useContext } from "react";
import type { MobileOpenTarget } from "../../shared/mobile-link";
import { friendlyError } from "@/lib/plain-error";
import type { GlassBridge } from "./native-glass";
import type { MenuBridge } from "./native-menu";

export type HapticKind = "light" | "soft" | "medium" | "selection" | "error" | "success";

export interface KeyboardFrame {
  /** Height the keyboard covers, in css px, 0 when hidden. */
  height: number;
  /** Starting to move (`will`) or settled (`did`). */
  phase: "will" | "did";
}

export interface ScanResult {
  text: string;
}

export interface AppleCredential { identityToken: string; authorizationCode: string; givenName?: string; familyName?: string }

export type CameraPermission = "granted" | "denied" | "prompt";

/** A live QR scan under our own viewfinder. Natively the camera draws behind a transparent WebView (the page adds
 * `mobile-scanning` to <html> while it runs); in a browser it plays into the given <video>. */
export interface CameraSession {
  stop(): Promise<void>;
  torch?: { set(on: boolean): Promise<void> };
  /** The system drew the whole scanner itself (iPhone, VisionKit): the page shows none of its own. */
  fullScreen?: boolean;
  /** A read code is being redeemed: a full screen scanner pauses and says so. */
  busy?(on: boolean, label?: string): void;
}

/** The page's words for a scanner the system draws full screen. */
export interface ScanOverlay {
  title: string;
  hint: string;
  close: string;
  torch: string;
  /** buttons under the viewfinder; `icon` is an SF Symbol */
  actions: { key: string; title: string; icon?: string }[];
}

export interface CameraScanner {
  permission(): Promise<CameraPermission>;
  request(): Promise<CameraPermission>;
  /** The OS settings page for this app, where a refused camera is turned back on. */
  openSettings?(): Promise<void>;
  start(options: {
    onCode: (text: string) => void;
    onError?: (message: string) => void;
    video?: HTMLVideoElement | null;
    overlay?: ScanOverlay;
    /** a button of the overlay, or "close" */
    onAction?: (key: string) => void;
  }): Promise<CameraSession>;
}

/** Everything the phone layer asks of the device. The native app supplies Capacitor plugins; the web preview and a
 * plain browser get the fallbacks in `webPlatform`. Capability flags, never user-agent guesses. */
export interface OrientationBridge {
  allowLandscape(on: boolean): void;
  rotate(to: "portrait" | "landscape"): void;
}

export interface MobilePlatform {
  kind: "ios" | "android" | "web";
  native: boolean;
  haptic(kind: HapticKind): void;
  /** Native keyboard events; absent where the visual viewport is the only signal. */
  onKeyboard?(listener: (frame: KeyboardFrame) => void): () => void;
  hideKeyboard?(): void;
  setStatusBar?(style: "dark" | "light"): void;
  /** Android's hardware back; return true when handled. */
  onBack?(listener: () => boolean): () => void;
  /** Links the OS hands the app: duskbot://pair, duskbot://open, the desktop's thread links. A listener returns
   * true when the link was its kind; the link that launched the app waits for the first listener that takes it. */
  onAppUrl?(listener: (url: string) => boolean): () => void;
  onResume?(listener: () => void): () => void;
  /** The app went to the background. */
  onPause?(listener: () => void): () => void;
  /** Non-secret key/value storage. */
  prefs: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  /** Keychain/Keystore. The web fallback keeps secrets in session memory only. */
  secrets: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  scanQr?(): Promise<ScanResult | null>;
  camera?: CameraScanner;
  readClipboard?(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  /** Closes the in-app browser sheet openExternal showed, if one is up. */
  closeBrowser?(): void;
  share?(data: { title?: string; text?: string; url?: string }): Promise<void>;
  /** Sign in with Apple through the system sheet (iPhone): Apple binds `nonceHash` (sha-256 hex) into the identity token.
   * Null when the person closed the sheet; throws when it failed. */
  appleSignIn?(nonceHash: string): Promise<AppleCredential | null>;
  /** Push registration; resolves the device token or null when refused or unsupported. Without `prompt` it never shows
   * the system's question: a phone not yet asked resolves null. */
  registerPush?(options?: { prompt?: boolean }): Promise<{ token: string; platform: "apns" | "fcm" } | null>;
  onNotificationOpen?(listener: (target: MobileOpenTarget) => void): () => void;
  /** The chat header and composer drawn in the OS's own glass, where the app has it. */
  glass?: GlassBridge;
  /** The system's own context menu over the page's items, where the app has it. */
  menu?: MenuBridge;
  /** The phone may turn sideways while a remote screen is open; everywhere else the app stays upright. */
  orientation?: OrientationBridge;
  deviceName(): string;
  appVersion: string;
}

const memorySecrets = new Map<string, string>();

function storageOf(kind: "localStorage" | "sessionStorage"): Storage | null {
  try { return globalThis[kind] ?? null; } catch { return null; }
}

export function webPlatform(): MobilePlatform {
  const local = storageOf("localStorage");
  return {
    kind: "web",
    native: false,
    haptic(kind) {
      // android chrome honours vibrate; ios safari ignores it, which is the honest answer for a browser
      const pattern = kind === "error" ? [12, 40, 12] : kind === "medium" ? 14 : kind === "selection" ? 4 : 8;
      try { navigator.vibrate?.(pattern); } catch {}
      if (import.meta.env.DEV) document.documentElement.dataset.lastHaptic = `${kind}:${Date.now()}`;
    },
    prefs: {
      get: async (key) => local?.getItem(key) ?? null,
      set: async (key, value) => { local?.setItem(key, value); },
      remove: async (key) => { local?.removeItem(key); },
    },
    secrets: {
      get: async (key) => memorySecrets.get(key) ?? null,
      set: async (key, value) => { memorySecrets.set(key, value); },
      remove: async (key) => { memorySecrets.delete(key); },
    },
    camera: typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia ? {
      async permission() {
        try {
          const result = await navigator.permissions?.query({ name: "camera" as PermissionName });
          return result?.state === "granted" || result?.state === "denied" ? result.state : "prompt";
        } catch { return "prompt"; }
      },
      async request() {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          for (const track of stream.getTracks()) track.stop();
          return "granted";
        } catch { return "denied"; }
      },
      async start({ onCode, onError, video }) {
        if (!video) throw new Error("video-required");
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const seen = new Set<string>();
        let stopped = false;
        let frame = 0;
        let lastScan = -Infinity;
        let detecting = false;
        const stop = async () => {
          if (stopped) return;
          stopped = true;
          cancelAnimationFrame(frame);
          for (const track of stream.getTracks()) track.stop();
          if (video.srcObject === stream) {
            video.pause();
            video.srcObject = null;
          }
        };
        try {
          video.muted = true;
          video.playsInline = true;
          video.autoplay = true;
          video.srcObject = stream;
          await video.play();
          type Detector = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };
          const BarcodeDetector = (globalThis as typeof globalThis & {
            BarcodeDetector?: { new(options: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> };
          }).BarcodeDetector;
          const formats = BarcodeDetector ? await BarcodeDetector.getSupportedFormats() : [];
          if (BarcodeDetector && formats.includes("qr_code")) {
            const detector = new BarcodeDetector({ formats: ["qr_code"] });
            const scan = (now: number) => {
              if (stopped) return;
              frame = requestAnimationFrame(scan);
              if (detecting || now - lastScan < 150 || video.readyState < 2) return;
              lastScan = now;
              detecting = true;
              void detector.detect(video).then((codes) => {
                for (const { rawValue } of codes) {
                  if (stopped) return;
                  if (typeof rawValue !== "string" || seen.has(rawValue)) continue;
                  seen.add(rawValue);
                  onCode(rawValue);
                }
              }).catch((error: unknown) => {
                if (!stopped) onError?.(friendlyError(error));
              }).finally(() => { detecting = false; });
            };
            frame = requestAnimationFrame(scan);
          } else {
            onError?.("unsupported");
          }
          const track = stream.getVideoTracks()[0];
          const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
          return {
            stop,
            torch: capabilities?.torch ? {
              async set(on) {
                if (!stopped) await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
              },
            } : undefined,
          };
        } catch (error) {
          await stop();
          throw error;
        }
      },
    } : undefined,
    async readClipboard() {
      try { return await navigator.clipboard?.readText() ?? null; } catch { return null; }
    },
    openExternal: async (url) => { window.open(url, "_blank", "noopener"); },
    share: typeof navigator !== "undefined" && "share" in navigator
      ? async (data) => { await navigator.share(data).catch(() => {}); }
      : undefined,
    deviceName: () => (/iphone/i.test(navigator.userAgent) ? "iPhone" : /android/i.test(navigator.userAgent) ? "Android phone" : "Phone browser"),
    appVersion: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev",
  };
}

export const PlatformContext = createContext<MobilePlatform | null>(null);

export function usePlatform(): MobilePlatform {
  const platform = useContext(PlatformContext);
  if (!platform) throw new Error("usePlatform outside the mobile root");
  return platform;
}
