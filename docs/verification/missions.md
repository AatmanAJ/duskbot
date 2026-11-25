# Mission control

What [Mission control](../missions.md) shows and does, proven against an isolated fixture with invented bots.

## Automated

```sh
pnpm vitest run server/missions.test.ts server/routes/missions.test.ts server/missions.e2e.test.ts
```

- `server/missions.test.ts`: lane states from a job, timeline spans from an assignment's log, failure words, a
  reply's closing question and suggested answer, file changes across turns, the mission's state.
- `server/routes/missions.test.ts`: tagged conversations grouped into missions, newest first; file changes only since
  launch; a lane the reader cannot open left out, and 404 once none is left.
- `server/missions.e2e.test.ts`: a real fixture with the scripted room engine. Three lanes are made with a `mission`
  tag (a bad tag is refused), sent the brief, and read back: one done, one done after a real hand-off to a teammate
  (its row and hand-off mark on the timeline), one held working. A held read of the mission wakes when that lane is
  stopped, and it reads as stopped, and the mission as partly done.

## In the app

```sh
node --experimental-strip-types scripts/control-dusk.ts ui launch --scripted-room
H=/tmp/duskbot-verify-data-XXXXXX/ui.json
node --experimental-strip-types scripts/testing/mission-fixture.ts --ui $H
```

`mission-fixture.ts` makes six invented bots and launches two missions through the same routes the page uses: one that
finishes ("Competitor teardown") and one with a lane in each state ("Spring launch review": Atlas working, Ferro waiting
on its teammate Okra, Lumen done, Pike asking a question, Sable failed). `--release` lets the held lanes finish.

```sh
pnpm control:dusk ui eval --ui $H --js "(() => { document.querySelector('[data-mission-control-row]').click(); return true; })()"
pnpm control:dusk ui screenshot --ui $H --out .dusk-scratch/verify-evidence/missions.png
```

Expected: the sidebar row reads "Mission control, 1 working"; the board has five cards whose `data-lane-state` is
`working`, `waiting`, `done`, `needs-input` and `failed`; Pike's card shows its question and **Go with: Tuesday
morning**; Sable's says the supplier sheet answered 403; the timeline has a row for Okra under Ferro. Then:

- **Go with: Tuesday morning** on Pike: its card goes to `done` without a reload.
- **Stop** on Atlas: `stopped`; **Run again**: `working`; **Steer**, type a line, send: the line is the newest
  message of Atlas's conversation.
- **New mission**, a name, a brief, three bots, **Launch 3 lanes**: the page opens the new mission with three cards.
- **Results**: one card per lane, Lumen's checklist in full; **Copy all as Markdown** says Copied.

The fixture's `PATH` holds only `node`, so no checkpoint is taken and no lane lists changed files there;
`server/routes/missions.test.ts` covers reading them from turn digests.
