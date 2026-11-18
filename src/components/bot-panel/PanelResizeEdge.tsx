import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { PANEL_MIN, panelRest, panelRestMax, resizePanel, usePanelWidth } from "@/lib/panel-wide";

const STEP = 16;

function holdPageCursor(held: boolean) {
  document.body.style.cursor = held ? "col-resize" : "";
  document.body.style.userSelect = held ? "none" : "";
}

/** The panel's left edge: its 0.5px hairline, and a strip over it that a drag or the arrow keys resize the panel by.
 * The width it is left at is kept for the next open. */
export function PanelResizeEdge() {
  usePanelWidth();
  const drag = useRef<{ x: number; from: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => () => holdPageCursor(false), []);
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    holdPageCursor(false);
    resizePanel(panelRest(), true);
  };
  return (
    <>
      <span aria-hidden="true" data-panel-edge className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[0.5px] bg-edge max-md:hidden" />
      <div
        role="separator"
        aria-label={t("computer.resizeAria")}
        aria-orientation="vertical"
        aria-valuemin={PANEL_MIN}
        aria-valuemax={panelRestMax()}
        aria-valuenow={panelRest()}
        tabIndex={0}
        data-panel-resize={dragging ? "dragging" : ""}
        className={cn("absolute inset-y-0 left-0 z-20 hidden w-2 cursor-col-resize touch-none outline-none md:block",
          "after:absolute after:inset-y-0 after:left-0 after:w-0.5 focus-visible:after:bg-focus")}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, from: panelRest() };
          setDragging(true);
          holdPageCursor(true);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          resizePanel(current.from + current.x - event.clientX);
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          resizePanel(panelRest() + (event.key === "ArrowLeft" ? STEP : -STEP), true);
        }}
      />
    </>
  );
}
