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
node scripts/brand-studio/frame.mjs --in BEFORE.png --in AFTER.png --out PAIR.png --label before --label after [--arrange auto|row|stack]
node scripts/brand-studio/frame.mjs --in RAW.png --out FRAMED.png --crop 40,120,560,360
node scripts/brand-studio/frame.mjs --in F1.png --in F2.png [--in ...] --out DEMO.gif [--hold 1400] [--fade 320]
node scripts/brand-studio/frame.mjs --reframe DIR [--bg 1|2|3]
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--in PATH` | a raw screenshot; repeat for a pair on one PNG or the frames of a GIF | |
| `--out PATH` | `.png` for a still, `.gif` for a looping animation | |
| `--bg N` | the background, below | `1` |
| `--label TEXT` | one per `--in`, in order | none |
| `--arrange MODE` | several `--in` on a PNG: `row`, `stack` or `auto`, below | `auto` |
| `--crop X,Y,W,H` | the part of a screenshot to keep, in points from its top left; one for every `--in`, or one per `--in` | the whole screenshot |
| `--density N` | pixels per point of the raw screenshots | `2` |
| `--pad POINTS` | space around the screenshots | about 8.5% of their width, 72 to 160 |
| `--hold MS` | how long a GIF rests on each frame | `1400` |
| `--fade MS` | cross-fade between GIF frames; `0` cuts | `320` |
| `--gif-width PX` | widest a GIF may be | `1280` |
| `--reframe DIR` | frame a whole folder by the naming convention below | |

It prints JSON naming each file written with its size, and exits non-zero on
failure. For a still it also prints the `arrange` it used and `columnScale`:
how far GitHub shrinks the picture to fit a pull request's 900 px column
(`1` is full size).

### Row or stack

A pair can sit side by side (`row`, a label under each shot) or one above the
other (`stack`, a label over each shot, on a canvas no wider than the widest
shot needs). `auto` takes the row while the row stays readable in a pull
request, and the stack otherwise. Readable means the column shrinks the
picture to no less than 0.66 of its size, which keeps the app's 13-point text
at about 9 px: a row up to 1,364 points wide with its padding, so two shots of
up to about 560 points each. Two full 1280-point windows side by side would
show at a third of their size; stacked they show at 0.6.

### Crop to what changed

A whole window is rarely the point. `--crop` keeps one rectangle of a
screenshot, given in points (the units of `--width` and `--height`, and of
`getBoundingClientRect()` in the page), so the picture is the changed control
at full size. It only cuts: the pixels kept are never resampled, and a crop
that reaches outside the screenshot is refused. Leave room around the control,
and move an edge rather than cut through a heading or a line of text behind
it. Two shots of a pair may take different crops, for example when the after
is taller than the before.

The raw file stays whole, so a later pass can choose a different crop.

What the frame is: the screenshot, or the part a crop keeps, at its own pixels (never resampled, so a
`--scale 2` capture stays retina-sharp), centred, with 12-point rounded
corners, a hairline edge and a soft two-layer shadow. Nothing else: no window
chrome, no gradient or tint over the picture. A phone-shaped capture or row
gets a canvas up to 4:3 wide, though never wider than stays readable. Labels are small ink pills in Geist Mono; the red
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
| `<slug>.before-after.png` | both on one picture, labelled |
| `<slug>.f01-<label>.raw.png`, `<slug>.f02-<label>.raw.png`, … | the raw frames of an interaction, in number order |
| `<slug>.gif` | those frames as a looping GIF, each labelled with its `<label>` |

`<slug>` and `<state>` are lowercase letters, digits and hyphens. The `-<label>`
of a frame is optional; hyphens in it show as spaces.

Keep the raw files next to the framed ones. `frame.mjs --reframe DIR` rebuilds
every framed file in a folder from its raw files alone, so a later pass can
change the background or the frame for every pull request without capturing
anything again.

`--reframe` also reads the older naming some asset branches use, and writes
the names those pull requests already link:

| File | What it is |
| --- | --- |
| `pr-<n>-before.png`, `pr-<n>-after.png` | raw captures |
| `pr-<n>-before-<case>.png`, `pr-<n>-after-<case>.png` | raw captures of a second case |
| `pr-<n>-<state>[-<case>]-framed.png` | that capture, framed |
| `pr-<n>-before-after[-<case>].png` | both on one picture, labelled |

### frame.json

Crops and arrangements for `--reframe` live in a `frame.json` beside the raw
files, keyed by the framed file they apply to:

```json
{
  "chat-stop.before-after.png": { "crop": ["66,186,360,140", "66,288,360,140"] },
  "chat-stop.gif": { "crop": "40,120,560,360", "labels": ["ask", "working", "stopped"] },
  "tab-ring.gif": { "frames": ["tab-ring.f04-search.raw.png", "tab-ring.f05-new-bot.raw.png"], "hold": 900, "fade": 200 },
  "chat-stop.after.png": { "arrange": "stack" },
  "chat-stop.close-up.png": { "shots": ["chat-stop.before.raw.png", "chat-stop.after.raw.png"], "crop": "300,80,200,90", "labels": ["before", "after"] }
}
```

| Key | Meaning |
| --- | --- |
| `crop` | one `"x,y,width,height"` in points for every shot of that file, or a list with one per shot (`null` leaves a shot whole) |
| `arrange` | `auto`, `row` or `stack` for that file |
| `labels` | one per shot, instead of the ones the names give |
| `shots` | raw files in the folder: one more still made from them, such as a closer crop of the same pair |
| `frames` | a GIF only: the numbered raw files it shows, in the order given, when a shorter loop of a few of them reads better than all of them |
| `hold`, `fade` | a GIF only: how long it rests on each frame and how long it cross-fades, in milliseconds, instead of `--hold` and `--fade` |

A file with no entry is framed whole, so a pair can be cropped to the changed
control while each single shot still shows the whole window. An entry for a
file the folder does not yield is an error.

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
