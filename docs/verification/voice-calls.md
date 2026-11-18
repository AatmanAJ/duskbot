# Voice calls with the built-in voice

A call from a chat's composer with no key or account: the page's microphone
(echo-cancelled by Chromium, so the person can talk over the bot), a turn
detector in the page, Moonshine base hearing on the harness, the bot's normal
turn (marked `via: "call"` with the call's id, and told its reply is spoken),
and Kokoro-82M speaking the reply as it streams. The models (about 160 MB) download
on the first call into the computer's cache (`server/local-voice/models.ts`),
from pinned revisions, resumable and hash-checked.

## Sub-features

- `GET /api/voice/local` says whether the runtime loads here, the download's
  progress, and the voices; `POST /api/voice/local/prepare` downloads and warms;
  `POST /api/voice/local/speak` answers a WAV; `POST /api/voice/local/transcribe`
  takes a WAV of one spoken turn.
- A line said on a call carries `voiceCall: { callId }`; the route turns it into
  `via: "call"` and puts the spoken-reply note before the prompt.
- The call bar: the bot, a waveform (bars for whoever talks, dots in silence),
  voice and speed, transcript, mute, hang up. Without the transcript the chat
  steps back behind the bot.
- Talking over the bot dips it at once and stops it after a further 160 ms of
  voice; a short noise only dips it. A turn that ends on "and", "um" and the
  like waits 900 ms for the rest.

## Recipe

```sh
DUSK_VITEST_WORKERS=2 pnpm exec vitest run server/local-voice server/routes/local-voice.test.ts server/routes/bot-messages.test.ts src/lib/voice-call
# the real models, once downloaded (any DUSK_VOICE_MODELS_DIR that holds them):
DUSK_VOICE_MODELS_DIR=~/Library/Caches/bot.dusk.app/voice pnpm exec vitest run server/local-voice/engine.e2e.test.ts
```

By hand, a whole call in headless Chromium with a WAV as the microphone:

```sh
# terminal 1 (DUSK_VOICE_MODELS_DIR crosses into the fixture)
DUSK_VOICE_MODELS_DIR=~/Library/Caches/bot.dusk.app/voice FAKE_CLAUDE_STREAM_CADENCE=10:30 \
  FAKE_CLAUDE_REPLIES='["You have two meetings tomorrow."]' \
  node --experimental-strip-types scripts/control-dusk.ts ui launch --tool-calls '[]'
# terminal 2: Chromium with --use-fake-ui-for-media-stream --use-fake-device-for-media-stream
# --use-file-for-fake-audio-capture=<16-bit WAV: silence, a question, long silence>, microphone permission granted;
# open previewUrl, click [data-call-button="composer"], read [data-voice-call] for the phase and
# [data-turn-ms] for endpoint,transcribed,sent,firstAudio in ms after the person stopped.
```

Expected: the phase goes connecting, listening, hearing, thinking, speaking,
listening; the chat shows the question "Via call" and the reply.

## Gotchas

- The UI preview does not reload code from a worktree under `.claude/`
  (vite.config.ts ignores it): restart `ui launch` after a change.
- `echoCancellation: "all"` gave pure silence in headless Chromium 151; the
  call asks plain `true`.
- Playwright's video has no sound; listen to the voice through the samples.

## Last exercised

2026-11-19, macOS on an M5 Pro, headless Chromium 151, fake engine: two turns
answered with first audio 1,211 ms and 1,158 ms after the person stopped
(580 ms of that is the end-of-turn pause, about 60 ms hearing). Kokoro speaks
a short sentence in about 150 ms and six seconds of speech in about 500 ms;
Moonshine hears 3.7 s in about 70 ms.
