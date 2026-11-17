# Notification sounds: quiet receipts, loud asks

A bot chooses with `set_notification_sound` whether the notice for its turn's
reply makes a sound. Without a choice, a reply to the person dings and a
routine or webhook run's notice goes quietly (`silent: true` on the live
`notify` frame). Approvals, questions, sign-ins, secrets and failures always
ding. Each device's **Play sound for notifications** setting (Let the bot
decide, Always, Never) has the last word.

## Automated

```sh
pnpm exec vitest run server/notification-sound.e2e.test.ts server/notification-sound.test.ts \
  server/harness/status-calls.test.ts src/lib/notify.test.ts src/lib/notification-preferences.test.ts src/lib/ui-sounds.test.ts
node --test electron/desktop-notifications.node-test.mjs
```

The e2e file drives the real server and Claude driver with the fake engine
calling `mcp__agents__set_notification_sound`, and reads the `notify` frames
from `/api/events`.

## In the real renderer

Script two turns, the first quiet and the second loud, and launch the UI
fixture ([Chat UI, driven headlessly](chat-ui.md)):

```sh
FAKE_CLAUDE_REPLY_STATE=/tmp/sound-state \
FAKE_CLAUDE_REPLIES='["Overnight backup finished: 214 files copied, no errors.","The 9:05 flight dropped to $212. Book it?"]' \
FAKE_CLAUDE_TOOL_CALLS_BY_TURN='[[{"name":"mcp__agents__set_notification_sound","input":{"sound":"quiet"},"ok":true}],[{"name":"mcp__agents__set_notification_sound","input":{"sound":"ding"},"ok":true}]]' \
node --experimental-strip-types scripts/control-dusk.ts ui launch
```

The fake engine reuses its last list of tool calls past the end of
`FAKE_CLAUDE_TOOL_CALLS_BY_TURN`, so a third turn also calls `ding`.

1. With `ui eval`, replace `window.Notification` with a class that records
   each banner (with `permission = "granted"`), wrap
   `HTMLMediaElement.prototype.play` to record each chime, and make
   `document.hasFocus` return false so a reply in the open chat still notifies.
2. Start a routine for the bot (`POST /api/routines`, then
   `POST /api/routines/<id>/run`). Expected: one `notify` frame with
   `silent: true`, and one banner recorded with no chime.
3. Send a message in the composer. Expected: a frame without `silent`, a banner
   and one chime (`chime-b.wav`).
4. In Settings, General, set **Play sound for notifications** to Always and
   run the routine again. Expected: it chimes.

Not covered here: the OS's own sound and its Do Not Disturb (macOS Focus,
Windows Do Not Disturb, GNOME and KDE), the phone's push, and Linux's
Do Not Disturb probe on a real desktop. Unit tests cover their payloads.
