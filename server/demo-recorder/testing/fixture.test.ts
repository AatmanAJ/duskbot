// The stand-ins themselves: the fake portal and the fake browser must work by hand before anything is recorded on them.
import { afterEach, describe, expect, it } from "vitest";

import { ExpensePortal } from "./expense-portal.ts";
import { FakeBrowser } from "./fake-browser.ts";
import { EXPENSES, filedAs, showOneExpense, withoutId } from "./scenario.ts";
import { testVault } from "./vault.ts";

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step(); });

async function fixture() {
  const portal = await ExpensePortal.start();
  const browser = new FakeBrowser();
  cleanup.push(() => portal.close(), () => browser.close());
  return { portal, browser };
}

describe("the fake expense portal in the fake browser", () => {
  it("files an expense a person enters by hand, mistakes and all", async () => {
    const { portal, browser } = await fixture();
    await showOneExpense(browser, portal, EXPENSES[0]!, { wander: true });
    expect(browser.url).toContain("/expenses/done?id=ER-1042");
    expect(browser.text()).toContain("Report ER-1042 was filed.");
    expect(portal.filed.map(withoutId)).toEqual([filedAs(EXPENSES[0]!)]);
    portal.signOutAll();
    await showOneExpense(browser, portal, EXPENSES[3]!);
    expect(portal.filed.map(withoutId)).toEqual([filedAs(EXPENSES[0]!), filedAs(EXPENSES[3]!)]);
  });

  it("turns away a wrong password, sends the signed-out to the sign-in page, and changes its ids on every load", async () => {
    const { portal, browser } = await fixture();
    await browser.goto(portal.url("/expenses/new"));
    expect(browser.url).toBe(portal.url("/login"));
    const first = (browser.document.querySelector("[name=uid]") as unknown as { id: string }).id;
    await browser.person.type("[name=uid]", portal.user);
    await browser.person.type("[name=pw]", "not-the-password");
    await browser.person.press("Enter");
    expect(browser.text()).toContain("The user ID or password is not correct.");
    expect((browser.document.querySelector("[name=uid]") as unknown as { id: string }).id).not.toBe(first);
    expect(portal.filed).toEqual([]);
  });

  it("changes only digits in its ids, so no load spells a word like 2fa that makes fill_login read a code box", async () => {
    const { portal, browser } = await fixture();
    await browser.goto(portal.url("/login"));
    expect([...browser.document.querySelectorAll("input[id]")].map((input) => input.id)).toEqual([expect.stringMatching(/^ctl00_\d{6}_uid$/u), expect.stringMatching(/^ctl00_\d{6}_pw$/u)]);
  });

  it("refuses a report with a missing value, and renames its button once redesigned", async () => {
    const { portal, browser } = await fixture();
    await browser.goto(portal.url("/login"));
    const vault = testVault(browser.loginInput(), portal);
    expect(await vault.signIn("127.0.0.1")).toMatchObject({ ok: true });
    expect(browser.url).toBe(portal.url("/expenses"));
    await browser.goto(portal.url("/expenses/new"));
    await browser.person.type("[name=merchant]", "Lyft");
    await browser.person.click("input[type=submit]");
    expect(browser.text()).toContain("Report date is required.");
    expect((browser.document.querySelector("[name=merchant]") as unknown as { value: string }).value).toBe("Lyft");
    portal.redesigned = true;
    await browser.goto(portal.url("/expenses/new"));
    expect((browser.document.querySelector("input[type=submit]") as unknown as { value: string }).value).toBe("Next step");
  });
});
