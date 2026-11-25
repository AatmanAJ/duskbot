# Mission control

One brief, run by several bots at once, watched and steered from one page.

Open it from **Mission control** at the top of the sidebar (shown once there are two bots), or from the command palette.
The sidebar row counts the mission lanes working now.

## What a mission is

A mission is a brief and the bots it runs on. Each bot gets the brief, plus an optional extra line of its own, in a new
conversation: a *lane*. A lane is an ordinary conversation. Its chat, cards, approvals, Inbox lines, Stop, and the
headless `duskbot wait`/`export` all work on it as they do anywhere else. A mission has no record of its own: each lane's
conversation carries a `mission` tag (`shared/mission.ts`: id, title, lane number, launch time, and the lane's brief), set
when the conversation is made and never changed. Deleting or archiving a lane's conversation takes it off the board.

## The page

- **Missions**: every mission, newest first, with a light for its state: running, needs you, done, partly done,
  failed, stopped, or not started.
- **Header**: the mission's state, its clock (elapsed while any lane runs, then how long it took), how many lanes are
  in each state, and **Stop all**.
- **Board**: one card per lane: the bot, its light and state in words, what it is doing or how it ended, the step it is
  on now, the teammates it handed work to, the files its turns changed in a project folder, and its latest reply.
  - **Steer** sends a line into the running turn (the same `followUp: "steer"` as typing while a bot works).
  - **Answer** replies to a lane that ends on a question; **Go with: …** sends the answer the bot said it would pick.
  - **Stop** presses Stop in that lane, which ends the teammates it asked too.
  - **Run again** sends the lane's brief again after it failed or was stopped; **Start** sends it to a lane whose first
    message never went out.
  - **Open chat** opens the lane's conversation.
- **Run timeline**: one row per lane and one per teammate task under it, on the mission's clock. A bar is queued
  (outline), working (red), waiting on teammates (striped), needs you (amber); a tick marks how it ended. It is drawn from
  the coordinator's own log of each piece of work (`assignment_events` in `runtime.db`), so a hand-off, an answer and a
  restart land where they happened.
- **Results**: every lane's reply side by side, its changed files, and **Copy all as Markdown**.

## Server

| Route | What |
| --- | --- |
| `POST /api/bots/:id/tasks` with `mission` | Makes a lane: `{ id, title, lane, launchedAt?, brief? }`, each field checked (`parseMissionTag`). |
| `GET /api/missions` | Every mission the reader can see a lane of, newest first (at most 50), with its state and lane counts. |
| `GET /api/missions/:id` | The board, timeline spans and marks. With `wait=MS&version=V` the read is held until something on the page changes (at most 25 s), like `GET /api/threads/:id/job`. |

Both reads are client-scope, so a paired phone can watch a mission. A lane in a conversation the reader cannot open is
left out; a mission none of whose lanes it can open answers 404. Launching, steering and stopping go through the
ordinary message and Stop routes, so every check on a person's own message applies to a lane's.

Each lane's state comes from its job (`server/job-view.ts`) since the mission launched: working, waiting on teammates,
queued, needs you, done, failed, stopped, or not started. Files come from the turn digests' checkpoint diff, which is
taken only in a project folder (not a conversation's private folder) and needs `git` on the server's `PATH`.

## Not yet

- Lanes in their own git worktree of one repository, and a per-lane diff to review before merging.
- Renaming or removing a whole mission in one step.
