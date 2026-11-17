# Media for "notifications: a bot decides whether a message dings"

Kept on this branch so the pull request's diff stays code only. Delete the branch once the PR is merged or closed.

- Every app frame is the real renderer on an isolated `control-dusk ui launch` fixture (fake engine, a temporary data folder), at 2x.
- The bot's replies and its `set_notification_sound` calls are scripted through the fake engine.
- `notify-frames.json` holds the three live `notify` frames from `/api/events`: the two routine receipts carry `silent: true` and the flight alert does not.
- `renderer-spy-log.json` is what the page did. `Notification` and `HTMLMediaElement.play` were replaced by recorders, and the log shows a banner for each notice and one chime (`chime-b.wav`), for the alert only.
- Labels, captions and the "what your computer did" panel are drawn on top in the dusk bot brand: the dusk-sea background with General Sans, Geist Mono and Pixelify Sans from `apps/site`.
- The Settings frames used a stand-in desktop bridge (`platform: darwin`), so the desktop-only "System sound" choice shows.
