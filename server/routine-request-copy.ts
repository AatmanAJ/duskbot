import { plainTimeZone } from "../shared/plain-time-zone.ts";
import type { RoutineRequestDefinition, RoutineRequestSchedule } from "../shared/routine-request.ts";
import { redactSecretsInText } from "./redact.ts";
import { plainCronWhen } from "./routine-cron-words.ts";
import { intervalHasRestrictions, type RoutineManager } from "./routines.ts";
import { serverLine } from "./server-lines.ts";

export function consequenceLine(schedule: RoutineRequestSchedule, continuity = false): string {
  const session = continuity ? "each run starts a fresh session with the previous run's report" : "each run starts a fresh session";
  if (schedule.type === "cron") return `${plainCronWhen(schedule) ?? `Will run at matching calendar times, ${plainTimeZone(schedule.timeZone)}`}; ${session}.`;
  if (schedule.type === "once") return "Will run once; that run starts a fresh session.";
  if (schedule.type === "limit_reset") {
    return schedule.repeat === "every_reset"
      ? "Will run a minute after each time that usage limit resets, in this conversation."
      : "Will run once, a minute after that usage limit resets, and continue in this conversation.";
  }
  if (schedule.type === "interval") {
    if (intervalHasRestrictions(schedule)) {
      return `Will run every ${schedule.everyMinutes} minutes when its day, time, and end restrictions allow; ${session}.`;
    }
    const runsPerDay = Math.round(1440 / schedule.everyMinutes);
    const cadence = runsPerDay <= 1 ? "about once a day" : `about ${runsPerDay} times a day`;
    return `Will run ${cadence}; ${session}.`;
  }
  const days = schedule.weekdays.length;
  const cadence = days === 7 ? "every day" : days === 1 ? "one day a week" : `${days} days a week`;
  return `Will run ${cadence}; ${session}.`;
}

export function chainLines(chain: RoutineRequestDefinition["chain"], manager: RoutineManager): string[] {
  const name = (id: string) => redactSecretsInText(manager.listRoutines().find((routine) => routine.id === id)?.name ?? "a removed automation");
  return [
    ...(chain?.readFrom?.length ? [serverLine(undefined, "server.routine.chainReads", { routines: chain.readFrom.map(name).join(", ") })] : []),
    ...(chain?.after?.length ? [serverLine(undefined, "server.routine.chainAfter", { routines: chain.after.map(name).join(", ") })] : []),
    ...(chain?.handTo ? [serverLine(undefined, "botId" in chain.handTo ? "server.routine.chainToBot" : "server.routine.chainToRoom")] : []),
  ];
}
