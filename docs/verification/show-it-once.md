# Show it once

A person records a task once in a bot's browser, or on its Local VM, and the
bot keeps it as steps it can repeat for other inputs. Everything below runs in
disposable homes with the fake model; none of it touches the operator's data.

## Offline checks

```sh
pnpm exec vitest run server/demo-recorder server/routes/demo-recordings.test.ts src/components/DemoRecorder.dom.test.ts
```

They cover, with the fake expense portal in `server/demo-recorder/fixtures`:

- capture: clicks, typing runs, keys, scrolls, drags and choices become
  events with a picture before and after;
- secrets: a password typed during a recording is in no file of the recording,
  no log line, no prompt, no skill, no routine and no reply, in any encoding,
  and its field is black in every kept picture, or the picture is not kept;
- the compiler: one step for each action from the recording alone, the
  model's grouping when its answer holds up, and the outline when it does not;
- replay: eleven receipts filed on the page as shown, on a page laid out
  differently, and on one with renamed labels and a survey in the way, where
  the bot's own turn takes the step and the value must still be on screen;
- the desktop: a viewer's RFB bytes read into clicks and keys, the driver's
  accessibility tree, and a plan carried out through the driver's actions.

## On real Chrome

```sh
DUSK_CDP_CHROME=/absolute/path/to/chrome pnpm exec vitest run server/demo-recorder/browser.e2e.test.ts server/demo-recorder/devtools-page.e2e.test.ts
```

`server/demo-recorder/browser.e2e.test.ts` drives the new engine as a person's
view does (`server/browser/viewers/core.ts` hears every input first), and
`server/demo-recorder/devtools-page.e2e.test.ts` the path the default engine
takes: a DevTools client of its own. Both record a sign-in and an expense, check
the password's field in the stored pictures pixel by pixel, and file three more
receipts on the rearranged page. Without `DUSK_CDP_CHROME` or `DUSK_CDP_E2E=1`
they skip.

## By hand, in the real Browser panel

```sh
DUSK_VERIFY_BROWSER_CHROME=/absolute/path/to/chrome \
node --experimental-strip-types scripts/verify-show-it-once.ts
```

Add `DUSK_VERIFY_ENGINE=agent-browser` and
`DUSK_VERIFY_BROWSER_BINARY=/absolute/path/to/agent-browser` for the default
engine. The launcher prints the preview URL, the portal's address and the
folder of receipts. Open only the printed preview URL.

1. Enter the printed portal address. Press **Record**: the pill reads "You
   have control" and stays so, and the strip counts each thing you do.
2. Press **New expense**, fill Merchant, Amount, Date and Notes from the first
   receipt, choose a Category, and press **Submit expense**.
3. Press **Stop and review**. The steps appear with a picture drawn in close
   on where each happened. Rename an input, move a step up and back, then
   **Save as skill**: the line under the steps names the skill.
4. Press **Hand back**, open **Shown tasks**, the recording, then **Run on
   files** and choose the other eleven receipts. The bot's pointer moves
   through the form for each, the strip counts to 11 of 11, and the portal
   lists twelve expenses.
5. Record the sign-in page with a made-up password. The password field is
   black in that recording's pictures and `trace.json` under the printed data
   folder holds only how many characters were typed.

Stop the launcher with Ctrl-C. A Local VM desktop needs Docker: take control in
the Computer panel, press **Record** there, and the same review opens.
