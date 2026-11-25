# Product analytics

The desktop app shares anonymous usage information to help improve dusk bot, but only once it has signed in to a dusk
bot account: signing in is when a person agrees to the terms and privacy policy, and nothing is sent from the apps
before that. **Help improve dusk bot** covers usage counts and crash reports. It is on by default (an opt-out), except
where the account service places the person in the EU, the EEA, the UK or Switzerland, or cannot place them
(`cookieless` in `apps/dashboard/server/analytics/context.ts`): there it reads off until they turn it on.

**Session notes** are separate and need a yes. When a chat goes badly, after a long session and once a week, the
person's own AI reads a few recent messages where the bots run (at most the last 12 or 14 of that chat, or for the
weekly note the last 6 of each of the 12 most recent chats), writes a short note on that machine using a little of
their AI plan, and only the scrubbed note is sent. Notes run only while help improve is on too. They are stored with no
account and no workspace, under a hash of a random id only the workspace knows, and kept 30 days.

Both switches are in Settings, Privacy, and on the account page. Turning either off stops it, clears anything still
queued and deletes what was already sent (records by account and workspace, notes by the ids the workspace kept).

## Asking about session notes

Nobody is asked at sign-in. The desktop app asks once, with a card, when the person has really started using dusk bot
(`REAL_USE_TURNS` finished turns with a reply over `REAL_USE_DAYS` days, or one routine that ran and worked, in
`server/usage-signals-switch.ts`), notes are off, and they never answered, on any device. It shows on app open or after
a reply finishes, never while a bot is working. Showing the card records "no"; "Share session notes" turns them on.

An earlier setting can carry over: the account service reads `DUSK_NOTES_CARRY_OVER` (a file of account ids, one per
line) once and keeps notes on for those accounts until they answer themselves; a carried-over setting goes off the
first time the account reports from the EU, the EEA, the UK or Switzerland. A person's own answer always wins.

## See what's been shared

The workspace keeps what it sent in `usage-shared.json` (0600) for 30 days: each note as sent, and per kind (turn
records, routine runs, setup counts, named events) how many and when last. "Delete all" clears it at once and queues
the note ids and a delete of this workspace's records; the queue rides the next reports (`usageForget`), or the app's
notes request for a workspace no account dashboard hears from, until the account service took it.

There is no third-party analytics SDK. Everything below goes to the dusk bot account service, the same service your
sign-in uses.

## Before sign-in

An app or workspace that has never signed in sends nothing: no app events, no usage records, no notes on how sessions
went, no "how things went" events and no crash reports. It does not write session notes either, so it uses none of the
person's AI plan for them. Nothing is queued for later: events from before the first sign-in are dropped, never sent
once it happens.

- The desktop app records when it first signed in (`signedInAt` in `desktop-prefs.json`). Its main process drops every
  page event and every event of its own stamped before then, and crash reports start only after it.
- A workspace starts recording once the account service answers a report for it, which happens only for a workspace
  linked to an account (`account` in `usage-signals.json`). Notes left from before are dropped at start.
- A page with no relay through the desktop's main process (the phone app, another server's page in the desktop
  window) sends only with a signed-in account's token.

The switch in Settings shows on before sign-in too; it just has nothing to send yet.

## What help improve covers

It controls three things:

- **App events**: the small events listed below, sent by the desktop app. The phone app sends none: it has no switch
  of its own yet, and nothing there counts as on.
- **Usage records**: one record per bot turn and routine run, plus a count snapshot of what is set up, sent by your
  workspace with its regular report. Every value is a word from a fixed list, a count or a time (for example, the
  engine family `claude`, the tool kind `browser`, or a connector slug such as `gmail`). Bot, chat and routine ids are
  hashed with a salt that never leaves your computer.
- **Crash reports** from the desktop app, in builds that name a crash report endpoint: the error's type, message,
  stack and page path.

Message text, prompts, file contents, URLs, tool arguments, keys, names and email addresses are never sent. Free text
is dropped on your device before anything leaves it, and the account service drops anything outside its allowlist
again on arrival.

## When it is sent

Events are queued in memory and sent in batches of at most 50, about every 30 seconds, when the window is hidden and
when the app closes. The desktop app hands its batches to its own main process, which adds your account's event
token and posts them. A batch that fails is retried once. Turning the switch off clears anything still queued.

Each batch carries a random install id (kept in the app's local storage), a random id for this launch, the platform
and the app version. Every batch is from an app that has signed in, so the install is linked to that account.

## Events

| Event | Properties | When |
| --- | --- | --- |
| `app_open` | `kind` (desktop or mobile), `platform`, `appVersion` | once per launch |
| `app_close` | `ms`, how long the app was open | when the window closes |
| `app_screen` | `screen`, the page path with ids, numbers and long parts replaced by `:id` and no query string | when you move to another page |
| `app_feature` | `feature`, one word from a fixed list (`bot_created`, `routine_ran`, `chat_opened`, `voice_used` and so on) | when you use one of those features |
| `app_messages` | `sent`, `replies`, `latencyMs` (the median time to a first reply) | counts, folded into each batch |
| `app_error` | `kind`, `code`, both single words | a window error or unhandled rejection, without its message or stack |
| `app_pair_failed` | `reason`, a single word such as `expired_code` or `network` | pairing a phone fails |
| `app_action` | `name`, plus up to eight properties that are each a single word, a count or true/false | a button or step such as the setup environment (`env`: OS, architecture, language, screen size bucket, theme, skin, notification permission, hour of day) |
| `app_feedback` | `score` (1 to 5), `moment`, a single word | you answer the short feedback prompt |

## Turning it off

Turn off **help improve dusk bot** in Settings, Privacy, or on the account page. The desktop app, its background
server (usage records) and its crash reports all follow the same switch, and stop at once. Session notes stop with it. A server you run yourself can also be kept off with `DUSK_USAGE_SIGNALS=off`, and a desktop build's
crash reports with `DUSK_ERROR_REPORTS=0`.

Bot usage, cost accounting, server logs and diagnostics stay available in the app and on your server whether the
switch is on or off.
