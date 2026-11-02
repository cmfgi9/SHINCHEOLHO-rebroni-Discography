// 온라인 법당 — 입장·이동·동작·동기화·소리
// - 자유 채팅 없음: 인사는 정해진 문구(PHRASES)의 번호만 주고받는다. 닉네임도 정해진 낱말 조합(번호)만 쓴다.
// - 서버(Realtime Database)에 연결하지 못하면 '혼자 모드'(같은 브라우저 탭끼리만)로 계속 동작한다.
import {
  WORLD, SPAWN, BELL, MOKTAK, CUSHIONS, SLOTS, CHARS, LANTERN_COLORS, LANTERN_NAMES,
  collide, inHall, inBell, inCourtyard, drawGround, staticSprites, drawChar, drawRoofs, drawLanternLines, drawNight, drawLotusLantern, POND
} from "./world.js?v=1";
import { FirebaseNet, LocalNet, kstDay } from "./net.js?v=1";
import { Engine } from "../meditate/audio-engine.js?v=3";

const PROFILE_KEY = "rebroni-temple-profile";
const BOWS_KEY = "rebroni-temple-bows";
const NAME_A = ["고요한", "맑은", "따뜻한", "푸른", "잔잔한", "환한", "너그러운", "포근한", "향기로운", "새벽", "달빛", "소박한", "느긋한", "다정한", "씩씩한", "조용한"];
const NAME_B = ["연꽃", "바람", "구름", "소나무", "이슬", "등불", "산새", "물결", "들꽃", "풍경", "대나무", "별빛", "다람쥐", "단풍", "목련", "반딧불"];
const PHRASES = [
  ["🙏 성불하세요", "May you be at peace"],
  ["반갑습니다", "Nice to meet you"],
  ["고맙습니다", "Thank you"],
  ["나무아미타불", "Namu Amitabul"],
  ["평안하세요", "Be well"],
  ["함께 기도해요", "Let's pray together"],
  ["좋은 하루 되세요", "Have a good day"],
  ["안녕히 가세요", "Goodbye"]
];
const SPEED = 135;
const BOW_SECS = 1.7;
const SAY_SECS = 5;

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const nameOf = (n) => `${NAME_A[(n >> 4) & 15] || NAME_A[0]} ${NAME_B[n & 15] || NAME_B[0]}`;
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 무시 */ } };

let profile = load(PROFILE_KEY, null);
if (!profile || typeof profile !== "object") profile = { c: Math.floor(Math.random() * CHARS.length), n: Math.floor(Math.random() * 256) };
profile.c = clamp(profile.c | 0, 0, CHARS.length - 1);
profile.n = clamp(profile.n | 0, 0, 255);

// ---------- 소리 ----------
const engine = new Engine();
let soundOn = profile.sound !== false, soundStarted = false;
function unlockSound() {
  if (!soundOn || soundStarted) return;
  engine.ensure();
  engine.setMasterVolume(profile.vol ?? 0.8);
  engine.play();
  soundStarted = true;
  updateAmbience(true);
  syncSoundBtn();
}
const canPlay = () => soundOn && soundStarted && engine.ctx;
function bell(type, vol) { if (canPlay() && vol > 0.03) engine.bell(type, engine.now + 0.02, 1, vol); }
let amb = {};
function updateAmbience(force) {
  if (!canPlay()) return;
  const hall = inHall(me.x, me.y) ? 0.45 : 1;
  const pd = Math.hypot((me.x - POND.x) / 1.4, me.y - POND.y);
  const next = night
    ? { crickets: 0.42 * hall, wind: 0.1 * hall, stream: 0.4 * clamp(1 - pd / 420, 0, 1) * hall }
    : { birds: 0.38 * hall, wind: 0.14 * hall, stream: 0.4 * clamp(1 - pd / 420, 0, 1) * hall };
  for (const id of new Set([...Object.keys(amb), ...Object.keys(next)])) {
    const v = Math.round((next[id] || 0) * 50) / 50;
    if (force || v !== amb[id]) engine.setLevel(id, v);
  }
  amb = next;
}

