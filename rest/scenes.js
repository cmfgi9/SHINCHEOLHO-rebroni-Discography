// 쉼터(Rest)의 다섯 공간 — 캔버스 장면
// 공통 규칙
// - 좌표는 CSS 픽셀 기준 (rest.js가 devicePixelRatio 변환을 걸어 준다)
// - 배경·나무·산호처럼 움직이지 않는 요소는 위치를 hash()로 정해 저장하지 않고 매 프레임 같은 모양으로 그린다
// - 휴대폰 부담을 줄이려고 shadowBlur·filter는 쓰지 않고, 빛 번짐은 미리 그려 둔 glow 스프라이트를 겹쳐 그린다
// - 각 장면: enter() / leave() / resize(w, h) / draw(g, t, dt) / down·move·up(x, y, e) / key(e, isDown) / mix()

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x, 0, 1));
const mod = (a, n) => ((a % n) + n) % n;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 정수 → 0..1 (같은 입력이면 항상 같은 값)
function hash(i, s = 0) {
  let h = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((s | 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise1(x, s = 0) {
  const i = Math.floor(x), f = x - i;
  return lerp(hash(i, s), hash(i + 1, s), f * f * (3 - 2 * f));
}
function fbm(x, s = 0) {
  return (noise1(x, s) + 0.5 * noise1(x * 2.1, s + 1) + 0.25 * noise1(x * 4.3, s + 2)) / 1.75;
}
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// 부드러운 빛 번짐 스프라이트 (색마다 한 번만 만든다)
const glowCache = new Map();
function glowSprite(c) {
  const key = c.join(",");
  let cv = glowCache.get(key);
  if (!cv) {
    cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const x = cv.getContext("2d");
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, rgb(c, 1));
    gr.addColorStop(0.2, rgb(c, 0.5));
    gr.addColorStop(0.5, rgb(c, 0.14));
    gr.addColorStop(1, rgb(c, 0));
    x.fillStyle = gr;
    x.fillRect(0, 0, 128, 128);
    glowCache.set(key, cv);
  }
  return cv;
}
function glow(g, x, y, r, c, a = 1) {
  if (r < 0.5 || a <= 0.003) return;
  g.globalAlpha = Math.min(1, a);
  g.drawImage(glowSprite(c), x - r, y - r, r * 2, r * 2);
  g.globalAlpha = 1;
}
function ellipse(g, x, y, rx, ry, rot = 0) {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
  g.fill();
}
function wrapText(g, text, maxW) {
  const lines = [];
  let line = "";
  for (const ch of text) {
    if (g.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; }
    else line += ch;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

class Scene {
  constructor(app, id) {
    this.app = app;
    this.id = id;
    this.w = 1; this.h = 1; this.t = 0;
    this.panel = document.querySelector(`.panel[data-room="${id}"]`);
  }
  $(sel) { return this.panel.querySelector(sel); }
  enter() {}
  leave() {}
  resize(w, h) { this.w = w; this.h = h; }
  draw() {}
  down() {}
  move() {}
  up() {}
  key() { return false; }
  mix() { return {}; }
}

// =====================================================================
// 1. 촛불의 방
// =====================================================================
const CANDLES = [
  { u: -0.55, z: 0.74, hf: 1.25, wf: 1.0 },  // 뒷줄
  { u: 0.02, z: 0.74, hf: 1.7, wf: 1.15 },
  { u: 0.58, z: 0.74, hf: 1.05, wf: 0.95 },
  { u: -0.82, z: 1, hf: 0.85, wf: 1.05 },    // 앞줄
  { u: -0.28, z: 1, hf: 1.3, wf: 0.9 },
  { u: 0.27, z: 1, hf: 0.7, wf: 1.2 },
  { u: 0.8, z: 1, hf: 1.08, wf: 0.95 }
];
const CANDLE_WORDS = [
  "작은 불빛 하나로도 방이 따뜻해져요. · One small light warms the whole room.",
  "불꽃이 흔들리는 대로, 숨도 천천히. · Breathe as slowly as the flame sways.",
  "오늘 하루 수고한 나를 위해 하나 켜 볼까요? · Light one for yourself today.",
  "그리운 사람을 떠올리며 불을 밝혀도 좋아요. · Light one for someone you miss."
];

export class CandleScene extends Scene {
  constructor(app) {
    super(app, "candle");
    const saved = app.prefs.candles || [];
    this.candles = CANDLES.map((d, i) => ({ ...d, i, lit: !!saved[i], f: saved[i] ? 1 : 0, ph: hash(i, 7) * 100, outAt: -99 }));
    this.ambient = this.litCount() / CANDLES.length;
    this.$(".js-all-on").addEventListener("click", () => this.setAll(true));
    this.$(".js-all-off").addEventListener("click", () => this.setAll(false));
    this.countEl = this.$(".js-count");
    this.updateCount();
  }

  litCount() { return this.candles.filter((c) => c.lit).length; }

  mix() {
    const n = this.litCount();
    return { fire: 0.06 + n * 0.035, crickets: 0.12 };
  }

  enter() { this.app.say(pick(CANDLE_WORDS)); }

  resize(w, h) {
    super.resize(w, h);
    const portrait = h > w * 1.2;
    const unit = this.unit = Math.min(w / (portrait ? 7 : 8.5), h / 6.5, 120);
    this.tableY = Math.max(h * 0.4, Math.min(h * (portrait ? 0.64 : 0.6), this.app.dockTop() - unit * 1.6));
    const spread = Math.min(w * 0.44, unit * 3.4);
    for (const c of this.candles) {
      c.x = w / 2 + c.u * spread * (c.z < 1 ? 0.85 : 1);
      c.base = this.tableY + (c.z < 1 ? unit * 0.35 : unit * 1.15);
      c.cw = unit * 0.5 * c.wf * c.z;
      c.ch = unit * 1.45 * c.hf * c.z;
    }
  }

  toggle(c, quiet) {
    c.lit = !c.lit;
    if (c.lit) this.app.sound.match();
    else { c.outAt = this.t; this.app.sound.blow(); }
    this.app.prefs.candles = this.candles.map((x) => x.lit);
    this.app.save();
    this.app.sound.level("fire", this.mix().fire);
    this.updateCount();
    if (!quiet && c.lit && this.litCount() === CANDLES.length) {
      this.app.say("모든 촛불이 켜졌어요. 잠시 불빛을 바라보며 쉬어 가세요. · All candles are lit. Rest here a while.");
    }
  }

  setAll(on) {
    const todo = this.candles.filter((c) => c.lit !== on);
    todo.forEach((c, k) => setTimeout(() => { if (c.lit !== on) this.toggle(c, k < todo.length - 1); }, k * 220));
  }

  updateCount() {
    if (this.countEl) this.countEl.textContent = `${this.litCount()} / ${CANDLES.length}`;
  }

  key(e, isDown) {
    if (!isDown) return false;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= CANDLES.length) {
      // 화면 왼쪽부터 1, 2, 3 …
      const sorted = [...this.candles].sort((a, b) => a.x - b.x);
      this.toggle(sorted[n - 1]);
      return true;
    }
    return false;
  }

  down(x, y) {
    let best = null, bestD = Infinity;
    for (const c of this.candles) {
      const top = c.base - c.ch;
      const half = Math.max(c.cw * 0.9, 24);
      if (Math.abs(x - c.x) < half && y > top - c.cw * 2.8 && y < c.base + 12) {
        const d = Math.abs(x - c.x) - (c.z === 1 ? 6 : 0); // 겹치면 앞줄 우선
        if (d < bestD) { bestD = d; best = c; }
      }
    }
    if (best) this.toggle(best);
  }

  draw(g, t, dt) {
    this.t = t;
    const { w, h, unit } = this;
    const lit = this.litCount();
    for (const c of this.candles) {
      const target = c.lit ? 1 : 0;
      c.f += (target - c.f) * Math.min(1, dt * (c.lit ? 2.2 : 9));
      if (!c.lit && c.f < 0.01) c.f = 0;
    }
    this.ambient += (lit / CANDLES.length - this.ambient) * Math.min(1, dt * 1.5);
    const A = this.ambient * (0.92 + 0.08 * noise1(t * 6, 3));

    // 벽
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, rgb(mixc([9, 8, 13], [44, 27, 18], A)));
    bg.addColorStop(1, rgb(mixc([13, 10, 9], [68, 40, 22], A)));
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    this.drawWindow(g, t, A);

    // 방 안을 채우는 따뜻한 빛
    const cx = w / 2, cy = this.tableY;
    const R = Math.max(w, h) * 0.8;
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    rg.addColorStop(0, `rgba(255,150,70,${0.3 * A})`);
    rg.addColorStop(0.45, `rgba(190,90,40,${0.1 * A})`);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, w, h);

    // 탁자
    const ty = this.tableY;
    const tg = g.createLinearGradient(0, ty, 0, h);
    tg.addColorStop(0, rgb(mixc([30, 20, 13], [96, 58, 32], A)));
    tg.addColorStop(0.12, rgb(mixc([20, 13, 9], [58, 35, 20], A)));
    tg.addColorStop(1, rgb([7, 5, 4]));
    g.fillStyle = tg;
    g.fillRect(0, ty, w, h - ty);
    g.fillStyle = `rgba(255,190,120,${0.06 + 0.22 * A})`;
    g.fillRect(0, ty, w, 1.5);
    g.strokeStyle = `rgba(0,0,0,${0.18})`;
    g.lineWidth = 1;
    for (let k = 0; k < 9; k++) {
      const y = ty + 8 + (h - ty) * hash(k, 41) * 0.9;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(w * 0.3, y + (hash(k, 42) - 0.5) * 10, w * 0.7, y - (hash(k, 43) - 0.5) * 10, w, y + 3);
      g.stroke();
    }

    // 탁자 위에 비친 불빛
    g.globalCompositeOperation = "lighter";
    for (const c of this.candles) {
      if (c.f <= 0) continue;
      g.save();
      g.translate(c.x, c.base + c.cw * 0.2);
      g.scale(1, 0.3);
      glow(g, 0, 0, unit * 2.2 * c.z, [255, 140, 60], 0.45 * c.f);
      g.restore();
    }
    g.globalCompositeOperation = "source-over";

    for (const c of this.candles) this.drawCandle(g, c, t);

    // 가장자리 어둡게
    const vg = g.createRadialGradient(cx, h * 0.5, Math.min(w, h) * 0.3, cx, h * 0.5, Math.max(w, h) * 0.8);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.55)");
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
  }

  drawWindow(g, t, A) {
    const { w, unit } = this;
    const ww = Math.min(w * 0.36, unit * 3.2, 300);
    const x0 = w / 2 - ww / 2, x1 = w / 2 + ww / 2;
    const top = this.h * 0.07, bot = this.tableY - unit * 0.9;
    if (bot - top < ww * 0.7) return;
    const path = () => {
      g.beginPath();
      g.moveTo(x0, bot);
      g.lineTo(x0, top + ww / 2);
      g.arc(w / 2, top + ww / 2, ww / 2, Math.PI, 0);
      g.lineTo(x1, bot);
      g.closePath();
    };
    g.save();
    path();
    const sky = g.createLinearGradient(0, top, 0, bot);
    sky.addColorStop(0, "#0c1430");
    sky.addColorStop(1, "#22284a");
    g.fillStyle = sky;
    g.fill();
    g.clip();
    for (let k = 0; k < 26; k++) {
      const sx = x0 + hash(k, 51) * ww, sy = top + hash(k, 52) * (bot - top) * 0.8;
      const a = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * (0.6 + hash(k, 53)) + k));
      g.fillStyle = `rgba(230,236,255,${a})`;
      g.fillRect(sx, sy, 1.4, 1.4);
    }
    const mx = x0 + ww * 0.7, my = top + ww * 0.42;
    g.globalCompositeOperation = "lighter";
    glow(g, mx, my, ww * 0.45, [150, 170, 230], 0.5);
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#e9e6d6";
    ellipse(g, mx, my, ww * 0.075, ww * 0.075);
    g.fillStyle = "#1a2044";
    ellipse(g, mx + ww * 0.03, my - ww * 0.012, ww * 0.068, ww * 0.068); // 초승달
    g.restore();
    // 창틀
    g.strokeStyle = rgb(mixc([26, 20, 18], [92, 58, 34], A));
    g.lineWidth = Math.max(4, ww * 0.035);
    path();
    g.stroke();
    g.lineWidth = Math.max(2, ww * 0.02);
    g.beginPath();
    g.moveTo(w / 2, top);
    g.lineTo(w / 2, bot);
    g.moveTo(x0, top + ww * 0.75);
    g.lineTo(x1, top + ww * 0.75);
    g.stroke();
  }

  drawCandle(g, c, t) {
    const { x, base, cw, ch } = c;
    const top = base - ch;
    const f = c.f;
    // 그림자
    g.fillStyle = "rgba(0,0,0,0.35)";
    ellipse(g, x + cw * 0.12, base, cw * 0.85, cw * 0.17);
    // 몸통
    const warm = f * 0.65;
    const bg = g.createLinearGradient(x - cw / 2, 0, x + cw / 2, 0);
    bg.addColorStop(0, rgb(mixc([92, 80, 68], [168, 104, 58], warm)));
    bg.addColorStop(0.42, rgb(mixc([196, 184, 162], [255, 214, 162], warm)));
    bg.addColorStop(1, rgb(mixc([70, 60, 52], [138, 82, 46], warm)));
    g.fillStyle = bg;
    g.fillRect(x - cw / 2, top, cw, ch);
    ellipse(g, x, base, cw / 2, cw * 0.12);
    if (f > 0) {
      // 불빛이 초 안으로 스며드는 느낌
      const sg = g.createRadialGradient(x, top, 0, x, top, cw * 1.4);
      sg.addColorStop(0, `rgba(255,180,90,${0.6 * f})`);
      sg.addColorStop(1, "rgba(255,150,60,0)");
      g.fillStyle = sg;
      g.fillRect(x - cw / 2, top, cw, ch);
    }
    g.fillStyle = rgb(mixc([170, 158, 138], [255, 222, 176], f));
    ellipse(g, x, top, cw / 2, cw * 0.14);
    g.fillStyle = `rgba(255,196,120,${0.55 * f})`;
    ellipse(g, x, top + cw * 0.01, cw * 0.32, cw * 0.08);

    // 심지
    const n1 = noise1(t * 2.3 + c.ph, 1) - 0.5, n2 = noise1(t * 7 + c.ph, 2) - 0.5;
    const wx = x, wy = top - cw * 0.1;
    g.strokeStyle = "#2a2119";
    g.lineWidth = Math.max(1.2, cw * 0.06);
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x, top);
    g.lineTo(x + n1 * cw * 0.06, top - cw * 0.3);
    g.stroke();

    const age = t - c.outAt;
    if (!c.lit && age < 1.6) { // 꺼진 직후 빨갛게 남은 심지
      g.globalCompositeOperation = "lighter";
      glow(g, x, top - cw * 0.3, cw * 0.35, [255, 90, 30], 0.8 * (1 - age / 1.6));
      g.globalCompositeOperation = "source-over";
    }

    if (f > 0.01) {
      const fh = cw * 1.9 * f * (1 + 0.12 * n2 + 0.05 * Math.sin(t * 11 + c.ph));
      const fw = cw * 0.3 * Math.sqrt(f);
      const tipx = wx + n1 * cw * 0.55 * f, tipy = wy - fh;
      g.globalCompositeOperation = "lighter";
      glow(g, wx, wy - fh * 0.4, this.unit * 1.6 * c.z * f, [255, 140, 55], 0.5 + 0.12 * n2);
      glow(g, wx, wy - fh * 0.35, fh * 0.95, [255, 220, 150], 0.45);
      g.globalCompositeOperation = "source-over";
      const fg = g.createRadialGradient(wx, wy - fh * 0.16, 0, wx, wy - fh * 0.3, fh * 0.85);
      fg.addColorStop(0, "rgba(255,255,240,1)");
      fg.addColorStop(0.3, "rgba(255,228,150,.97)");
      fg.addColorStop(0.62, "rgba(255,150,50,.85)");
      fg.addColorStop(1, "rgba(220,70,20,0)");
      g.fillStyle = fg;
      g.beginPath();
      g.moveTo(tipx, tipy);
      g.bezierCurveTo(wx + fw * 1.4, wy - fh * 0.45, wx + fw * 1.1, wy + fw * 0.6, wx, wy + fw * 0.7);
      g.bezierCurveTo(wx - fw * 1.1, wy + fw * 0.6, wx - fw * 1.4, wy - fh * 0.45, tipx, tipy);
      g.fill();
      g.fillStyle = `rgba(110,140,255,${0.32 * f})`;
      ellipse(g, wx, wy + fw * 0.35, fw * 0.55, fw * 0.42);
    }

    // 연기 (꺼진 뒤 4초 동안, 시간만으로 모양이 정해진다)
    if (!c.lit && age < 4.5) {
      const u = this.unit * c.z;
      for (let k = 0; k < 16; k++) {
        const s = age - k * 0.09;
        if (s <= 0) continue;
        const a = 0.15 * (1 - s / 3.6) * (1 - k / 16);
        if (a <= 0) continue;
        const py = top - cw * 0.3 - s * u * 0.55;
        const px = x + Math.sin(s * 2.4 + k * 0.5 + c.ph) * s * u * 0.1;
        g.fillStyle = `rgba(190,182,172,${a})`;
        ellipse(g, px, py, u * 0.02 + s * u * 0.06, u * 0.02 + s * u * 0.06);
      }
    }
  }
}

