import type { BenchTask } from "./task.ts";
import { COMPOSER_TASKS } from "./tasks-composers.ts";
import { FILE_TASKS } from "./tasks-files.ts";
import { FLOW_TASKS } from "./tasks-flows.ts";
import { FRAME_TASKS } from "./tasks-frames.ts";
import { LIST_TASKS } from "./tasks-lists.ts";
import { OVERLAY_TASKS } from "./tasks-overlays.ts";
import { WIDGET_TASKS } from "./tasks-widgets.ts";

export const TASKS: BenchTask[] = [...COMPOSER_TASKS, ...LIST_TASKS, ...WIDGET_TASKS, ...FRAME_TASKS, ...OVERLAY_TASKS, ...FLOW_TASKS, ...FILE_TASKS];