// ---------- 상태 ----------
const me = {
  x: SPAWN.x + (Math.random() - 0.5) * 60, y: SPAWN.y, d: 3, a: "idle",
  s: -1, sn: 0, e: "", en: 0, phase: 0, bowAt: -9, sayAt: -9, sitOn: -1
};
const remotes = new Map(); // uid → { p(data), rx, ry, phase, sn, en, sayAt, bowAt }
let net = null, online = false, joined = false, ready = false;
let night = (() => { const h = new Date().getHours(); return h >= 19 || h < 6; })();
let lanternMap = {};
let fadeHall = 1, fadeBell = 1;
let state = { bellAt: -99 };
let target = null, stuckT = 0, steerSide = 1;
const keys = new Set();
let lastSent = 0, lastPayload = "", lastBeat = 0;
let bellCool = 0, moktakCool = 0;
let myBows = (() => { const b = load(BOWS_KEY, null); return b && b.day === kstDay(Date.now()) ? b.n | 0 : 0; })();

// ---------- 화면 ----------
const canvas = $("stage");
const g = canvas.getContext("2d");
let W = 1, H = 1, dpr = 1, zoom = 1;
const cam = { x: 0, y: 0 };
function resize() {
  W = innerWidth; H = innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, matchMedia("(pointer: coarse)").matches ? 1.75 : 2);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  canvas.style.width = W + "px"; canvas.style.height = H + "px";
  zoom = clamp(Math.min(W, H) / 600, 0.66, 1.45);
}
addEventListener("resize", resize);
resize();

// ---------- 입장 화면 ----------
function renderPicker() {
  const box = $("char-list");
  box.innerHTML = "";
  CHARS.forEach((ch, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "char";
    b.setAttribute("aria-pressed", String(i === profile.c));
    b.setAttribute("aria-label", `${ch.ko} · ${ch.en}`);
    const cv = document.createElement("canvas");
    const pr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = 64 * pr; cv.height = 72 * pr;
    const cg = cv.getContext("2d");
    cg.scale(pr * 1.35, pr * 1.35);
    drawChar(cg, 23.5, 50, i, 0, 0, "idle", { p: 0 });
    const lab = document.createElement("span");
    lab.innerHTML = `${ch.ko}<span class="en-sub">${ch.en}</span>`;
    b.append(cv, lab);
    b.addEventListener("click", () => { profile.c = i; renderPicker(); });
    box.append(b);
  });
  $("my-name").textContent = nameOf(profile.n);
}
$("reroll").addEventListener("click", () => { profile.n = Math.floor(Math.random() * 256); renderPicker(); });
$("enter-btn").addEventListener("click", enter);
renderPicker();

async function enter() {
  store(PROFILE_KEY, profile);
  unlockSound();
  $("join").hidden = true;
  $("hud").hidden = false;
  joined = true;
  me.n = profile.n; me.c = profile.c;
  toast("방향키·WASD 또는 가고 싶은 곳을 눌러 이동해요. · Use arrow keys or tap to move.");
  setStatus("connecting");
  const wantLocal = new URLSearchParams(location.search).get("net") === "local";
  net = wantLocal ? new LocalNet() : new FirebaseNet();
  try {
    await net.connect();
    online = true; // ?net=local(개발 확인용)도 여러 탭이 함께 있는 것으로 표시
  } catch (e) {
    console.warn("[temple] 서버 연결 실패 → 혼자 모드", e);
    net = new LocalNet();
    await net.connect();
    online = false;
  }
  net.on.players = onPlayer;
  net.on.lanterns = () => rebuildLanterns();
  net.on.bows = () => updateBows();
  net.on.status = (ok) => { if (online) setStatus(ok ? "online" : "reconnecting"); };
  net.listen();
  ready = true;
  setStatus(online ? "online" : "solo");
  sendMe(true);
  updateBows();
}

