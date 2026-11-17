#!/usr/bin/env bash
# The tests a change to how engines reach MCP servers can break: every engine's MCP wiring, the HTTP mounts, warm
# engines, tool selection, and end-to-end turns that call the agents, data and dusk servers, with the security tests.
set -euo pipefail
cd "$(dirname "$0")/.."
DUSK_VITEST_WORKERS="${DUSK_VITEST_WORKERS:-8}" exec pnpm exec vitest run \
  server/drivers/claude.test.ts server/drivers/claude-keepwarm.test.ts server/drivers/claude-tool-search.test.ts \
  server/drivers/claude-box.test.ts server/drivers/claude-warm-summary.test.ts \
  server/drivers/codex-mcp-mount.test.ts server/drivers/codex-mcp-startup.test.ts server/drivers/codex.test.ts \
  server/drivers/turn-mcp.test.ts server/routes/own-mcp-http.test.ts \
  server/drivers/pi.test.ts server/drivers/pi-mcp-extension.test.ts \
  server/drivers/agents-proxy.test.ts server/drivers/agents-mcp-env.test.ts server/drivers/session-idle.test.ts \
  server/drivers/chat-mcp-own-servers.test.ts server/drivers/chat-mcp-tools.test.ts \
  server/drivers/acp/tool-scope.test.ts server/drivers/acp/acp.test.ts server/drivers/tool-scope-coverage.test.ts \
  server/testing/fake-claude-dump.test.ts \
  server/mcp-host \
  server/mcp-host-security.e2e.test.ts server/tool-scope.e2e.test.ts server/agents-bridge.e2e.test.ts \
  server/workspace-by-chat.e2e.test.ts server/question-cards.e2e.test.ts
