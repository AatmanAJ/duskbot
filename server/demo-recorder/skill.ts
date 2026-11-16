import type { DemoPlan } from "../../shared/demo-recording.ts";

const todo = (): never => { throw new Error("not built"); };

/** The SKILL.md a plan is saved as. */
export function renderDemoSkill(_plan: DemoPlan, _options?: { name?: string }): { name: string; content: string } { return todo(); }

/** What a routine made from a plan asks the bot to do each time it runs. */
export function demoRoutinePrompt(_plan: DemoPlan, _skillName: string, _source: string): string { return todo(); }
