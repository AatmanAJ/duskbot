// dusk bot's approval and question server for Claude's --permission-prompt-tool (approve) and its ask_user tool: each ask
// goes to the thread's broker over its unix socket (a named pipe on Windows) and the answer comes back on the
// connection it went out on. permission-proxy.ts serves it over stdio; the MCP host answers it inside the harness.
import { connect, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { parseAskQuestions, questionAnswersByQuestion, type AskQuestion } from "../shared/ask-question.ts";
import { allowsTool, parseToolScope } from "../shared/tool-scope.ts";
import { REFUSED_NEXT_STEP } from "./reply-habits.ts";

interface BrokerAnswer {
  behavior?: string;
  message?: string;
  source?: string;
  always?: boolean;
}
type AskKind = "question" | "permission";
interface AllowPermissionResult {
  behavior: "allow";
  updatedInput: object;
  updatedPermissions?: object[];
}

/** What the bot is told when the person cannot be asked at all: what to do instead, so it never just skips. */
const UNREACHABLE_NOTE: Record<AskKind, string> = {
  question:
    "dusk bot could not show this question to the person: its question service did not answer. Do not retry this tool. Ask in your reply instead: end it with the exact question and stop there until they answer.",
  permission:
    "dusk bot could not ask the person to approve this step: its approval service did not answer. Skip this step, and say in your reply what you wanted to do and why, so the person can decide.",
};
const unreachable = (kind: AskKind): BrokerAnswer => ({ behavior: "deny", message: UNREACHABLE_NOTE[kind], source: "system" });

export interface PermissionMcp {
  answer(message: unknown): Promise<unknown | undefined>;
  close(): void;
}

/** `socketPath` null answers every ask as unreachable, for a keep-warm ping that must list the same tools and reach no one. */
export function createPermissionMcp(options: { socketPath: string | null; toolScope?: unknown }): PermissionMcp {
  const selection = parseToolScope(options.toolScope);
  if (!selection.ok) throw new Error(selection.error);
  const allowQuestion = allowsTool(selection.scope, { kind: "mcp", server: "dusk", name: "ask_user" });
  const socketPath = options.socketPath;
  let closed = false;
  /** Asks waiting for the broker, by id; an answer only ever comes back on the connection its ask went out on. */
  const waiting = new Map<string, { conn: Socket; kind: AskKind; resolve: (answer: BrokerAnswer) => void }>();
  let live: Socket | null = null;
  let opening: Promise<Socket | null> | null = null;

  function open(): Promise<Socket | null> {
    return new Promise((resolve) => {
      if (!socketPath || closed) return resolve(null);
      const conn = connect(socketPath);
      // JSON lines can span reads; a stream decoder keeps a split character whole.
      conn.setEncoding("utf8");
      let connected = false;
      let buf = "";
      conn.on("data", (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          let msg: any;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          const entry = msg?.t === "answer" ? waiting.get(String(msg.id)) : undefined;
          if (entry?.conn !== conn) continue;
          waiting.delete(String(msg.id));
          entry.resolve(msg);
        }
      });
      conn.once("connect", () => {
        connected = true;
        resolve(conn);
      });
      conn.on("error", () => {});
      conn.once("close", () => {
        if (!connected) resolve(null);
        if (live === conn) live = null;
        for (const [id, entry] of waiting) {
          if (entry.conn !== conn) continue;
          waiting.delete(id);
          entry.resolve(unreachable(entry.kind));
        }
      });
    });
  }

  /** The connection to the broker, opened again after a drop; a few quick tries ride out a broker that is still binding. */
  function brokerConnection(): Promise<Socket | null> {
    if (live && !live.destroyed) return Promise.resolve(live);
    opening ??= (async () => {
      for (const pause of [0, 200, 800]) {
        if (pause) await sleep(pause);
        const conn = await open();
        if (conn) return (live = conn);
      }
      return null;
    })().finally(() => {
      opening = null;
    });
    return opening;
  }
  // Connected at start, so a process that outlives its session never reaches a newer broker bound at the same path.
  void brokerConnection();

  async function askBroker(ask: Record<string, unknown> & { id: string }, kind: AskKind): Promise<BrokerAnswer> {
    const conn = await brokerConnection();
    if (!conn || conn.destroyed) return unreachable(kind);
    return new Promise((resolve) => {
      waiting.set(ask.id, { conn, kind, resolve });
      conn.write(JSON.stringify(ask) + "\n", (error) => {
        if (!error || waiting.get(ask.id)?.conn !== conn) return;
        waiting.delete(ask.id);
        resolve(unreachable(kind));
      });
    });
  }

  function multiSelectQuestion(args: Record<string, unknown>): AskQuestion[] | null {
    if (args.multiSelect !== true) return null;
    const options = Array.isArray(args.choices) ? args.choices : [];
    return parseAskQuestions({ questions: [{ question: args.question, multiSelect: true, options }] });
  }

  const ASK_USER_QUESTION = "AskUserQuestion";

  const asRecord = (value: unknown): Record<string, unknown> | null =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

  /** A bare allow makes the headless CLI run AskUserQuestion with no dialog ("The user did not answer the questions."),
   * so answers go in the tool's own `answers` field: keyed by question text, one comma-joined string each. */
  async function answerNativeQuestions(input: unknown): Promise<string> {
    const questions = parseAskQuestions(input);
    if (!questions?.length) {
      return JSON.stringify({
        behavior: "deny",
        message:
          "dusk bot: this AskUserQuestion call had no answerable question (each one needs question text), so nobody was shown it. Ask again with a well-formed call, or continue without it.",
      });
    }
    const answer = await askBroker({ t: "ask", id: randomUUID(), kind: "question", tool: ASK_USER_QUESTION, input: { questions } }, "question");
    if (answer.behavior === "deny") {
      return JSON.stringify({ behavior: "deny", message: answer.message || "Denied from dusk bot" });
    }
    // Only the person's own answer fills `answers`: the broker's notes (a timeout's sentence) would read as their choice.
    const answers =
      answer.source === "user" && typeof answer.message === "string"
        ? questionAnswersByQuestion(answer.message, questions)
        : {};
    return JSON.stringify({ behavior: "allow", updatedInput: { ...asRecord(input), answers } });
  }

  const TOOLS = [
    {
      name: "approve",
      description: "Ask the dusk bot user whether a tool use is allowed",
      inputSchema: {
        type: "object",
        properties: {
          tool_name: { type: "string" },
          input: { type: "object" },
          tool_use_id: { type: "string" },
        },
        required: ["tool_name", "input"],
      },
    },
    {
      name: "ask_user",
      description:
        "Ask the human who owns this bot a question and wait for their answer. Use whenever you need a decision, a preference, missing information, or sign-off before doing something consequential: do not guess on things the owner would want to decide. Returns their answer as text.",
      inputSchema: {
        type: "object",
        properties: {
          question: { type: "string", description: "The question, with enough context to answer at a glance" },
          choices: {
            type: "array",
            items: { type: "string" },
            description: "Optional 2-5 suggested answers, shown as one-tap buttons",
          },
          multiSelect: {
            type: "boolean",
            description: "Set true when the person may pick more than one of the choices. Their picks come back joined with commas.",
          },
        },
        required: ["question"],
      },
    },
  ];

  async function handle(msg: any): Promise<unknown | undefined> {
    if (msg.method === "initialize") {
      return ({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: msg.params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "duskbot-permissions", version: "1" },
        },
      });
    }
    // approve is the CLI's private permission callback, not an execution grant.
    if (msg.method === "tools/list") return { jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS.filter((tool) => tool.name === "approve" || allowQuestion) } };
    if (msg.method === "tools/call") {
      const name = msg.params?.name;
      const args = msg.params?.arguments ?? {};
      const reply = (text: string, isError = false) => ({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text }], ...(isError ? { isError } : {}) } });
      if (name === "ask_user" && !allowQuestion) return reply("dusk bot: this question tool is excluded by the bot's tool selection.");
      if (name === "approve" && args.tool_name === ASK_USER_QUESTION) {
        return reply(await answerNativeQuestions(args.input));
      }
      const askId = randomUUID();
      const isQuestion = name === "ask_user";
      const picksSeveral = isQuestion ? multiSelectQuestion(args) : null;
      // Hand the CLI's own suggested rules back as updatedPermissions, so claude stops asking at its own layer.
      const suggestions = Array.isArray(args.permission_suggestions)
        ? args.permission_suggestions
        : Array.isArray(args.suggestions)
          ? args.suggestions
          : null;
      const answer = await askBroker(
        isQuestion
          ? { t: "ask", id: askId, kind: "question", tool: "ask_user", input: { question: args.question, choices: args.choices, ...(picksSeveral ? { questions: picksSeveral } : {}) } }
          : { t: "ask", id: askId, tool: args.tool_name, input: args.input },
        isQuestion ? "question" : "permission",
      );
      let text = answer.message || "No answer was given: use your best judgment.";
      if (picksSeveral && answer.source === "user" && typeof answer.message === "string") {
        text = questionAnswersByQuestion(answer.message, picksSeveral)[picksSeveral[0]!.question] ?? text;
      }
      if (!isQuestion) {
        if (answer.behavior === "allow") {
          const result: AllowPermissionResult = { behavior: "allow", updatedInput: args.input ?? {} };
          if (answer.always && suggestions) result.updatedPermissions = suggestions;
          text = JSON.stringify(result);
        } else {
          text = JSON.stringify({ behavior: "deny", message: (answer.message || "Denied from dusk bot") + (answer.source === "user" ? REFUSED_NEXT_STEP : "") });
        }
      }
      return reply(text, isQuestion && answer.behavior === "deny");
    }
    if (String(msg.method ?? "").startsWith("notifications/")) return undefined;
    if (msg.id != null) {
      return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } };
    }
    return undefined;
  }

  return {
    answer: (message) => handle(message),
    close: () => {
      closed = true;
      live?.destroy();
      live = null;
    },
  };
}

