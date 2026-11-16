import type { DemoPlan, DemoStep } from "./demo-recording.ts";

const todo = (): never => { throw new Error("not built"); };

export const BLANK_NAME = /^[a-z][a-z0-9_]{0,39}$/;

/** The blanks a piece of text names, in order, once each. */
export function blankNames(_text: string): string[] { return todo(); }

/** Text with each {{name}} replaced by its value; a blank with no value stays as written. */
export function fillBlanks(_text: string, _values: Readonly<Record<string, string>>): string { return todo(); }

/** Whether `text` holds `pattern`, where * stands for anything, ignoring case and spacing. */
export function matchesPattern(_pattern: string, _text: string): boolean { return todo(); }

/** A name a blank may have, made from a field's label. */
export function blankNameFrom(_label: string, _taken: ReadonlySet<string>): string { return todo(); }

export function renameBlank(_plan: DemoPlan, _from: string, _to: string): DemoPlan | { error: string } { return todo(); }

/** Makes a blank a fixed value: every {{name}} becomes the value and the blank goes. */
export function fixBlank(_plan: DemoPlan, _name: string, _value: string): DemoPlan | { error: string } { return todo(); }

export function moveStep(_plan: DemoPlan, _stepId: string, _toIndex: number): DemoPlan { return todo(); }

export function removeStep(_plan: DemoPlan, _stepId: string): DemoPlan { return todo(); }

export function updateStep(_plan: DemoPlan, _stepId: string, _patch: Partial<Pick<DemoStep, "title" | "goal" | "check">>): DemoPlan | { error: string } { return todo(); }

/** A plan as it may be saved: known shapes only, every blank a step names declared, every step with a goal and a check. */
export function validatePlan(_value: unknown): { plan: DemoPlan } | { error: string } { return todo(); }
