// One person filing one expense in the fake portal, the way people really do it: a typo fixed, a mind changed, a page
// opened by mistake, clicks that mean nothing. The same task is what every Show it once test records and replays.
import { statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExpensePortal, FiledExpense } from "./expense-portal.ts";
import type { FakeBrowser } from "./fake-browser.ts";

export const INBOX = fileURLToPath(new URL("../../testing/fixtures/expense-portal/inbox/", import.meta.url));

export type Expense = Omit<FiledExpense, "id" | "receiptBytes">;

const row = (date: string, merchant: string, category: string, amount: string, paidWith: string, billable: boolean, notes: string, n: number): Expense =>
  ({ date, merchant, category, amount, paidWith, billable, notes, receipt: `receipt-${String(n).padStart(2, "0")}.txt` });

/** The twelve expenses of the inbox, in file order: the first is shown, the other eleven are replayed. */
export const EXPENSES: readonly Expense[] = [
  row("11/03/2026", "Blue Bottle Coffee", "Meals", "18.40", "Company card", true, "Coffee with the Acme team", 1),
  row("11/03/2026", "Lyft", "Travel", "42.15", "Company card", true, "Airport to client office", 2),
  row("11/04/2026", "Hotel Zephyr", "Lodging", "289.00", "Company card", true, "One night, client workshop", 3),
  row("11/04/2026", "Tartine Bakery", "Meals", "27.80", "Personal card", false, "Team breakfast", 4),
  row("11/05/2026", "Staples", "Office supplies", "63.49", "Company card", false, "Whiteboard markers and sticky notes", 5),
  row("11/05/2026", "Figma", "Software", "45.00", "Company card", false, "Extra editor seat, November", 6),
  row("11/06/2026", "Caltrain", "Travel", "16.50", "Personal card", true, "Day pass to Palo Alto", 7),
  row("11/06/2026", "Souvla", "Meals", "34.25", "Company card", true, "Lunch with client", 8),
  row("11/07/2026", "FedEx Office", "Other", "12.99", "Personal card", false, "Printed workshop handouts", 9),
  row("11/09/2026", "United Airlines", "Travel", "412.60", "Company card", true, "SFO to SEA, kickoff", 10),
  row("11/10/2026", "Ace Hotel Seattle", "Lodging", "236.00", "Company card", true, "One night, kickoff", 11),
  row("11/10/2026", "Victrola Coffee", "Meals", "9.75", "Personal card", false, "Coffee before the kickoff", 12),
];

export function receiptPath(expense: Expense): string {
  return join(INBOX, "receipts", expense.receipt);
}

/** What the portal holds once an expense is filed. */
export function filedAs(expense: Expense): Omit<FiledExpense, "id"> {
  return { ...expense, receiptBytes: statSync(receiptPath(expense)).size };
}

export const withoutId = ({ id: _id, ...rest }: FiledExpense): Omit<FiledExpense, "id"> => rest;

export interface ShowOptions {
  /** Called once each new page is showing, before the person acts on it: where a browser that cannot run a script in
   * every new document gets its recorder installed. */
  arrived?: () => Promise<void>;
  /** Also open Help by mistake on the way, a step the person deletes afterwards. */
  wander?: boolean;
  /** Paste this into Notes by mistake before the real note. */
  pasteIntoNotes?: string;
}

/** Signs in and files `expense`, mistakes and all. */
export async function showOneExpense(browser: FakeBrowser, portal: ExpensePortal, expense: Expense, options: ShowOptions = {}): Promise<void> {
  const { person } = browser;
  const arrived = options.arrived ?? (async () => {});
  await browser.goto(portal.url("/login"));
  await arrived();
  await person.type("[name=uid]", "ada.lovelase");
  await person.clear("[name=uid]");
  await person.type("[name=uid]", portal.user);
  await person.type("[name=pw]", portal.password);
  await person.click("input[type=submit]");
  await arrived();
  await person.clickNowhere();
  await person.scroll();
  if (options.wander) {
    await person.click('#nav a[href="/help"]');
    await arrived();
  }
  await person.click('#nav a[href="/expenses/new"]');
  await arrived();
  await person.type("[name=date]", expense.date);
  await person.type("[name=merchant]", "Blue Bottel");
  await person.clear("[name=merchant]");
  await person.type("[name=merchant]", expense.merchant);
  await person.select("[name=category]", expense.category === "Travel" ? "Meals" : "Travel");
  await person.select("[name=category]", expense.category);
  await person.click("[name=amount]");
  await person.click("[name=date]");
  await person.type("[name=amount]", expense.amount);
  await person.press("Tab");
  await person.click(`[name=paid][value=${expense.paidWith === "Company card" ? "personal" : "corp"}]`);
  await person.click(`[name=paid][value=${expense.paidWith === "Company card" ? "corp" : "personal"}]`);
  await person.click("[name=billable]");
  await person.click("[name=billable]");
  if (expense.billable) await person.click("label[for$=_bl]");
  await person.scroll();
  if (options.pasteIntoNotes) {
    await person.type("[name=notes]", options.pasteIntoNotes);
    await person.clear("[name=notes]");
  }
  await person.type("[name=notes]", expense.notes);
  await person.attach("[name=receipt]", [receiptPath(expense)]);
  await person.clickNowhere();
  await person.click("input[type=submit]");
  await arrived();
  await person.click("button[type=submit]");
  await arrived();
}

/** The steps `showOneExpense` comes to, as sentences, before any value is made a blank. */
export function shownSentences(portal: ExpensePortal, expense: Expense, { wander = false } = {}): string[] {
  return [
    `Open ${portal.url("/login")}.`,
    "Sign in to 127.0.0.1 with the saved login from the Vault (fill_login). Never type a password yourself.",
    ...(wander ? ['Click the "Help" link.'] : []),
    'Click the "New expense report" link.',
    `Type "${expense.date}" into the field labelled "Report date".`,
    `Type "${expense.merchant}" into the field labelled "Merchant".`,
    `Choose "${expense.category}" in the "Category" list.`,
    `Type "${expense.amount}" into the field labelled "Amount (USD)".`,
    `Pick "${expense.paidWith}" in the "Paid with" choices.`,
    ...(expense.billable ? ['Tick the "Billable to client" checkbox.'] : []),
    `Type "${expense.notes}" into the field labelled "Notes".`,
    `Attach the file "${expense.receipt}" to the "Receipt" file picker.`,
    'Click the "Continue" button.',
    'Click the "Submit report" button.',
  ];
}
