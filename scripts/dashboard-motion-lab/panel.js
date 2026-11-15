const lab = window.__motionLab;
const SPEEDS = [1, 0.5, 0.25, 0.1];
const NAV = 'nav[aria-label="dashboard"] a[href]';
let last = null;

const host = document.createElement("div");
host.id = "motion-lab";
document.body.append(host);
const root = host.attachShadow({ mode: "open" });
root.innerHTML = `
<style>
  :host { all: initial; }
  .panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; flex-direction: column; gap: 8px; padding: 12px;
    border-radius: 18px; background: #1d1d20; color: #f4f4f1; font: 500 13px/1.3 ui-sans-serif, system-ui, sans-serif; box-shadow: 0 8px 28px rgb(20 20 30 / 0.28); }
  .row { display: flex; gap: 6px; align-items: center; }
  button { all: unset; box-sizing: border-box; min-width: 44px; height: 32px; padding: 0 10px; border-radius: 999px; background: #2e2e33; color: inherit;
    text-align: center; cursor: pointer; font-variant-numeric: tabular-nums; }
  button:hover { background: #3a3a40; }
  button:focus-visible { outline: 2px solid #9fb6ff; outline-offset: 2px; }
  button[aria-pressed="true"] { background: #f4f4f1; color: #1d1d20; }
  button:disabled { opacity: 0.4; cursor: default; }
  .meta { color: #a9a9ad; font-size: 12px; }
</style>
<div class="panel" role="group" aria-label="motion lab">
  <div class="row" id="speeds"></div>
  <div class="row">
    <button id="replay" disabled>replay last click</button>
    <button id="pause" aria-pressed="false">pause</button>
    <button id="step" disabled aria-label="one frame forward">+1 frame</button>
  </div>
  <div class="meta" id="meta">click a sidebar item</div>
</div>`;

const $ = (id) => root.getElementById(id);
const speeds = $("speeds");
for (const s of SPEEDS) {
  const b = document.createElement("button");
  b.textContent = `${s}x`;
  b.dataset.speed = String(s);
  b.onclick = () => lab.setSpeed(s);
  speeds.append(b);
}

function paint() {
  for (const b of speeds.children) b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === lab.speed && !lab.paused));
  $("pause").setAttribute("aria-pressed", String(lab.paused));
  $("pause").textContent = lab.paused ? "resume" : "pause";
  $("step").disabled = !lab.paused;
  $("replay").disabled = !last;
}

$("pause").onclick = () => lab.setPaused(!lab.paused);
$("step").onclick = () => lab.step();

// the nav highlight moves on pointer-down and the page changes on click, so a replay presses then clicks
document.addEventListener("click", (e) => {
  const a = e.target instanceof Element && e.target.closest(NAV);
  if (!a || !e.isTrusted) return;
  const to = a.getAttribute("href");
  if (to !== location.pathname) { last = { from: location.pathname, to }; $("meta").textContent = `last: ${last.from} to ${last.to}`; paint(); }
}, true);

const linkTo = (path) => [...document.querySelectorAll(NAV)].find((a) => a.getAttribute("href") === path);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function press(a) {
  a.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, isPrimary: true }));
  window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, isPrimary: true }));
  a.click();
}

$("replay").onclick = async () => {
  if (!last) return;
  const { from, to } = last, speed = lab.speed;
  if (lab.paused) lab.setPaused(false);
  lab.setSpeed(50);
  const back = linkTo(from);
  if (back && location.pathname !== from) press(back);
  await wait(400);
  lab.setSpeed(speed);
  const next = linkTo(to);
  if (next) press(next);
};

window.addEventListener("motion-lab", paint);
paint();
