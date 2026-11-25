# Teach a task: show a bot once in its browser

The person records a task in a bot's browser, reviews the steps and hands them to the bot, which writes a skill
through the usual skill-authoring turn (`skill_manage`, with its approval and Undo). Ways in: **Teach {bot} a task**
under the Computer tab's browser, the browser panel's ⋮ menu, ⌘K "teach", and **Skills → Teach by showing**.

## What is recorded

- A click: the role and accessible name of what was clicked (`button “Find tea”`), read in the page at the click.
- Typing: the text, into the field it went to. Nothing typed into a password, one-time code or card field, into the
  panel's **Type a password or code** box, or into a field that could not be read is kept: the step says it was
  private.
- The page each step happened on: origin and path only, never the query or fragment, and its title.
- Enter, Tab and Escape, the browser's Back, Forward and Reload, and a choice in a dropdown list.

Only the person who started the recording is recorded, only in that browser, for at most ten minutes or 200 steps.
A stopped recording waits 30 minutes for its review, then is dropped. Recordings live in the server's memory only.

The message the bot gets opens with the line in `shared/teach-task.ts` (`TEACH_TASK_LINE`); the server turns it into
the `/learn` turn (`server/skill-learn.ts`), with the steps framed as page data, never instructions.

## Checks

```sh
pnpm exec vitest run server/browser/teach.test.ts server/skill-learn.test.ts src/components/browser/TeachTask.dom.test.ts src/components/bot-panel/LocalBrowser.dom.test.ts
DUSK_CDP_CHROME=/path/to/chrome pnpm exec vitest run server/browser/teach.e2e.test.ts
```

The real-Chrome test records through the v2 stream route and a real WebSocket: a click on a labelled search field,
typing, a password field, a submit that navigates, and a link on the next page; it checks the field's prefilled
value, the password and the query string never reach the recording.

## By hand, in the app

1. `node --experimental-strip-types scripts/control-dusk.ts ui launch`, then
   `PATCH /api/config {"browserEngine":{"engine":"chrome"}}` on the printed `url` (the fixture's agent-browser CLI is
   a stand-in, so its live view cannot connect).
2. Serve an invented page on loopback and allow its port for the fixture only:
   `PATCH /api/config {"browserEngine":{"egress":{"allow":["127.0.0.1:PORT"]}}}`.
3. ⌘K, type `teach`, Enter: the Computer tab opens, the browser starts and widens, and the red **Showing Pepper a
   task** bar counts time and steps. Open the page, click and type into it (the `ui` session's
   `agent-browser mouse` and `keyboard type` reach the page's canvas), type into a password field, submit.
4. `GET /api/bots/<id>/browser/teach` lists the steps; the password step reads `"hidden": true` with empty text.
5. **Stop and review**, name the task, **Teach Pepper**: the message lands in the chat, the fake engine's dump
   (`fake-claude-dump.json`) holds a `[SKILL LEARN]` turn, and `grep -r` of the data folder and the server log finds
   no trace of the password typed.
