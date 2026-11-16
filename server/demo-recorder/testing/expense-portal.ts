// A stand-in for the kind of site Show it once is for: an old corporate expense portal, drawn by its server one page at
// a time, with tables for layout, labels that belong to nothing, and element ids that change on every load. Run it alone
// with `node --experimental-strip-types server/demo-recorder/testing/expense-portal.ts --port 4780`.
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

export interface FiledExpense {
  id: string;
  date: string;
  merchant: string;
  category: string;
  amount: string;
  paidWith: string;
  billable: boolean;
  notes: string;
  receipt: string;
  receiptBytes: number;
}

type Draft = Omit<FiledExpense, "id">;

interface Session {
  user: string;
  draft: Draft | null;
}

export interface ExpensePortalOptions {
  port?: number;
  user?: string;
  password?: string;
}

export const PORTAL_USER = "ada.lovelace";
export const PORTAL_CATEGORIES = ["Meals", "Travel", "Lodging", "Office supplies", "Software", "Other"] as const;
const PAID_WITH: Record<string, string> = { corp: "Company card", personal: "Personal card" };

const STYLE = `
  body { margin: 0; background: #d9dde3; font: 12px Verdana, Geneva, Tahoma, sans-serif; color: #1c2733; }
  #band { background: #1f3a5f; color: #fff; padding: 9px 16px; border-bottom: 3px solid #c8962e; }
  #band b { font-size: 15px; letter-spacing: .3px; }
  #band span { float: right; font-size: 11px; opacity: .85; padding-top: 3px; }
  #nav { background: #edf0f4; border-bottom: 1px solid #a9b3c1; padding: 6px 16px; }
  #nav a { margin-right: 18px; color: #1f3a5f; }
  #page { width: 760px; margin: 18px auto; background: #fff; border: 1px solid #a9b3c1; padding: 14px 20px 22px; }
  h1 { font-size: 16px; margin: 4px 0 12px; color: #1f3a5f; border-bottom: 1px solid #c9d0da; padding-bottom: 6px; }
  table.frm td { padding: 5px 8px 5px 0; vertical-align: top; }
  td.lbl { width: 150px; font-weight: bold; color: #33475f; padding-top: 8px; }
  table.grid { border-collapse: collapse; width: 100%; }
  table.grid th { background: #1f3a5f; color: #fff; text-align: left; padding: 5px 8px; font-size: 11px; }
  table.grid td { border-bottom: 1px solid #dfe3e9; padding: 5px 8px; }
  input[type=text], input[type=password], select, textarea { font: 12px Verdana, sans-serif; border: 1px solid #7f8ea3; padding: 3px 4px; }
  textarea { width: 330px; height: 54px; }
  fieldset { border: 1px solid #c9d0da; margin: 0; padding: 4px 10px 6px; }
  legend { font-weight: bold; color: #33475f; }
  .btn, button { font: bold 12px Verdana, sans-serif; background: #e7ebf0; border: 1px solid #6b7a90; padding: 4px 14px; cursor: pointer; }
  .err { background: #fdecea; border: 1px solid #c0392b; color: #8e2218; padding: 6px 10px; margin-bottom: 10px; }
  .ok { background: #e8f5e9; border: 1px solid #3c8d40; color: #22592a; padding: 8px 10px; margin-bottom: 12px; }
  .foot { margin-top: 18px; color: #6b7a90; font-size: 10px; }
`;

const escapeHtml = (text: string) => text.replace(/[&<>"']/gu, (char) => `&#${char.charCodeAt(0)};`);

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) cookies[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return cookies;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

interface Posted {
  fields: Record<string, string>;
  files: Record<string, { name: string; bytes: number }>;
}

function parsePosted(contentType: string, body: Buffer): Posted {
  const posted: Posted = { fields: {}, files: {} };
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/iu.exec(contentType);
  if (!boundary) {
    for (const [name, value] of new URLSearchParams(body.toString("utf8"))) posted.fields[name] = value;
    return posted;
  }
  const marker = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let at = body.indexOf(marker);
  while (at >= 0) {
    const next = body.indexOf(marker, at + marker.length);
    if (next < 0) break;
    const part = body.subarray(at + marker.length, next);
    const split = part.indexOf("\r\n\r\n");
    if (split >= 0) {
      const head = part.subarray(0, split).toString("utf8");
      const content = part.subarray(split + 4, part.length - 2);
      const name = /name="([^"]*)"/u.exec(head)?.[1];
      const file = /filename="([^"]*)"/u.exec(head);
      if (name && file) {
        if (file[1]) posted.files[name] = { name: file[1].split(/[\\/]/u).pop() ?? file[1], bytes: content.length };
      } else if (name) {
        posted.fields[name] = content.toString("utf8");
      }
    }
    at = next;
  }
  return posted;
}

export class ExpensePortal {
  readonly user: string;
  readonly password: string;
  /** Every report filed, oldest first. */
  readonly filed: FiledExpense[] = [];
  /** The site after its redesign: the form's button has another name, as a real portal changes under a saved skill. */
  redesigned = false;
  port = 0;
  readonly #sessions = new Map<string, Session>();
  readonly #server: Server;
  #next = 1042;

