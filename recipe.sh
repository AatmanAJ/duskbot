#!/bin/zsh
# Re-shoot desktop-first-run.{hello,ai,chat}.raw.png from the real Electron window (macOS), all data temporary.
# Run from a duskbot checkout with node_modules: zsh <this folder>/recipe.sh
set -eu
REPO=$(git rev-parse --show-toplevel); HERE=${0:A:h}; S=$(mktemp -d /tmp/dusk-first-run.XXXXXX)
mkdir -p $S/home $S/data $S/electron $S/nodebin $S/tmp; ln -s "$(command -v node)" $S/nodebin/node
off='{"driver":"not-a-real-driver"}'
cat > $S/data/config.json <<JSON
{ "instances": { "codex": $off, "cursor": $off, "githubCopilot": $off, "qwen": $off, "hermes": $off, "pi": $off,
  "claude": {"driver":"claudeAgent","displayName":"Claude","config":{"cli":"$REPO/server/testing/fake-claude-cli.ts"}} } }
JSON
cd $REPO
env -i HOME=$S/home USER=$USER SHELL=/bin/zsh TMPDIR=$S/tmp LANG=en_GB.UTF-8 PATH="$S/nodebin:/usr/bin:/bin:/usr/sbin:/sbin" \
  DUSK_TEST_SEALED_PATH=1 DUSK_DATA_DIR=$S/data DUSK_PORT=20400 DUSK_WEBHOOK_PORT=20401 DUSK_UI_PORT=20450 DUSK_ANALYTICS=0 \
  DUSK_NO_TEST_BOTS=1 FAKE_CLAUDE_MODE=happy node scripts/dev-app.mjs --user-data-dir=$S/electron --use-mock-keychain \
  --remote-debugging-port=20460 > $S/app.log 2>&1 &
RUNNER=$!
for i in {1..120}; do node $HERE/cdp.mjs list 2>/dev/null | grep -q '20450/$' && break; sleep 0.5; done; sleep 4
ID=$(node $HERE/cdp.mjs list | grep '20450/$' | cut -c1-8)
node $HERE/cdp.mjs shot $ID $HERE/desktop-first-run.hello.raw.png
node $HERE/cdp.mjs click $ID "Get started"; sleep 1.5; node $HERE/cdp.mjs shot $ID $HERE/desktop-first-run.ai.raw.png
node $HERE/cdp.mjs click $ID "Use the Claude"; sleep 3; node $HERE/cdp.mjs shot $ID $HERE/desktop-first-run.chat.raw.png
kill $RUNNER; rm -rf $S
# framed: node scripts/brand-studio/frame.mjs --in <hello> --in <ai> --in <chat> --out desktop-first-run.framed.png \
#   --label "1 · hello" --label "2 · one AI choice" --label "3 · Dusk's chat" --arrange row
