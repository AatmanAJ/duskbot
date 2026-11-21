# Task fidelity: right place, right route, draft first

Everyday requests with one right outcome each (`server/task-fidelity/cases.ts`),
played in a scripted workspace where every connected app, browser and screen
tool is mocked (`server/task-fidelity/world.ts`). Nothing reaches a real
person, Slack workspace, inbox or website.

Each play is scored on:

- **destination**: the first message out goes where the request said (a
  channel post stays in the channel, a DM goes to that person);
- **tool**: the work used the expected route (connected app, then browser,
  then screen) and no forbidden one;
- **steps**: tool calls stayed within the case's budget;
- **asked**: when the place was open (no channel, two people with one name,
  "the client"), the first turn asked and sent nothing; when clear, it acted;
- **focus**: no searching the person's files unless the task was a file;
- **draft**: words the bot wrote for other people were shown before they went
  out.

## Running it

```sh
# no model: the rules each case needs are in its prompt and tool descriptions
node --experimental-strip-types scripts/task-fidelity.ts --engine prompt
# the real Claude Code CLI, built-in tools off, the case's mocked tools as its one MCP server
node --experimental-strip-types scripts/task-fidelity.ts --engine claude --runs 3 --label after --out /tmp/task-fidelity
# any Anthropic Messages endpoint (TASK_EVAL_KEY, optional TASK_EVAL_URL and TASK_EVAL_MODEL)
node --experimental-strip-types scripts/task-fidelity.ts --engine model --runs 3
```

`npx vitest run server/task-fidelity` keeps the prompt checks at 100% and
checks the scorer against a scripted replay of the flagged chat.

## Scores, 2026-11-17

23 cases, 3 runs each, Claude Code `sonnet` (2.1.314):

| Check | Before | After |
|---|---|---|
| Tasks fully right | 51/69 (74%) | 61/69 (88%) |
| Destination | 67/69 | 68/69 |
| Route | 66/69 | 69/69 |
| Asked when open, acted when clear | 43/45 | 45/45 |
| Draft shown before posting | 10/21 | 17/21 |
| No file hunting | 63/66 | 66/66 |
| Within step budget | 67/69 | 65/69 |
| Mean tool calls | 4.4 | 4.1 |
| Prompt rules present (no model) | 21/76 | 76/76 |

The step-budget misses after are browser cases where the mocked page shows the
same confirmation after every click; they happen before the change too.
