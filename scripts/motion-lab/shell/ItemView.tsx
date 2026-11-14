import { Component, type ErrorInfo, type FC, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import type { Item, LabProps } from "@lab/types";
import type { Pick, PickEntry } from "./prefs";

const COLUMNS: { pick: Pick; label: string; component: (item: Item) => FC<LabProps>; note: (item: Item) => string }[] = [
  { pick: "original", label: "Original", component: (i) => i.Original, note: (i) => i.notes.original },
  { pick: "a", label: "Variant A", component: (i) => i.A, note: (i) => i.notes.a },
  { pick: "b", label: "Variant B", component: (i) => i.B, note: (i) => i.notes.b },
];

export function ItemView({
  item, active, replayKey, speed, reduced, pick, onPick, onReplay, onFocus,
}: {
  item: Item; active: boolean; replayKey: number; speed: number; reduced: boolean; pick: PickEntry;
  onPick: (patch: PickEntry) => void; onReplay: () => void; onFocus: () => void;
}) {
  return (
    <section id={`item-${item.id}`} className="lab-item" data-active={active} onPointerDown={onFocus} onFocusCapture={onFocus} aria-labelledby={`title-${item.id}`}>
      <div className="lab-item-head">
        <h2 id={`title-${item.id}`} className="lab-h2">{item.title}</h2>
        <span className="lab-surface">{item.surface}</span>
        <button type="button" className="lab-btn lab-btn-quiet" onClick={onReplay} title="replay (R)">
          <Icon name="refresh" size={14} />
          replay
        </button>
      </div>
      <div className="lab-columns">
        {COLUMNS.map((column) => {
          const Column = column.component(item);
          return (
            <figure key={column.pick} className="lab-column" data-picked={pick.pick === column.pick}>
              <figcaption className="lab-col-label">
                {column.label}
                {pick.pick === column.pick && <Icon name="check" size={13} aria-label="picked" />}
              </figcaption>
              <div className="lab-stage" style={{ height: item.height ?? 320 }}>
                <Boundary name={`${item.id} ${column.label}`}>
                  <Column replayKey={replayKey} speed={speed} reduced={reduced} />
                </Boundary>
              </div>
              <p className="lab-note">{column.note(item)}</p>
            </figure>
          );
        })}
      </div>
      <div className="lab-pick-row">
        <div className="lab-seg" role="radiogroup" aria-label={`pick for ${item.title}`}>
          {COLUMNS.map((column) => (
            <button
              key={column.pick}
              type="button"
              role="radio"
              aria-checked={pick.pick === column.pick}
              className="lab-seg-btn"
              onClick={() => onPick({ pick: pick.pick === column.pick ? undefined : column.pick })}
            >
              {column.label === "Original" ? "keep original" : column.label}
            </button>
          ))}
        </div>
        <label className="lab-note-field">
          <span className="sr-only">tweak note for {item.title}</span>
          <input
            type="text"
            value={pick.note ?? ""}
            placeholder="tweak note (optional)"
            onChange={(event) => onPick({ note: event.target.value })}
          />
        </label>
      </div>
    </section>
  );
}

class Boundary extends Component<{ name: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`motion lab: ${this.props.name} crashed`, error, info.componentStack);
  }
  render() {
    if (this.state.error)
      return (
        <div className="lab-crash" role="alert">
          <Icon name="exclamation-circle" size={15} /> this column crashed: {this.state.error}
        </div>
      );
    return this.props.children;
  }
}
