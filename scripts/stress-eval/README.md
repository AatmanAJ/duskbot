# Stress eval

Many realistic conversations, judged. `run.ts` starts real dusk bot servers from `--repo` (each with its own data
folder under `--tmp` and a port pair in 8900-8999, never `~/.duskbot`), gives each conversation a new bot on one
OpenAI-compatible engine pointed at the gateway (streaming, as the app runs it), and talks to it through the app's
HTTP routes and live event stream (`/api/events`). Several conversations run at once on each server and several
servers run at once; a server is replaced after `--recycle` conversations.

```
python3 scripts/stress-eval/fixtures.py <fixtures>      # receipt, whiteboard, chart, invoice, CV, three CSVs
node --experimental-strip-types scripts/stress-eval/run.ts --tmp <scratch>/tmp --out <scratch>/run1 --fixtures <fixtures> \
  [--model gpt-6.2-sol] [--judge gpt-6.2-sol] [--repeat 2] [--servers 4] [--parallel 3] [--only id,id]
node --experimental-strip-types scripts/stress-eval/summary.ts <scratch>/run1/results.jsonl
```

`DUSK_MODEL_DIR` may point at a copy of the local embedding model so servers do not download it. The gateway key is
read as the memory eval reads it and is written only into each server's own `config.json` (0600), removed with its
data folder; results hold transcripts, so keep `--out` outside the repo.

- **Scenarios** (`scenarios.ts`): personas (business owner across sales, support, hiring, bookkeeping and marketing;
  an agency monitoring Telegram, WhatsApp and email; student; developer; creator; non-native English; angry; vague;
  typos and dictation; Hindi and Hinglish; Portuguese) times shapes (corrections, interruptions sent while the bot
  works, "make it 3 bullets", follow-ups on earlier files, image/PDF/CSV attachments, memory across new chats,
  routines, monitors, capability questions, the headless browser, harmful-but-benign asks, long jobs).
- **Hard checks** (`checks.ts`): every file and document a bot shared opens, web links load, no tool names or step
  traces in chat, no error text or runtime errors, no turn without a reply, no stuck turn, first words within 20 s
  and turns within 120 s.
- **Judge** (`judge.ts`): reads the conversation as the person saw it plus what really happened (tools run,
  automations and waits that exist, memory, check results) and returns a 1-5 score, pass and rubric flags.
