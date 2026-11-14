import { MotionGlobalConfig, processFrame } from "motion/react";

// one slowed clock for the whole lab. motion runs on manual timing, driven here at `speed` x real time, so every
// spring, tween and layout animation slows, whatever transition the item passes. css animations, css transitions and
// plain WAAPI animations get the same speed through playbackRate.
let speed = 1;
let started = false;

export function setLabSpeed(next: number) {
  speed = next;
  document.documentElement.style.setProperty("--lab-speed", String(next));
}

export function getLabSpeed() {
  return speed;
}

export function startLabClock() {
  if (started) return;
  started = true;
  MotionGlobalConfig.useManualTiming = true;
  let real = performance.now();
  let virtual = real;
  const tick = (now: number) => {
    // a hidden tab pauses rAF; never jump more than 100ms of lab time
    virtual += Math.min(now - real, 100) * speed;
    real = now;
    processFrame(virtual);
    for (const animation of document.getAnimations()) {
      if (animation.playbackRate !== speed) animation.playbackRate = speed;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