function setStatus(kind) {
  const el = $("status");
  el.dataset.kind = kind;
  if (kind === "connecting") el.textContent = "연결 중… · Connecting";
  else if (kind === "reconnecting") el.textContent = "다시 연결 중… · Reconnecting";
  else if (kind === "solo") el.textContent = "혼자 모드 · Solo";
  else updateCount();
  el.title = kind === "solo" ? "지금은 다른 사람과 연결되지 않았어요. 혼자서 둘러볼 수 있어요." : "";
}
function updateCount() {
  const el = $("status");
  if (el.dataset.kind !== "online") return;
  const n = 1 + (net ? net.livePlayers().length : 0);
  el.textContent = `🪷 ${n}명 함께 · ${n} here`;
}

// ---------- 다른 사람 ----------
function onPlayer(uid, p) {
  if (!p) { remotes.delete(uid); updateCount(); return; }
  let r = remotes.get(uid);
  if (!r) {
    r = { p, rx: p.x, ry: p.y, phase: 0, sn: p.sn, en: p.en, sayAt: -9, bowAt: -9, moving: false };
    remotes.set(uid, r);
    updateCount();
  }
  const t = performance.now() / 1000;
  if (p.sn !== r.sn) { r.sn = p.sn; if (p.s >= 0) r.sayAt = t; }
  if (p.en !== r.en) {
    r.en = p.en;
    const d = Math.hypot(p.x - me.x, p.y - me.y);
    if (p.e === "bow") r.bowAt = t;
    else if (p.e === "bell") { state.bellAt = t; bell("temple", Math.max(0.25, 0.85 - d / 1500)); }
    else if (p.e === "moktak") bell("moktak", clamp(0.8 - d / 500, 0, 0.8));
  }
  r.p = p;
}

// ---------- 내 정보 보내기 ----------
function sendMe(force) {
  if (!ready) return;
  const now = performance.now();
  const payload = {
    n: profile.n, c: profile.c, x: Math.round(me.x), y: Math.round(me.y), d: me.d,
    a: me.a, s: me.s, sn: me.sn, e: me.e, en: me.en
  };
  const key = JSON.stringify(payload);
  if (!force && key === lastPayload && now - lastBeat < 25000) return;
  if (!force && key !== lastPayload && now - lastSent < 160) return;
  lastSent = now;
  lastBeat = now;
  lastPayload = key;
  net.send(payload);
}

function emit(kind) { me.e = kind; me.en = (me.en + 1) % 100000; sendMe(true); }

