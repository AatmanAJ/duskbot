(() => {
  const realNow = performance.now.bind(performance);
  const realRaf = window.requestAnimationFrame.bind(window);
  let speed = Number(localStorage.getItem("motion-lab-speed")) || 1;
  let paused = false, realBase = realNow(), virtBase = realBase;
  const rate = () => (paused ? 0 : speed);
  const now = () => virtBase + (realNow() - realBase) * rate();

  performance.now = now;
  window.requestAnimationFrame = (cb) => realRaf(() => cb(now()));

  // motion 14.9.1 takes its waapi path only when Element.prototype owns animate (supportsWaapi); off it, motion runs on performance.now
  const animate = Element.prototype.animate;
  delete Element.prototype.animate;
  const wrapped = function (...args) { const a = animate.apply(this, args); a.playbackRate = rate(); return a; };
  HTMLElement.prototype.animate = wrapped;
  SVGElement.prototype.animate = wrapped;

  const sync = (list) => { for (const a of list) if (a.playbackRate !== rate()) a.playbackRate = rate(); };
  const onNative = (e) => sync(e.target.getAnimations ? e.target.getAnimations() : []);
  for (const type of ["transitionrun", "transitionstart", "animationstart"]) document.addEventListener(type, onNative, true);
  const sweep = () => { sync(document.getAnimations()); realRaf(sweep); };
  realRaf(sweep);

  const rebase = () => { virtBase = now(); realBase = realNow(); queueMicrotask(() => window.dispatchEvent(new Event("motion-lab"))); };
  window.__motionLab = {
    get speed() { return speed; },
    get paused() { return paused; },
    now,
    setSpeed(s) { rebase(); speed = s; localStorage.setItem("motion-lab-speed", String(s)); sync(document.getAnimations()); },
    setPaused(p) { rebase(); paused = p; sync(document.getAnimations()); },
    step(ms = 1000 / 60) {
      if (!paused) return;
      virtBase += ms;
      for (const a of document.getAnimations()) if (a.currentTime != null) a.currentTime = Number(a.currentTime) + ms;
    },
  };
})();
