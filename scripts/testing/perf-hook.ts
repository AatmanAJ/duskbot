/**
 * Render accounting for the transcript performance harness. React (19.x) reads
 * `__REACT_DEVTOOLS_GLOBAL_HOOK__` once, when react-dom first loads, so this
 * module must be imported before anything that imports React.
 */

interface Fiber {
  tag: number;
  type: unknown;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
  flags: number;
}

interface FiberRoot {
  current: Fiber;
}

export interface PerfReading {
  commits: number;
  profilerCommits: number;
  renderMs: number;
  maxCommitMs: number;
  p95CommitMs: number;
  componentRenders: number;
  topComponents: Array<[string, number]>;
  watched: Record<string, number>;
  elapsedMs: number;
}

export interface PerfProbe {
  reset(): void;
  read(): PerfReading;
  onRender(id: string, phase: string, actualDuration: number): void;
}

// React's work tags (ReactWorkTags, 19.x) for components that run user code.
const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
// ReactFiberFlags.PerformedWork.
const PERFORMED_WORK = 1;
const WATCHED = ["Bubble", "MessagesList", "RoomMessagesList", "Sidebar", "ChatView", "GroupView", "App", "SidebarBotRow", "ThreadChip", "OptionCard", "QuestionCard", "ActivityChip"];

const counts = new Map<string, number>();
let commits = 0;
let durations: number[] = [];
let startedAt = performance.now();

function componentName(type: unknown): string {
  if (typeof type === "function") return (type as { displayName?: string }).displayName || type.name || "Anonymous";
  if (type && typeof type === "object") {
    const wrapper = type as { displayName?: string; render?: { displayName?: string; name?: string }; type?: unknown };
    if (wrapper.displayName) return wrapper.displayName;
    if (wrapper.render) return wrapper.render.displayName || wrapper.render.name || "ForwardRef";
    if (wrapper.type) return componentName(wrapper.type);
  }
  return "Anonymous";
}

function count(fiber: Fiber) {
  if (!COMPONENT_TAGS.has(fiber.tag) || (fiber.flags & PERFORMED_WORK) === 0) return;
  const name = componentName(fiber.type);
  counts.set(name, (counts.get(name) ?? 0) + 1);
}

function mounted(fiber: Fiber) {
  count(fiber);
  for (let child = fiber.child; child; child = child.sibling) mounted(child);
}

function updated(next: Fiber, previous: Fiber) {
  count(next);
  if (next.child === previous.child) return;
  for (let child = next.child; child; child = child.sibling) {
    if (child.alternate) updated(child, child.alternate);
    else mounted(child);
  }
}

function onCommitFiberRoot(_renderer: number, root: FiberRoot) {
  commits++;
  const current = root.current;
  if (current.alternate) updated(current, current.alternate);
  else mounted(current);
}

const renderers = new Map<number, unknown>();
(globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  renderers,
  supportsFiber: true,
  isDisabled: false,
  inject(renderer: unknown) {
    const id = renderers.size + 1;
    renderers.set(id, renderer);
    return id;
  },
  checkDCE() {},
  onScheduleFiberRoot() {},
  onCommitFiberRoot,
  onPostCommitFiberRoot() {},
  onCommitFiberUnmount() {},
};

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
}

// esbuild renames a component that shares its binding's name (`const Bubble = memo(function Bubble…)` is `Bubble2`).
const bundledAs = (name: string) => {
  let total = 0;
  for (const [key, value] of counts) if (key === name || (key.startsWith(name) && /^\d+$/.test(key.slice(name.length)))) total += value;
  return total;
};

const round = (value: number) => Math.round(value * 100) / 100;

export const perfProbe: PerfProbe = {
  reset() {
    counts.clear();
    commits = 0;
    durations = [];
    startedAt = performance.now();
  },
  read() {
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return {
      commits,
      profilerCommits: durations.length,
      renderMs: round(durations.reduce((sum, value) => sum + value, 0)),
      maxCommitMs: round(Math.max(0, ...durations)),
      p95CommitMs: round(percentile(durations, 0.95)),
      componentRenders: top.reduce((sum, [, value]) => sum + value, 0),
      topComponents: top.slice(0, 25),
      watched: Object.fromEntries(WATCHED.map((name) => [name, bundledAs(name)])),
      elapsedMs: round(performance.now() - startedAt),
    };
  },
  onRender(_id, _phase, actualDuration) {
    durations.push(actualDuration);
  },
};

(globalThis as Record<string, unknown>).__duskPerf = perfProbe;