// ---------- 동작 ----------
function standUp() {
  if (me.a === "sit") { me.a = "idle"; me.sitOn = -1; }
}
function doBow() {
  const t = performance.now() / 1000;
  if (t - me.bowAt < BOW_SECS) return;
  unlockSound();
  me.bowAt = t;
  if (me.a === "walk") me.a = "idle";
  target = null;
  bell("moktak", 0.35);
  emit("bow");
  myBows++;
  store(BOWS_KEY, { day: kstDay(Date.now()), n: myBows });
  if (ready) net.addBow();
  updateBows();
  if (myBows === 108) {
    setTimeout(() => bell("bowl", 0.8), 900);
    toast("오늘의 108배를 마쳤어요. 마음이 한결 가벼워졌기를. · You completed 108 bows today.");
  }
}
function toggleHap() {
  unlockSound();
  standUp();
  me.a = me.a === "hap" ? "idle" : "hap";
  target = null;
  sendMe(true);
  syncButtons(true);
}
function say(i) {
  unlockSound();
  me.s = i;
  me.sn = (me.sn + 1) % 100000;
  me.sayAt = performance.now() / 1000;
  sendMe(true);
  closePops();
}
function ringBell() {
  const t = performance.now() / 1000;
  if (t < bellCool) { toast("범종의 여운이 가라앉을 때까지 잠시 기다려 주세요. · Let the bell settle first."); return; }
  unlockSound();
  bellCool = t + 8;
  state.bellAt = t;
  bell("temple", 0.9);
  emit("bell");
}
function hitMoktak() {
  const t = performance.now() / 1000;
  if (t < moktakCool) return;
  unlockSound();
  moktakCool = t + 0.35;
  bell("moktak", 0.8);
  emit("moktak");
}
function sitDown(i) {
  const c = CUSHIONS[i];
  if (!c) return;
  me.x = c.x; me.y = c.y + 4; me.d = 3; me.a = "sit"; me.sitOn = i;
  target = null;
  sendMe(true);
}
async function hangLantern(color) {
  closePops();
  unlockSound();
  if (!ready) { toast("아직 연결 중이에요. 잠시 뒤에 다시 눌러 주세요. · Still connecting."); return; }
  const L = net.freshLanterns();
  const mine = Object.values(L).filter((v) => v.u === net.uid).length;
  if (mine >= 3) { toast("연등은 하루에 3개까지 달 수 있어요. · Up to 3 lanterns a day."); return; }
  const cands = SLOTS.map((s, i) => ({ i, d: Math.hypot(s.x - me.x, s.y - me.y) })).filter((o) => !L[o.i]).sort((a, b) => a.d - b.d);
  for (const c of cands.slice(0, 6)) {
    try {
      await net.hangLantern(c.i, color);
      bell("chime", 0.5);
      toast(online
        ? `${LANTERN_NAMES[color][0]} 연등을 달았어요. 하루 동안 모두에게 보여요. · Your lantern glows for everyone for a day.`
        : `${LANTERN_NAMES[color][0]} 연등을 달았어요. (혼자 모드라 저장되지 않아요) · Not saved in solo mode.`);
      rebuildLanterns();
      return;
    } catch (e) { /* 다른 사람이 먼저 단 자리 → 다음 자리 */ }
  }
  toast("빈 자리가 없어요. 내일 다시 달아 주세요. · No free spot right now.");
}
function rebuildLanterns() {
  if (!net) return;
  const L = net.freshLanterns();
  lanternMap = {};
  for (const [k, v] of Object.entries(L)) lanternMap[k] = { c: clamp(v.c | 0, 0, LANTERN_COLORS.length - 1), mine: v.u === net.uid };
}
function updateBows() {
  const all = net ? Math.max(net.bows, 0) : 0;
  $("bows").textContent = `🙇 나 ${myBows}${myBows < 108 ? "/108" : " ✓"} · 오늘 모두 ${all.toLocaleString()}`;
}

// ---------- 버튼 ----------
let ctxKey = "";
function nearby() {
  const out = [];
  if (Math.hypot(me.x - BELL.x, me.y - BELL.y) < BELL.half + 40) out.push("bell");
  if (Math.hypot(me.x - MOKTAK.x, me.y - MOKTAK.y) < 70) out.push("moktak");
  if (me.a === "sit") out.push("stand");
  else {
    const ci = CUSHIONS.findIndex((c) => Math.hypot(c.x - me.x, c.y - me.y) < 26);
    if (ci >= 0) out.push("sit:" + ci);
  }
  if (inCourtyard(me.x, me.y)) out.push("lantern");
  return out;
}
const CTX = {
  bell: ["🔔 범종 치기", "Ring the bell", () => ringBell()],
  moktak: ["🪵 목탁", "Moktak", () => hitMoktak()],
  stand: ["일어서기", "Stand up", () => { standUp(); sendMe(true); }],
  lantern: ["🏮 연등 달기", "Hang a lantern", () => openPop("lantern-pop")]
};
function syncButtons(force) {
  const list = joined ? nearby() : [];
  const key = list.join(",") + "|" + me.a;
  if (!force && key === ctxKey) return;
  ctxKey = key;
  const box = $("ctx");
  box.innerHTML = "";
  for (const k of list) {
    const [id, arg] = k.split(":");
    const def = id === "sit" ? ["🧘 좌복에 앉기", "Sit", () => sitDown(Number(arg))] : CTX[id];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn ctx";
    b.innerHTML = `${def[0]} <span class="en-sub">${def[1]}</span>`;
    b.addEventListener("click", def[2]);
    box.append(b);
  }
  $("hap-btn").setAttribute("aria-pressed", String(me.a === "hap"));
}
$("hap-btn").addEventListener("click", toggleHap);
$("bow-btn").addEventListener("click", doBow);
$("say-btn").addEventListener("click", () => openPop("say-pop"));
PHRASES.forEach(([ko, en], i) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pop-item";
  b.innerHTML = `${ko} <span class="en-sub">${en}</span>`;
  b.addEventListener("click", () => say(i));
  $("say-pop").append(b);
});
LANTERN_COLORS.forEach((c, i) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pop-item lantern-item";
  const cv = document.createElement("canvas");
  cv.width = 36; cv.height = 44;
  const cg = cv.getContext("2d");
  drawLotusLantern(cg, 18, 20, c, false, false, 0);
  b.append(cv, Object.assign(document.createElement("span"), { textContent: LANTERN_NAMES[i][0] }));
  b.setAttribute("aria-label", `${LANTERN_NAMES[i][0]} 연등 · ${LANTERN_NAMES[i][1]} lantern`);
  b.addEventListener("click", () => hangLantern(i));
  $("lantern-pop").append(b);
});
function openPop(id) {
  const el = $(id);
  const open = el.hidden;
  closePops();
  el.hidden = !open;
}
function closePops() { document.querySelectorAll(".pop").forEach((p) => { p.hidden = true; }); }

