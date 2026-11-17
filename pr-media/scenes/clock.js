// Virtual time for the scenes: loaded before anything that reads the clock (the pixel engine included).
// ---- virtual time: everything that asks the time gets the scene's, so a render is frame exact ----
(() => {
  let now = 0, id = 1;
  let timers = [];
  const raf = new Map();
  performance.now = () => now;
  const epoch = Date.UTC(2026, 10, 17, 9, 30);
  Date.now = () => epoch + now;
  window.requestAnimationFrame = (f) => { const n = id++; raf.set(n, f); return n; };
  window.cancelAnimationFrame = (n) => raf.delete(n);
  window.setTimeout = (f, ms = 0, ...args) => { const n = id++; timers.push({ n, at: now + Math.max(0, ms), f, args }); return n; };
  window.clearTimeout = (n) => { timers = timers.filter((t) => t.n !== n); };
  window.setInterval = (f, ms) => { const n = id++; const tick = () => { f(); timers.push({ n, at: now + ms, f: tick, args: [] }); }; timers.push({ n, at: now + ms, f: tick, args: [] }); return n; };
  window.clearInterval = window.clearTimeout;
  // the engine watches visibility; a render shows everything, so it never has to wait for an observer
  delete window.IntersectionObserver;
  window.__now = () => now / 1000;
  window.__step = (ms) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      now = next.at;
      next.f(...next.args);
    }
    now = end;
    const due = [...raf.values()];
    raf.clear();
    for (const f of due) f(now);
    window.SCENE?.update?.(now / 1000);
    return now;
  };
})();

