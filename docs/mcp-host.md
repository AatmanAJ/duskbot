# The MCP host: dusk bot's own MCP servers inside the harness

A bot's engine reaches dusk bot's tools through MCP servers: `agents` (teammates, memory, cards), the harness tool
families (`browser`, `computer` on a relayed VPS, `data`, `email`, `device`), `dusk` (Claude's approvals and
`ask_user`), `dweb` and `phone`. Each used to be a Node relay process the engine started, per server, per warm engine,
plus a gate process in front of each one when the bot had a tool selection. The MCP host answers all of them inside
the harness instead, on its own loopback listener, and the engine gets one HTTP entry per server.

Measured on macOS arm64 with Claude Code 2.1.322, the same build with and without the host (dev run, relays from
`.ts` sources; a packaged app's bundled relays are smaller but just as many):

| Warm threads | Processes, relays | Processes, host | RSS, relays | RSS, host | Cold turn (median), relays | Cold turn, host |
|---|---|---|---|---|---|---|
| 1 | 6 | 2 | 1046 MB | 645 MB | 3.4 s | 3.4 s |
| 5 | 26 | 6 | 3649 MB | 1690 MB | 3.9 s | 4.2 s |
| 10 | 51 | 11 | 6847 MB | 2913 MB | 6.4 s | 4.8 s |

`scripts/bench-mcp-host.ts` measures the same with the fake engine, which starts every server of its launch the way
Claude Code does, for bots with and without a tool selection, and fails if any thread's MCP tools differ.

## How a turn gets its servers

1. The turn's integrations are built as before: stdio relay specs that carry the turn's capability (the comms token,
   a harness tool token, the permission broker's socket) in their environment.
2. `hostMcpServers` (`server/drivers/engine-mcp-host.ts`) recognizes dusk bot's own relays by the script they run
   (`server/mcp-host/relays.ts`) and mounts each on the host. A gate that does nothing but enforce a tool selection is
   replaced too, and the host enforces the selection (`server/mcp-host/scope-gate.ts`). Anything else stays as it was:
   the person's own servers, third parties' servers, remote servers behind the remote proxy, and any gate that trims
   results, fits schemas, lists a tool directory or watches an MCP app.
3. A mount (`server/mcp-host/mounts.ts`) holds the relay's settings in the harness and is named by a random 256-bit
   bearer. The engine is handed `{ "type": "http", "url": "http://127.0.0.1:<port>/api/internal/mcp-host/<server>",
   "headers": { "Authorization": "Bearer <mount bearer>" } }`.
4. Each engine launch takes a lease on its mounts and gives it back when the engine goes. While any lease holds a
   mount, the same thread, server and settings get the same bearer, so a warm engine's launch contract is equal from
   turn to turn and the engine stays warm. The last release revokes the bearer.

| Engine | How it reaches the host | Falls back to relays |
|---|---|---|
| Claude Code | `type: "http"` entries in its `--mcp-config` | for a CLI older than 1.0.27 or one whose version can't be read |
| Pi | dusk bot's own Pi extension speaks Streamable HTTP | never (the extension is ours) |
| ACP agents that take URL servers (opencode) | `type: "http"` in `session/new` | agents that only take stdio |
| Codex 0.167 and later | its own `url` mounts of the turn capability, as before | below 0.167 |

`DUSK_MCP_HOST=0` keeps every engine on its relays.

## The endpoint

`POST /api/internal/mcp-host/<server>` speaks MCP's Streamable HTTP transport on the harness's existing loopback port:
no new listener, so no firewall prompt on Windows or macOS. A request answers with JSON; a tool call still running after
two seconds answers as an event stream with a keep-alive comment every 15 seconds, so an approval or question that
waits on the person never trips an HTTP client's idle timer. There is no server-initiated stream (`GET` is 405) and no
session (`DELETE` is accepted and does nothing).

## Security

- **One bearer, one thread's one server.** A bearer resolves only on its own server's path, so a thread's `data` bearer
  never opens its `agents` tools, and a mount is bound to one thread at creation. Every refusal (missing, unknown,
  revoked, other server's bearer) is the same `401 unauthorized`.
- **The turn capability never reaches the engine.** With relays the engine process held the comms token and the
  harness tool tokens in its children's environment; with the host it holds only mount bearers, which are useless
  outside the host. The mount forwards to the harness with the turn capability, so every existing check still runs:
  the capability's kind, its generation (it works only during its turn), the bot and thread it was minted for.
- **Tool selection** is enforced in the host exactly as the gate enforced it: the list is filtered, a call outside the
  selection is refused before it reaches the server, and the agents server is never bridged behind a selection.
- **Approvals** still go through Claude's `--permission-prompt-tool mcp__dusk__approve`; the host's `dusk` mount talks to
  the thread's permission broker over its unix socket (a named pipe on Windows). A keep-warm fork gets a `dusk` mount
  that lists the same tools and reaches no broker. When a new broker is bound for a thread, its `dusk` mounts reconnect.
- **Guests** keep `--restricted`, the guest tool list and only `mcp__dusk` and `mcp__agents` pre-allowed.
  `--strict-mcp-config` is unchanged.
- **Logs and argv**: bearers live in the 0600 MCP config file Claude reads at launch, never on argv; the host stores
  only a SHA-256 of each bearer and never logs one.
- **Identity headers**: an `agents` mount also carries `X-Dusk-Bot-Id` and `X-Dusk-Thread-Id`, which the relay's
  environment already showed the engine. A request whose headers disagree with the mount is refused.
- **Bot box**: the box already bridges `/api/internal/` to the harness, so a boxed engine reaches the host the way its
  relays reached the harness. It no longer needs the broker's socket mounted.

`server/mcp-host-security.e2e.test.ts` holds these on a real server, whatever carries the credentials: each thread's are
its own, they work only during its turn, a tool selection narrows what is listed and run, and none reaches the log.

## The warm-engine pool

Every driver's idle engines share one least-recently-used pool (`server/drivers/warm-pool.ts`), on every machine size.
When an engine goes idle the pool measures each idle engine's whole process tree (`server/process-tree.ts`: `/proc`
on Linux, `ps` on macOS, a CIM query on Windows, at most every 30 seconds) and closes the longest idle until the rest
fit a quarter of the machine's memory, between 384 MB and 8 GB. `DUSK_WARM_ENGINES_MB` sets the budget. The engine
that just went idle is always kept, and a small box short of memory still keeps one idle engine at most. A process
other threads share (an ACP host, a Codex app server with several threads) is counted at the unmeasured default.
