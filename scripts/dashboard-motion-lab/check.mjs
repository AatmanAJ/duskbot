// headless proof that the lab slows the nav pill and the page change: logs both over time at 1x and 0.1x.
//   node scripts/dashboard-motion-lab/check.mjs <playwright module path> <chromium executable> [url] [screenshot dir]
const [pwPath, executablePath, url = "http://127.0.0.1:7561/", shots] = process.argv.slice(2);
const { chromium } = await import(pwPath);
const browser = await chromium.launch({ executablePath, args: ["--use-mock-keychain", "--password-store=basic"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(url);
await page.waitForSelector('nav[aria-label="dashboard"] a[href="/bots"]');
await page.waitForTimeout(1500);

const sample = (from, to, speed, shot) => page.evaluate(async ({ from, to, speed, shot }) => {
  const lab = window.__motionLab;
  const link = (p) => document.querySelector(`nav[aria-label="dashboard"] a[href="${p}"]`);
  const press = (a) => {
    a.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, isPrimary: true }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    a.click();
  };
  lab.setSpeed(50);
  if (location.pathname !== from) press(link(from));
  await new Promise((r) => setTimeout(r, 600));
  lab.setSpeed(speed);
  const navTop = document.querySelector('nav[aria-label="dashboard"]').getBoundingClientRect().top;
  const start = link(from).getBoundingClientRect().top - navTop, end = link(to).getBoundingClientRect().top - navTop;
  const rows = [];
  const t0 = Date.now();
  press(link(to));
  let marked = false;
  while (Date.now() - t0 < (speed < 1 ? 4000 : 600)) {
    await new Promise((r) => requestAnimationFrame(r));
    const pill = document.querySelector('nav[aria-label="dashboard"] span.absolute.inset-0');
    const main = document.querySelector("main") ?? document.body;
    const mover = [...main.querySelectorAll("div")].find((d) => d.style.opacity !== "" || d.style.transform !== "");
    const y = pill ? pill.getBoundingClientRect().top - navTop : NaN;
    const progress = (y - start) / (end - start);
    rows.push({ ms: Date.now() - t0, pill: +progress.toFixed(3), pageOpacity: mover ? Number(getComputedStyle(mover).opacity).toFixed(3) : "-" });
    if (shot && !marked && progress > 0.35 && progress < 0.75) { marked = true; lab.setPaused(true); return { rows, held: true }; }
  }
  return { rows };
}, { from, to, speed, shot });

const report = (label, { rows }) => {
  const at = (p) => rows.find((r) => r.pill >= p)?.ms ?? "never";
  console.log(`${label}: pill 50% at ${at(0.5)}ms, 95% at ${at(0.95)}ms`);
  for (const r of rows.filter((_, i) => i % Math.max(1, Math.round(rows.length / 14)) === 0)) console.log(`  ${String(r.ms).padStart(5)}ms pill ${r.pill} page opacity ${r.pageOpacity}`);
};

report("1x   home -> bots", await sample("/", "/bots", 1));
report("0.1x home -> bots", await sample("/", "/bots", 0.1));
if (shots) {
  const held = await sample("/", "/workspaces", 0.1, true);
  report("0.1x home -> workspaces (held mid-move)", held);
  await page.screenshot({ path: `${shots}/mid-transition.png` });
  console.log(`screenshot: ${shots}/mid-transition.png`);
}
await browser.close();
