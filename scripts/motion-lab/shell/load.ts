import type { Section } from "@lab/types";

export type Loaded = { sections: Section[]; failed: { path: string; error: string }[] };

// lazy, so one broken section shows as an error instead of taking the whole lab down
const modules = import.meta.glob<{ default: Section }>("../sections/*/index.tsx");

export async function loadSections(): Promise<Loaded> {
  const entries = Object.entries(modules);
  const results = await Promise.allSettled(entries.map(([, load]) => load()));
  const sections: Section[] = [];
  const failed: Loaded["failed"] = [];
  results.forEach((result, i) => {
    const path = entries[i][0].replace("../sections/", "").replace("/index.tsx", "");
    if (result.status === "rejected") failed.push({ path, error: String(result.reason?.message ?? result.reason) });
    else if (!result.value.default?.items) failed.push({ path, error: "no default export of { id, title, items }" });
    else sections.push(result.value.default);
  });
  sections.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id));
  return { sections, failed };
}
