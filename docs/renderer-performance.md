# Renderer store and transcript performance

How the desktop and web renderer keeps a live chat cheap to draw: the app store
is read through selectors, its lookups are normalized, and a long transcript
mounts only the rows near the viewport.

## The store

`src/state/store.tsx` keeps one `AppState` and one reducer, but the state now
lives in an external store (`src/state/external-store.ts`) that React reads with
`useSyncExternalStore`. The provider no longer rebuilds a context value on every
change, so a component renders again only when the part of the state it reads
changes.

| Hook (from `@/state/store`) | Renders again when |
| --- | --- |
| `useStoreSelector(selector, isEqual?)` | the selection changes (`Object.is` unless `isEqual` is given) |
| `useStoreShallow(selector)` | a fresh object or array the selector builds differs one level deep |
| `useOptionalStoreSelector(selector, fallback)` | as above; outside any store it returns `fallback` |
| `useDispatch()`, `useStoreActions()` | never |
| `useStoreRef()` (`@/state/store-ref`) | never; `state()` reads the newest state inside a handler or effect |
| `useStore()` | every change: a compatibility shim; no component outside the store module calls it |

Rules for a selector: return a primitive or an object that already exists in
the state (`s => s.config`, `s => botById(s, id)`); never build a new object
with `useStoreSelector` (use `useStoreShallow`, or select the parts). Shared
selectors live in `src/state/store-selectors.ts`; `sameDrawnBots` keeps a bot
list equal while only messages change, for avatars and mention lists.

`stateRef` inside the provider is still "the state last rendered", which is
what the wrapped dispatch reads right after `rawDispatch` (for example the
settings-opened analytics), so its behaviour did not change.

`ScopedStore` derives a store from the one around it: its readers see
`derive(state)` and follow the outer store, and its actions stand in for the
outer ones (the bot editor's draft). `BotEditorStore` and tests that render
inside `StoreContext.Provider` give a fixed value; every hook reads that value
instead of the app store. Tests that
mock the store module with their own `useStore` get the selector hooks through
`withStoreHooks` (`src/testing/store-mock.ts`).

### Normalized state

`AppState.normalized` (`src/state/store-index.ts`) holds the state by id and by
thread: `botsById`, `groupsById`, `tasksByThread` (every bot or room task that
names a thread), `messagesByThread` (the transcript open on each thread) and
`messageById` (each open transcript's rows by id). The root reducer brings it up
to date after any action that changes `bots` or `groups`, and shares it between
states otherwise. It is built incrementally: a frame that patches one bot
rebinds the thread maps without rescanning every task, and an appended or
patched transcript extends its row-position index after a pointer walk instead
of building a new map.

Bots and rooms still carry their open transcript in the wire shape, which is
what snapshots, the IndexedDB transcript cache, optimistic sends and branch
navigation read and write, so none of them changed. Read the normalized view
through `storeIndex(state)` (or `botById`, `groupById`, `messagesByThread`,
`tasksOfThread`): a state built by hand, as many tests do, may carry a stale
one, and `storeIndex` rebuilds it then.

### Reducer slices

`src/state/reducers/` holds the transcript, UI, automation and runtime slices.
Each owns a typed list of its action types; the root reducer routes by type
guard, so the core switch that remains in `store.tsx` is still checked as
exhaustive. Case bodies moved unchanged.

## The transcript

`src/components/TranscriptRows.tsx` draws the rows `MessagesList` (1:1 chats)
and the room `Transcript` build. Below `VIRTUAL_TRANSCRIPT_FROM` (120) drawn
rows it renders them exactly as before. From there it mounts only the rows near
the viewport with `@tanstack/react-virtual`, in normal flow inside a list whose
top and bottom padding stand in for the rest, so the column's gaps and the
tuck and hand-off spacing rules still apply. Each row is measured as it mounts;
a row above the viewport that changes height moves the scroll position with it.

What the viewport hook (`src/hooks/use-transcript-viewport.ts`) keeps:

- following the newest row while a reply streams, and stopping on an upward
  wheel, touch, scrollbar grab or scroll key;
- the reader's row in place when an older page is prepended;
- loading older pages near the top (the sentinel and the auto-load);
- the person's own new message bringing the transcript back to the bottom;
- a search hit (find-in-chat, the search palette, a notification): its row is
  scrolled into range so `useFocusMessage` can find, centre and highlight it;
- a bubble being edited stays mounted, hidden, while it is scrolled away.

The 120-row window that only grew, and its "show earlier/later" buttons, are
gone: every loaded message is in the list, and only the visible ones mount.

## Measuring

`scripts/testing/transcript-perf.ts` runs the real renderer (Vite dev build, so
React's Profiler reports) against disposable fake-engine fixtures in headless
Chrome, and prints JSON:

```sh
node --experimental-strip-types scripts/testing/transcript-perf.ts --label after --out perf.json
node --experimental-strip-types scripts/testing/transcript-perf.ts --scenario long --hold   # keep it open to look
```

- `stream`: a thread with history receives three replies that each run eight
  tool calls and stream about 2,400 characters; the page counts commits, render
  time (Profiler `actualDuration`) and component renders.
- `long`: a thread of 2,000+ messages is opened, every page is loaded, then it
  is scrolled end to end at 60 px per frame; it reports frame times, DOM nodes,
  mounted rows and JS heap (after `gc()`).

Numbers from one machine are comparable only with each other; run the before
and after back to back on an idle host.

## 2026-11-17 observations

macOS arm64 (Apple silicon), Node 26, headless Chrome for Testing at 1440x960,
Vite dev build of `main` at `dbfefd93d` and of this change, each run back to
back on the same fake-engine fixtures. Three runs per row; the range is
shown. Dev builds are slower than the packaged app, so compare rows with each
other, not with production.

A streamed reply with eight tool calls, in the open chat (100 earlier messages):

| | before | after |
| --- | ---: | ---: |
| React commits | 24–25 | 28–30 |
| component renders | 1,676–1,720 | 1,417–1,530 |
| render time (Profiler, summed) | 170–183 ms | 128–150 ms |
| slowest commit | 18.7–21.8 ms | 14.9–16.7 ms |
| `ChatView` renders | 19–20 | 22–23 |

The same reply from another bot while that chat stays open:

| | before | after |
| --- | ---: | ---: |
| React commits | 12–16 | 14–18 |
| component renders | 799–1,082 | 370–545 |
| render time | 45–63 ms | 26–31 ms |
| `ChatView` renders | 6–8 | 0 |

A thread of 2,051 messages, every page loaded and scrolled end to end at
60 px a frame (two passes each way):

| | before | after |
| --- | ---: | ---: |
| scrolling up: average fps | 54.0–55.0 | 60 |
| scrolling up: frames over 25 ms | 21–22 | 0 |
| scrolling up: worst frame | 283–333 ms | 16.8 ms |
| scrolling down: average fps | 60 | 60 |
| rows mounted once loaded | 1,026 (and growing) | 12 |
| DOM nodes once loaded | 29,514 | 478 |
| JS heap after `gc()` | 124.5 MB | 76.2 MB |

Commits are a little more frequent because `useSyncExternalStore` renders
sooner than a default-priority `useReducer` update did; live frames are
batched per task (`dispatchBatched`) to keep that close. Each commit renders
far fewer components, which is where the time goes.
