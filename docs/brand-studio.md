# Brand screen studio

Before and after pictures for a pull request: a real screenshot of the app,
taken on an isolated fixture, set on one of dusk bot's own pictures. Two tools
in `scripts/brand-studio/`:

- `capture.ts` screenshots a named view of the app.
- `frame.mjs` sets raw screenshots on a brand background, as a PNG or a
  looping GIF.

Neither needs anything installed beyond `pnpm install`. Framing draws on a
canvas in a hidden Electron window and encodes GIFs with its own encoder
(`gif.mjs`), so there is no ImageMagick, sharp or ffmpeg involved. On Linux
without a display, run `frame.mjs` under `xvfb-run`.

## Capture a view

```sh
node --experimental-strip-types scripts/brand-studio/capture.ts \
  --view chat-reply --slug chat-stop --state after
```

This starts the fake-engine fixture of
[Chat UI, driven headlessly](verification/chat-ui.md) (`control-dusk ui
launch`: a temporary data directory, the real renderer in a headless Chrome),
walks to the view, writes `qa-assets/chat-stop.after.raw.png` and stops the
fixture. The person's own app and `~/.duskbot` are never involved. The first
run downloads the pinned agent-browser and its Chrome into `.dusk-scratch/`.

| Option | Meaning | Default |
| --- | --- | --- |
| `--view NAME` | a named view, below | |
| `--steps FILE` | a JSON array of steps, instead of `--view` | |
| `--entry NAME` | with `--steps`: the preview page, `threads` (the whole app), `settings` or `dictation` (test pages) | `threads` |
| `--script JSON` | with `--steps`: the fake engine's turn, as `ui launch --script` takes it | |
| `--slug SLUG` | what the capture shows, lowercase-with-hyphens | required |
| `--state STATE` | `before`, `after`, or any lowercase-with-hyphens word | `after` |
| `--out-dir DIR` | where the raw PNG goes | `qa-assets` |
| `--width`, `--height` | the window, in points | 1280 × 800 |
| `--scale` | pixels per point | 2 |

Named views (`VIEWS` in `capture.ts`; add one there when a view is worth
sharing):

| View | Shows |
| --- | --- |
| `chat` | the seeded bot Pepper's chat, first open |
| `chat-draft` | the same with a message typed and not sent |
| `chat-reply` | after one sent message and the fake engine's reply |
| `chat-demo` | three shots of that turn (`f01-open`, `f02-ask`, `f03-reply`) for a GIF |

Steps, for `--steps` or a new view:

```json
[
  { "click": "Search" },
  { "type": { "name": "Message Pepper", "text": "hello" } },
  { "press": "Enter" },
  { "settle": 60 },
  { "waitMs": 300 },
  { "eval": "document.querySelector('[data-tour=tools] button')?.click()" },
  { "shot": "f01-open" }
]
```

`click` and `type` take an element's exact accessible name; find names with
`control-dusk ui snapshot`. `settle` waits for the bot's turn to finish.
`shot` screenshots at that point as `<slug>.<shot>.raw.png`; with no `shot`
step, one screenshot is taken at the end as `<slug>.<state>.raw.png`.

Every capture runs at the same window size, dark colour scheme and reduced
motion, with Pepper's colour pinned, so two runs of one view differ only where
the app does. The chat's time stamp ("Today 11:46") is the one thing that
still changes between runs.

For a **before** shot, run the same command with `--state before` from a
checkout of the base branch (for example a `git worktree` of `main`), with
`--out-dir` pointing at the same folder as the after shot.

## Frame it

