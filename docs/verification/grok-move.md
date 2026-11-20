# Move from Grok Bot (Nov 20 2026)

The direct move ([docs/grok-bot-move.md](../grok-bot-move.md)) through its HTTP routes, on an isolated fake-engine
server run as the desktop app's own (owner token). Its temporary home holds a synthetic Grok Bot profile
(`server/testing/grok-bot-profile.ts`): seven invented bots, two with pictures, one chat at the 200-entry window with
earlier history, one with none, routine events (one routine deleted), two connected apps, a removed bot, two bots named
the same, and one chat slice in a format newer than dusk bot reads. Login material beside it (`sand-secrets.json`,
`Cookies`, `Local Storage`, `sentry/`, `~/.grokbot`) holds a sentinel.

```sh
node --experimental-strip-types scripts/verify-grok-move.ts
```

It detects, moves every live bot, sends a second move at once, asks the first bot for the rest, drops that bot's export
into the fixture's Downloads under the requested name, waits for it to be applied, previews the undo and undoes the
move, then stops its server. It prints counts and timings only. What it shows on the synthetic profile:

| Step | Expected |
|---|---|
| detect | 7 bots, 1 removed, 2 with a picture, 236 messages, 1 chat with earlier history, 3 routine names, 2 apps, one `chat:newerFormat` problem |
| photo | 200, `image/png` |
| move | 202, the second move 409, `done`, 6 done and 0 failed, 236 messages, 2 pictures |
| landed | 6 bots in the "Grok Bot" section, 0 unread, no engine turn started (the fake engine's dump is absent) |
| request | text at most 1000 characters, URL at most 2048 |
| export | `arrived` within one Downloads look (4 s): 2 memories, 1 skill (off), 1 routine paused, 2 routines to set (an unknown zone, a schedule in words), 1 app name |
| undo | the preview names 6 bots, 6 removed, none kept |

`GROK_HOME_FROM=<home>` copies only `sand-client-persistence` and `roster-avatars` from another home's Grok Bot folder
into the fixture instead, and skips the export and the undo: the way to time a move on a copy of a real profile without
printing anything from it. Never point it at a live `~/Library/Application Support/Grok Bot`, and never open the
printed request URL on a computer where Grok Bot is installed.

```sh
pnpm exec vitest run shared/grok-move.test.ts shared/grok-import.test.ts server/grok-local.test.ts server/grok-bot-move.test.ts server/routes/grok-move.test.ts server/routes/setup-import.test.ts src/lib/grok-move.test.ts src/lib/bot-move.test.ts
```

The reader test records every file opened and checks that only the allowlisted slices and photos were, and that the
sentinel reaches no answer. The move test runs the real store, routines, skills, memory and package path over a
throwaway home: a quiet opening note, no unread conversation, a second run updating the same bot, stop, a move cut off
by a restart, undo with its new-message count, and the export applied to the same bot (instructions with history,
memories word for word, skills off, routines paused in their own zone, refusals in plain words). The route test covers
the owner-only guard, the answer away from the desktop app, methods, content type, bodies and each failure.

What a Grok Bot move would do on a real home, in counts only, without writing anything:

```sh
node --experimental-strip-types scripts/import-dry-run.ts
```

Not covered here: the screens, the packaged Electron window and macOS's Downloads prompt, and Grok Bot itself opening
the link (the link is checked by unit test against the parser's rules, never opened).
