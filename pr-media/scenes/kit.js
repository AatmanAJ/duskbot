// The scene kit, built from dusk.bot's own parts: its art (apps/site/public/landing/art), its bots (the site's pixel
// engine, apps/site/mascot-src), its pointer, and its motion curves (motion-kit-v2.css). A scene sets
// window.SCENE = { duration, still, update(t) } and the renderer steps a virtual clock with window.__step(ms).

const K = (window.K = {});
K.ART = "../../apps/site/public/landing/art/";
K.COL = { ink: "#131316", wash: "#f5f5f3", line: "#e9e9e6", blue: "#2f7bf2", pink: "#ff5c9d", green: "#1fb866", purple: "#8d5cf0",
  orange: "#ff7d1f", yellow: "#f8c623", lime: "#d6f04a", sky: "#29a9f2", tsky: "#e2f3ff", tlime: "#eef8c6", tpink: "#ffe7ef", tlemon: "#fff5bf" };
K.clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
K.lerp = (a, b, t) => a + (b - a) * t;
K.span = (t, a, b) => K.clamp((t - a) / (b - a));
// --mk-ease-out and --mk-ease-spring-ui from motion-kit-v2.css
K.out = (t) => 1 - Math.pow(1 - K.clamp(t), 3.2);
const SPRING = [0, 0.1176, 0.3457, 0.5719, 0.7511, 0.8746, 0.9503, 0.9911, 1.0095, 1.015, 1.0141, 1.0109, 1.0074, 1.0044, 1.0023, 1.001, 1.0003, 1];
K.spring = (t) => { t = K.clamp(t); const f = t * (SPRING.length - 1), i = Math.floor(f); return i >= SPRING.length - 1 ? 1 : K.lerp(SPRING[i], SPRING[i + 1], f - i); };
K.$ = (sel, root = document) => root.querySelector(sel);
K.el = (tag, attrs = {}, parent) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  if (parent) parent.appendChild(node);
  return node;
};
K.fmtBytes = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} KB` : `${Math.round(n)} B`;
K.rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** Shows an element the way the site reveals things: a short rise on the UI spring, with a fade. */
K.reveal = (node, t, at, { dy = 26, dur = 0.55 } = {}) => {
  const p = K.span(t, at, at + dur);
  node.style.opacity = K.clamp(p * 2.2);
  node.style.transform = `translateY(${(1 - K.spring(p)) * dy}px)`;
};
K.pop = (node, t, at, { dur = 0.55, from = 0.6 } = {}) => {
  const p = K.span(t, at, at + dur);
  node.style.opacity = K.clamp(p * 3);
  node.style.transform = `scale(${from + (1 - from) * K.spring(p)})`;
};

// ---- the bots: the site's own engine and its crew ----
const { DuskPixel, COLOURS } = window.Crowd;
K.CREW = window.Crowd.CROWD.map(([name, colour]) => ({ name, colour: COLOURS[colour] || colour }));
/** One pixel bot, standing with its feet at (x, y) when `stand` is set, else with its box at (x, y). */
K.bot = (parent, name, { x = 0, y = 0, size = 80, colour, seed = 1, state, stand = false } = {}) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "bot"); svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("width", size); svg.setAttribute("height", size);
  parent.appendChild(svg);
  const G = DuskPixel.rest(name).G;
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("class", "px"); g.setAttribute("transform", `translate(10 10) scale(${80 / G})`);
  svg.appendChild(g);
  const crew = K.CREW.find((c) => c.name === name);
  svg.style.color = colour || crew?.colour;
  const bot = DuskPixel.create(svg, { body: name, seed, tap: false, colour: colour || crew?.colour });
  if (state) bot.setState(state);
  bot.svg = svg; bot.size = size;
  bot.place = (px, py) => { svg.style.left = `${px - size / 2}px`; svg.style.top = `${stand ? py - size * 0.9 : py}px`; };
  if (stand) bot.place(x, y); else { svg.style.left = `${x}px`; svg.style.top = `${y}px`; }
  return bot;
};
/** A bot drawn inline in a line of type, as the site's big sentences do. */
K.inlineBot = (parent, name, { seed = 1, em = 0.8 } = {}) => {
  const span = K.el("span", { style: `display:inline-block;position:relative;width:${em}em;height:${em}em;vertical-align:-0.06em;margin:0 0.04em` }, parent);
  const b = K.bot(span, name, { size: 10, seed });
  b.svg.style.cssText += ";left:0;top:0;width:100%;height:100%";
  return b;
};
K.colourOf = (name) => K.CREW.find((c) => c.name === name)?.colour;

// ---- the site's art ----
K.img = (parent, file, style = "", cls = "stk") => K.el("img", { src: K.ART + file, class: cls, style }, parent);
/** The site's pixel pointer (art/pointer.svg) with a name tag, as the launch film shows it. */
K.pointer = (parent, { label = "you", colour = K.COL.pink, size = 34 } = {}) => {
  const wrap = K.el("div", { style: "position:absolute;left:0;top:0;z-index:40" }, parent);
  K.el("img", { src: K.ART + "pointer.svg", style: `display:block;width:${size}px;height:${size * 17 / 12}px;image-rendering:pixelated` }, wrap);
  K.el("span", { class: "mono", text: label, style: `position:absolute;left:${size * 0.7}px;top:${size * 1.25}px;padding:3px 9px 4px;border-radius:7px;background:${colour};color:#fff;font-size:15px;white-space:nowrap` }, wrap);
  return { el: wrap, move(x, y) { wrap.style.transform = `translate(${x}px, ${y}px)`; } };
};
/** A white edge torn into pixels (art/scatter-edge.png), laid over the top or bottom of a picture. */
K.scatter = (parent, { top = true, height = 54, colour = "#fff" } = {}) => K.el("div", {
  style: `position:absolute;left:0;right:0;${top ? "top:-1px;transform:scaleY(-1)" : "bottom:-1px"};height:${height}px;background:${colour};z-index:4;` +
    `-webkit-mask:url(${K.ART}scatter-edge.png) repeat-x center / auto 100%;mask:url(${K.ART}scatter-edge.png) repeat-x center / auto 100%`,
}, parent);
/** Clouds that drift across a picture, as on the site's hero. */
K.cloud = (parent, { kind = "pink", x = 0, y = 0, w = 170 } = {}) => {
  const c = K.el("img", { src: `${K.ART}cloud-${kind}.png`, style: `position:absolute;left:${x}px;top:${y}px;width:${w}px;image-rendering:pixelated;z-index:1` }, parent);
  return (t, speed = 14) => { c.style.transform = `translateX(${t * speed}px)`; };
};