let toastT = 0;
function toast(text) {
  const [ko, en] = text.split(" · ");
  const el = $("toast");
  el.innerHTML = "";
  el.append(Object.assign(document.createElement("span"), { textContent: ko }));
  if (en) el.append(Object.assign(document.createElement("span"), { className: "en-sub", textContent: en }));
  el.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove("show"), 5000);
}

// 소리·밤
function syncSoundBtn() {
  const b = $("sound-btn");
  b.textContent = !soundOn ? "🔇" : soundStarted ? "🔊" : "🔈";
  b.setAttribute("aria-label", soundOn ? "소리 끄기 · Mute" : "소리 켜기 · Unmute");
}
$("sound-btn").addEventListener("click", () => {
  if (!soundOn) { soundOn = true; soundStarted = false; unlockSound(); }
  else if (!soundStarted) unlockSound();
  else { soundOn = false; soundStarted = false; engine.pause(0.4); }
  profile.sound = soundOn;
  store(PROFILE_KEY, profile);
  syncSoundBtn();
});
$("night-btn").addEventListener("click", () => {
  night = !night;
  $("night-btn").textContent = night ? "☀️" : "🌙";
  updateAmbience(true);
});
$("night-btn").textContent = night ? "☀️" : "🌙";
syncSoundBtn();