// =====================================================================
// 2. 소원의 공간 (풍등 · 돌탑 · 두 손 모으기)
// =====================================================================
const WISH_REPLIES = [
  "소원이 하늘로 올라가 별이 되었어요. · Your wish rose and became a star.",
  "그 마음, 꼭 닿기를 바라요. · May your wish find its way.",
  "적어 보는 것만으로도 마음이 한결 가벼워지죠. · Writing it down lightens the heart.",
  "오늘의 소원이 내일의 용기가 되기를. · May today's wish become tomorrow's courage."
];

export class WishScene extends Scene {
  constructor(app) {
    super(app, "wish");
    this.lanterns = [];
    this.sessionStars = [];
    this.stones = 3;
    this.stoneAt = -9;
    this.pray = 0;
    this.praying = false;
    this.prayed = false;
    this.nextAmbient = 0;
    this.bg = null;

    this.input = this.$(".js-wish");
    this.keep = this.$(".js-keep");
    this.keep.checked = !!app.prefs.keepWishes;
    this.keep.addEventListener("change", () => { app.prefs.keepWishes = this.keep.checked; app.save(); });
    this.$(".js-form").addEventListener("submit", (e) => { e.preventDefault(); this.send(); });
    this.$(".js-stone").addEventListener("click", () => this.addStone());
    const pb = this.$(".js-pray");
    const start = (e) => { e.preventDefault(); this.startPray(); };
    const end = () => this.endPray();
    pb.addEventListener("pointerdown", start);
    pb.addEventListener("pointerup", end);
    pb.addEventListener("pointerleave", end);
    pb.addEventListener("pointercancel", end);
    pb.addEventListener("contextmenu", (e) => e.preventDefault());
    pb.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); this.startPray(); } });
    pb.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") this.endPray(); });
    this.listEl = this.$(".js-kept");
    this.listEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-del]");
      if (!b) return;
      app.removeWish(Number(b.dataset.del));
      this.renderKept();
    });
    this.$(".js-clear").addEventListener("click", () => {
      if (!app.wishes.length || !confirm("이 기기에 간직한 소원을 모두 지울까요?\nDelete all wishes kept on this device?")) return;
      app.clearWishes();
      this.renderKept();
    });
    this.renderKept();
  }

  mix() { return { wind: 0.14, crickets: 0.32, waves: 0.1 }; }

  enter() {
    this.app.say("마음속 소원을 적어 하늘로 띄워 보세요. · Write a wish and send it to the sky.");
    // 이미 떠 있는 다른 풍등 몇 개 (장식 — 다른 사람의 소원을 저장하거나 보여 주지 않는다)
    if (!this.lanterns.length) for (let k = 0; k < 4; k++) this.launch("", false, this.t - Math.random() * 20);
  }

  renderKept() {
    const list = this.app.wishes;
    const sum = this.$(".js-kept-count");
    sum.textContent = list.length ? `(${list.length})` : "";
    this.$(".js-clear").hidden = !list.length;
    if (!list.length) {
      this.listEl.innerHTML = `<li class="muted">아직 간직한 소원이 없어요. <span class="en-sub">No wishes kept yet.</span></li>`;
      return;
    }
    this.listEl.innerHTML = "";
    list.slice().reverse().forEach((wsh, ri) => {
      const i = list.length - 1 - ri;
      const li = document.createElement("li");
      const d = new Date(wsh.date);
      const span = document.createElement("span");
      span.textContent = wsh.text;
      const small = document.createElement("small");
      small.textContent = isNaN(d) ? "" : d.toLocaleDateString("ko-KR");
      const del = document.createElement("button");
      del.type = "button";
      del.className = "x";
      del.dataset.del = i;
      del.setAttribute("aria-label", "이 소원 지우기 · Delete");
      del.textContent = "×";
      li.append(span, small, del);
      this.listEl.append(li);
    });
  }

  resize(w, h) {
    super.resize(w, h);
    // 아래 조작판에 가리지 않도록, 조작판 위쪽 공간(H)을 기준으로 배치
    const H = clamp(this.app.dockTop() - 8, h * 0.55, h);
    this.u = Math.min(w, H) * 0.065;
    this.horizon = H * 0.56;
    this.shore = H * 0.76;
    this.altarX = w * 0.5 - this.u * 0.9;
    this.altarY = H * 0.9;
    this.cairnX = w * 0.5 + this.u * 1.6;
    this.cairnY = H * 0.915;
    const n = Math.min(260, Math.round(w * h / 5000));
    this.stars = [];
    for (let k = 0; k < n; k++) {
      this.stars.push({
        x: hash(k, 61) * w, y: Math.pow(hash(k, 62), 1.3) * this.horizon * 0.96,
        r: 0.4 + Math.pow(hash(k, 63), 3) * 1.4, ph: hash(k, 64) * 100, sp: 0.5 + hash(k, 65) * 2
      });
    }
    this.renderBg();
  }

  // 움직이지 않는 하늘·산·호수·물가는 한 번만 그려 둔다
  renderBg() {
    const { w, h } = this;
    const dpr = this.app.dpr;
    const cv = this.bg || (this.bg = document.createElement("canvas"));
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const hy = this.horizon;
    const sky = g.createLinearGradient(0, 0, 0, hy);
    sky.addColorStop(0, "#050819");
    sky.addColorStop(0.55, "#141339");
    sky.addColorStop(1, "#3b2452");
    g.fillStyle = sky;
    g.fillRect(0, 0, w, hy + 1);
    // 은하수처럼 옅은 띠
    g.save();
    g.translate(w * 0.5, hy * 0.45);
    g.rotate(-0.35);
    g.scale(1, 0.18);
    g.globalCompositeOperation = "lighter";
    glow(g, 0, 0, Math.max(w, h) * 0.6, [90, 80, 150], 0.22);
    g.restore();
    // 달
    const mx = w * 0.8, my = h * 0.13, mr = this.u * 0.55;
    g.globalCompositeOperation = "lighter";
    glow(g, mx, my, mr * 7, [120, 120, 190], 0.45);
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#f3eedb";
    ellipse(g, mx, my, mr, mr);
    // 산 두 겹
    const ridge = (base, amp, s, color, scale) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, hy + 2);
      for (let x = 0; x <= w + 8; x += 8) g.lineTo(x, base - fbm(x / scale, s) * amp);
      g.lineTo(w, hy + 2);
      g.closePath();
      g.fill();
    };
    ridge(hy, h * 0.16, 3, "#1d1940", 260);
    ridge(hy, h * 0.08, 7, "#110f28", 140);
    // 호수
    const lake = g.createLinearGradient(0, hy, 0, this.shore);
    lake.addColorStop(0, "#2b1c44");
    lake.addColorStop(1, "#0b0b20");
    g.fillStyle = lake;
    g.fillRect(0, hy, w, this.shore - hy + 1);
    // 달빛 물길
    g.globalCompositeOperation = "lighter";
    for (let k = 0; k < 18; k++) {
      const y = hy + 3 + (this.shore - hy) * (k / 18);
      const len = mr * (2.5 - k * 0.08) * (0.6 + hash(k, 71));
      g.fillStyle = `rgba(200,190,255,${0.12 * (1 - k / 22)})`;
      g.fillRect(mx - len / 2 + (hash(k, 72) - 0.5) * mr, y, len, 1.2);
    }
    g.globalCompositeOperation = "source-over";
    // 물가 (앞쪽 땅)
    g.fillStyle = "#07060f";
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w + 10; x += 10) g.lineTo(x, this.shore + (fbm(x / 120, 9) - 0.5) * h * 0.04);
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    // 풀
    g.strokeStyle = "#0b0a17";
    g.lineWidth = 1.5;
    for (let k = 0; k < w / 4; k++) {
      const x = k * 4 + hash(k, 75) * 4;
      const y0 = this.shore + (fbm(x / 120, 9) - 0.5) * h * 0.04 + 2;
      const len = 6 + hash(k, 76) * 16;
      g.beginPath();
      g.moveTo(x, y0);
      g.lineTo(x + (hash(k, 77) - 0.5) * 8, y0 - len);
      g.stroke();
    }
  }

  send() {
    const text = this.input.value.trim().slice(0, 80);
    this.app.unlockSound();
    if (!text) {
      this.input.focus();
      this.app.say("마음속 소원을 한 줄로 적어 보세요. · Write your wish in a line.");
      return;
    }
    this.launch(text, true);
    this.app.sound.release();
    if (this.keep.checked) { this.app.addWish(text); this.renderKept(); }
    this.input.value = "";
    this.input.blur();
    this.app.say(pick(WISH_REPLIES));
  }

  launch(text, own, t0 = this.t) {
    const { w, h } = this;
    this.lanterns.push({
      text, own, t0,
      x0: own ? this.altarX : w * (0.08 + 0.84 * Math.random()),
      y0: own ? this.altarY - this.u * 2.3 : this.horizon - h * 0.02 + Math.random() * h * 0.06,
      s0: own ? 1 : 0.28 + Math.random() * 0.25,
      drift: (Math.random() - 0.5) * (own ? 10 : 6),
      ph: Math.random() * 100,
      T: own ? 32 : 26 + Math.random() * 14,
      endY: h * (0.05 + Math.random() * 0.25)
    });
  }

  addStone() {
    this.app.unlockSound();
    if (this.stones >= 11) {
      this.stones = 3;
      this.app.say("새 돌탑을 쌓아 볼까요? · Let's start a new cairn.");
      return;
    }
    this.stones++;
    this.stoneAt = this.t;
    setTimeout(() => this.app.sound.stone(), 300);
    if (this.stones === 11) this.app.say("돌탑이 완성됐어요. 한 개 한 개에 마음을 담았네요. · The cairn is complete.");
  }

  startPray() {
    if (this.praying) return;
    this.app.unlockSound();
    this.praying = true;
    this.prayed = false;
    this.$(".js-pray").classList.add("on");
  }

  endPray() {
    if (!this.praying) return;
    this.praying = false;
    this.$(".js-pray").classList.remove("on");
    if (!this.prayed) this.app.say("버튼을 3초쯤 꾹 누른 채 마음을 모아 보세요. · Press and hold for about 3 seconds.");
  }

  down(x, y) {
    const u = this.u;
    if (Math.abs(x - this.cairnX) < u * 1.1 && y < this.cairnY + u * 0.4 && y > this.cairnY - u * (0.4 * this.stones + 0.8)) this.addStone();
  }

  draw(g, t, dt) {
    this.t = t;
    const { w, h, u } = this;
    if (this.bg) g.drawImage(this.bg, 0, 0, w, h);

    // 별
    for (const s of this.stars) {
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph));
      g.fillStyle = `rgba(235,236,255,${a})`;
      g.fillRect(s.x, s.y, s.r * 1.4, s.r * 1.4);
    }
    // 소원 별 (이 기기에 간직한 소원 + 이번에 띄운 소원)
    g.globalCompositeOperation = "lighter";
    const wishes = this.app.wishes;
    for (let i = 0; i < wishes.length; i++) {
      const sx = (0.06 + 0.88 * hash(i, 91)) * w, sy = (0.04 + 0.34 * hash(i, 92)) * h;
      const a = 0.55 + 0.35 * Math.sin(t * 0.9 + i * 1.7);
      glow(g, sx, sy, 7 + u * 0.12, [255, 214, 140], a);
    }
    for (const s of this.sessionStars) {
      const a = Math.min(1, (t - s.t0) / 2) * (0.6 + 0.3 * Math.sin(t * 1.1 + s.ph));
      glow(g, s.x, s.y, 8 + u * 0.12, [255, 226, 170], a);
    }
    g.globalCompositeOperation = "source-over";

    // 호수 물결 반짝임
    for (let k = 0; k < 14; k++) {
      const y = this.horizon + 6 + (this.shore - this.horizon - h * 0.03 - 8) * hash(k, 81);
      const x = mod(hash(k, 82) * w + t * (4 + hash(k, 83) * 6), w + 60) - 30;
      g.fillStyle = `rgba(190,170,255,${0.05 + 0.08 * (0.5 + 0.5 * Math.sin(t * 1.3 + k))})`;
      g.fillRect(x, y, 14 + hash(k, 84) * 26, 1);
    }

    // 다른 풍등 떠오르기 (장식)
    if (t > this.nextAmbient) {
      if (this.lanterns.length < 14) this.launch("", false);
      this.nextAmbient = t + 5 + Math.random() * 9;
    }

    // 풍등
    const alive = [];
    for (const L of this.lanterns) {
      const a = t - L.t0, p = a / L.T;
      if (p >= 1) {
        if (L.own) this.sessionStars.push({ x: L.x, y: L.y, t0: t, ph: Math.random() * 10 });
        continue;
      }
      alive.push(L);
      const e = 1 - Math.pow(1 - p, 1.5);
      const sc = L.s0 * lerp(1, 0.1, e);
      L.x = L.x0 + L.drift * a + Math.sin(a * 0.5 + L.ph) * 14 * sc;
      L.y = lerp(L.y0, L.endY, e);
      const alpha = Math.min(1, a / 1.2) * (p > 0.82 ? 1 - (p - 0.82) / 0.18 : 1);
      const flick = 0.85 + 0.15 * noise1(t * 5 + L.ph, 4);
      const size = u * 0.75 * sc;
      // 호수에 비친 모습
      const ry = 2 * this.horizon - L.y;
      if (ry > this.horizon && ry < this.shore) {
        g.globalCompositeOperation = "lighter";
        g.save();
        g.translate(L.x, ry);
        g.scale(1, 0.45);
        glow(g, 0, 0, size * 2.4, [255, 140, 60], 0.3 * alpha * flick);
        g.restore();
        g.globalCompositeOperation = "source-over";
      }
      drawLantern(g, L.x, L.y, size, alpha, flick);
      if (L.own && L.text && a < 8) {
        const ta = Math.min(1, a / 0.8) * (a > 5 ? 1 - (a - 5) / 3 : 1);
        g.font = `500 ${Math.round(clamp(u * 0.32, 13, 17))}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
        g.textAlign = "center";
        g.fillStyle = `rgba(255,236,210,${ta})`;
        const lines = wrapText(g, L.text, Math.min(w * 0.7, 300));
        lines.forEach((ln, i) => g.fillText(ln, L.x, L.y - size * 1.4 - (lines.length - 1 - i) * 20 - 6));
      }
    }
    this.lanterns = alive;
    if (this.sessionStars.length > 40) this.sessionStars.splice(0, this.sessionStars.length - 40);

    // 기도: 누르고 있는 동안 빛이 모이고, 3초가 되면 범종이 울린다
    this.pray += ((this.praying ? 1 : 0) - this.pray) * Math.min(1, dt * (this.praying ? 0.45 : 1.2));
    if (this.praying && !this.prayed && this.pray > 0.72) {
      this.prayed = true;
      this.app.sound.bell("temple", 0, 1, 0.6);
      this.app.say("두 손 모은 그 마음이 닿기를 바랍니다. · May your prayer be heard.");
    }

    this.drawAltar(g, t);
    this.drawCairn(g, t);

    if (this.pray > 0.01) {
      g.globalCompositeOperation = "lighter";
      const P = this.pray;
      glow(g, this.altarX, this.altarY - u * 1.4, u * (2 + 5 * P), [255, 200, 130], 0.5 * P);
      for (let k = 0; k < 26; k++) {
        const ph = mod(t * 0.3 + hash(k, 101), 1);
        const px = this.altarX + (hash(k, 102) - 0.5) * u * 3 * (1 - ph * 0.6) + Math.sin(t + k) * 4;
        const py = this.altarY - u * 1.4 - ph * h * 0.45;
        glow(g, px, py, 3 + hash(k, 103) * 5, [255, 230, 180], P * Math.sin(ph * Math.PI));
      }
      g.globalCompositeOperation = "source-over";
    }
  }

  drawAltar(g, t) {
    const { u } = this;
    const x = this.altarX, y = this.altarY;
    const stone = (c) => { g.fillStyle = c; };
    // 받침
    stone("#2a2734");
    g.fillRect(x - u * 0.75, y - u * 0.25, u * 1.5, u * 0.25);
    stone("#24212d");
    g.fillRect(x - u * 0.22, y - u * 1.0, u * 0.44, u * 0.75);
    // 불집 (빛 나는 창)
    stone("#2e2a38");
    g.fillRect(x - u * 0.5, y - u * 1.75, u * 1.0, u * 0.75);
    const flick = 0.85 + 0.15 * noise1(t * 5, 8);
    g.globalCompositeOperation = "lighter";
    glow(g, x, y - u * 1.38, u * 2.4, [255, 160, 70], 0.55 * flick);
    g.globalCompositeOperation = "source-over";
    g.fillStyle = `rgba(255,${190 + 30 * flick | 0},120,0.95)`;
    g.fillRect(x - u * 0.2, y - u * 1.62, u * 0.4, u * 0.48);
    // 지붕
    stone("#1d1a26");
    g.beginPath();
    g.moveTo(x - u * 0.9, y - u * 1.72);
    g.quadraticCurveTo(x - u * 0.3, y - u * 1.85, x - u * 0.1, y - u * 2.2);
    g.lineTo(x + u * 0.1, y - u * 2.2);
    g.quadraticCurveTo(x + u * 0.3, y - u * 1.85, x + u * 0.9, y - u * 1.72);
    g.closePath();
    g.fill();
    ellipse(g, x, y - u * 2.3, u * 0.12, u * 0.14);
  }

  drawCairn(g, t) {
    const { u } = this;
    let y = this.cairnY;
    for (let k = 0; k < this.stones; k++) {
      const sw = u * (0.85 - k * 0.055) * (0.9 + hash(k, 111) * 0.25);
      const sh = u * (0.26 + hash(k, 112) * 0.08);
      let sy = y - sh * 0.5;
      const isNew = k === this.stones - 1 && t - this.stoneAt < 0.35;
      if (isNew) sy -= (1 - ease((t - this.stoneAt) / 0.35)) * u * 2.5;
      const c = 34 + hash(k, 113) * 14;
      g.fillStyle = `rgb(${c},${c - 2},${c + 8})`;
      ellipse(g, this.cairnX + (hash(k, 114) - 0.5) * u * 0.2, sy, sw * 0.5, sh * 0.5);
      g.fillStyle = "rgba(255,190,120,0.07)";
      ellipse(g, this.cairnX - sw * 0.15, sy - sh * 0.15, sw * 0.28, sh * 0.18);
      y -= sh * 0.88;
    }
  }
}

function drawLantern(g, x, y, L, a, flick) {
  g.globalCompositeOperation = "lighter";
  glow(g, x, y, Math.max(3, L * 3.4), [255, 140, 55], 0.5 * a * flick);
  g.globalCompositeOperation = "source-over";
  if (L < 2.5) return;
  const top = y - L * 0.62, bot = y + L * 0.55, wt = L * 0.55, wb = L * 0.36;
  const lg = g.createLinearGradient(0, top, 0, bot);
  lg.addColorStop(0, `rgba(240,150,80,${a * 0.92})`);
  lg.addColorStop(1, `rgba(255,224,150,${a})`);
  g.fillStyle = lg;
  g.beginPath();
  g.moveTo(x - wb, bot);
  g.lineTo(x - wt, top + L * 0.22);
  g.quadraticCurveTo(x - wt, top, x, top);
  g.quadraticCurveTo(x + wt, top, x + wt, top + L * 0.22);
  g.lineTo(x + wb, bot);
  g.closePath();
  g.fill();
  g.globalCompositeOperation = "lighter";
  glow(g, x, bot - L * 0.1, L * 0.55, [255, 240, 200], a * flick);
  g.globalCompositeOperation = "source-over";
}

// =====================================================================
// 3. 나를 찾는 명상
// =====================================================================
const SELF_STEPS = [
  ["편안하게 앉아 어깨의 힘을 내려놓아요.", "Settle in and let your shoulders drop."],
  ["눈을 살며시 감거나, 화면 가운데 빛을 바라봐요.", "Close your eyes softly, or rest your gaze on the light."],
  ["숨이 들어오고 나가는 것을 그대로 느껴 보세요.", "Simply notice the breath coming and going."],
  ["들이쉴 때 빛이 커지고, 내쉴 때 작아져요.", "The light grows as you breathe in, softens as you breathe out."],
  ["이마와 턱, 어깨에 머문 긴장을 하나씩 풀어 주세요.", "Release your brow, your jaw, your shoulders."],
  ["떠오르는 생각은 구름처럼 흘려보내요.", "Let passing thoughts drift by like clouds."],
  ["지금 나는 어떤 마음인가요? 판단하지 않고 바라봐요.", "How am I right now? Just notice, without judging."],
  ["나에게 정말 필요한 것은 무엇일까요?", "What do I truly need?"],
  ["애쓰고 있는 나에게 '괜찮아'라고 말해 주세요.", "Tell yourself: it's okay, you're doing enough."],
  ["있는 그대로의 나를 조용히 안아 주세요.", "Gently hold yourself, just as you are."],
  ["몇 번 더, 편안하게 숨을 쉬어요.", "A few more easy breaths."],
  ["손끝과 발끝을 천천히 움직이며 돌아와요.", "Slowly move your fingers and toes, and come back."]
];
const SELF_CLOSING = [
  ["있는 그대로의 나로 충분해요.", "You are enough, just as you are."],
  ["오늘 나를 위해 시간을 내 주어 고마워요.", "Thank you for making time for yourself today."],
  ["내 안의 고요는 언제든 다시 찾아올 수 있어요.", "The stillness within is always there to return to."],
  ["천천히, 나의 속도로 걸어가면 돼요.", "Go slowly, at your own pace."]
];
// 들이쉬기 4초 · 멈춤 2초 · 내쉬기 6초
const BREATH = [["inhale", 4, "들이쉬고", "Breathe in"], ["hold", 2, "멈추고", "Hold"], ["exhale", 6, "내쉬고", "Breathe out"]];
const CYCLE = BREATH.reduce((s, b) => s + b[1], 0);

export class SelfScene extends Scene {
  constructor(app) {
    super(app, "self");
    this.state = "idle";
    this.mins = app.prefs.selfMins || 5;
    this.amb = app.prefs.selfAmb ?? "stream";
    this.cues = app.prefs.selfCues !== false;
    this.breathEl = this.$(".js-breath");
    this.promptEl = this.$(".js-prompt");
    this.timeEl = this.$(".js-time");
    this.panel.querySelectorAll("[data-mins]").forEach((b) => {
      b.setAttribute("aria-pressed", String(Number(b.dataset.mins) === this.mins));
      b.addEventListener("click", () => {
        this.mins = Number(b.dataset.mins);
        app.prefs.selfMins = this.mins; app.save();
        this.panel.querySelectorAll("[data-mins]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      });
    });
    const amb = this.$(".js-amb");
    amb.value = this.amb;
    amb.addEventListener("change", () => {
      this.amb = amb.value;
      app.prefs.selfAmb = this.amb; app.save();
      app.unlockSound();
      app.sound.setMix(this.mix());
    });
    const cues = this.$(".js-cues");
    cues.checked = this.cues;
    cues.addEventListener("change", () => { this.cues = cues.checked; app.prefs.selfCues = this.cues; app.save(); });
    this.$(".js-start").addEventListener("click", () => this.start());
    this.$(".js-stop").addEventListener("click", () => this.stop(true));
    this.$(".js-again").addEventListener("click", () => this.setState("idle"));
    this.setState("idle");
  }

  mix() { return this.amb && this.amb !== "none" ? { [this.amb]: this.amb === "rain" ? 0.3 : 0.38 } : {}; }

  enter() {
    if (this.state === "idle") this.app.say("나에게로 돌아오는 짧은 여행 · A short journey back to yourself.");
  }

  leave() { if (this.state === "run") this.stop(false); }

  setState(s) {
    this.state = s;
    this.panel.dataset.state = s;
    if (s === "idle") {
      this.setText("준비가 되면 시작을 눌러 주세요.", "Press start when you're ready.");
      this.breathEl.textContent = "";
    }
  }

  setText(ko, en) {
    if (this.promptEl.dataset.ko === ko) return;
    this.promptEl.dataset.ko = ko;
    this.promptEl.classList.remove("show");
    void this.promptEl.offsetWidth;
    this.promptEl.innerHTML = "";
    const k = document.createElement("span");
    k.textContent = ko;
    const e = document.createElement("span");
    e.className = "en-sub";
    e.textContent = en;
    this.promptEl.append(k, e);
    this.promptEl.classList.add("show");
  }

  start() {
    this.app.unlockSound();
    this.total = this.mins * 60;
    this.t0 = this.t;
    this.lastStep = -1;
    this.lastPhase = "";
    this.setState("run");
    this.app.sound.bell("bowl", 0, 1, 0.8);
    this.app.sound.bell("bowl", this.total, 2, 0.8); // 끝 종은 오디오 시계에 미리 예약 (화면이 꺼져도 정확)
    this.app.wakeLock(true);
  }

  stop(byUser) {
    this.app.sound.cancelBells();
    if (byUser) this.app.say("괜찮아요, 언제든 다시 돌아오면 돼요. · That's okay — come back anytime.");
    this.setState("idle");
  }

  finish() {
    const c = pick(SELF_CLOSING);
    this.setState("done");
    this.setText(c[0], c[1]);
    this.breathEl.textContent = "";
  }

  breath(t) {
    if (this.state !== "run") return { b: 0.5 - 0.5 * Math.cos(t * TAU / 10), phase: null };
    let p = (t - this.t0) % CYCLE;
    for (const [kind, len, ko, en] of BREATH) {
      if (p < len) {
        const x = p / len;
        const b = kind === "inhale" ? ease(x) : kind === "hold" ? 1 : 1 - ease(x);
        return { b, phase: kind, ko, en, left: Math.ceil(len - p) };
      }
      p -= len;
    }
    return { b: 0, phase: null };
  }

  draw(g, t) {
    this.t = t;
    const { w, h } = this;
    if (this.state === "run") {
      const el = t - this.t0;
      if (el >= this.total) this.finish();
      else {
        const per = (this.total - 10) / SELF_STEPS.length;
        const i = Math.min(SELF_STEPS.length - 1, Math.floor(el / per));
        if (i !== this.lastStep) { this.lastStep = i; this.setText(...SELF_STEPS[i]); }
        const left = Math.ceil(this.total - el);
        const txt = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
        if (this.timeEl.textContent !== txt) this.timeEl.textContent = txt;
      }
    }
    const br = this.breath(t);
    if (this.state === "run" && br.phase) {
      if (br.phase !== this.lastPhase) {
        this.lastPhase = br.phase;
        if (this.cues) this.app.sound.cue(br.phase);
      }
      const txt = `${br.ko} · ${br.en}`;
      if (this.breathEl.textContent !== txt) this.breathEl.textContent = txt;
    }

    const hs = 0.5 + 0.5 * Math.sin(t * 0.03);
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, rgb(mixc([8, 12, 30], [16, 9, 32], hs)));
    bg.addColorStop(1, rgb(mixc([18, 36, 54], [36, 22, 56], hs)));
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);

    const b = br.b;
    const cx = w / 2, cy = h * 0.4, R = Math.min(w, h) * 0.16;
    const r = R * (0.62 + 0.38 * b);
    g.globalCompositeOperation = "lighter";
    glow(g, cx, cy, r * 4.4, mixc([90, 130, 255], [170, 120, 255], hs), 0.3 + 0.25 * b);
    glow(g, cx, cy, r * 2.4, [200, 170, 255], 0.3 + 0.15 * b);
    // 퍼져 나가는 물결
    g.lineWidth = 1.2;
    for (let k = 0; k < 3; k++) {
      const p = mod(t * 0.08 + k / 3, 1);
      g.strokeStyle = `rgba(190,200,255,${0.16 * (1 - p)})`;
      g.beginPath();
      g.arc(cx, cy, R * (0.9 + p * 2.8), 0, TAU);
      g.stroke();
    }
    // 둘레를 도는 작은 빛
    for (let k = 0; k < 70; k++) {
      const dir = k % 2 ? 1 : -1;
      const ang = hash(k, 121) * TAU + t * (0.03 + hash(k, 122) * 0.06) * dir;
      const rad = R * (1.15 + hash(k, 123) * 1.9) * (0.85 + 0.25 * b);
      const a = (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * (0.7 + hash(k, 124)) + k))) * 0.55;
      glow(g, cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad * 0.92, 2 + hash(k, 125) * 4, [210, 220, 255], a);
    }
    // 가운데 빛
    const og = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    og.addColorStop(0, "rgba(255,255,255,0.95)");
    og.addColorStop(0.35, "rgba(214,206,255,0.6)");
    og.addColorStop(0.75, "rgba(150,140,255,0.18)");
    og.addColorStop(1, "rgba(120,120,255,0)");
    g.fillStyle = og;
    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
    g.fill();
    g.globalCompositeOperation = "source-over";
  }
}

// =====================================================================
// 4. 자연 산책 (옆으로 흐르는 숲길 · 시간대 · 시냇물 다리)
// =====================================================================
const WALK_TIMES = {
  morning: { sky: [[150, 194, 232], [252, 222, 192]], sunC: [255, 238, 196], sun: [0.74, 0.3], far: [142, 162, 188], hill: [106, 150, 128], tree: [52, 104, 70], ground: [92, 136, 66], path: [200, 176, 134], water: [120, 180, 210], fog: 0.55, light: 1, stars: 0, fireflies: 0, rays: 1, leaves: 1, birds: 0.55, crickets: 0, wind: 0.16 },
  day: { sky: [[88, 156, 224], [198, 226, 246]], sunC: [255, 252, 236], sun: [0.24, 0.16], far: [126, 158, 196], hill: [92, 150, 100], tree: [44, 104, 58], ground: [96, 150, 62], path: [212, 188, 142], water: [96, 170, 214], fog: 0.4, light: 1, stars: 0, fireflies: 0, rays: 0.3, leaves: 1, birds: 0.45, crickets: 0, wind: 0.2 },
  sunset: { sky: [[66, 58, 122], [255, 156, 106]], sunC: [255, 186, 118], sun: [0.3, 0.47], far: [122, 92, 130], hill: [94, 72, 98], tree: [52, 44, 62], ground: [76, 66, 58], path: [168, 126, 102], water: [190, 130, 140], fog: 0.5, light: 0.75, stars: 0.15, fireflies: 0.5, rays: 0.4, leaves: 1, birds: 0.2, crickets: 0.22, wind: 0.18 },
  night: { sky: [[6, 10, 28], [28, 42, 76]], sunC: [232, 238, 255], sun: [0.76, 0.17], far: [26, 34, 60], hill: [20, 30, 46], tree: [12, 20, 30], ground: [16, 24, 28], path: [50, 56, 66], water: [40, 60, 100], fog: 0.35, light: 0.35, stars: 1, fireflies: 1, rays: 0, leaves: 0, birds: 0, crickets: 0.5, wind: 0.12 }
};
const WALK_SPEEDS = { stop: 0, slow: 34, walk: 64 };
const STEP_IV = { stop: 0, slow: 0.8, walk: 0.55 };
const CREEK = 2800; // 시냇물과 다리가 나오는 간격 (월드 px)

function mixPal(a, b, t) {
  const o = {};
  for (const k in b) {
    const va = a[k], vb = b[k];
    if (Array.isArray(vb)) o[k] = Array.isArray(vb[0]) ? vb.map((c, i) => mixc(va[i], c, t)) : mixc(va, vb, t);
    else o[k] = lerp(va, vb, t);
  }
  return o;
}

export class WalkScene extends Scene {
  constructor(app) {
    super(app, "walk");
    const hr = new Date().getHours();
    this.time = hr >= 5 && hr < 10 ? "morning" : hr >= 10 && hr < 16 ? "day" : hr >= 16 && hr < 19 ? "sunset" : "night";
    this.pal = WALK_TIMES[this.time];
    this.palFrom = this.pal;
    this.palT = 1;
    this.speed = "walk";
    this.v = 0;
    this.pos = 400;
    this.dist = 0;
    this.feet = app.prefs.walkFeet !== false;
    this.lastMix = 0;
    this.statEl = this.$(".js-stat");
    this.panel.querySelectorAll("[data-time]").forEach((b) => b.addEventListener("click", () => this.setTime(b.dataset.time)));
    this.panel.querySelectorAll("[data-speed]").forEach((b) => b.addEventListener("click", () => this.setSpeed(b.dataset.speed)));
    const feet = this.$(".js-feet");
    feet.checked = this.feet;
    feet.addEventListener("change", () => { this.feet = feet.checked; app.prefs.walkFeet = this.feet; app.save(); this.applySpeedSound(); });
    this.syncButtons();
  }

  syncButtons() {
    this.panel.querySelectorAll("[data-time]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.time === this.time)));
    this.panel.querySelectorAll("[data-speed]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.speed === this.speed)));
  }

  setTime(id) {
    if (id === this.time) return;
    this.palFrom = this.pal;
    this.palT = 0;
    this.time = id;
    this.syncButtons();
    this.app.unlockSound();
    this.app.sound.setMix(this.mix());
  }

  setSpeed(id) {
    this.speed = id;
    this.syncButtons();
    this.app.unlockSound();
    this.applySpeedSound();
  }

  applySpeedSound() {
    const s = this.app.sound;
    s.stepInterval = this.feet ? STEP_IV[this.speed] : 0;
    s.level("footsteps", this.feet && this.speed !== "stop" ? 0.6 : 0);
  }

  enter() {
    this.app.say("천천히 걸으며 숲의 소리에 귀 기울여 보세요. · Walk slowly and listen to the forest.");
    this.applySpeedSound();
  }

  leave() { this.app.sound.stepInterval = 0; }

  key(e, isDown) {
    if (!isDown) return false;
    if (e.key === "ArrowRight") { this.setSpeed(this.speed === "stop" ? "slow" : "walk"); return true; }
    if (e.key === "ArrowLeft") { this.setSpeed(this.speed === "walk" ? "slow" : "stop"); return true; }
    return false;
  }

  creekLevel() {
    const k = Math.round((this.pos + this.w / 2 - CREEK / 2) / CREEK);
    const sx = k * CREEK + CREEK / 2 - this.pos;
    const d = Math.abs(sx - this.w / 2);
    return 0.06 + 0.6 * Math.pow(clamp(1 - d / (this.w * 0.9 + 200), 0, 1), 1.5);
  }

  mix() {
    const P = WALK_TIMES[this.time];
    const m = { birds: P.birds, crickets: P.crickets, wind: P.wind, stream: this.creekLevel() };
    if (this.feet && this.speed !== "stop") m.footsteps = 0.6;
    return m;
  }

  draw(g, t, dt) {
    this.t = t;
    const { w, h } = this;
    if (this.palT < 1) {
      this.palT = Math.min(1, this.palT + dt / 2.5);
      this.pal = mixPal(this.palFrom, WALK_TIMES[this.time], ease(this.palT));
    }
    const P = this.pal;
    this.v += (WALK_SPEEDS[this.speed] - this.v) * Math.min(1, dt * 1.5);
    this.pos += this.v * dt;
    this.dist += this.v * dt;
    if (t - this.lastMix > 0.4) {
      this.lastMix = t;
      this.app.sound.level("stream", this.creekLevel());
      const steps = Math.floor(this.dist / 35);
      const txt = `걸음 ${steps.toLocaleString()} · 약 ${Math.round(steps * 0.7).toLocaleString()} m`;
      if (this.statEl.textContent !== txt) this.statEl.textContent = txt;
    }
    const pos = this.pos;
    const skyLow = P.sky[1];
    const fogc = (c, k) => mixc(c, skyLow, k);

    // 하늘
    const hz = h * 0.66;
    const sky = g.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, rgb(P.sky[0]));
    sky.addColorStop(1, rgb(P.sky[1]));
    g.fillStyle = sky;
    g.fillRect(0, 0, w, hz + 2);

    if (P.stars > 0.02) {
      for (let k = 0; k < 140; k++) {
        const a = P.stars * (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * (0.5 + hash(k, 131) * 2) + k)));
        g.fillStyle = `rgba(235,238,255,${a})`;
        const s = 0.6 + hash(k, 134) * 1.2;
        g.fillRect(hash(k, 132) * w, Math.pow(hash(k, 133), 1.4) * h * 0.55, s, s);
      }
    }

    // 해 / 달
    const sx = w * P.sun[0], sy = h * P.sun[1], sr = Math.min(w, h) * 0.045;
    g.globalCompositeOperation = "lighter";
    glow(g, sx, sy, sr * 9, P.sunC, 0.35 + 0.25 * P.light);
    g.globalCompositeOperation = "source-over";
    g.fillStyle = rgb(P.sunC, 0.95);
    ellipse(g, sx, sy, sr, sr);

    // 빛줄기
    if (P.rays > 0.02) {
      g.globalCompositeOperation = "lighter";
      for (let k = 0; k < 5; k++) {
        const ang = 0.35 + k * 0.22 + Math.sin(t * 0.07 + k) * 0.03;
        const len = Math.max(w, h) * 1.3, wid = 0.05 + hash(k, 141) * 0.05;
        g.fillStyle = rgb(P.sunC, 0.05 * P.rays * (0.6 + 0.4 * Math.sin(t * 0.3 + k * 2)));
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(sx + Math.cos(Math.PI - ang - wid) * len * (sx > w / 2 ? 1 : -1), sy + Math.sin(ang + wid) * len);
        g.lineTo(sx + Math.cos(Math.PI - ang + wid) * len * (sx > w / 2 ? 1 : -1), sy + Math.sin(ang - wid) * len);
        g.closePath();
        g.fill();
      }
      g.globalCompositeOperation = "source-over";
    }

    // 구름
    const cc = mixc([255, 255, 255], P.sky[1], 0.25);
    for (let k = 0; k < 6; k++) {
      const span = w * 1.6;
      const x = mod(hash(k, 151) * span - pos * 0.03 - t * (3 + hash(k, 152) * 3), span) - w * 0.3;
      const y = h * (0.08 + hash(k, 153) * 0.25);
      const s = Math.min(w, h) * (0.05 + hash(k, 154) * 0.05);
      g.fillStyle = rgb(cc, 0.28 * (0.4 + 0.6 * P.light));
      for (let j = 0; j < 5; j++) ellipse(g, x + (j - 2) * s * 0.9, y + Math.abs(j - 2) * s * 0.15, s * (1.2 - Math.abs(j - 2) * 0.2), s * 0.6);
    }

    // 먼 산
    this.ridge(g, pos * 0.04, h * 0.5, h * 0.17, 280, 1, rgb(fogc(P.far, 0.35)), hz + 4);
    // 언덕
    this.ridge(g, pos * 0.12, h * 0.61, h * 0.08, 190, 2, rgb(fogc(P.hill, P.fog * 0.55)), h);
    // 먼 나무줄
    const ftc = rgb(fogc(P.tree, P.fog * 0.45));
    const far = pos * 0.28, fsp = 22;
    for (let i = Math.floor(far / fsp) - 1; i <= Math.floor((far + w) / fsp) + 1; i++) {
      const x = i * fsp + hash(i, 161) * fsp - far;
      const by = h * 0.665 - noise1((i * fsp) / 160, 3) * h * 0.035;
      drawTree(g, x, by, h * (0.045 + hash(i, 162) * 0.045), hash(i, 163) < 0.6 ? 0 : 1, ftc, 0);
    }
    g.fillStyle = ftc;
    g.fillRect(0, h * 0.66, w, h * 0.06);
    // 아침 안개
    if (P.fog > 0.45) {
      const fg = g.createLinearGradient(0, h * 0.58, 0, h * 0.74);
      fg.addColorStop(0, rgb(skyLow, 0));
      fg.addColorStop(0.5, rgb(skyLow, (P.fog - 0.4) * 0.9));
      fg.addColorStop(1, rgb(skyLow, 0));
      g.fillStyle = fg;
      g.fillRect(0, h * 0.58, w, h * 0.16);
    }
    // 가운데 숲 + 들판
    const mtc = rgb(fogc(P.tree, P.fog * 0.18));
    const mid = pos * 0.6, msp = 120;
    const midGround = (x) => h * 0.75 - noise1((x + mid) / 220, 5) * h * 0.025;
    g.fillStyle = rgb(fogc(P.ground, P.fog * 0.25));
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w + 12; x += 12) g.lineTo(x, midGround(x));
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    for (let i = Math.floor(mid / msp) - 1; i <= Math.floor((mid + w) / msp) + 1; i++) {
      if (hash(i, 171) < 0.25) continue;
      const x = i * msp + hash(i, 172) * msp * 0.8 - mid;
      drawTree(g, x, midGround(x) + 4, h * (0.17 + hash(i, 173) * 0.15), hash(i, 174) < 0.45 ? 0 : 1, mtc, Math.sin(t * 0.8 + i) * 0.015);
    }

    // 가까운 땅·오솔길
    const gTop = (x) => h * 0.79 + (noise1((x + pos) / 140, 6) - 0.5) * 10;
    const pTop = h * 0.84, pBot = h * 0.94;
    g.fillStyle = rgb(P.ground);
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w + 10; x += 10) g.lineTo(x, gTop(x));
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    g.fillStyle = rgb(P.path);
    g.beginPath();
    for (let x = 0; x <= w + 10; x += 10) g.lineTo(x, pTop + (noise1((x + pos) / 90, 7) - 0.5) * 6);
    for (let x = w + 10; x >= 0; x -= 10) g.lineTo(x, pBot + (noise1((x + pos) / 90, 8) - 0.5) * 6);
    g.closePath();
    g.fill();
    // 조약돌
    const pc = mixc(P.path, [0, 0, 0], 0.22);
    g.fillStyle = rgb(pc);
    for (let i = Math.floor(pos / 36); i <= Math.floor((pos + w) / 36) + 1; i++) {
      if (hash(i, 181) > 0.4) continue;
      const x = i * 36 + hash(i, 182) * 36 - pos;
      const y = pTop + 6 + hash(i, 183) * (pBot - pTop - 10);
      ellipse(g, x, y, 2 + hash(i, 184) * 4, 1.4 + hash(i, 185) * 2);
    }
    // 꽃
    if (P.light > 0.5) {
      for (let i = Math.floor(pos / 50); i <= Math.floor((pos + w) / 50) + 1; i++) {
        if (hash(i, 191) > 0.35) continue;
        const x = i * 50 + hash(i, 192) * 50 - pos;
        const y = gTop(x) + 4 + hash(i, 193) * (pTop - gTop(x) - 6);
        const col = [[255, 236, 120], [255, 180, 200], [210, 190, 255], [255, 255, 255]][Math.floor(hash(i, 194) * 4)];
        g.fillStyle = rgb(mixc(col, P.ground, 1 - P.light), 0.95);
        ellipse(g, x, y, 2.2, 2.2);
      }
    }
    // 풀
    g.strokeStyle = rgb(mixc(P.ground, [0, 0, 0], 0.18));
    g.lineWidth = 1.4;
    g.beginPath();
    for (let i = Math.floor(pos / 9); i <= Math.floor((pos + w) / 9) + 1; i++) {
      const x = i * 9 - pos + hash(i, 201) * 9;
      const y = gTop(x) + 1;
      const len = 5 + hash(i, 202) * 10;
      g.moveTo(x, y);
      g.lineTo(x + Math.sin(t * 1.2 + i) * 2 + (hash(i, 203) - 0.5) * 5, y - len);
      g.moveTo(x, pTop + 2);
      g.lineTo(x + Math.sin(t * 1.2 + i * 1.3) * 1.5, pTop + 2 - len * 0.6);
    }
    g.stroke();

    // 시냇물과 다리
    const k0 = Math.floor((pos - CREEK) / CREEK), k1 = Math.floor((pos + w + CREEK) / CREEK);
    for (let k = k0; k <= k1; k++) {
      const cx = k * CREEK + CREEK / 2 - pos;
      if (cx < -260 || cx > w + 260) continue;
      this.drawCreek(g, cx, gTop(cx), pTop, pBot, P, t);
    }

    // 반딧불
    if (P.fireflies > 0.02) {
      g.globalCompositeOperation = "lighter";
      for (let k = 0; k < 34; k++) {
        const x = mod(hash(k, 211) * w * 1.3 + noise1(t * 0.12 + k, 212) * 140 - pos * 0.7, w * 1.3) - w * 0.15;
        const y = h * (0.55 + hash(k, 213) * 0.35) + (noise1(t * 0.15 + k * 3, 214) - 0.5) * 70;
        const bl = Math.max(0, Math.sin(t * (0.8 + hash(k, 215)) + k * 2));
        glow(g, x, y, 7, [200, 255, 140], P.fireflies * bl * 0.9);
      }
      g.globalCompositeOperation = "source-over";
    }

    // 날아가는 새
    if (P.birds > 0.05) {
      const cyc = Math.floor(t / 24), ph = (t / 24) % 1;
      if (ph < 0.6 && hash(cyc, 221) < 0.8) {
        const dir = hash(cyc, 222) < 0.5 ? 1 : -1;
        const p = ph / 0.6;
        const bx = dir > 0 ? lerp(-80, w + 80, p) : lerp(w + 80, -80, p);
        const by = h * (0.12 + hash(cyc, 223) * 0.25) + Math.sin(p * 6) * 10;
        g.strokeStyle = rgb(mixc([40, 40, 50], P.sky[1], 0.3), 0.8);
        g.lineWidth = 1.6;
        for (let j = 0; j < 3 + Math.floor(hash(cyc, 224) * 4); j++) {
          const x = bx - dir * j * 22 + hash(j, cyc) * 10, y = by + (j % 2 ? 12 : -4) * Math.ceil(j / 2);
          const f = Math.sin(t * 9 + j) * 4;
          g.beginPath();
          g.moveTo(x - 7, y - f);
          g.quadraticCurveTo(x - 3, y - 3, x, y);
          g.quadraticCurveTo(x + 3, y - 3, x + 7, y - f);
          g.stroke();
        }
      }
    }

    // 떨어지는 잎
    if (P.leaves > 0.02) {
      for (let k = 0; k < 12; k++) {
        const x = mod(hash(k, 231) * w - pos * 0.9 + Math.sin(t * 0.7 + k) * 30 + t * 12, w + 40) - 20;
        const y = mod(hash(k, 232) * h + t * (18 + hash(k, 233) * 16), h + 40) - 20;
        const col = this.time === "sunset" ? [220, 120, 60] : [150, 180, 70];
        g.fillStyle = rgb(col, 0.85 * P.leaves);
        ellipse(g, x, y, 4, 2, t * 2 + k);
      }
    }

    // 앞쪽 큰 풀잎·나무 기둥 (빠르게 지나감)
    const near = pos * 1.5;
    const nc = rgb(mixc(P.tree, [0, 0, 0], 0.55));
    const bark = mixc(mixc([70, 52, 38], P.tree, 0.35), [0, 0, 0], 0.45 + (1 - P.light) * 0.4);
    for (let i = Math.floor(near / 1300) - 1; i <= Math.floor((near + w) / 1300) + 1; i++) {
      if (hash(i, 241) > 0.35) continue;
      const x = i * 1300 + hash(i, 242) * 700 - near;
      const tw = 26 + hash(i, 243) * 22;
      if (x < -tw || x > w + tw) continue;
      const tg = g.createLinearGradient(x - tw / 2, 0, x + tw / 2, 0);
      tg.addColorStop(0, rgb(mixc(bark, [0, 0, 0], 0.5)));
      tg.addColorStop(0.35, rgb(mixc(bark, [255, 255, 255], 0.08 * P.light)));
      tg.addColorStop(1, rgb(mixc(bark, [0, 0, 0], 0.6)));
      g.fillStyle = tg;
      g.beginPath();
      g.moveTo(x - tw * 0.5, -10);
      g.lineTo(x + tw * 0.5, -10);
      g.lineTo(x + tw * 0.62, h + 10);
      g.lineTo(x - tw * 0.62, h + 10);
      g.closePath();
      g.fill();
      // 나무껍질 결
      g.strokeStyle = rgb(mixc(bark, [0, 0, 0], 0.55), 0.6);
      g.lineWidth = 1.2;
      g.beginPath();
      for (let k = 0; k < 4; k++) {
        const bx = x + (k / 3 - 0.5) * tw * 0.6;
        g.moveTo(bx, -10);
        g.bezierCurveTo(bx + 4, h * 0.3, bx - 4, h * 0.6, bx + 2, h + 10);
      }
      g.stroke();
    }
    g.strokeStyle = nc;
    g.lineWidth = 3;
    g.beginPath();
    for (let i = Math.floor(near / 14); i <= Math.floor((near + w) / 14) + 1; i++) {
      if (hash(i, 251) > 0.55) continue;
      const x = i * 14 - near + hash(i, 252) * 14;
      const len = 18 + hash(i, 253) * 46;
      g.moveTo(x, h + 4);
      g.quadraticCurveTo(x + 4, h - len * 0.6, x + (hash(i, 254) - 0.3) * 18 + Math.sin(t + i) * 3, h - len);
    }
    g.stroke();

    // 밤에는 전체를 살짝 어둡게
    if (P.light < 0.9) {
      g.fillStyle = `rgba(4,8,20,${(0.9 - P.light) * 0.35})`;
      g.fillRect(0, 0, w, h);
    }
  }

  ridge(g, off, base, amp, scale, seed, color, bottom) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, bottom);
    for (let x = 0; x <= this.w + 6; x += 6) g.lineTo(x, base - fbm((x + off) / scale, seed) * amp);
    g.lineTo(this.w, bottom);
    g.closePath();
    g.fill();
  }

  drawCreek(g, cx, gy, pTop, pBot, P, t) {
    const { h } = this;
    const hw = 110;
    const wg = g.createLinearGradient(0, gy, 0, h);
    wg.addColorStop(0, rgb(mixc(P.water, P.sky[1], 0.3)));
    wg.addColorStop(1, rgb(mixc(P.water, [0, 0, 0], 0.35)));
    g.fillStyle = wg;
    g.beginPath();
    g.moveTo(cx - hw - 20, gy - 2);
    g.bezierCurveTo(cx - hw, gy + 20, cx - hw + 10, h, cx - hw + 6, h);
    g.lineTo(cx + hw - 6, h);
    g.bezierCurveTo(cx + hw - 10, h, cx + hw, gy + 20, cx + hw + 20, gy - 2);
    g.closePath();
    g.fill();
    // 물결 반짝임
    g.strokeStyle = `rgba(255,255,255,${0.25 * (0.4 + 0.6 * P.light)})`;
    g.lineWidth = 1.2;
    for (let k = 0; k < 9; k++) {
      const y = gy + 10 + ((k * 23 + t * 18) % (h - gy - 10));
      const x = cx + Math.sin(t * 1.4 + k * 2) * hw * 0.5;
      g.beginPath();
      g.moveTo(x - 12, y);
      g.quadraticCurveTo(x, y - 3, x + 12, y);
      g.stroke();
    }
    // 강가 돌
    g.fillStyle = rgb(mixc(P.path, [0, 0, 0], 0.35));
    for (let j = 0; j < 6; j++) {
      const side = j % 2 ? 1 : -1;
      ellipse(g, cx + side * (hw - 4 + hash(j, 261) * 14), gy + 8 + j * (h - gy) / 7, 8 + hash(j, 262) * 7, 5 + hash(j, 263) * 3);
    }
    // 나무다리
    const wood = mixc([120, 82, 50], P.sky[1], 0.12);
    const dark = mixc(wood, [0, 0, 0], 0.4);
    const d0 = pTop - 4, d1 = pBot - 6;
    g.fillStyle = rgb(dark);
    g.fillRect(cx - hw - 26, d1, hw * 2 + 52, 6);
    for (let x = cx - hw - 24; x < cx + hw + 24; x += 13) {
      g.fillStyle = rgb(mixc(wood, [0, 0, 0], hash(Math.round(x), 271) * 0.2));
      g.fillRect(x, d0, 11, d1 - d0);
    }
    g.fillStyle = rgb(dark);
    for (const px of [cx - hw - 20, cx - hw / 3, cx + hw / 3, cx + hw + 14]) g.fillRect(px, d0 - 30, 6, 32);
    g.fillRect(cx - hw - 22, d0 - 30, hw * 2 + 44, 5);
  }
}

function drawTree(g, x, by, size, type, color, sway) {
  g.fillStyle = color;
  const tip = sway * size;
  if (type === 0) { // 소나무
    g.fillRect(x - size * 0.035, by - size * 0.25, size * 0.07, size * 0.25);
    for (let k = 0; k < 3; k++) {
      const y0 = by - size * (0.15 + k * 0.26), wd = size * (0.34 - k * 0.08);
      g.beginPath();
      g.moveTo(x - wd, y0);
      g.lineTo(x + tip * (k + 1) / 3, y0 - size * 0.42);
      g.lineTo(x + wd, y0);
      g.closePath();
      g.fill();
    }
  } else { // 둥근 나무
    g.fillRect(x - size * 0.04, by - size * 0.45, size * 0.08, size * 0.45);
    const cy = by - size * 0.62;
    ellipse(g, x + tip * 0.5, cy, size * 0.26, size * 0.24);
    ellipse(g, x - size * 0.16 + tip * 0.4, cy + size * 0.1, size * 0.18, size * 0.16);
    ellipse(g, x + size * 0.17 + tip * 0.4, cy + size * 0.08, size * 0.19, size * 0.17);
    ellipse(g, x + tip, cy - size * 0.18, size * 0.17, size * 0.16);
  }
}

// =====================================================================
// 5. 푸른 바다 수영
// =====================================================================
const SEABED = 1500;        // 바닥 평균 깊이 (월드 px)
const PX_PER_M = 50;        // 수심 표시: 50px = 1m
const FISH_KINDS = [
  { c: [255, 208, 60], len: 22, n: 14 },                 // 노랑 쥐치
  { c: [84, 160, 255], len: 18, n: 22 },                 // 파랑 물고기
  { c: [205, 225, 238], len: 14, n: 34 },                // 은빛 정어리 떼
  { c: [255, 128, 64], len: 16, n: 8, stripe: true },    // 흰 줄무늬 주황 물고기
  { c: [170, 120, 255], len: 20, n: 10 }                 // 보라 물고기
];

function water(y) {
  const d = clamp(y / 1800, 0, 1);
  return d < 0.45 ? mixc([84, 202, 226], [26, 112, 178], d / 0.45) : mixc([26, 112, 178], [6, 34, 80], (d - 0.45) / 0.55);
}

export class OceanScene extends Scene {
  constructor(app) {
    super(app, "ocean");
    this.cx = 0; this.cy = 380;
    this.vx = 0; this.vy = 0;
    this.keys = new Set();
    this.ptr = null;          // { x, y, down, t0, sx, sy, moved }
    this.lastInput = -99;
    this.auto = app.prefs.oceanAuto !== false;
    this.schools = [];
    this.jellies = [];
    this.bubbles = [];
    this.turtle = null;
    this.manta = null;
    this.whale = { active: false, next: 12 };
    this.lastMix = 0;
    this.depthEl = this.$(".js-depth");
    const auto = this.$(".js-auto");
    auto.checked = this.auto;
    auto.addEventListener("change", () => { this.auto = auto.checked; app.prefs.oceanAuto = this.auto; app.save(); });
    this.$(".js-up").addEventListener("click", () => { this.vy -= 140; this.lastInput = this.t; });
    this.$(".js-down").addEventListener("click", () => { this.vy += 140; this.lastInput = this.t; });
    this.spawned = false;
  }

  mix() { return { underwater: 0.75, waves: this.surfaceLevel() }; }
  surfaceLevel() { return 0.3 * clamp(1 - (this.cy + this.h / 2) / 700, 0, 1); }

  enter() {
    this.app.say("화면을 누른 채로 움직이면 그쪽으로 헤엄쳐요. 톡 누르면 물방울! · Hold to swim, tap for bubbles.");
    this.whale.next = this.t + 15;
  }

  resize(w, h) {
    super.resize(w, h);
    if (!this.spawned) { this.spawned = true; this.spawnAll(); }
  }

  get centerX() { return this.cx + this.w / 2; }

  spawnAll() {
    for (let i = 0; i < 6; i++) this.schools.push(this.newSchool(i, true));
    for (let i = 0; i < 6; i++) this.jellies.push(this.newJelly(true));
    this.turtle = this.newTurtle(true);
    this.manta = this.newManta(true);
  }

  // 화면 밖(또는 처음엔 화면 안)에 새로 놓는다
  around(inside) {
    const { w } = this;
    const dir = Math.random() < 0.5 ? -1 : 1;
    const x = inside ? this.cx + Math.random() * w : this.centerX + (Math.random() < 0.5 ? -1 : 1) * (w * 0.5 + 150 + Math.random() * 300);
    return { x, dir };
  }

  newSchool(i, inside) {
    const kind = FISH_KINDS[i % FISH_KINDS.length];
    const { x } = this.around(inside);
    const dir = x < this.centerX ? 1 : -1;
    const n = kind.n;
    const members = [];
    const spread = Math.sqrt(n) * kind.len * 1.4;
    for (let k = 0; k < n; k++) {
      members.push({ ox: (Math.random() - 0.5) * spread * 2.2, oy: (Math.random() - 0.5) * spread, ph: Math.random() * 100, s: 0.8 + Math.random() * 0.4, dx: 0, dy: 0, vx: 0, vy: 0 });
    }
    return {
      kind, members, x, dir: inside ? (Math.random() < 0.5 ? -1 : 1) : dir,
      baseY: clamp(this.cy + this.h * (0.2 + Math.random() * 0.6), 120, SEABED - 120),
      speed: 18 + Math.random() * 26, ph: Math.random() * 100
    };
  }

  newJelly(inside) {
    const { x } = this.around(inside);
    return { x, y: this.cy + this.h * (inside ? Math.random() : 1.1 + Math.random() * 0.3), s: 14 + Math.random() * 22, ph: Math.random() * 100, hue: Math.random() < 0.5 ? [255, 160, 220] : [170, 190, 255] };
  }

  newTurtle(inside) {
    const { x } = this.around(inside);
    return { x, y: clamp(this.cy + this.h * (0.3 + Math.random() * 0.4), 150, SEABED - 160), dir: x < this.centerX ? 1 : -1, s: 46 + Math.random() * 16, ph: Math.random() * 10 };
  }

  newManta(inside) {
    const { x } = this.around(inside);
    return { x, y: clamp(this.cy + this.h * (0.5 + Math.random() * 0.4), 600, SEABED - 120), dir: x < this.centerX ? 1 : -1, s: 70 + Math.random() * 30, ph: Math.random() * 10 };
  }

  far(x, margin) { return Math.abs(x - this.centerX) > this.w * 0.5 + margin; }
  offDepth(y) { return Math.abs(y - (this.cy + this.h / 2)) > this.h * 1.4; }

  key(e, isDown) {
    const k = e.key.toLowerCase();
    if (!["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", " "].includes(k)) return false;
    if (k === " ") { if (isDown) this.burst(this.w / 2, this.h / 2); return true; }
    if (isDown) this.keys.add(k); else this.keys.delete(k);
    this.lastInput = this.t;
    return true;
  }

  down(x, y) { this.ptr = { x, y, down: true, t0: this.t, sx: x, sy: y, moved: false }; }
  move(x, y, e) {
    if (!this.ptr) this.ptr = { x, y, down: false };
    this.ptr.x = x; this.ptr.y = y;
    if (this.ptr.down && Math.hypot(x - this.ptr.sx, y - this.ptr.sy) > 10) this.ptr.moved = true;
    if (!this.ptr.down && e.pointerType !== "mouse") this.ptr = null;
  }
  up(x, y, e) {
    const p = this.ptr;
    if (p && p.down && !p.moved && this.t - p.t0 < 0.3) this.burst(x, y);
    this.ptr = e && e.pointerType === "mouse" ? { x, y, down: false } : null;
  }

  // 톡: 물방울 + 물고기가 흩어짐
  burst(sx, sy) {
    this.app.unlockSound();
    const wx = sx + this.cx, wy = sy + this.cy;
    for (let k = 0; k < 12; k++) this.addBubble(wx + (Math.random() - 0.5) * 20, wy + (Math.random() - 0.5) * 20, 2 + Math.random() * 6);
    this.app.sound.bubbles(5);
    for (const s of this.schools) {
      const sy0 = s.baseY + Math.sin(this.t * 0.15 + s.ph) * 50;
      for (const m of s.members) {
        const fx = s.x + m.ox + m.dx, fy = sy0 + m.oy + m.dy;
        const dx = fx - wx, dy = fy - wy, d = Math.hypot(dx, dy);
        if (d < 220 && d > 0.1) { m.vx += (dx / d) * 260 * (1 - d / 220); m.vy += (dy / d) * 260 * (1 - d / 220); }
      }
    }
  }

  addBubble(x, y, r) {
    if (this.bubbles.length > 160) this.bubbles.shift();
    this.bubbles.push({ x, y, r, born: this.t, ph: Math.random() * 10 });
  }

  update(t, dt) {
    const { w, h } = this;
    // 헤엄치기
    let tx = 0, ty = 0, input = false;
    const K = this.keys;
    if (K.has("arrowleft") || K.has("a")) { tx -= 150; input = true; }
    if (K.has("arrowright") || K.has("d")) { tx += 150; input = true; }
    if (K.has("arrowup") || K.has("w")) { ty -= 120; input = true; }
    if (K.has("arrowdown") || K.has("s")) { ty += 120; input = true; }
    const p = this.ptr;
    if (p && p.down && (p.moved || t - p.t0 > 0.25)) {
      const s = Math.min(w, h) / 2;
      tx = clamp((p.x - w / 2) / s, -1.2, 1.2) * 170;
      ty = clamp((p.y - h / 2) / s, -1.2, 1.2) * 140;
      input = true;
    }
    if (input) this.lastInput = t;
    else if (this.auto && t - this.lastInput > 3) {
      tx = 26;
      const wantY = 520 + Math.sin(t * 0.03) * 260;
      ty = clamp((wantY - this.cy) * 0.05, -14, 14);
    }
    const k = Math.min(1, dt * 1.6);
    this.vx += (tx - this.vx) * k;
    this.vy += (ty - this.vy) * k;
    this.cx += this.vx * dt;
    this.cy = clamp(this.cy + this.vy * dt, -h * 0.3, SEABED + 40 - h * 0.78);

    // 물고기 떼
    const pw = p ? { x: p.x + this.cx, y: p.y + this.cy } : null;
    for (let i = 0; i < this.schools.length; i++) {
      let s = this.schools[i];
      s.x += s.dir * s.speed * dt;
      const sy0 = s.baseY + Math.sin(t * 0.15 + s.ph) * 50;
      // 화면에서 옆으로 멀어지거나, 위아래로 많이 벗어나면 화면 밖 가까운 곳에 새로 놓는다
      if (this.far(s.x, 500) || this.offDepth(sy0)) { this.schools[i] = this.newSchool(i, false); continue; }
      const damp = Math.pow(0.04, dt);
      for (const m of s.members) {
        if (pw) {
          const fx = s.x + m.ox + m.dx, fy = sy0 + m.oy + m.dy;
          const dx = fx - pw.x, dy = fy - pw.y, d = Math.hypot(dx, dy);
          const R = p.down ? 150 : 90;
          if (d < R && d > 0.1) { m.vx += (dx / d) * 600 * (1 - d / R) * dt; m.vy += (dy / d) * 600 * (1 - d / R) * dt; }
        }
        m.vx -= m.dx * 1.2 * dt;  // 원래 자리로 천천히 돌아옴
        m.vy -= m.dy * 1.2 * dt;
        m.vx *= damp; m.vy *= damp;
        m.dx += m.vx * dt; m.dy += m.vy * dt;
      }
    }
    for (let i = 0; i < this.jellies.length; i++) {
      const j = this.jellies[i];
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.6 + j.ph);
      j.y -= (4 + pulse * 10) * dt;
      j.x += Math.sin(t * 0.2 + j.ph) * 5 * dt;
      if (this.far(j.x, 400) || j.y < this.cy - h * 0.5 || j.y > this.cy + h * 1.6 || j.y < -40) this.jellies[i] = this.newJelly(false);
    }
    const T = this.turtle;
    T.x += T.dir * 24 * dt;
    T.y += Math.sin(t * 0.3 + T.ph) * 6 * dt;
    if (this.far(T.x, 600) || this.offDepth(T.y)) this.turtle = this.newTurtle(false);
    const M = this.manta;
    M.x += M.dir * 34 * dt;
    if (this.far(M.x, 700) || this.offDepth(M.y)) this.manta = this.newManta(false);

    // 고래 (멀리서 천천히 지나감 · 노래)
    const W = this.whale;
    if (!W.active && t > W.next) {
      W.active = true;
      W.size = Math.max(380, w * 0.6);
      W.dir = Math.random() < 0.5 ? 1 : -1;
      W.sx = W.dir > 0 ? -W.size : w + W.size; // 화면 좌표 (먼 배경)
      W.sy = h * (0.3 + Math.random() * 0.25);
      W.sang = 0;
      this.app.sound.whale();
    }
    if (W.active) {
      W.sx += W.dir * 22 * dt - this.vx * 0.25 * dt;
      if (W.sang < 2 && Math.abs(W.sx - w / 2) < w * 0.35) { W.sang = 2; this.app.sound.whale(); setTimeout(() => { if (this.app.current === this) this.app.sound.whale(); }, 7000); }
      if ((W.dir > 0 && W.sx > w + W.size * 1.2) || (W.dir < 0 && W.sx < -W.size * 1.2)) { W.active = false; W.next = t + 50 + Math.random() * 50; }
    }

    // 물방울
    if (Math.random() < dt * 1.4) { // 바닥 틈에서 가끔
      const bx = this.cx + Math.random() * w;
      const by = this.bedY(bx);
      if (by < this.cy + h + 20) this.addBubble(bx, by - 4, 2 + Math.random() * 4);
    }
    this.bubbles = this.bubbles.filter((b) => {
      const age = t - b.born;
      b.y -= (26 + b.r * 7) * dt;
      b.x += Math.sin(age * 3 + b.ph) * 12 * dt;
      return b.y > 0 && age < 16;
    });

    if (t - this.lastMix > 0.5) {
      this.lastMix = t;
      this.app.sound.level("waves", this.surfaceLevel());
      const m = Math.max(0, (this.cy + h / 2) / PX_PER_M);
      const txt = `수심 ${m.toFixed(0)} m · Depth`;
      if (this.depthEl.textContent !== txt) this.depthEl.textContent = txt;
    }
  }

  bedY(x) {
    return SEABED + (noise1(x / 420, 12) - 0.5) * 120 + (noise1(x / 90, 13) - 0.5) * 16;
  }

  draw(g, t, dt) {
    this.t = t;
    this.update(t, dt);
    const { w, h, cx, cy } = this;

    // 물 색 (깊을수록 어둡게)
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, rgb(water(Math.max(0, cy))));
    bg.addColorStop(1, rgb(water(Math.max(0, cy + h))));
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);

    // 수면
    const surf = -cy;
    if (surf > -20) {
      const sg = g.createLinearGradient(0, surf - 160, 0, surf + 60);
      sg.addColorStop(0, "rgba(220,248,255,0.95)");
      sg.addColorStop(0.7, "rgba(150,228,245,0.85)");
      sg.addColorStop(1, "rgba(150,228,245,0)");
      g.fillStyle = sg;
      g.beginPath();
      g.moveTo(0, 0);
      for (let x = 0; x <= w + 8; x += 8) g.lineTo(x, surf + Math.sin((x + cx) * 0.02 + t * 1.2) * 4 + Math.sin((x + cx) * 0.053 - t * 2) * 2);
      g.lineTo(w, 0);
      g.closePath();
      g.fill();
      g.strokeStyle = "rgba(255,255,255,0.7)";
      g.lineWidth = 1.5;
      g.beginPath();
      for (let x = 0; x <= w + 8; x += 8) g.lineTo(x, surf + Math.sin((x + cx) * 0.02 + t * 1.2) * 4 + Math.sin((x + cx) * 0.053 - t * 2) * 2);
      g.stroke();
    }

    // 햇빛 기둥
    const rayA = 0.12 * clamp(1 - cy / 1300, 0, 1);
    if (rayA > 0.005) {
      g.globalCompositeOperation = "lighter";
      const top = Math.max(0, surf);
      for (let k = 0; k < 6; k++) {
        const span = w * 1.5;
        const x = mod(k * span / 6 - cx * 0.3 + Math.sin(t * 0.1 + k) * 40, span) - w * 0.25;
        const wd = 40 + hash(k, 301) * 100;
        const len = h * 1.3;
        const a = rayA * (0.55 + 0.45 * Math.sin(t * 0.5 + k * 1.7));
        const rg = g.createLinearGradient(0, top, 0, top + len);
        rg.addColorStop(0, `rgba(210,245,255,${a})`);
        rg.addColorStop(1, "rgba(210,245,255,0)");
        g.fillStyle = rg;
        g.beginPath();
        g.moveTo(x - wd * 0.5, top);
        g.lineTo(x + wd * 0.5, top);
        g.lineTo(x + wd * 1.3 + len * 0.18, top + len);
        g.lineTo(x - wd * 0.2 + len * 0.18, top + len);
        g.closePath();
        g.fill();
      }
      g.globalCompositeOperation = "source-over";
    }

    // 고래 (가장 먼 배경)
    if (this.whale.active) drawWhale(g, this.whale, t, mixc(water(cy + h * 0.5), [8, 26, 56], 0.5));

    // 먼 암초
    const farC = mixc(water(SEABED - 300), [12, 44, 84], 0.25);
    if (SEABED - 520 - cy < h) {
      g.fillStyle = rgb(farC, 0.8);
      g.beginPath();
      g.moveTo(0, h + 2);
      for (let x = 0; x <= w + 10; x += 10) {
        const wx = x + cx * 0.5;
        g.lineTo(x, SEABED - 60 - fbm(wx / 260, 14) * 420 - cy);
      }
      g.lineTo(w, h + 2);
      g.closePath();
      g.fill();
    }

    // 떠다니는 부유물 (바다 눈)
    g.fillStyle = "rgba(230,245,255,0.35)";
    for (let k = 0; k < 70; k++) {
      const x = mod(hash(k, 311) * w - cx * 0.8 + Math.sin(t * 0.2 + k) * 6, w);
      const y = mod(hash(k, 312) * h - cy * 0.8 + t * (4 + hash(k, 313) * 6), h);
      const s = 0.8 + hash(k, 314) * 1.6;
      g.fillRect(x, y, s, s);
    }

    // 바닥
    const bedTop = SEABED - 80 - cy;
    if (bedTop < h) this.drawBed(g, t);

    // 해파리
    for (const j of this.jellies) drawJelly(g, j.x - cx, j.y - cy, j, t);
    // 쥐가오리
    drawManta(g, this.manta.x - cx, this.manta.y - cy, this.manta, t);
    // 거북이
    drawTurtle(g, this.turtle.x - cx, this.turtle.y - cy, this.turtle, t);
    // 물고기 떼
    for (const s of this.schools) {
      const sy0 = s.baseY + Math.sin(t * 0.15 + s.ph) * 50;
      for (const m of s.members) {
        const fx = s.x + m.ox + m.dx + Math.sin(t * 1.3 + m.ph) * 6 - cx;
        const fy = sy0 + m.oy + m.dy + Math.cos(t * 1.1 + m.ph) * 5 - cy;
        if (fx < -40 || fx > w + 40 || fy < -40 || fy > h + 40) continue;
        const dir = Math.abs(m.vx) > 40 ? Math.sign(m.vx) : s.dir;
        drawFish(g, fx, fy, s.kind.len * m.s, dir, s.kind, m.ph, t);
      }
    }

    // 물방울
    g.lineWidth = 1;
    for (const b of this.bubbles) {
      const x = b.x - cx, y = b.y - cy;
      if (x < -10 || x > w + 10 || y < -10 || y > h + 10) continue;
      g.strokeStyle = "rgba(225,248,255,0.6)";
      g.fillStyle = "rgba(255,255,255,0.08)";
      g.beginPath();
      g.arc(x, y, b.r, 0, TAU);
      g.fill();
      g.stroke();
      g.fillStyle = "rgba(255,255,255,0.7)";
      g.fillRect(x - b.r * 0.45, y - b.r * 0.5, Math.max(1, b.r * 0.3), Math.max(1, b.r * 0.3));
    }

    // 깊이에 따른 어둠
    const dTop = clamp(cy / 3200, 0, 0.4), dBot = clamp((cy + h) / 3200, 0, 0.4);
    const dg = g.createLinearGradient(0, 0, 0, h);
    dg.addColorStop(0, `rgba(2,16,44,${dTop})`);
    dg.addColorStop(1, `rgba(2,16,44,${dBot})`);
    g.fillStyle = dg;
    g.fillRect(0, 0, w, h);
    // 가장자리
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, "rgba(0,20,50,0)");
    vg.addColorStop(1, "rgba(0,20,50,0.4)");
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
  }

  drawBed(g, t) {
    const { w, h, cx, cy } = this;
    const sand = mixc([214, 198, 150], water(SEABED), 0.35);
    // 모래
    const sg = g.createLinearGradient(0, SEABED - 80 - cy, 0, SEABED + 200 - cy);
    sg.addColorStop(0, rgb(sand));
    sg.addColorStop(1, rgb(mixc(sand, [10, 30, 50], 0.35)));
    g.fillStyle = sg;
    g.beginPath();
    g.moveTo(0, h + 2);
    for (let x = 0; x <= w + 8; x += 8) g.lineTo(x, this.bedY(x + cx) - cy);
    g.lineTo(w, h + 2);
    g.closePath();
    g.fill();
    // 일렁이는 빛 무늬
    g.globalCompositeOperation = "lighter";
    for (let k = 0; k < 10; k++) {
      const x = mod(hash(k, 321) * w * 1.4 - cx + Math.sin(t * 0.4 + k) * 30, w * 1.4) - w * 0.2;
      const y = this.bedY(x + cx) - cy + 10 + hash(k, 322) * 60;
      g.save();
      g.translate(x, y);
      g.scale(1, 0.3);
      glow(g, 0, 0, 40 + hash(k, 323) * 40, [200, 240, 255], 0.1 + 0.06 * Math.sin(t * 1.2 + k));
      g.restore();
    }
    g.globalCompositeOperation = "source-over";

    const x0 = cx - 200, x1 = cx + w + 200;
    const fogK = 0.35;
    // 바위
    for (let i = Math.floor(x0 / 260); i <= Math.floor(x1 / 260); i++) {
      if (hash(i, 331) > 0.5) continue;
      const wx = i * 260 + hash(i, 332) * 200;
      const by = this.bedY(wx) - cy;
      const rw = 30 + hash(i, 333) * 60;
      g.fillStyle = rgb(mixc([60, 70, 86], water(SEABED), fogK));
      ellipse(g, wx - cx, by + 6, rw, rw * 0.55);
      g.fillStyle = rgb(mixc([84, 96, 110], water(SEABED), fogK));
      ellipse(g, wx - cx - rw * 0.2, by - rw * 0.05, rw * 0.5, rw * 0.3);
    }
    // 산호·말미잘
    for (let i = Math.floor(x0 / 150); i <= Math.floor(x1 / 150); i++) {
      if (hash(i, 341) > 0.6) continue;
      const wx = i * 150 + hash(i, 342) * 110;
      const sx = wx - cx, by = this.bedY(wx) - cy + 6;
      const type = Math.floor(hash(i, 343) * 4);
      const col = [[255, 120, 150], [255, 160, 80], [190, 120, 255], [255, 210, 120], [120, 220, 210]][Math.floor(hash(i, 344) * 5)];
      const c = mixc(col, water(SEABED), fogK);
      const size = 30 + hash(i, 345) * 40;
      if (type === 0) drawBranchCoral(g, sx, by, size, c, i, t);
      else if (type === 1) drawFanCoral(g, sx, by, size * 1.2, c, t, i);
      else if (type === 2) {
        g.fillStyle = rgb(c);
        g.beginPath();
        g.ellipse(sx, by, size * 0.6, size * 0.45, 0, Math.PI, 0);
        g.fill();
        g.strokeStyle = rgb(mixc(c, [0, 0, 0], 0.25));
        g.lineWidth = 1.5;
        for (let k = 1; k < 4; k++) {
          g.beginPath();
          g.ellipse(sx, by, size * 0.6 * k / 4, size * 0.45 * k / 4, 0, Math.PI, 0);
          g.stroke();
        }
      } else drawAnemone(g, sx, by, size * 0.8, c, t, i);
    }
    // 다시마 (흔들림)
    for (let i = Math.floor(x0 / 70); i <= Math.floor(x1 / 70); i++) {
      if (hash(i, 351) > 0.4) continue;
      const wx = i * 70 + hash(i, 352) * 60;
      const sx = wx - cx, by = this.bedY(wx) - cy + 8;
      const len = 160 + hash(i, 353) * 380;
      if (by - len > h || sx < -80 || sx > w + 80) continue;
      const c = mixc(hash(i, 354) < 0.5 ? [52, 140, 80] : [90, 130, 50], water(SEABED - len / 2), 0.3);
      const seg = 12, ph = hash(i, 355) * 10;
      const pts = [];
      for (let j = 0; j <= seg; j++) {
        const yy = by - (len * j) / seg;
        pts.push([sx + Math.sin(t * 0.7 + j * 0.35 + ph) * j * 2.4 + Math.sin(t * 0.25 + ph) * j * 1.2, yy]);
      }
      g.strokeStyle = rgb(c);
      g.lineWidth = 6;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let j = 1; j < pts.length; j++) g.lineTo(pts[j][0], pts[j][1]);
      g.stroke();
      g.fillStyle = rgb(c);
      for (let j = 2; j < pts.length; j += 2) {
        const side = j % 4 ? 1 : -1;
        ellipse(g, pts[j][0] + side * 9, pts[j][1], 10, 4, side * 0.6 + Math.sin(t + j) * 0.2);
      }
    }
  }
}

function drawFish(g, x, y, len, dir, kind, ph, t) {
  g.save();
  g.translate(x, y);
  g.scale(dir, 1);
  const tail = Math.sin(t * 9 + ph) * len * 0.12;
  g.fillStyle = rgb(kind.c);
  g.beginPath();
  g.ellipse(0, 0, len * 0.5, len * 0.22, 0, 0, TAU);
  g.fill();
  g.beginPath();
  g.moveTo(-len * 0.4, 0);
  g.lineTo(-len * 0.76, -len * 0.22 + tail);
  g.lineTo(-len * 0.76, len * 0.22 + tail);
  g.closePath();
  g.fill();
  if (kind.stripe) {
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.fillRect(len * 0.08, -len * 0.2, len * 0.09, len * 0.4);
    g.fillRect(-len * 0.22, -len * 0.18, len * 0.08, len * 0.36);
  }
  g.fillStyle = "rgba(255,255,255,0.25)";
  ellipse(g, len * 0.05, -len * 0.07, len * 0.3, len * 0.06);
  g.fillStyle = "rgba(10,20,30,0.85)";
  ellipse(g, len * 0.3, -len * 0.04, len * 0.045, len * 0.045);
  g.restore();
}

function drawJelly(g, x, y, j, t) {
  const s = j.s;
  const p = 0.5 + 0.5 * Math.sin(t * 1.6 + j.ph);
  g.globalCompositeOperation = "lighter";
  glow(g, x, y, s * 2.6, j.hue, 0.22);
  g.globalCompositeOperation = "source-over";
  // 촉수
  g.strokeStyle = rgb(j.hue, 0.35);
  g.lineWidth = 1.2;
  for (let k = 0; k < 6; k++) {
    const bx = x + (k / 5 - 0.5) * s * 1.4;
    g.beginPath();
    g.moveTo(bx, y);
    for (let q = 1; q <= 6; q++) g.lineTo(bx + Math.sin(t * 2 + k + q * 0.8 + j.ph) * 3 * q * 0.5, y + (s * 2.6 * q) / 6);
    g.stroke();
  }
  // 갓
  const rx = s * (1 + 0.12 * p), ry = s * (0.8 - 0.14 * p);
  g.fillStyle = rgb(j.hue, 0.38);
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, Math.PI, 0);
  g.quadraticCurveTo(x, y + ry * 0.35, x - rx, y);
  g.fill();
  g.strokeStyle = rgb(mixc(j.hue, [255, 255, 255], 0.5), 0.6);
  g.lineWidth = 1.2;
  g.stroke();
}

function drawTurtle(g, x, y, T, t) {
  const s = T.s;
  g.save();
  g.translate(x, y);
  g.scale(T.dir, 1);
  const f = Math.sin(t * 1.4 + T.ph);
  g.fillStyle = "rgb(118,140,92)";
  // 지느러미
  g.save(); g.translate(s * 0.2, s * 0.12); g.rotate(0.5 + f * 0.5); ellipse(g, s * 0.25, 0, s * 0.36, s * 0.1); g.restore();
  g.save(); g.translate(s * 0.15, -s * 0.12); g.rotate(-0.4 - f * 0.45); ellipse(g, s * 0.22, 0, s * 0.32, s * 0.09); g.restore();
  g.save(); g.translate(-s * 0.38, s * 0.12); g.rotate(-0.5 - f * 0.3); ellipse(g, -s * 0.06, 0, s * 0.14, s * 0.06); g.restore();
  // 머리
  ellipse(g, s * 0.58, -s * 0.02, s * 0.14, s * 0.1);
  g.fillStyle = "rgba(20,30,20,0.8)";
  ellipse(g, s * 0.64, -s * 0.05, s * 0.018, s * 0.018);
  // 등껍질
  g.fillStyle = "rgb(96,108,62)";
  ellipse(g, 0, 0, s * 0.5, s * 0.3);
  g.strokeStyle = "rgba(60,62,34,0.8)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(-s * 0.25, -s * 0.25); g.lineTo(-s * 0.12, 0); g.lineTo(-s * 0.25, s * 0.25);
  g.moveTo(s * 0.25, -s * 0.25); g.lineTo(s * 0.12, 0); g.lineTo(s * 0.25, s * 0.25);
  g.moveTo(-s * 0.12, 0); g.lineTo(s * 0.12, 0);
  g.stroke();
  g.fillStyle = "rgba(255,255,220,0.12)";
  ellipse(g, -s * 0.05, -s * 0.12, s * 0.3, s * 0.08);
  g.restore();
}

function drawManta(g, x, y, M, t) {
  const s = M.s;
  const f = Math.sin(t * 1.1 + M.ph) * s * 0.28;
  g.save();
  g.translate(x, y);
  g.scale(M.dir, 1);
  g.fillStyle = "rgba(24,46,78,0.9)";
  g.beginPath();
  g.moveTo(s * 0.5, 0);
  g.quadraticCurveTo(s * 0.1, -s * 0.15, -s * 0.15, -s * 0.85 + f);
  g.quadraticCurveTo(-s * 0.2, -s * 0.2, -s * 0.5, 0);
  g.quadraticCurveTo(-s * 0.2, s * 0.2, -s * 0.15, s * 0.85 - f);
  g.quadraticCurveTo(s * 0.1, s * 0.15, s * 0.5, 0);
  g.fill();
  g.strokeStyle = "rgba(24,46,78,0.8)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-s * 0.48, 0);
  g.lineTo(-s * 1.1, Math.sin(t * 1.1 + M.ph - 1) * s * 0.06);
  g.stroke();
  g.restore();
}

function drawWhale(g, W, t, c) {
  const s = W.size;
  g.save();
  g.translate(W.sx, W.sy + Math.sin(t * 0.2) * 10);
  g.scale(W.dir, 1);
  g.fillStyle = rgb(c, 0.75);
  const tail = Math.sin(t * 0.6) * s * 0.05;
  g.beginPath();
  g.moveTo(s * 0.5, 0);
  g.bezierCurveTo(s * 0.45, -s * 0.12, s * 0.1, -s * 0.13, -s * 0.2, -s * 0.06);
  g.quadraticCurveTo(-s * 0.4, -s * 0.02 + tail, -s * 0.5, tail);
  g.lineTo(-s * 0.62, -s * 0.07 + tail * 1.5);
  g.quadraticCurveTo(-s * 0.56, tail, -s * 0.62, s * 0.06 + tail * 1.5);
  g.lineTo(-s * 0.5, tail + s * 0.01);
  g.quadraticCurveTo(-s * 0.3, s * 0.05 + tail, 0, s * 0.08);
  g.bezierCurveTo(s * 0.25, s * 0.1, s * 0.48, s * 0.06, s * 0.5, 0);
  g.fill();
  // 가슴지느러미
  g.beginPath();
  g.moveTo(s * 0.18, s * 0.06);
  g.quadraticCurveTo(s * 0.1, s * 0.2 + Math.sin(t * 0.5) * s * 0.03, s * 0.0, s * 0.22);
  g.quadraticCurveTo(s * 0.08, s * 0.1, s * 0.12, s * 0.06);
  g.fill();
  g.restore();
}

function drawBranchCoral(g, x, y, size, c, seed, t) {
  g.strokeStyle = rgb(c);
  g.lineCap = "round";
  const branch = (bx, by, ang, len, wd, d, id) => {
    const sway = Math.sin(t * 0.6 + seed + d) * 0.03;
    const ex = bx + Math.cos(ang + sway) * len, ey = by + Math.sin(ang + sway) * len;
    g.lineWidth = wd;
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(ex, ey);
    g.stroke();
    if (d < 3) {
      branch(ex, ey, ang - 0.35 - hash(id, seed) * 0.3, len * 0.72, wd * 0.7, d + 1, id * 2 + 1);
      branch(ex, ey, ang + 0.35 + hash(id + 7, seed) * 0.3, len * 0.72, wd * 0.7, d + 1, id * 2 + 2);
    }
  };
  branch(x, y, -Math.PI / 2, size * 0.42, size * 0.13, 0, 1);
}

function drawFanCoral(g, x, y, size, c, t, seed) {
  g.strokeStyle = rgb(c, 0.85);
  g.lineWidth = 1.4;
  const sway = Math.sin(t * 0.5 + seed) * 0.04;
  g.beginPath();
  for (let k = 0; k <= 12; k++) {
    const a = -Math.PI + 0.25 + (k / 12) * (Math.PI - 0.5) + sway;
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * size * 0.5, y + Math.sin(a) * size * 0.6, x + Math.cos(a) * size, y + Math.sin(a) * size * 0.95);
  }
  g.stroke();
  g.lineWidth = 3;
  g.beginPath();
  g.arc(x, y, size * 0.96, -Math.PI + 0.25 + sway, -0.25 + sway);
  g.stroke();
}

function drawAnemone(g, x, y, size, c, t, seed) {
  g.lineCap = "round";
  for (let k = 0; k < 14; k++) {
    const a = -Math.PI + 0.3 + (k / 13) * (Math.PI - 0.6);
    const sw = Math.sin(t * 1.2 + k * 0.6 + seed) * 0.25;
    const ex = x + Math.cos(a + sw) * size, ey = y + Math.sin(a + sw) * size;
    g.strokeStyle = rgb(c, 0.9);
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * size * 0.5, y + Math.sin(a) * size * 0.5, ex, ey);
    g.stroke();
    g.fillStyle = rgb(mixc(c, [255, 255, 255], 0.5));
    ellipse(g, ex, ey, 2.6, 2.6);
  }
  // 말미잘 곁의 작은 물고기 두 마리
  for (let k = 0; k < 2; k++) {
    const a = t * 0.8 + k * Math.PI + seed;
    const fx = x + Math.cos(a) * size * 0.9, fy = y - size * 0.7 + Math.sin(a * 1.3) * size * 0.3;
    drawFish(g, fx, fy, 13, Math.sin(a) > 0 ? -1 : 1, { c: [255, 130, 50], stripe: true }, k, t);
  }
}