  private constructor(options: ExpensePortalOptions) {
    this.user = options.user ?? PORTAL_USER;
    this.password = options.password ?? "portal-demo-password";
    this.#server = createServer((request, response) => {
      this.#handle(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain" });
        response.end("The portal failed.");
      });
    });
  }

  static async start(options: ExpensePortalOptions = {}): Promise<ExpensePortal> {
    const portal = new ExpensePortal(options);
    await new Promise<void>((resolve) => portal.#server.listen(options.port ?? 0, "127.0.0.1", resolve));
    portal.port = (portal.#server.address() as AddressInfo).port;
    return portal;
  }

  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  url(path: string): string {
    return `${this.origin}${path}`;
  }

  /** Signs everyone out, as the portal's own timeout does. */
  signOutAll(): void {
    this.#sessions.clear();
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.#server.closeAllConnections?.();
      this.#server.close(() => resolve());
    });
  }

  #page(title: string, body: string, session: Session | null): string {
    const nav = session
      ? `<div id="nav"><a href="/expenses">My reports</a><a href="/expenses/new">New expense report</a><a href="/help">Help</a><a href="/logout">Sign out</a></div>`
      : "";
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)} - Harbor &amp; Vale eXpense</title><style>${STYLE}</style></head>
<body><div id="band"><b>Harbor &amp; Vale</b> &nbsp;eXpense Portal<span>${session ? `Signed in as ${escapeHtml(session.user)}` : "v4.2.1"}</span></div>${nav}
<div id="page"><h1>${escapeHtml(title)}</h1>${body}<div class="foot">Harbor &amp; Vale Corporate Services. Internal use only. Best viewed at 1024x768.</div></div></body></html>`;
  }

  #send(response: ServerResponse, html: string, status = 200): void {
    response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(html);
  }

  #redirect(response: ServerResponse, location: string, cookie?: string): void {
    response.writeHead(303, { location, "cache-control": "no-store", ...(cookie ? { "set-cookie": cookie } : {}) });
    response.end();
  }

  #loginPage(error = ""): string {
    const junk = randomBytes(3).toString("hex");
    return this.#page("Sign in", `${error ? `<div class="err" role="alert">${escapeHtml(error)}</div>` : ""}
<form method="post" action="/login">
<table class="frm">
<tr><td class="lbl">User ID</td><td><input type="text" name="uid" id="ctl00_${junk}_uid" size="26"></td></tr>
<tr><td class="lbl">Password</td><td><input type="password" name="pw" id="ctl00_${junk}_pw" size="26"></td></tr>
<tr><td></td><td><input type="submit" class="btn" value="Sign in"></td></tr>
</table></form>`, null);
  }

  #listPage(session: Session, notice = ""): string {
    const rows = this.filed.length
      ? this.filed.map((expense) => `<tr><td>${expense.id}</td><td>${escapeHtml(expense.date)}</td><td>${escapeHtml(expense.merchant)}</td><td>${escapeHtml(expense.category)}</td><td>$${escapeHtml(expense.amount)}</td><td>Filed</td></tr>`).join("")
      : `<tr><td colspan="6">No reports yet.</td></tr>`;
    return this.#page("My expense reports", `${notice}
<p><a href="/expenses/new">New expense report</a></p>
<table class="grid"><tr><th>Report</th><th>Date</th><th>Merchant</th><th>Category</th><th>Amount</th><th>Status</th></tr>${rows}</table>`, session);
  }

  #formPage(session: Session, values: Partial<Draft> = {}, error = ""): string {
    const junk = randomBytes(3).toString("hex");
    const id = (name: string) => `ctl00_${junk}_${name}`;
    const options = PORTAL_CATEGORIES.map((category) => `<option value="${category}"${values.category === category ? " selected" : ""}>${category}</option>`).join("");
    const paid = Object.entries(PAID_WITH).map(([value, label]) =>
      `<label><input type="radio" name="paid" value="${value}"${values.paidWith === label ? " checked" : ""}> ${label}</label> &nbsp; `).join("");
    return this.#page("New expense report", `${error ? `<div class="err" role="alert">${escapeHtml(error)}</div>` : ""}