// ---------- 입력 ----------
const toWorld = (sx, sy) => [cam.x + sx / zoom, cam.y + sy / zoom];
canvas.addEventListener("pointerdown", (e) => {
  if (!joined) return;
  closePops();
  unlockSound();
  const [wx, wy] = toWorld(e.clientX, e.clientY);
  target = { x: wx, y: wy };
  stuckT = 0;
  standUp();
  if (me.a === "hap") me.a = "idle";
});
const typing = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
addEventListener("keydown", (e) => {
  if (!joined || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(k)) {
    keys.add(k); target = null; standUp(); if (me.a === "hap") me.a = "idle";
    e.preventDefault();
    unlockSound();
  } else if (!e.repeat && e.target.tagName !== "BUTTON") {
    if (k === "b") doBow();
    else if (k === "h") toggleHap();
    else if (k === "e" || k === "enter") { const first = $("ctx").querySelector("button"); first?.click(); }
    else if (k >= "1" && k <= "8") say(Number(k) - 1);
    else if (k === "escape") closePops();
  }
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => keys.clear());
addEventListener("pagehide", () => net?.leave());

// ---------- 갱신 ----------
function updateMe(dt, t) {
  let vx = 0, vy = 0;
  if (keys.has("arrowleft") || keys.has("a")) vx -= 1;
  if (keys.has("arrowright") || keys.has("d")) vx += 1;
  if (keys.has("arrowup") || keys.has("w")) vy -= 1;
  if (keys.has("arrowdown") || keys.has("s")) vy += 1;
  if (!vx && !vy && target) {
    const dx = target.x - me.x, dy = target.y - me.y, d = Math.hypot(dx, dy);
    if (d < 5) target = null;
    else { vx = dx / d; vy = dy / d; }
  }
  const bowing = t - me.bowAt < BOW_SECS;
  const moving = (vx || vy) && !bowing;
  if (moving) {
    const len = Math.hypot(vx, vy), ux = vx / len, uy = vy / len, step = SPEED * dt;
    const ox = me.x, oy = me.y;
    let nx, ny;
    [nx, ny] = collide(me.x + ux * step, me.y + uy * step);
    // 누른 곳으로 가는 중 앞이 막히면 옆으로 비켜 돌아간다 (석탑·나무 등)
    if (target && (nx - ox) * ux + (ny - oy) * uy < step * 0.6) {
      const base = Math.atan2(uy, ux);
      let best = null;
      for (const o of [0.6, 1.1, 1.5]) {
        for (const sgn of [steerSide, -steerSide]) {
          const a = base + o * sgn;
          const [cx, cy] = collide(me.x + Math.cos(a) * step, me.y + Math.sin(a) * step);
          const prog = (cx - ox) * ux + (cy - oy) * uy, moved = Math.hypot(cx - ox, cy - oy);
          if (moved > step * 0.5 && prog > step * 0.1 && (!best || prog > best[2] + 1e-3)) best = [cx, cy, prog, sgn];
        }
        if (best) break;
      }
      if (best) { [nx, ny] = best; steerSide = best[3]; }
    }
    me.x = nx; me.y = ny;
    const mx = me.x - ox, my = me.y - oy;
    if (Math.abs(mx) > 0.01 || Math.abs(my) > 0.01) {
      if (Math.abs(mx) > Math.abs(my)) me.d = mx < 0 ? 1 : 2; else me.d = my < 0 ? 3 : 0;
    }
    me.phase += dt * 11;
    me.a = "walk";
    // 벽에 막혀 거의 못 움직이면 목적지 취소
    if (target && Math.hypot(me.x - ox, me.y - oy) < SPEED * dt * 0.2) { stuckT += dt; if (stuckT > 0.4) target = null; } else stuckT = 0;
  } else if (me.a === "walk") me.a = "idle";
  sendMe(false);
}

function updateRemotes(dt) {
  for (const r of remotes.values()) {
    const dx = r.p.x - r.rx, dy = r.p.y - r.ry, d = Math.hypot(dx, dy);
    if (d > 300) { r.rx = r.p.x; r.ry = r.p.y; }
    else { const k = Math.min(1, dt * 8); r.rx += dx * k; r.ry += dy * k; }
    r.moving = d > 1.5 || r.p.a === "walk";
    if (r.moving) r.phase += dt * 11;
  }
}

// ---------- 그리기 ----------
let last = 0, ambT = 0, countT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const t = now / 1000;
  const dt = Math.min(0.1, last ? t - last : 1 / 60);
  last = t;
  if (joined) updateMe(dt, t);
  updateRemotes(dt);
  if (t - ambT > 0.6) { ambT = t; updateAmbience(false); syncButtons(false); }
  if (t - countT > 5) { countT = t; updateCount(); }

  // 카메라
  const vw = W / zoom, vh = H / zoom;
  const tx = vw >= WORLD.w ? (WORLD.w - vw) / 2 : clamp(me.x - vw / 2, 0, WORLD.w - vw);
  const ty = vh >= WORLD.h ? (WORLD.h - vh) / 2 : clamp(me.y - 30 - vh / 2, 0, WORLD.h - vh);
  const ck = joined ? Math.min(1, dt * 6) : 1;
  cam.x += (tx - cam.x) * ck; cam.y += (ty - cam.y) * ck;
  if (!joined) { cam.x = tx; cam.y = ty; }
  const view = { x0: cam.x, y0: cam.y, x1: cam.x + vw, y1: cam.y + vh };

  g.setTransform(dpr * zoom, 0, 0, dpr * zoom, -cam.x * dpr * zoom, -cam.y * dpr * zoom);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  drawGround(g, view, t, night);

  const items = staticSprites(view);
  const actP = (bowAt, sit) => ({ p: (t - bowAt) / BOW_SECS, sit });
  const charAct = (a, bowAt) => (t - bowAt < BOW_SECS ? "bow" : a);
  for (const [uid, r] of remotes) {
    const p = r.p;
    if (net && p.t && net.now() - p.t > 90000) continue;
    items.push({ y: r.ry, draw: (gg) => drawChar(gg, r.rx, r.ry, p.c, p.d, r.phase, r.moving && p.a !== "sit" ? "walk" : charAct(p.a, r.bowAt), actP(r.bowAt, p.a === "sit")) });
  }
  if (joined) items.push({ y: me.y, draw: (gg) => drawChar(gg, me.x, me.y, profile.c, me.d, me.phase, charAct(me.a, me.bowAt), actP(me.bowAt, me.a === "sit")) });
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw(g, t, night, state);

  drawLanternLines(g, t, lanternMap, night);
  const meInHall = joined && inHall(me.x, me.y), meInBell = joined && inBell(me.x, me.y);
  fadeHall += ((meInHall ? 0.08 : 1) - fadeHall) * Math.min(1, dt * 5);
  fadeBell += ((meInBell ? 0.15 : 1) - fadeBell) * Math.min(1, dt * 5);
  drawRoofs(g, fadeHall, fadeBell);
  if (night) drawNight(g, view, t, lanternMap);

  // 이름·말풍선 (화면 좌표로 선명하게)
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const label = (x, y, name, mine, sayIdx, sayAt, ci, hidden) => {
    if (hidden) return;
    const sx = (x - cam.x) * zoom, sy = (y - cam.y) * zoom - 52 * zoom * (CHARS[ci]?.s || 1) - 6;
    if (sx < -100 || sx > W + 100 || sy < -60 || sy > H + 40) return;
    g.font = "600 12px -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    const tw = g.measureText(name).width + 12;
    g.fillStyle = mine ? "rgba(240,184,120,0.92)" : "rgba(20,22,30,0.55)";
    pill(g, sx - tw / 2, sy - 9, tw, 18, 9);
    g.fillStyle = mine ? "#1a1006" : "#f4f1ea";
    g.fillText(name, sx, sy + 0.5);
    if (sayIdx >= 0 && t - sayAt < SAY_SECS) {
      const a = Math.min(1, (SAY_SECS - (t - sayAt)) / 0.6);
      const txt = PHRASES[sayIdx]?.[0] || "";
      g.font = "500 13px -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
      const bw = g.measureText(txt).width + 18, by = sy - 30;
      g.globalAlpha = a;
      g.fillStyle = "rgba(255,253,246,0.96)";
      pill(g, sx - bw / 2, by - 12, bw, 24, 10);
      g.beginPath(); g.moveTo(sx - 5, by + 11); g.lineTo(sx + 5, by + 11); g.lineTo(sx, by + 17); g.closePath(); g.fill();
      g.fillStyle = "#2a2420";
      g.fillText(txt, sx, by + 0.5);
      g.globalAlpha = 1;
    }
  };
  const hiddenByRoof = (x, y) => (inHall(x, y) && fadeHall > 0.5) || (inBell(x, y) && fadeBell > 0.5 && !meInBell);
  for (const r of remotes.values()) {
    if (net && r.p.t && net.now() - r.p.t > 90000) continue;
    label(r.rx, r.ry, nameOf(r.p.n), false, r.p.s, r.sayAt, r.p.c, hiddenByRoof(r.rx, r.ry));
  }
  if (joined) label(me.x, me.y, nameOf(profile.n), true, me.s, me.sayAt, profile.c, false);
}
function pill(g2, x, y, w, h, r) {
  g2.beginPath();
  g2.roundRect ? g2.roundRect(x, y, w, h, r) : g2.rect(x, y, w, h);
  g2.fill();
}
requestAnimationFrame(frame);
