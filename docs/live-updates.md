# Live updates and the bot registry

How a change to a bot reaches every open app, and how the server keeps its bots on disk.

## The live stream

`GET /api/events` is a server-sent event stream. Every frame carries `seq` and an
`id: <stream>:<seq>` line, so an EventSource resumes through `Last-Event-ID`; a
cursor the server can no longer replay gets `hello` with `resumed: false`, and the
client reads a snapshot (`GET /api/bots`).

### Protocols

A client picks its frame protocol with `?protocol=` (`shared/live-protocol.ts`).

| Protocol | Asked with | A bot that changes arrives as |
| --- | --- | --- |
| 1 | nothing (every client before this change, scripts, the headless CLI, the talk server) | a whole `bot` frame: the bot and every thread it has |
| 2 | `?protocol=2` (the desktop, web and phone apps through `src/lib/live-events.ts`) | a `bot.patch` or `task.patch` when the stream already sent that bot |

A server that does not know `protocol` ignores it, so a new app on an old server
gets protocol 1, and an old app on a new server asks for nothing and gets protocol 1.

Protocol 2 still sends a whole `bot` frame:

- the first time a bot goes out, and after `bot.deleted`;
- when the frame carries a page of messages (the bot's open thread changed);
- for the first frame of every bot after any client read a snapshot (`GET /api/bots`);
- to every stream that is not the admin's whole view: members of a shared workspace,
  a Team Cloud person's own stream. Those are narrowed per viewer
  (`server/bot-visibility.ts`) and keep protocol 1.

### Revisions

Every bot frame and every `GET /api/bots` bot carries `rev`, the number of changed
frames the stream has sent for that bot since the server started. A frame that
changes nothing leaves `rev` alone and protocol 2 streams get nothing for it.

```ts
{ kind: "bot.patch", id, base, rev, fields?, unset?, tasks?: { order?, add?, change?: [{ threadId, fields?, unset? }] } }
{ kind: "task.patch", botId, threadId, base, rev, fields?, unset? }
```

`fields` hold whole new values of top-level keys and `unset` the keys that are gone.
`tasks.order` is the whole list of thread ids when it changed (a thread left out is
gone), `add` the new threads in full, `change` the threads whose fields changed. A
change to one thread alone is a `task.patch`.

The client (`src/state/live-bot-patches.ts`) applies a patch to the bot its stream
last sent, or to the store's copy when that copy has `rev === base` (after a
snapshot), and gets exactly the whole frame protocol 1 would have sent. That frame
goes through the same `botPatched` reducer, so both protocols drive the same client
code. Threads a patch leaves alone keep their object identity. A patch older than
what the client holds is dropped; a patch from a revision it never had reads the
bot again.

`shared/live-patch.ts` holds the diff (server) and the apply (client), and its
tests replay thousands of random changes through both.

### Text deltas

`content.delta` events are merged per thread and stream for 50 ms in the event bus
(`server/harness/bus.ts`) before they reach `broadcast`, so a reply streams as a few
frames a second per thread, in order. Any other event for the thread flushes the
pending text first.

## The registry on disk

The registry is the list of bots and their threads (`server/store.ts`). It is kept in
two places in the data folder:

| File | What | Written |
| --- | --- | --- |
| `registry.db` | one row per bot and per thread (`node:sqlite`, WAL) | a thread or bot change writes only its own rows |
| `bots.json` | the whole registry, as every earlier build wrote it | on every full save (creating, deleting or reordering bots, setup changes), and 2 s after the last row write; at shutdown and before a backup (`flushDeferredSaves`) |

`registry.db` records the hash of the `bots.json` it last wrote. At start the
server reads the rows only when `bots.json` is still exactly that file. Any other
`bots.json` wins and becomes the rows: a restored backup, a hand edit, a move, or
an earlier build that ran in between.

- **Migration.** The first start of this build finds no rows that match, reads
  `bots.json`, and writes the rows in one transaction. Nothing is renamed or
  removed.
- **Rollback.** An earlier build reads `bots.json`, which is current after a clean
  shutdown and at most 2 s behind after a crash. When this build starts again, the
  file the earlier build wrote no longer matches the rows, so it is read again:
  nothing the earlier build did is lost.
- **Durability.** A permission change (`save: "now"`) commits with
  `synchronous = FULL` (and `fullfsync` on macOS), as `bots.json` was written. Other
  thread changes commit with `synchronous = NORMAL`, like `messages.db`: a crash keeps
  them, a power loss can take the last moments.
- **Privacy.** Thread rows hold provider session ids: the file is `0600`, hidden
  from engines (`server/drivers/engine-read-scope.ts`), and left out of workspace
  backups (`server/workspace-backup.ts`), which carry `bots.json` instead.

`registry.db` is local, user-side data, like `messages.db`; it does not go to Dusk's
MongoDB ([docs/mongodb.md](mongodb.md)).

## Lookups

`store.bot(id)`, `store.botByThread(threadId)`, `store.group(id)`,
`store.groupByThread(threadId)` and `store.taskByThread(botId, threadId)` go through
`server/owner-index.ts`: a map by id and by thread, rebuilt only after the lists
change. A hit is checked against the live list, and a miss is trusted only while
every owner still has the list of threads it was built from. With
`DUSK_REGISTRY_SHADOW=1` (every test) each answer is compared with a front-to-back
search.

## Measuring

`node --experimental-strip-types scripts/bench-registry.ts` runs both parts on
isolated fixtures: lookups and a thread rename's save time on a registry of 30 bots
with 100 threads each, then 8 threads streaming replies at once on a fake-engine
server, counting the bytes the desktop's stream receives and the harness's CPU
(scaled by a fixed calibration workload, so a busy machine does not move it).