```sh
node scripts/brand-studio/frame.mjs --in RAW.png --out FRAMED.png [--bg 1|2|3]
node scripts/brand-studio/frame.mjs --in BEFORE.png --in AFTER.png --out PAIR.png --label before --label after
node scripts/brand-studio/frame.mjs --in F1.png --in F2.png [--in ...] --out DEMO.gif [--hold 1400] [--fade 320]
node scripts/brand-studio/frame.mjs --reframe DIR [--bg 1|2|3]
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--in PATH` | a raw screenshot; repeat for a side-by-side PNG or the frames of a GIF | |
| `--out PATH` | `.png` for a still, `.gif` for a looping animation | |
| `--bg N` | the background, below | `1` |
| `--label TEXT` | one per `--in`, in order | none |
| `--density N` | pixels per point of the raw screenshots | `2` |
| `--pad POINTS` | space around the screenshots | about 8.5% of their width, 72 to 160 |
| `--hold MS` | how long a GIF rests on each frame | `1400` |
| `--fade MS` | cross-fade between GIF frames; `0` cuts | `320` |
| `--gif-width PX` | widest a GIF may be | `1280` |
| `--reframe DIR` | frame a whole folder by the naming convention below | |

It prints JSON naming each file written with its size, and exits non-zero on
failure.

What the frame is: the screenshot at its own pixels (never resampled, so a
`--scale 2` capture stays retina-sharp), centred, with 12-point rounded
corners, a hairline edge and a soft two-layer shadow. Nothing else: no window
chrome, no gradient or tint over the picture. A phone-shaped capture gets a
canvas at least 4:3 wide. Labels are small ink pills in Geist Mono; the red
dot (`ACCENT` in `layout.mjs`) marks the last label of a still, the "after",
and every label of a GIF.

A GIF holds each frame, cross-fades to the next, and fades from the last back
to the first, so the loop has no jump. Frames after the first store only the
rectangle that changed.

## The three backgrounds

In `scripts/brand-studio/backgrounds/`, copied unchanged from the site's
pictures (`apps/site/public/landing/art/strip-*.webp`), which
[dusk.bot/brand](https://dusk.bot/brand) shows:

| `--bg` | File | Picture | Good for |
| --- | --- | --- | --- |
| `1` | `1-sky.webp` | open sky, the strip at the top of the brand page | the default; the calmest |
| `2` | `2-dunes.webp` | cream sand dunes by the sea | a second picture in the same pull request |
| `3` | `3-birches.webp` | birch trees in front of lilac hills | the loudest; one hero picture |

To change one, replace the file and its entry in `BACKGROUNDS` in
`layout.mjs`.

## Names

Everything in a pull request's asset folder is named
`<slug>.<state>.<kind>`:

| File | What it is |
| --- | --- |
| `<slug>.before.raw.png`, `<slug>.after.raw.png` | raw captures, as `capture.ts` writes them |
| `<slug>.<state>.png` | that capture, framed |
| `<slug>.before-after.png` | both, side by side, labelled |
| `<slug>.f01-<label>.raw.png`, `<slug>.f02-<label>.raw.png`, … | the raw frames of an interaction, in number order |
| `<slug>.gif` | those frames as a looping GIF, each labelled with its `<label>` |

`<slug>` and `<state>` are lowercase letters, digits and hyphens. The `-<label>`
of a frame is optional; hyphens in it show as spaces.

Keep the raw files next to the framed ones. `frame.mjs --reframe DIR` rebuilds
every framed file in a folder from its raw files alone, so a later pass can
change the background or the frame for every pull request without capturing
anything again.

## Where the pictures live

Not on the pull request's own branch. They go on an orphan branch
`qa-assets/<branch>` on the fork (`<branch>` is the pull request's branch
without its `fix/` or `feat/` prefix), files at the root, one commit
`qa assets: <branch>`:

```sh
git worktree add --detach ../qa-assets-tmp
cd ../qa-assets-tmp
git checkout --orphan qa-assets/chat-stop-control
git rm -rfq .
cp /path/to/qa-assets/* .
git add . && git commit -m "qa assets: chat-stop-control"
git push fork qa-assets/chat-stop-control
```

In the pull request body, link each picture by that commit's hash, so the
picture a reviewer sees never changes under them:

```md
![chat stop control, before and after](https://raw.githubusercontent.com/<owner>/duskbot/<commit>/chat-stop.before-after.png)
```
