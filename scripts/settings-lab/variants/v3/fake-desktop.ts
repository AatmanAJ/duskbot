// the few calls of the desktop app's preload bridge the settings panes make, so they draw their Mac version. keys
// live in memory; listening never starts (no microphone in the lab).
type Bridge = NonNullable<Window["duskDesktop"]>;
type VoiceKeys = Partial<Record<string, boolean>>;

const keys: VoiceKeys = { openai: true };

const bridge = {
  platform: "darwin",
  permStatus: async () => ({ mic: "granted", pageMic: "allowed" as const }),
  permRequestMic: async () => true,
  voiceInput: {
    keys: {
      status: async () => ({ ...keys }),
      set: async (provider: string) => { keys[provider] = true; },
      clear: async (provider: string) => { keys[provider] = false; },
    },
    start: async () => { throw new Error("The microphone isn't connected in the settings lab."); },
    audio: () => {},
    finish: async () => {},
    stop: async () => {},
    onTranscript: () => () => {},
    onEnd: () => () => {},
    findWhisperCpp: async () => ({ binaries: ["/opt/homebrew/bin/whisper-cli"], models: [] }),
  },
} as unknown as Bridge;

let before: Bridge | undefined;

/** v3 runs with this bridge; the shell and the other variants get the page's own (none) back */
export function claimDesktop(): () => void {
  if (window.duskDesktop !== bridge) {
    before = window.duskDesktop;
    window.duskDesktop = bridge;
  }
  return () => {
    if (window.duskDesktop === bridge) window.duskDesktop = before;
  };
}
