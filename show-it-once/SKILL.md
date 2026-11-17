---
name: submit-expense-harbor-expenses
description: "Shown once on Harbor Expenses: 8 steps, 5 inputs. Learned from one demonstration by a person. Inputs: merchant, amount, date, category, notes."
---

# Submit expense · Harbor Expenses

Shown once on Harbor Expenses: 8 steps, 5 inputs.

A person showed this task once and it was turned into the steps below. `{{name}}` in a step stands for that input's value.

## Inputs

- `merchant` (Merchant): a piece of text, for example "Corner Deli"
- `amount` (Amount): a number, for example "18.40"
- `date` (Date): a date, for example "2026-11-02"
- `category` (Category): one of "Meals", "Travel", "Software", "Office supplies", "Other", for example "Meals"
- `notes` (Notes): a piece of text, for example "Team lunch"

## Steps

Work through the steps in order. Each step is a goal, not a recipe: "As shown" is how the person did it, found by what things are called, never by where they sat on the screen. After each step, make sure its check holds before going on.

If a check does not hold, look at the screen. Something may have moved, been renamed, or be covering the page. Deal with that, then try the step again, up to three times. If it still does not hold, stop that run and say which step failed and what the screen shows.

1. **Open Harbor Expenses**
   Goal: Go to http://127.0.0.1:5173/__harbor/portal.html?signedIn=1.
   As shown: open http://127.0.0.1:5173/__harbor/portal.html?signedIn=1.
   Check: the address contains http://127.0.0.1:5173/__harbor/portal.html.
2. **Click New expense**
   Goal: Click the "New expense" button.
   As shown: click the button "New expense".
   Check: the screen shows "New expense" (a * stands for anything).
3. **Enter Merchant**
   Goal: Type {{merchant}} into the "Merchant" field.
   As shown: type {{merchant}} into the textbox "Merchant".
   Check: the textbox "Merchant" holds {{merchant}}.
4. **Enter Amount**
   Goal: Type {{amount}} into the "Amount" field.
   As shown: type {{amount}} into the textbox "Amount".
   Check: the textbox "Amount" holds {{amount}}.
5. **Enter Date**
   Goal: Type {{date}} into the "Date" field.
   As shown: type {{date}} into the textbox "Date".
   Check: the textbox "Date" holds {{date}}.
6. **Choose Category**
   Goal: Choose {{category}} in the "Category" list.
   As shown: choose {{category}} in the combobox "Category".
   Check: the combobox "Category" holds {{category}}.
7. **Enter Notes**
   Goal: Type {{notes}} into the "Notes" field.
   As shown: type {{notes}} into the textbox "Notes".
   Check: the textbox "Notes" holds {{notes}}.
8. **Click Submit expense**
   Goal: Click the "Submit expense" button.
   As shown: click the button "Submit expense".
   Check: the screen shows "Expense EXP-* submitted: {{merchant}}, ${{amount}}" (a * stands for anything).

## Doing it for many

For a folder of files or the rows of a table, read the inputs from each one, then run every step for it. Keep one line for each: done, or the step that failed and why. After a failure, go on to the next one. Skip one whose inputs cannot be read, and say which input was missing.
