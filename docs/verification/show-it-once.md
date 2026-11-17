# Show it once

A person presses **Record**, does a task once in the bot's browser, and the bot
keeps it as a skill with named blanks. `skill_replay` then repeats it, once or
once per input file in a folder, and hands the rest back to the bot's normal
browsing when a step no longer matches the page.

## The automated checks

```sh
pnpm exec vitest run server/demo-recorder server/host/show-it-once.test.ts \
  server/host/skill-replay-turn.test.ts server/routes/demo-recorder.test.ts \
  src/components/DemoRecorder.dom.test.ts
```

They run against the fake expense portal in
`server/demo-recorder/testing/expense-portal.ts` (a table-laid-out form with
generated ids, a sign-in, a review page and a file field) and the twelve
expenses under `server/testing/fixtures/expense-portal/inbox`:

1. `server/demo-recorder/page-script.test.ts`: the page script names each
   element by role, accessible name, nearby label and group, and never reads a
   password, a one-time code or a card field, including a field that was a
   password and was switched to text.
2. `server/demo-recorder/normalise.test.ts` and
   `server/demo-recorder/normalise-keys.test.ts`: stray clicks, scrolling,
   retyping, focus moving about, redirects and the button click a browser
   reports with Enter make no step; a sign-in becomes one step with no value.
3. `server/demo-recorder/compile.test.ts`: values become blanks, one engine
   pass names them, and a failed or malformed pass falls back to the page's own
   labels.
4. `server/demo-recorder/show-it-once.test.ts`: record one expense, save it,
   replay the other eleven from their files; a page that no longer matches stops
   the run at that step and reports what is left.
5. `server/demo-recorder/secrets.test.ts`: the password typed while recording
   is absent from the drained events, the draft, the logs, the naming prompt,
   the skill files and the replay's result; replay signs in through the Vault.
6. `server/demo-recorder/show-it-once.e2e.test.ts` does the same in a real
   Chrome with real mouse and key events. It runs with
   `DUSK_CDP_CHROME=<chrome executable>` (or `DUSK_CDP_E2E=1` for the installed
   Google Chrome) and skips without one; CI runs it in the browser driver job
   on macOS, Windows and Linux.

## By hand, in the real app

`scripts/verify-show-it-once.ts` starts a disposable fixture: the server with
the fake engine, the app's own renderer, the fake portal and a bot named Tally
whose working folder holds an `Expenses` folder. Nothing touches your own
dusk bot data.

```sh
pnpm build:browser
DUSK_VERIFY_BROWSER_BINARY=<agent-browser binary under dist-native/browser> \
DUSK_VERIFY_BROWSER_CHROME=<its chrome-headless-shell> \
  node --experimental-strip-types scripts/verify-show-it-once.ts
```

It prints `previewUrl`, the portal's address and its sign-in. Open
`previewUrl`, then:

1. Open Tally's conversation and send `Open the expense portal`.
2. Open Tally's profile, the **Computer** tab, and press **Record**. The
   browser opens big, the list on the right says Recording, and the first step
   is the portal's address.
3. Sign in with the printed user and password. The list shows one step,
   "Sign in to 127.0.0.1 with your saved login", marked Vault, and no step
   holds the password.
4. Choose New expense report and fill it in from
   `server/testing/fixtures/expense-portal/inbox/expense-01.json`, then
   Continue and Submit report. Each field becomes one step, named by its label.
5. Press **Stop**. Every value is now a named blank. Name the task
   `File an expense report`, rename a blank, delete a step and put it back by
   recording again if you like, then **Save as skill**.
6. Go back to the panel and send `Do the other 11 from this folder`. The
   fixture's model calls `skill_replay` with the folder; the portal's list ends
   with twelve reports, and stopping the launcher prints what was filed.

The file field cannot be demonstrated in this view on the default engine (its
file picker belongs to the page), so a live recording has no receipt step. The
automated checks cover uploads.

## What the server exposes

- `GET /api/bots/ID/demo-recording` returns the draft; `POST` to
  `/api/bots/ID/demo-recording/start`, `/stop`, `/discard`, `/save`, `/title`
  and `/blanks`, and `PATCH` or `DELETE` on
  `/api/bots/ID/demo-recording/steps/STEP` edit it. All are admin routes
  (`server/routes/demo-recorder.ts`).
- `POST /api/internal/skill-replay` is the bot's `skill_replay` tool
  (`server/routes/skill-replay.ts`, `server/host/skill-replay-turn.ts`).
- Starting answers `not-held` unless the person holds the browser, and the
  recording ends when they hand it back (`server/host/show-it-once.ts`).
