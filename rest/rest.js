// Rebroni Rest(쉼터) — 입구·공간 전환·공용 UI
// - 공간마다 전체 화면 캔버스 장면(scenes.js) + 소리 조합(sound.js)
// - 주소: /rest/#candle · #wish · #self · #walk · #ocean (해시가 없으면 입구)
// - 설치·가입·서버 저장 없음. 설정과 '간직한 소원'만 이 기기(localStorage)에 저장한다.
import { RestSound } from "./sound.js?v=1";
import { CandleScene, WishScene, SelfScene, WalkScene, OceanScene } from "./scenes.js?v=1";

const SETTINGS_KEY = "rebroni-rest-settings";
const WISHES_KEY = "rebroni-rest-wishes";
const MAX_WISHES = 50;
const ROOMS = {
  candle: ["촛불의 방", "Candle Room"],
  wish: ["소원의 뜰", "Wishing Garden"],
  self: ["나를 찾는 명상", "Finding Me"],
  walk: ["숲길 산책", "Forest Walk"],
  ocean: ["푸른 바다", "Ocean Swim"]
};

const $ = (id) => document.getElementById(id);

function load(key, def) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? def;
  } catch (e) { return def; }
}
function store(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 저장 불가(사생활 보호 모드 등) — 무시 */ }
}

let prefs = load(SETTINGS_KEY, {});
if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) prefs = {};
let wishes = load(WISHES_KEY, []);
if (!Array.isArray(wishes)) wishes = [];
wishes = wishes.filter((x) => x && typeof x.text === "string").slice(-MAX_WISHES);

const sound = new RestSound(prefs);
const canvas = $("stage");
const g = canvas.getContext("2d");
const room = $("room");
const hub = $("hub");
const msgEl = $("room-msg");

// ---------- 화면 꺼짐 방지 (공간 안에 있는 동안) ----------
let lock = null, wantLock = false;
async function wakeLock(on) {
  wantLock = on;
  try {
    if (on && !lock && navigator.wakeLock && document.visibilityState === "visible") {
      lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => { lock = null; });
    } else if (!on && lock) {
      const l = lock;
      lock = null;
      await l.release();
    }
  } catch (e) { /* 지원하지 않거나 거부됨 — 무시 */ }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && wantLock) wakeLock(true);
});

// ---------- 장면들이 함께 쓰는 기능 ----------
let msgT = 0;
const app = {
  prefs, sound, dpr: 1, current: null,
  get wishes() { return wishes; },
  save() { store(SETTINGS_KEY, prefs); },
  addWish(text) {
    wishes.push({ text, date: Date.now() });
    if (wishes.length > MAX_WISHES) wishes.splice(0, wishes.length - MAX_WISHES);
    store(WISHES_KEY, wishes);
  },
  removeWish(i) {
    wishes.splice(i, 1);
    store(WISHES_KEY, wishes);
  },
  clearWishes() {
    wishes = [];
    try { localStorage.removeItem(WISHES_KEY); } catch (e) { /* 무시 */ }
  },
  // 사용자 탭 안에서 호출 → 소리 시작 (이미 켜져 있으면 아무것도 안 함)
  unlockSound() {
    if (sound.enabled && !sound.started) {
      sound.unlock();
      if (app.current) sound.setMix(app.current.mix());
      updateSoundBtn();
    }
  },
  // "한국어 · English" 형식의 짧은 안내 문구
  say(text) {
    const [ko, en] = text.split(" · ");
    msgEl.innerHTML = "";
    const k = document.createElement("span");
    k.textContent = ko;
    msgEl.append(k);
    if (en) {
      const e = document.createElement("span");
      e.className = "en-sub";
      e.textContent = en;
      msgEl.append(e);
    }
    msgEl.classList.add("show");
    clearTimeout(msgT);
    msgT = setTimeout(() => msgEl.classList.remove("show"), 6500);
  },
  wakeLock,
  // 아래쪽 조작판의 윗변 (장면이 조작판에 가리지 않게 배치할 때 사용)
  dockTop() {
    const d = app.current?.panel.querySelector(".dock:not(.top)");
    if (!d) return innerHeight;
    const r = d.getBoundingClientRect();
    return r.height ? r.top : innerHeight;
  }
};

const scenes = {
  candle: new CandleScene(app),
  wish: new WishScene(app),
  self: new SelfScene(app),
  walk: new WalkScene(app),
  ocean: new OceanScene(app)
};

// ---------- 크기 ----------
function resize() {
  const w = innerWidth, h = innerHeight;
  const coarse = matchMedia("(pointer: coarse)").matches;
  app.dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.75 : 2);
  canvas.width = Math.max(1, Math.round(w * app.dpr));
  canvas.height = Math.max(1, Math.round(h * app.dpr));
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  app.current?.resize(w, h);
}
let resizeT = 0;
addEventListener("resize", () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(resize, 80);
});

