# PR media: perf project 3

Everything here was made for this PR: the scenes, the kit, the captures and the renders. Nothing was downloaded.

## Files in `out/`

| File | What it shows |
| --- | --- |
| `hero.gif` / `hero.mp4` | "every change, sent as a patch." over the site's hero meadow, with the three headline numbers and the crew sending patches. |
| `wire.gif` / `wire.mp4` | Two real recorded streams replayed side by side in the site's wash cards, protocol 1 and protocol 2, during the same 8-thread burst. Ends on 78.4× less bot traffic. |
| `anatomy.png` | One real whole `bot` frame (11,895 B, the changed thread in lemon) next to the `task.patch` (194 B) the same change sent, with the 61× cut out of the site's landscape. |
| `app.gif` / `app.mp4` | The real app built from this branch while eight threads stream, with a live count of the frames its window received. |
| `proof.png` | The finished app: patches and bytes per sidebar row, and 0 whole bots. |
| `compat.png` | Who gets whole frames and who gets patches, as the site's "where it runs" cards. |
| `lookup.gif` / `lookup.mp4` | "Who owns this thread?": a front-to-back search (3,978 ns) next to the index (78 ns), slowed a million times. |
| `save.gif` / `save.mp4` | A thread rename: bots.json rewritten whole (6.19 ms) next to one registry.db row (0.27 ms), slowed a thousand times. |
| `persistence.png` | registry.db as a cache that bots.json overrules, as the site's job card over its sailing scene: first start, crash, rollback, forward again, restore, failure and removal. |
| `numbers.png` | Every before and after number, including harness CPU, which didn't change. |
| `climb.gif` / `climb.mp4` / `climb.png` | The hill climb's real score log, 8.227 → 0, as terraces down to the bar, with the undone steps and the two relocks shown for what they were. |

GIFs are 960 px wide at 20 fps and start on the scene's key frame, which is also what a paused GIF shows. MP4s are 1920×1080, 30 fps and silent. Stills are 3200×1800.

## Where the data comes from

- `capture/streams.ts` starts an isolated fake-engine server (temporary home and data folder) with 10 bots × 40 threads. It records `/api/events` twice at once, as protocol 1 and protocol 2, while 8 threads stream one round. Each bot gets a warm-up rename first, so the recording shows the steady state of a window that already holds its bots. Output: `data/streams.json`.
- `capture/app.ts` serves this branch's `dist/` from another isolated fake-engine server (6 bots × 30 threads), films it in headless Chrome and taps the page's own EventSource. Output: `recording/app/*.jpg`, `data/app.json` and three 2x stills.
- `capture/prepare.ts` packs both captures into `scenes/data/*.js` for the scenes.
- The lookup, save, hero and numbers figures are the PR's bench numbers from `scripts/bench-registry.ts`. The climb scene follows `.hill-climb/perf3-registry/log.jsonl`.

Neither capture touches a real app, account or data folder.

## Rebuilding

Needs ffmpeg and a Chrome for Testing binary (`PR_MEDIA_CHROME`; the default is Playwright's cache).

```sh
pnpm build
node --experimental-strip-types pr-media/capture/streams.ts
node --experimental-strip-types pr-media/capture/app.ts
node --experimental-strip-types pr-media/capture/prepare.ts
for s in hero wire app lookup save climb; do node --experimental-strip-types pr-media/render.ts $s; done
for s in anatomy proof compat persistence numbers climb; do node --experimental-strip-types pr-media/render.ts $s --still --scale 2; done
```

Scenes run on a virtual clock (`scenes/clock.js`), so every render of a scene comes out the same, frame for frame. `--gifOnly` rebuilds a GIF from frames already rendered.

## Licensing

- The look is the dusk bot site's, built from its own source in `apps/site`: the fonts in `public/landing/fonts` (Pixelify Sans and Geist Mono under the SIL Open Font License 1.1, General Sans under the Fontshare free licence), the art in `public/landing/art`, the motion curves in `motion-kit-v2.css`, and the pixel mascots from `mascot-src/pixel`, bundled into `scenes/vendor/crowd.js` with esbuild. `scenes/vendor/GEIST-OFL.txt` is the OFL text.
- The scenes, the kit and the captures were written for this PR. No stock, generated or third-party art, no audio.
