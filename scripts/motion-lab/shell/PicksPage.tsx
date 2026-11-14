import { useState } from "react";
import { Icon } from "@/components/Icon";
import type { Item, Section } from "@lab/types";
import { itemKey, type Picks } from "./prefs";

type Flat = { section: Section; item: Item }[];

const LABEL = { original: "keep original", a: "Variant A", b: "Variant B" } as const;

export function picksJson(flat: Flat, picks: Picks) {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      picks: flat.map(({ section, item }) => {
        const entry = picks[itemKey(section.id, item.id)] ?? {};
        return {
          section: section.id,
          item: item.id,
          title: item.title,
          pick: entry.pick ?? null,
          note: entry.note ?? "",
          chosen: entry.pick ? item.notes[entry.pick === "original" ? "original" : entry.pick] : null,
        };
      }),
    },
    null,
    2,
  );
}

export async function exportPicks(flat: Flat, picks: Picks, how: "copy" | "download") {
  const json = picksJson(flat, picks);
  if (how === "download") {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `motion-picks-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }
  try {
    await navigator.clipboard.writeText(json);
    return true;
  } catch {
    // clipboard api needs focus and a secure origin; the textarea copy works over plain http
    const area = Object.assign(document.createElement("textarea"), { value: json });
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export function PicksPage({ flat, picks, onOpen }: { flat: Flat; picks: Picks; onOpen: (section: string, item: string) => void }) {
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const picked = flat.filter(({ section, item }) => picks[itemKey(section.id, item.id)]?.pick).length;
  const sections = [...new Map(flat.map((f) => [f.section.id, f.section])).values()];

  return (
    <div className="lab-page">
      <h1 className="lab-h1">picks</h1>
      <div className="lab-picks-head">
        <p className="lab-quiet">
          {picked} of {flat.length} items picked
        </p>
        <div className="lab-bar-group">
          <button type="button" className="lab-btn" onClick={() => exportPicks(flat, picks, "download")}>
            <Icon name="cloud-download" size={15} />
            export picks
          </button>
          <button
            type="button"
            className="lab-btn"
            onClick={async () => {
              setCopied((await exportPicks(flat, picks, "copy")) ? "copied" : "failed");
              setTimeout(() => setCopied(null), 1600);
            }}
          >
            <Icon name={copied === "copied" ? "check" : "copy"} size={15} />
            {copied === "copied" ? "copied" : copied === "failed" ? "copy failed" : "copy json"}
          </button>
        </div>
      </div>
      {sections.map((section) => (
        <div key={section.id} className="lab-picks-section">
          <h2 className="lab-h2">{section.title}</h2>
          <ul className="lab-picks-list">
            {section.items.map((item) => {
              const entry = picks[itemKey(section.id, item.id)] ?? {};
              return (
                <li key={item.id}>
                  <button type="button" className="lab-picks-row" onClick={() => onOpen(section.id, item.id)}>
                    <span className="lab-truncate">{item.title}</span>
                    <span className={entry.pick ? "lab-picks-choice" : "lab-quiet"}>{entry.pick ? LABEL[entry.pick] : "not picked"}</span>
                    <span className="lab-quiet lab-truncate">{entry.note || ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