<form method="post" action="/expenses/review" enctype="multipart/form-data">
<table class="frm">
<tr><td class="lbl">Report date</td><td><input type="text" name="date" id="${id("dt")}" size="14" placeholder="MM/DD/YYYY" value="${escapeHtml(values.date ?? "")}"></td></tr>
<tr><td class="lbl">Merchant</td><td><input type="text" name="merchant" id="${id("mr")}" size="38" value="${escapeHtml(values.merchant ?? "")}"></td></tr>
<tr><td class="lbl"><label for="${id("ct")}">Category</label></td><td><select name="category" id="${id("ct")}"><option value="">-- Select --</option>${options}</select></td></tr>
<tr><td class="lbl">Amount (USD)</td><td><input type="text" name="amount" id="${id("am")}" size="12" value="${escapeHtml(values.amount ?? "")}"></td></tr>
<tr><td class="lbl"></td><td><fieldset><legend>Paid with</legend>${paid}</fieldset></td></tr>
<tr><td class="lbl"></td><td><input type="checkbox" name="billable" id="${id("bl")}" value="1"${values.billable ? " checked" : ""}> <label for="${id("bl")}">Billable to client</label></td></tr>
<tr><td class="lbl">Notes</td><td><textarea name="notes" id="${id("nt")}" aria-label="Notes">${escapeHtml(values.notes ?? "")}</textarea></td></tr>
<tr><td class="lbl">Receipt</td><td><input type="file" name="receipt" id="${id("rc")}"></td></tr>
<tr><td></td><td><input type="submit" class="btn" value="${this.redesigned ? "Next step" : "Continue"}"> &nbsp; <a href="/expenses">Cancel</a></td></tr>
</table></form>`, session);
  }

  #reviewPage(session: Session, draft: Draft): string {
    const row = (label: string, value: string) => `<tr><td class="lbl">${label}</td><td>${escapeHtml(value) || "&nbsp;"}</td></tr>`;
    return this.#page("Review your report", `
<table class="frm">${row("Report date", draft.date)}${row("Merchant", draft.merchant)}${row("Category", draft.category)}${row("Amount (USD)", draft.amount)}${row("Paid with", draft.paidWith)}${row("Billable to client", draft.billable ? "Yes" : "No")}${row("Notes", draft.notes)}${row("Receipt", draft.receipt || "None attached")}</table>
<form method="post" action="/expenses/submit"><p><button type="submit">Submit report</button> &nbsp; <a href="/expenses/new">Back</a></p></form>`, session);
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", this.origin);
    const sid = parseCookies(request.headers.cookie).hvsid ?? "";
    const session = this.#sessions.get(sid) ?? null;
    const path = url.pathname;
    const method = request.method ?? "GET";

    if (path === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (path === "/logout") {
      this.#sessions.delete(sid);
      return this.#redirect(response, "/login", "hvsid=; Path=/; Max-Age=0");
    }
    if (path === "/login" || path === "/") {
      if (method === "POST") {
        const { fields } = parsePosted(request.headers["content-type"] ?? "", await readBody(request));
        if (fields.uid !== this.user || fields.pw !== this.password) return this.#send(response, this.#loginPage("The user ID or password is not correct."));
        const fresh = randomBytes(12).toString("hex");
        this.#sessions.set(fresh, { user: this.user, draft: null });
        return this.#redirect(response, "/expenses", `hvsid=${fresh}; Path=/; HttpOnly; SameSite=Lax`);
      }
      return session ? this.#redirect(response, "/expenses") : this.#send(response, this.#loginPage());
    }
    if (!session) return this.#redirect(response, "/login");
    if (path === "/help") return this.#send(response, this.#page("Help", "<p>Call the service desk on extension 4400.</p>", session));
    if (path === "/expenses") return this.#send(response, this.#listPage(session));
    if (path === "/expenses/new") return this.#send(response, this.#formPage(session, session.draft ?? {}));
    if (path === "/expenses/review" && method === "POST") {
      const { fields, files } = parsePosted(request.headers["content-type"] ?? "", await readBody(request));
      const draft: Draft = {
        date: (fields.date ?? "").trim(),
        merchant: (fields.merchant ?? "").trim(),
        category: (fields.category ?? "").trim(),
        amount: (fields.amount ?? "").trim(),
        paidWith: PAID_WITH[fields.paid ?? ""] ?? "",
        billable: fields.billable === "1",
        notes: (fields.notes ?? "").trim(),
        receipt: files.receipt?.name ?? "",
        receiptBytes: files.receipt?.bytes ?? 0,
      };
      const problem = !draft.date ? "Report date is required."
        : !draft.merchant ? "Merchant is required."
          : !draft.category ? "Choose a category."
            : !/^\d+(?:\.\d{1,2})?$/u.test(draft.amount) ? "Amount must be a number, such as 18.40."
              : !draft.paidWith ? "Say how this was paid." : "";
      if (problem) return this.#send(response, this.#formPage(session, draft, problem));
      session.draft = draft;
      return this.#send(response, this.#reviewPage(session, draft));
    }
    if (path === "/expenses/submit" && method === "POST") {
      await readBody(request);
      if (!session.draft) return this.#redirect(response, "/expenses/new");
      const expense: FiledExpense = { id: `ER-${this.#next++}`, ...session.draft };
      this.filed.push(expense);
      session.draft = null;
      return this.#redirect(response, `/expenses/done?id=${expense.id}`);
    }
    if (path === "/expenses/done") {
      const id = url.searchParams.get("id") ?? "";
      return this.#send(response, this.#listPage(session, `<div class="ok" role="status">Report ${escapeHtml(id)} was filed.</div>`));
    }
    this.#send(response, this.#page("Not found", "<p>That page does not exist.</p>", session), 404);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--port");
  const portal = await ExpensePortal.start({ port: at > 0 ? Number(process.argv[at + 1]) : 4780, password: process.env.PORTAL_PASSWORD });
  console.log(`expense portal: ${portal.url("/login")}  (user ${portal.user})`);
}