// ---------- 그리기 ----------
let raf = 0, last = 0;
function frame(now) {
  raf = requestAnimationFrame(frame);
  const t = now / 1000;
  const dt = Math.min(0.1, last ? Math.max(0, t - last) : 1 / 60);
  last = t;
  const s = app.current;
  if (!s) return;
  g.setTransform(app.dpr, 0, 0, app.dpr, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  try { s.draw(g, t, dt); } catch (e) { console.error("[rest]", e); }
}
function startLoop() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
function stopLoop() { cancelAnimationFrame(raf); raf = 0; }

// ---------- 공간 전환 ----------
function route() {
  const id = location.hash.replace(/^#/, "").split(/[&?]/)[0];
  const scene = scenes[id];
  if (app.current && app.current !== scene) app.current.leave();
  if (!scene) {
    app.current = null;
    room.hidden = true;
    hub.hidden = false;
    document.body.classList.remove("in-room");
    document.title = "Rebroni Rest · 쉼터";
    sound.stepInterval = 0;
    sound.setMix({});
    stopLoop();
    wakeLock(false);
    return;
  }
  const changed = app.current !== scene;
  hub.hidden = true;
  room.hidden = false;
  room.dataset.room = id;
  document.body.classList.add("in-room");
  document.querySelectorAll(".panel").forEach((p) => { p.hidden = p.dataset.room !== id; });
  const [ko, en] = ROOMS[id];
  $("room-title").innerHTML = `${ko} <span class="en-sub">${en}</span>`;
  document.title = `${ko} · Rebroni Rest`;
  app.current = scene;
  scene.t = performance.now() / 1000;
  resize();
  if (changed) {
    msgEl.classList.remove("show");
    scene.enter();
    sound.setMix(scene.mix());
  }
  updateSoundBtn();
  startLoop();
  wakeLock(true);
  window.scrollTo(0, 0);
}
addEventListener("hashchange", route);

// 입구 카드: 누르는 순간(사용자 동작 안)에 소리를 깨운다
document.querySelectorAll(".room-card").forEach((a) => a.addEventListener("click", () => app.unlockSound()));
document.querySelector(".rb-back").addEventListener("click", (e) => {
  e.preventDefault();
  history.pushState(null, "", location.pathname + location.search);
  route();
});

// ---------- 캔버스 입력 ----------
canvas.addEventListener("pointerdown", (e) => {
  app.unlockSound();
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
  app.current?.down(e.clientX, e.clientY, e);
});
canvas.addEventListener("pointermove", (e) => app.current?.move(e.clientX, e.clientY, e));
canvas.addEventListener("pointerup", (e) => app.current?.up(e.clientX, e.clientY, e));
canvas.addEventListener("pointercancel", (e) => app.current?.up(e.clientX, e.clientY, e));
canvas.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") app.current?.up(e.clientX, e.clientY, { pointerType: "none" }); });

const typing = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
addEventListener("keydown", (e) => {
  if (!app.current || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Escape") { location.hash = ""; return; }
  if (e.target.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
  if (app.current.key(e, true)) { e.preventDefault(); app.unlockSound(); }
});
addEventListener("keyup", (e) => {
  if (!app.current || typing(e.target)) return;
  if (app.current.key(e, false)) e.preventDefault();
});

// ---------- 소리 버튼 · 볼륨 ----------
function updateSoundBtn() {
  const b = $("sound-btn");
  let icon, label, cls = "";
  if (!sound.enabled) { icon = "🔇"; label = "소리 꺼짐"; }
  else if (!sound.started) { icon = "🔈"; label = "소리 켜기"; cls = "pulse"; }
  else { icon = "🔊"; label = "소리 끄기"; }
  b.innerHTML = `${icon} <span class="hide-xs">${label}</span>`;
  b.className = `rb-btn ${cls}`;
  b.setAttribute("aria-label", `${label} · Sound`);
  $("vol").hidden = !sound.enabled || !sound.started;
}
$("sound-btn").addEventListener("click", () => {
  if (!sound.enabled) {
    prefs.sound = true;
    sound.setEnabled(true);
  } else if (!sound.started) {
    sound.unlock();
  } else {
    prefs.sound = false;
    sound.setEnabled(false);
  }
  if (sound.enabled && app.current) sound.setMix(app.current.mix());
  app.save();
  updateSoundBtn();
});
const vol = $("vol");
vol.value = String(sound.volume);
vol.addEventListener("input", () => {
  const v = Number(vol.value);
  sound.setVolume(v);
  prefs.volume = v;
});
vol.addEventListener("change", () => app.save());

// ---------- 화면만 보기 · 전체 화면 ----------
$("bare-btn").addEventListener("click", () => {
  const on = !room.classList.contains("bare");
  room.classList.toggle("bare", on);
  $("bare-btn").setAttribute("aria-pressed", String(on));
});
if (document.fullscreenEnabled) {
  const fs = $("fs-btn");
  fs.hidden = false;
  fs.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  });
}

// ---------- 입구 테마 (사이트 공용 dark / nature) ----------
function currentTheme() { try { return localStorage.getItem("theme") || "dark"; } catch (e) { return "dark"; } }
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("theme", t); } catch (e) { /* 무시 */ }
  $("theme-btn").textContent = t === "dark" ? "🌿" : "🌌";
  $("theme-btn").title = t === "dark" ? "Nature Green 테마로 전환" : "Cosmic Dark 테마로 전환";
  document.querySelector('meta[name="theme-color"]').content = t === "nature" ? "#eef4ec" : "#0b0d14";
}
$("theme-btn").addEventListener("click", () => applyTheme(currentTheme() === "dark" ? "nature" : "dark"));
applyTheme(currentTheme());

if (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
  $("ios-note").hidden = false;
}

updateSoundBtn();
route();
