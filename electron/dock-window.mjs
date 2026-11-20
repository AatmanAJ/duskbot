// The bot dock: a window against the right edge of the work area, as tall as it and as wide as the dock opens.
import { DOCK, dockLayout } from "./ambient-geometry.mjs";
import { createAmbientWindow } from "./ambient-window.mjs";

export function createDockWindow({ BrowserWindow, url, platform = process.platform, onMessage, log, trace = null, cursor }) {
  const overlay = createAmbientWindow({ BrowserWindow, surface: "dock", url, level: "floating", platform, onMessage, log, trace, hoverKey: false, cursor });
  return {
    ...overlay,
    layout(display, { order }) {
      const layout = dockLayout(display);
      overlay.place(layout.window);
      overlay.send("ambient:layout", { surface: "dock", width: layout.window.width, height: layout.window.height, body: layout.body, top: layout.top, dock: DOCK, order });
      return layout;
    },
  };
}
