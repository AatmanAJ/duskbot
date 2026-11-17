// dweb's HTTP API (the local dusk bot network daemon) as MCP tools: dweb_status, dweb_repo_status, dweb_opencode_models,
// dweb_opencode_run (waits up to 5 min). dweb-proxy.ts serves them over stdio; the MCP host answers them in the harness.
type Json = Record<string, unknown>;

export const DEFAULT_DWEB_URL = "http://127.0.0.1:49737";

interface DwebTarget {
  base: string;
  /** The base URL without any credentials in it, for error text. */
  display: string;
}

function dwebTarget(url: string | undefined): DwebTarget {
  const base = (url ?? DEFAULT_DWEB_URL).replace(/\/+$/, "");
  let display = "(invalid DWEB_URL)";
  try {
    const parsed = new URL(base);
    parsed.username = "";
    parsed.password = "";
    display = parsed.toString().replace(/\/+$/, "");
  } catch {}
  return { base, display };
}

const TOOLS = [
  {
    name: "dweb_status",
    description:
      "Ping the local dweb daemon and report its status: server id, hostname, platform, version, uptime, peer count, and the services it runs. Call this first to confirm the network is reachable and see what's available.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "dweb_repo_status",
    description:
      "Report the state of the dusk bot repository the dweb daemon is tracking: repo name, checked-out branch, last commit, file count, and checkout path.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "dweb_opencode_models",
    description:
      "List the models available on dweb's opencode integration. Each has an id you can pass to dweb_opencode_run. Returns a note if no models are available.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "dweb_opencode_run",
    description:
      "Run a model on dweb's opencode integration and wait for the result. Give a command for the model to process; optionally pick a model with the 'model' arg (defaults to dweb's choice). Can take several minutes: use this for long-running model work and report the output back verbatim.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command/prompt to run on the model." },
        model: { type: "string", description: "Optional model id (from dweb_opencode_models)." },
      },
      required: ["command"],
    },
  },
];

async function api(dweb: DwebTarget, path: string, init?: RequestInit): Promise<Json> {
  const res = await fetch(dweb.base + path, {
    signal: AbortSignal.timeout(30_000),
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) throw new Error(String(body.error ?? `HTTP ${res.status}`));
  return body;
}

async function callTool(dweb: DwebTarget, name: string, args: Json): Promise<{ text: string; isError?: boolean }> {
  if (name === "dweb_status") {
    const r = await api(dweb, "/ping");
    const lines = [
      `status: ${String(r.status ?? "unknown")}`,
      `server: ${String(r.server ?? "unknown")}`,
      `id: ${String(r.id ?? "unknown")}`,
      `hostname: ${String(r.hostname ?? "unknown")}`,
      `platform: ${String(r.platform ?? "unknown")}`,
      `version: ${String(r.version ?? "unknown")}`,
      `uptime: ${String(r.uptime ?? "unknown")}`,
      `peers: ${String(r.peers ?? "unknown")}`,
      `services: ${String(r.services ?? "unknown")}`,
    ];
    return { text: `dweb status:\n${lines.join("\n")}` };
  }
  if (name === "dweb_repo_status") {
    const r = await api(dweb, "/api/repo/status");
    const lines = [
      `repo: ${String(r.repo ?? "unknown")}`,
      `branch: ${String(r.branch ?? "unknown")}`,
      `commit: ${String(r.commit ?? "unknown")}`,
      `files: ${String(r.files ?? "unknown")}`,
      `path: ${String(r.path ?? "unknown")}`,
    ];
    return { text: `dweb repo status:\n${lines.join("\n")}` };
  }
  if (name === "dweb_opencode_models") {
    const r = await api(dweb, "/api/opencode/models");
    const models = Array.isArray(r.models) ? r.models : [];
    if (!models.length) return { text: "No models available on dweb's opencode integration." };
    const lines = models.map((model) => {
      const id = typeof model === "object" && model !== null && "id" in model ? model.id : model;
      return `- ${String(id)}`;
    });
    return { text: `Models available on dweb's opencode integration:\n${lines.join("\n")}` };
  }
  if (name === "dweb_opencode_run") {
    if (typeof args.command !== "string" || !args.command.trim()) {
      return { text: "dweb_opencode_run needs a string command.", isError: true };
    }
    if (args.model !== undefined && typeof args.model !== "string") {
      return { text: "dweb_opencode_run model must be a string.", isError: true };
    }
    const command = args.command.trim();
    const model = args.model?.trim() || undefined;
    const r = await api(dweb, "/api/opencode/run", {
      method: "POST",
      body: JSON.stringify({ command, ...(model !== undefined ? { model } : {}) }),
      signal: AbortSignal.timeout(300000),
    });
    if (r.status === "error") {
      return {
        text: `dweb request failed at ${dweb.display}: ${String(r.error ?? r.output ?? "opencode run failed")}`,
        isError: true,
      };
    }
    return { text: String(r.output ?? "(no output)") };
  }
  return { text: `Unknown tool: ${name}`, isError: true };
}

const ok = (id: unknown, result: unknown): Json => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id: unknown, code: number, message: string): Json => ({ jsonrpc: "2.0", id, error: { code, message } });
const textResult = (id: unknown, text: string, isError = false) => ok(id, { content: [{ type: "text", text }], isError });

/** The dweb server's answers for `url` (DWEB_URL). */
export function dwebMcp(url: string | undefined): (msg: Json) => Promise<Json | undefined> {
  const dweb = dwebTarget(url);
  return async (msg) => {
    const id = msg.id;
    const method = msg.method as string | undefined;
    if (!method) return undefined;
    const params = (msg.params ?? {}) as Json;
    switch (method) {
      case "initialize":
        return ok(id, {
          protocolVersion: (params.protocolVersion as string) ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "dweb-proxy", version: "0.1.0" },
        });
      case "notifications/initialized":
      case "notifications/cancelled":
        return undefined;
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: TOOLS });
      case "tools/call": {
        const name = params.name as string;
        if (!TOOLS.some((t) => t.name === name)) return rpcErr(id, -32602, `Unknown tool: ${name}`);
        try {
          const rawArgs = params.arguments;
          const args = typeof rawArgs === "object" && rawArgs !== null && !Array.isArray(rawArgs) ? (rawArgs as Json) : {};
          const { text, isError } = await callTool(dweb, name, args);
          return textResult(id, text, isError);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return textResult(id, `dweb request failed at ${dweb.display}: ${message}`, true);
        }
      }
      default:
        return id !== undefined ? rpcErr(id, -32601, `Method not found: ${method}`) : undefined;
    }
  };
}
