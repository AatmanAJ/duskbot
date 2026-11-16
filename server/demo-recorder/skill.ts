import type { DemoAction, DemoBlank, DemoCheck, DemoPlan } from "../../shared/demo-recording.ts";
import { DESCRIPTION_MAX, isSkillName, SKILL_NAME_MAX, yamlFrontmatterValue } from "../../shared/skill-md.ts";

const FALLBACK_NAME = "shown-task";

/** A skill's name from any words: lowercase, hyphens between. */
export function skillNameFrom(words: string): string {
  const slug = words.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, SKILL_NAME_MAX).replace(/-+$/g, "");
  return slug && isSkillName(slug) ? slug : FALLBACK_NAME;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

function inputLine(blank: DemoBlank): string {
  const head = `- \`${blank.name}\` (${oneLine(blank.label)})`;
  if (blank.kind === "secret") return `${head}: comes from the saved sign-in for this site. Never ask for it and never type it yourself; fill it with the sign-in tool.`;
  const kind = blank.kind === "choice" && blank.choices?.length ? `one of ${blank.choices.map((choice) => `"${oneLine(choice)}"`).join(", ")}` : blank.kind === "choice" ? "a choice from a list" : `a ${blank.kind === "text" ? "piece of text" : blank.kind}`;
  return `${head}: ${kind}${blank.example !== undefined && blank.example.trim() ? `, for example "${oneLine(blank.example)}"` : ""}`;
}

function shown(action: DemoAction, secrets: ReadonlySet<string>): string {
  if (action.do === "open") return `open ${action.url}`;
  if (action.do === "press") return `press ${action.key}`;
  const what = `the ${action.role} "${oneLine(action.name)}"`;
  if (action.do === "click") return `click ${what}`;
  const secret = [...secrets].some((name) => action.value.includes(`{{${name}}}`));
  if (action.do === "choose") return `choose ${action.value} in ${what}`;
  return secret ? `fill ${what} from the saved sign-in` : `type ${action.value} into ${what}`;
}

/** A check as the words a skill carries: what to look for, with the blanks still written {{name}}. */
export function checkWords(check: DemoCheck): string {
  if (check.kind === "text") return `the screen shows "${oneLine(check.text)}" (a * stands for anything)`;
  if (check.kind === "field") return `the ${check.role} "${oneLine(check.name)}" holds ${check.value}`;
  if (check.kind === "title") return `the page or window is titled "${oneLine(check.text)}"`;
  if (check.kind === "url") return `the address contains ${oneLine(check.text)}`;
  return oneLine(check.expect);
}

/** The SKILL.md a plan is saved as. */
export function renderDemoSkill(plan: DemoPlan, options: { name?: string } = {}): { name: string; content: string } {
  const name = skillNameFrom(options.name?.trim() || plan.title);
  const inputs = plan.blanks.filter((blank) => blank.kind !== "secret").map((blank) => blank.name);
  const lead = oneLine(plan.summary) || oneLine(plan.title);
  const description = oneLine(`${sentence(lead)} Learned from one demonstration by a person.${inputs.length ? ` Inputs: ${inputs.join(", ")}.` : ""}`).slice(0, DESCRIPTION_MAX);
  const secrets = new Set(plan.blanks.filter((blank) => blank.kind === "secret").map((blank) => blank.name));
  const steps = plan.steps.flatMap((step, index) => [
    `${index + 1}. **${oneLine(step.title)}**`,
    `   Goal: ${oneLine(step.goal)}`,
    ...(step.actions.length ? [`   As shown: ${step.actions.map((action) => shown(action, secrets)).join("; ")}.`] : []),
    ...(step.point && !step.actions.length ? [`   Where: about ${Math.round(step.point.x)}, ${Math.round(step.point.y)} on the screen as it was when this was shown.`] : []),
    `   Check: ${checkWords(step.check)}.`,
  ]);
  const content = [
    "---",
    `name: ${name}`,
    `description: ${yamlFrontmatterValue(description)}`,
    "---",
    "",
    `# ${oneLine(plan.title)}`,
    "",
    sentence(lead),
    "",
    "A person showed this task once and it was turned into the steps below. `{{name}}` in a step stands for that input's value.",
    "",
    "## Inputs",
    "",
    ...(plan.blanks.length ? plan.blanks.map(inputLine) : ["None: the task is the same every time."]),
    "",
    "## Steps",
    "",
    "Work through the steps in order. Each step is a goal, not a recipe: \"As shown\" is how the person did it, found by what things are called, never by where they sat on the screen. After each step, make sure its check holds before going on.",
    "",
    "If a check does not hold, look at the screen. Something may have moved, been renamed, or be covering the page. Deal with that, then try the step again, up to three times. If it still does not hold, stop that run and say which step failed and what the screen shows.",
    "",
    ...steps,
    "",
    "## Doing it for many",
    "",
    "For a folder of files or the rows of a table, read the inputs from each one, then run every step for it. Keep one line for each: done, or the step that failed and why. After a failure, go on to the next one. Skip one whose inputs cannot be read, and say which input was missing.",
    "",
  ].join("\n");
  return { name, content };
}

/** What a routine made from a plan asks the bot to do each time it runs. */
export function demoRoutinePrompt(plan: DemoPlan, skillName: string, source: string): string {
  const inputs = plan.blanks.filter((blank) => blank.kind !== "secret").map((blank) => `${blank.name} (${oneLine(blank.label)})`);
  const secrets = plan.blanks.filter((blank) => blank.kind === "secret").map((blank) => blank.name);
  return [
    `Use your skill \`${skillName}\` once for each of ${oneLine(source)}.`,
    inputs.length ? `For each one, read these inputs: ${inputs.join(", ")}.` : "It takes no inputs.",
    ...(secrets.length ? [`Fill ${secrets.join(", ")} from the saved sign-in, never by typing.`] : []),
    "Run every step and make sure its check holds before the next. When all are done, report one line for each: done, or the step that failed and what the screen showed. Skip one whose inputs cannot be read and say which input was missing.",
  ].join(" ");
}
