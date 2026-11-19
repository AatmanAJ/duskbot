import { createLocalVoiceRoutes } from "../routes/local-voice.ts";
import type { RouteHandler } from "../routes/table.ts";
import { isBuiltInVoice, loadOrt, LocalVoiceEngine, DEFAULT_VOICE } from "./engine.ts";
import { ModelStore } from "./models.ts";
import { onBattery, startPrefetch } from "./prefetch.ts";

export function localVoiceRoutes({ busy, prefetch, models = new ModelStore() }: {
  busy: () => boolean;
  /** Fetch the models in the background while nothing is going on (the desktop app's own harness, a Cloud). */
  prefetch: boolean;
  models?: ModelStore;
}): RouteHandler {
  const engine = new LocalVoiceEngine(models);
  const halves = () => ({ hear: models.ready("hear"), speak: models.ready("speak") });
  if (prefetch && process.env.DUSK_VOICE_PREFETCH !== "0" && !process.env.VITEST) {
    void loadOrt().then((ort) => {
      if (ort) startPrefetch({ models, busy, onBattery: () => onBattery(), warm: () => engine.warm(halves()) });
    });
  }
  return createLocalVoiceRoutes({
    available: async () => Boolean(await loadOrt()),
    status: () => models.status(),
    prepare: async () => {
      await engine.warm(halves());
      await models.ensure();
      await engine.warm();
    },
    speak: (text, voice, speed) => engine.speak(text, isBuiltInVoice(voice) ? voice : DEFAULT_VOICE, speed),
    transcribe: (samples) => engine.transcribe(samples),
  });
}
