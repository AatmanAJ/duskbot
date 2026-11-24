# Re-shoot: a follow-up with no quick reply

Fake engine (deterministic), in a dusk bot checkout:

1. `git apply fake-steer-log.patch` (logs every steer the fake engine receives; not part of the PR).
2. `echo __FAIL__ > /tmp/fail.txt`, then
   `FAKE_CLAUDE_TEXT_FILE=/tmp/fail.txt FAKE_CLAUDE_STEER_LOG=/tmp/steers.jsonl node --experimental-strip-types scripts/control-dusk.ts ui launch --script '[{"text":"I am drafting the Hana email as a Word document now."},{"waitMs":6000},{"ifSteered":"(steered)"},{"waitMs":40000},{"text":"Here is the Word document."}]'`
3. `node fake-drive.mjs <url> <botId> out` (pairs as a person, sends the job, then the second ask 2.5 s later).
4. `/tmp/steers.jsonl` holds what the engine read; the server log has `side reply: none ... takes its usual path`.

Real engine (Codex): add `timeoutMs: Number(process.env.DUSK_VERIFY_SIDE_TIMEOUT_MS) || undefined` to the
`createSideReplies` deps in server/index.ts (not part of the PR), start the climb's real-engine fixture with
`DUSK_VERIFY_SIDE_TIMEOUT_MS=1`, put a new bot on codex / gpt-5.6-luna / low, and run
`node real-drive.mjs <harness> <botId> "<Word job>" "Who are ustwo's two closest competitors in London?"`
(the second ask goes once the bot's first row shows, so it is not folded in as a burst). Pin both bots to
orange (`PATCH /api/bots/:id {"color":"orange"}`) before the screenshots (1280x900 at 2x).
Frame: `frame.mjs --in before.raw --in after.raw --crop 300,308,975,482 --crop 300,452,975,336 --arrange stack`.
