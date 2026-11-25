# Mission control

What [Mission control](../missions.md) shows and does, proven against an isolated fixture with invented bots.

## Automated

```sh
pnpm vitest run server/missions.test.ts server/routes/missions.test.ts server/missions.e2e.test.ts \
  server/mission-worktrees.test.ts server/mission-worktrees.e2e.test.ts
```

- `server/missions.test.ts`: lane states from a job, timeline spans from an assignment's log, failure words, a
  reply's closing question and suggested answer, file changes across turns, the mission's state.
- `server/routes/missions.test.ts`: tagged conversations grouped into missions, newest first; file changes only since
  launch; a lane the reader cannot open left out, and 404 once none is left.
- `server/missions.e2e.test.ts`: a real fixture with the scripted room engine. Three lanes are made with a `mission`
  tag (a bad tag is refused), sent the brief, and read back: one done, one done after a real hand-off to a teammate
  (its row and hand-off mark on the timeline), one held working. A held read of the mission wakes when that lane is
  stopped, and it reads as stopped, and the mission as partly done.
- `server/mission-worktrees.test.ts`: real git in a temporary folder. A repository's root, commit, branch and
  uncommitted changes; a folder that is not one, or has no commits, refused. Two lanes get their own branches and
  folders; a lane's diff holds a commit it made, a changed, a deleted and a new file, and the other lane's is empty;
  the person's checkout stays clean; removing a folder keeps the branch; a folder the server did not make, or a commit
  that is not whole, is refused; the repository's own hooks never run.
- `server/mission-worktrees.e2e.test.ts`: a fixture with git (`DUSK_VERIFY_GIT=1`). Lanes made with
  `mission.worktree` work in their own worktree; a lane's turn writes files there; the board lists them from the
  turn's checkpoint, the diff route shows them, the other lane's diff is empty, and removing the folder keeps the
  branch.

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

Lanes in a repository: launch with `--git` (git, and nothing else, joins the fixture's `PATH`) and seed with `--repo`:

```sh
node --experimental-strip-types scripts/control-dusk.ts ui launch --scripted-room --git
node --experimental-strip-types scripts/testing/mission-fixture.ts --ui $H --repo
```

This also makes an invented shop site repository in the temp folder and launches "Shop site refresh" on Wren, Cobalt
and Juno, each in its own worktree. Expected: each card names its branch; Wren's and Cobalt's list one changed file;
**Review** on Cobalt shows `mission/…/2-cobalt`, `prices.md` with `+2 −1`, and the diff; **Remove folder** then
**Remove folder** in the dialog says the work is on that branch. In **New mission**, typing the repository's path and
leaving the field says "Lanes branch from main at <commit>"; launching makes three lanes, each with its branch.

Without `--git` the fixture's `PATH` holds only `node`: no checkpoint is taken and no lane lists changed files.
