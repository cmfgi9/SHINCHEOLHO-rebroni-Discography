// Rebroni Meditate — 명상 타이머 · 슬립 타이머 · 가이드 명상 · 자연의 소리 믹서 · 생성형/스템 음악 · 호흡 가이드
import { Engine, NATURE, BELLS, holdAt, curve } from "./audio-engine.js?v=3";
import { GenerativeMusic, StemMusic, AlbumPlayer, VoicePlayer, MOODS, STEM_ROLES } from "./music.js?v=3";
import { loadAlbums, firebaseConfigReady } from "../data-service.js";
import { firebaseConfig } from "../firebase-config.js";

const $ = id => document.getElementById(id);
const LS_KEY = "rebroni-meditate-settings";
const LS_PRESETS = "rebroni-meditate-presets";
const SITE = "https://music.rebroni.com/meditate/";

// ---------- 설정 ----------
const DEFAULTS = {
  vol: 0.8, musicVol: 0.7, natureVol: 0.7,
  levels: {},
  music: { src: "none", mood: "calm", density: 0.5, bright: 0.5, seed: 1, set: "all", album: "all", shuffle: false, favOnly: false },
  favs: [],
  tab: "meditate",
  timer: { dur: 15, prep: 10, interval: 0, startBell: "bowl", endBell: "bowl", endStrikes: 3, fadeIn: true, fadeOut: 30 },
  sleep: { dur: 30, fade: 5, autoNight: true },
  guided: { id: null },
  breath: { pattern: "relax", custom: [4, 2, 6, 0], cue: "tone", vibrate: true, withSession: false },
  prefs: { wake: "breath", night: false, nightAsk: true, remindTime: "21:30", quality: "auto" }
};

const clone = o => JSON.parse(JSON.stringify(o));
function merge(base, over) {
  const out = clone(base);
  for (const k of Object.keys(over || {})) {
    const v = over[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])
      ? merge(base[k], v) : v;
  }
  return out;
}

let state = clone(DEFAULTS);
try { state = merge(DEFAULTS, JSON.parse(localStorage.getItem(LS_KEY) || "{}")); } catch (e) { /* 기본값 */ }
let saveT = null;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* 무시 */ } }, 300);
}
const getPath = (path) => path.split(".").reduce((o, k) => o?.[k], state);
function setPath(path, v) {
  const ks = path.split(".");
  const last = ks.pop();
  ks.reduce((o, k) => o[k], state)[last] = v;
  save();
}

// ---------- 오디오 ----------
const engine = new Engine();
engine.setQuality(state.prefs.quality); // auto | rich | lite
const gen = new GenerativeMusic(engine);
const stems = new StemMusic(engine);
const album = new AlbumPlayer(engine);
const voice = new VoicePlayer(engine);

let tracks = [];       // 업로드된 앨범 음원
let albums = [];
let guidedItems = [];
let stemItems = [];

function ensureAudio() {
  const fresh = !engine.ctx;
  engine.ensure();
  if (fresh) {
    engine.setMasterVolume(state.vol);
    engine.setBusVolume("musicBus", state.musicVol);
    engine.setBusVolume("natureBus", state.natureVol);
    for (const [id, lv] of Object.entries(state.levels)) if (lv > 0) engine.setLevel(id, lv);
  }
}

async function play() {
  ensureAudio();
  await engine.play();
  syncMusic();
}

function pause() { engine.pause(); }

engine.onstate = (playing) => {
  if (playing) { album.resumeEls(); voice.resume(); } else { album.pauseEls(); voice.pause(); }
  renderTransport();
  updateMediaSession();
  syncWake();
};

// 음악 소스 전환: 재생 중일 때만 실제로 시작
function syncMusic() {
  const src = state.music.src;
  if (src !== "gen") gen.stop(3);
  if (src !== "stems") stems.stop(3);
  if (src !== "album" && album.running) album.stop(3);
  if (!engine.playing) return;
  if (src === "gen" && !gen.running) {
    gen.setParams({ mood: state.music.mood, density: state.music.density, bright: state.music.bright, seed: state.music.seed });
    gen.start();
  } else if (src === "stems" && !stems.running && stemItems.length) {
    stems.setStems(stemItems);
    stems.start(state.music.set);
  } else if (src === "album" && !album.running) {
    const list = albumList();
    if (list.length) { album.setShuffle(state.music.shuffle); album.setList(list); album.play(0); }
  }
  renderNowPlaying();
  updateMediaSession();
}

// ---------- 세션 (명상 / 수면 / 가이드) ----------
let sess = null;

async function startSession() {
  const mode = state.tab;
  if (mode === "guided" && !currentGuided()) { flashPhase("가이드 명상을 먼저 고르세요", "Pick a session first"); return; }
  await play();
  const e = engine;
  const now = e.now + 0.15;
  e.cancelScheduled("bell");
  const sg = e.session.gain;
  holdAt(sg, now);
  sess = { mode, t0: now, end: Infinity, doneAt: Infinity };

  if (mode === "meditate") {
    const T = state.timer;
    const t0 = now + T.prep;
    sess.t0 = t0;
    sess.end = T.dur > 0 ? t0 + T.dur * 60 : Infinity;
    const fadeIn = T.fadeIn ? Math.max(8, T.prep) : 0.5;
    sg.setValueAtTime(0, now);
    sg.setValueCurveAtTime(curve(0, 1, "in"), now + 0.01, fadeIn);
    e.bell(T.startBell, t0, 1);
    sess.nextInterval = T.interval ? t0 + T.interval * 60 : Infinity;
    if (isFinite(sess.end)) {
      const fo = Math.min(T.fadeOut, T.dur * 60 / 2);
      sg.setValueAtTime(1, sess.end - fo);
      sg.setValueCurveAtTime(curve(1, 0, "out"), sess.end - fo, fo);
      e.bell(T.endBell, sess.end, T.endStrikes);
      const gap = { bowl: 4.5, temple: 7, chime: 3, moktak: 0.55 }[T.endBell] || 0;
      sess.doneAt = sess.end + (T.endBell === "none" ? 1 : (T.endStrikes - 1) * gap + 10);
    }
    // 중간 벨은 오디오 시계로 미리 예약 (무제한이면 진행하면서 계속 예약)
    sess.ticker = (n, until) => {
      while (sess && sess.nextInterval < Math.min(until, sess.end - 10)) {
        e.bell(T.startBell === "none" ? "bowl" : T.startBell, sess.nextInterval, 1, 0.55);
        sess.nextInterval += T.interval * 60;
      }
    };
    e.tickers.add(sess.ticker);
  } else if (mode === "sleep") {
    const S = state.sleep;
    const trackEnd = S.dur === -1 && state.music.src === "album" && album.running;
    sg.setValueAtTime(sg.value, now);
    sg.linearRampToValueAtTime(1, now + 3);
    if (trackEnd) {
      album.stopAfterCurrent = true;
      album.onfinish = () => { if (sess?.mode === "sleep") endSoon(Math.min(S.fade * 60, 20)); };
    } else {
      const dur = (S.dur > 0 ? S.dur : 30) * 60;
      sess.end = now + dur;
      const fo = Math.min(S.fade * 60, dur / 2);
      sg.setValueAtTime(1, sess.end - fo);
      sg.setValueCurveAtTime(curve(1, 0, "out"), sess.end - fo, fo);
      sess.doneAt = sess.end + 0.5;
    }
    if (S.autoNight) setNight(true);
  } else {
    const item = currentGuided();
    sess.item = item;
    sg.setValueAtTime(sg.value, now);
    sg.linearRampToValueAtTime(1, now + 2);
    e.smooth(e.duck.gain, 0.4, 3);
    voice.onend = () => { if (sess?.mode === "guided") { e.smooth(e.duck.gain, 1, 4); endSoon(25, true); } };
    voice.ontime = (cur, dur) => { if (sess?.mode === "guided" && isFinite(dur)) { sess.t0 = e.now - cur; sess.guidedDur = dur; } };
    voice.play(item).catch(err => { console.warn(err); flashPhase("음성을 불러오지 못했습니다", "Could not load audio"); stopSession(); });
  }

  if (state.breath.withSession && !breath) startBreath();
  renderSession();
  syncWake();
  updateMediaSession();
}

// 지금부터 secs초 뒤에 끝나도록 (가이드 음성이 끝났을 때 · '곡이 끝나면')
function endSoon(secs, bell = false) {
  if (!sess) return;
  const e = engine, now = e.now;
  sess.end = now + secs;
  const sg = e.session.gain;
  holdAt(sg, now);
  sg.setValueCurveAtTime(curve(sg.value, 0, "out"), now + 0.01, secs);
  if (bell) e.bell("bowl", sess.end, 1, 0.8);
  sess.doneAt = sess.end + (bell ? 8 : 0.5);
}

function stopSession(early = true) {
  if (!sess) return;
  const e = engine;
  if (sess.ticker) e.tickers.delete(sess.ticker);
  e.cancelScheduled("bell");
  album.stopAfterCurrent = false;
  album.onfinish = null;
  voice.onend = null;
  voice.ontime = null;
  if (sess.mode === "guided") voice.stop();
  const endBell = sess.mode === "meditate" && early && engine.playing ? state.timer.endBell : "none";
  sess = null;
  if (state.breath.withSession) stopBreath();
  if (early && e.ctx) {
    e.smooth(e.session.gain, 0, 2.5);
    // 무제한 명상 등을 직접 끝낼 때도 종료 벨 한 번 (울림이 끝난 뒤 재생 정지)
    if (endBell !== "none") e.bell(endBell, e.now + 0.3, 1);
    setTimeout(() => finishAudio(), endBell !== "none" ? 10000 : 2600);
  } else finishAudio();
  renderSession();
  syncWake();
  updateMediaSession();
}

// 세션이 끝난 뒤: 재생 정지 + 다음 재생을 위해 세션 볼륨 복구
function finishAudio() {
  const e = engine;
  if (!e.ctx || sess) return;
  e.pause(0.3);
  e.smooth(e.duck.gain, 1, 0.3);
  setTimeout(() => { if (!sess) { holdAt(e.session.gain, e.now); e.session.gain.setValueAtTime(1, e.now); } }, 400);
}

// ---------- 호흡 가이드 ----------
const PATTERNS = {
  relax: { ko: "4-6 이완 호흡", en: "Relax 4-6", seq: [4, 0, 6, 0], desc: "날숨을 길게 내쉬어 긴장을 풉니다. 처음이라면 이 패턴부터." },
  box: { ko: "박스 호흡", en: "Box 4-4-4-4", seq: [4, 4, 4, 4], desc: "들숨·멈춤·날숨·멈춤을 같은 길이로. 집중이 필요할 때." },
  coherent: { ko: "공명 호흡", en: "Coherent 5.5", seq: [5.5, 0, 5.5, 0], desc: "분당 약 5~6회의 느린 호흡. 편안한 리듬을 유지합니다." },
  b478: { ko: "4-7-8 호흡", en: "4-7-8", seq: [4, 7, 8, 0], desc: "잠들기 전에. 숨을 참는 시간이 길어 어지러우면 바로 멈추세요.", caution: true },
  custom: { ko: "직접 설정", en: "Custom", seq: null, desc: "각 단계의 초를 직접 정합니다." }
};
const PHASES = [
  { kind: "inhale", ko: "들이쉬기", en: "Breathe in" },
  { kind: "hold", ko: "멈춤", en: "Hold" },
  { kind: "exhale", ko: "내쉬기", en: "Breathe out" },
  { kind: "hold", ko: "멈춤", en: "Hold" }
];
let breath = null;

function breathSeq() {
  const p = PATTERNS[state.breath.pattern] || PATTERNS.relax;
  const seq = p.seq || state.breath.custom.map(Number);
  return seq.map(v => Math.max(0, Math.min(20, Number(v) || 0)));
}

async function startBreath() {
  if (breath) stopBreath();
  if (!engine.playing) await play();
  const seq = breathSeq();
  if (seq[0] + seq[2] <= 0) return;
  const t0 = engine.now + 0.8;
  breath = { t0, seq, cycle: seq.reduce((a, b) => a + b, 0), nextB: t0, nextIdx: 0, lastPhase: -1 };
  breath.ticker = (n, until) => {
    if (!breath) return;
    while (breath.nextB < until) {
      const i = breath.nextIdx;
      if (breath.seq[i] > 0) {
        if (state.breath.cue !== "off") engine.cue(PHASES[i].kind, breath.nextB, state.breath.cue);
        breath.nextB += breath.seq[i];
      }
      breath.nextIdx = (i + 1) % 4;
    }
  };
  engine.tickers.add(breath.ticker);
  renderBreathBtn();
  syncWake();
  loop();
}

function stopBreath() {
  if (!breath) return;
  engine.tickers.delete(breath.ticker);
  engine.cancelScheduled("cue");
  breath = null;
  $("orb").style.removeProperty("--s");
  renderBreathBtn();
  renderPhase();
  syncWake();
}

function breathState(t) {
  const b = breath;
  if (!b || t < b.t0) return null;
  let x = (t - b.t0) % b.cycle;
  for (let i = 0; i < 4; i++) {
    if (x < b.seq[i]) return { i, p: x / b.seq[i], left: b.seq[i] - x };
    x -= b.seq[i];
  }
  return { i: 0, p: 0, left: b.seq[0] };
}

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const ease = x => (1 - Math.cos(Math.PI * x)) / 2;

// ---------- 화면 갱신 루프 ----------
let raf = 0;
function loop() {
  cancelAnimationFrame(raf);
  if (document.hidden) return;
  frame();
  if (breath || sess) raf = requestAnimationFrame(loop);
}

function frame() {
  const t = engine.now;
  const orb = $("orb");
  const bs = breathState(t);
  if (bs) {
    const lo = reduceMotion.matches ? 0.62 : 0.5, hi = reduceMotion.matches ? 0.72 : 1;
    const s = bs.i === 0 ? lo + (hi - lo) * ease(bs.p) : bs.i === 1 ? hi : bs.i === 2 ? hi - (hi - lo) * ease(bs.p) : lo;
    orb.style.setProperty("--s", s.toFixed(4));
    orb.classList.remove("idle");
    if (bs.i !== breath.lastPhase) {
      breath.lastPhase = bs.i;
      if (state.breath.vibrate && navigator.vibrate) navigator.vibrate(bs.i === 0 ? [40] : bs.i === 2 ? [25, 60, 25] : [15]);
    }
  } else {
    orb.classList.toggle("idle", engine.playing && !breath);
  }
  renderClock(t, bs);
}

// 0.5초마다: 세션 종료 감지·잠금 화면 진행률 (백그라운드에서도 동작)
setInterval(() => {
  if (sess && engine.ctx && engine.now >= sess.doneAt) stopSession(false);
  if (document.hidden) return;
  if (!breath && !sess) frame();
}, 500);
setInterval(() => { if (sess && engine.playing) updatePosition(); }, 10000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { loop(); syncWake(); }
});

function fmt(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function renderClock(t, bs) {
  const ring = $("ring");
  const C = 590.6;
  let clock, ratio = 0;
  if (sess) {
    if (t < sess.t0) { clock = fmt(sess.t0 - t); }
    else if (isFinite(sess.end)) { clock = fmt(sess.end - t); ratio = Math.min(1, (t - sess.t0) / (sess.end - sess.t0)); }
    else if (sess.mode === "guided" && sess.guidedDur) { clock = fmt(sess.guidedDur - (t - sess.t0)); ratio = Math.min(1, (t - sess.t0) / sess.guidedDur); }
    else clock = fmt(t - sess.t0);
  } else {
    clock = idleClock();
  }
  $("clock").textContent = clock;
  ring.style.strokeDashoffset = String(C * (1 - ratio));
  renderPhase(t, bs);
}

function idleClock() {
  if (state.tab === "meditate") return state.timer.dur > 0 ? fmt(state.timer.dur * 60) : "∞";
  if (state.tab === "sleep") return state.sleep.dur > 0 ? fmt(state.sleep.dur * 60) : "♪";
  const g = currentGuided();
  return g?.duration ? fmt(g.duration) : "--:--";
}

let flashT = 0, flashMsg = null;
function flashPhase(ko, en) { flashMsg = { ko, en }; flashT = Date.now() + 3000; renderPhase(); }

function renderPhase(t = engine.now, bs = breathState(t)) {
  const el = $("phase");
  let ko, en;
  if (flashMsg && Date.now() < flashT) ({ ko, en } = flashMsg);
  else if (bs) { const ph = PHASES[bs.i]; ko = `${ph.ko} ${Math.ceil(bs.left)}`; en = ph.en; }
  else if (sess && t < sess.t0) { ko = "곧 시작합니다"; en = "Settle in…"; }
  else if (sess) {
    ko = { meditate: "명상 중", sleep: "편안히 잠드세요", guided: sess.item?.title || "가이드 명상" }[sess.mode];
    en = { meditate: "Meditating", sleep: "Sleep well", guided: sess.item?.titleEn || "Guided" }[sess.mode];
    if (!engine.playing) { ko = "일시정지"; en = "Paused"; }
  } else if (engine.playing) { ko = "재생 중"; en = "Playing"; }
  else { ko = "탭하여 시작"; en = "Tap to begin"; }
  const html = `${esc(ko)} <span class="en-sub">${esc(en)}</span>`;
  if (el.innerHTML !== html) el.innerHTML = html;
}

// ---------- 렌더링 ----------
function esc(s) {
  return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function renderTransport() {
  const btn = $("play-btn");
  btn.textContent = engine.playing ? "❚❚" : "▶";
  btn.setAttribute("aria-label", engine.playing ? "일시정지" : "재생");
  const albumMode = state.music.src === "album" && album.running;
  $("prev-btn").hidden = !albumMode;
  $("next-btn").hidden = !albumMode;
  const badge = $("status-badge");
  badge.textContent = sess ? ({ meditate: "명상 중", sleep: "수면", guided: "가이드" }[sess.mode]) : engine.playing ? "재생 중" : "준비";
  badge.classList.toggle("on", engine.playing);
  loop();
}

function renderSession() {
  $("session-btn").hidden = !!sess;
  $("session-stop").hidden = !sess;
  document.querySelectorAll("#tabs button").forEach(b => { b.disabled = !!sess && b.dataset.tab !== state.tab; });
  renderTransport();
}

function renderTabs() {
  document.querySelectorAll("#tabs button").forEach(b => {
    const on = b.dataset.tab === state.tab;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on);
  });
  document.querySelectorAll(".tabpanel").forEach(p => { p.hidden = p.dataset.panel !== state.tab; });
  frame();
}

function renderChips(id, value) {
  const wrap = $(id);
  let matched = false;
  wrap.querySelectorAll("button").forEach(b => {
    const on = Number(b.dataset.v) === value;
    matched ||= on;
    b.classList.toggle("on", on);
  });
  const ci = wrap.querySelector(".chip-input");
  if (ci) {
    ci.classList.toggle("on", !matched);
    ci.querySelector("input").value = matched ? "" : value;
  }
}

function renderTimer() {
  renderChips("t-dur", state.timer.dur);
  renderChips("s-dur", state.sleep.dur);
  $("s-track-end").disabled = state.music.src !== "album";
  if (state.sleep.dur === -1 && state.music.src !== "album") { state.sleep.dur = 30; renderChips("s-dur", 30); }
  document.querySelectorAll("[data-key]").forEach(el => {
    if (el.classList.contains("chips")) return;
    const v = getPath(el.dataset.key);
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = String(v);
  });
}

function renderGuided() {
  const box = $("guided-list");
  if (!guidedItems.length) {
    box.innerHTML = `<div class="empty">가이드 명상 콘텐츠를 준비하고 있습니다. 곧 rebroni의 목소리로 찾아올게요.<span class="en-sub">Guided sessions are coming soon.</span></div>`;
    return;
  }
  box.innerHTML = guidedItems.map(g => `
    <div class="item ${g.id === state.guided.id ? "on" : ""}">
      <button class="main" data-id="${esc(g.id)}">${esc(g.title)}${g.titleEn ? `<span class="en-sub">${esc(g.titleEn)}</span>` : ""}
        ${g.description ? `<span class="en-sub">${esc(g.description)}</span>` : ""}</button>
      <span class="muted small">${g.duration ? fmt(g.duration) : ""}</span>
    </div>`).join("");
  box.querySelectorAll("button.main").forEach(b => b.addEventListener("click", () => {
    if (sess) return;
    state.guided.id = b.dataset.id;
    save();
    renderGuided();
    frame();
  }));
}

function currentGuided() { return guidedItems.find(g => g.id === state.guided.id) || null; }

function renderMusic() {
  const src = state.music.src;
  document.querySelectorAll("#music-src button").forEach(b => {
    b.classList.toggle("on", b.dataset.v === src);
    b.setAttribute("aria-checked", b.dataset.v === src);
  });
  document.querySelectorAll(".srcpanel").forEach(p => { p.hidden = p.dataset.src !== src; });
  // 생성형
  $("g-mood").innerHTML = Object.entries(MOODS).map(([k, m]) =>
    `<button data-v="${k}" class="${k === state.music.mood ? "on" : ""}">${m.ko}<span class="en-sub">${m.en}</span></button>`).join("");
  $("g-density").value = Math.round(state.music.density * 100);
  $("g-bright").value = Math.round(state.music.bright * 100);
  $("g-seed").textContent = state.music.seed;
  // 스템
  const sets = [...new Set(stemItems.map(s => s.set || "default"))];
  $("st-set").innerHTML = `<option value="all">전체 세트 섞기</option>` + sets.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  $("st-set").value = sets.includes(state.music.set) ? state.music.set : "all";
  const pool = stemItems.filter(s => $("st-set").value === "all" || (s.set || "default") === $("st-set").value);
  $("st-info").innerHTML = stemItems.length
    ? Object.entries(STEM_ROLES).map(([r, c]) => `${c.ko} ${pool.filter(s => s.role === r).length}`).join(" · ")
    : `<span class="empty" style="display:block">스템(소리 조각)을 준비하고 있습니다. 그동안 '생성형'을 들어 보세요.<span class="en-sub">Stems are coming soon — try Generative meanwhile.</span></span>`;
  // 앨범
  renderAlbumPanel();
  renderTimer();
  renderTransport();
}

function albumList() {
  return tracks.filter(t => (state.music.album === "all" || t.albumId === state.music.album) && (!state.music.favOnly || state.favs.includes(t.key)));
}

function renderAlbumPanel() {
  const withAudio = albums.filter(a => tracks.some(t => t.albumId === a.id));
  $("al-album").innerHTML = `<option value="all">전체 앨범 (${tracks.length}곡)</option>` +
    withAudio.map(a => `<option value="${esc(a.id)}">${esc(a.title)} (${tracks.filter(t => t.albumId === a.id).length}곡)</option>`).join("");
  $("al-album").value = withAudio.some(a => a.id === state.music.album) ? state.music.album : "all";
  $("al-shuffle").checked = state.music.shuffle;
  $("al-fav").checked = state.music.favOnly;
  const list = albumList();
  const cur = album.current;
  const box = $("al-list");
  if (!tracks.length) {
    box.innerHTML = `<div class="empty">재생할 수 있는 앨범 음원을 불러오는 중이거나 아직 없습니다.<span class="en-sub">No album audio available yet.</span></div>`;
    return;
  }
  if (!list.length) {
    box.innerHTML = `<div class="empty">즐겨찾기한 곡이 없습니다. ♥를 눌러 추가하세요.<span class="en-sub">No favorites yet.</span></div>`;
    return;
  }
  box.innerHTML = list.map((t, i) => `
    <div class="item ${cur?.key === t.key ? "on" : ""}">
      <button class="main" data-i="${i}">${esc(t.title)}<span class="en-sub">${esc(t.albumTitle)}</span></button>
      <span class="acts"><button class="fav ${state.favs.includes(t.key) ? "on" : ""}" data-key="${esc(t.key)}" aria-label="즐겨찾기">♥</button></span>
    </div>`).join("");
}

function renderNowPlaying() {
  const el = $("now-playing");
  const src = state.music.src;
  const names = NATURE.filter(n => state.levels[n.id] > 0).map(n => n.ko);
  let ko = "", en = "";
  if (src === "album" && album.current) { ko = `♪ ${album.current.title}`; en = album.current.albumTitle; }
  else if (src === "gen") { const m = MOODS[state.music.mood]; ko = `생성형 앰비언트 · ${m.ko}`; en = `Generative · ${m.en} #${state.music.seed}`; }
  else if (src === "stems") { ko = "스템 재조합"; en = "Stem recombination"; }
  if (names.length) ko += (ko ? " + " : "") + names.join(" · ");
  if (!ko) { ko = "소리를 고르고 ▶을 누르세요"; en = "Pick sounds and press play"; }
  el.innerHTML = `${esc(ko)} <span class="en-sub">${esc(en)}</span>`;
  renderTransport();
}

function renderMixer() {
  const box = $("mixer");
  box.innerHTML = NATURE.map(n => {
    const lv = Math.round((state.levels[n.id] || 0) * 100);
    return `<div class="tile ${lv ? "on" : ""}" data-id="${n.id}">
      <button data-toggle="${n.id}" aria-pressed="${!!lv}"><span class="ico" aria-hidden="true">${n.icon}</span><span>${n.ko}<span class="en-sub">${n.en}</span></span></button>
      <input type="range" min="0" max="100" value="${lv}" class="slider" data-level="${n.id}" aria-label="${n.ko} 볼륨">
    </div>`;
  }).join("");
}

function setLevel(id, lv) {
  state.levels[id] = lv;
  if (lv <= 0) delete state.levels[id];
  save();
  const tile = document.querySelector(`.tile[data-id="${id}"]`);
  if (tile) {
    tile.classList.toggle("on", lv > 0);
    tile.querySelector("button").setAttribute("aria-pressed", lv > 0);
    const r = tile.querySelector("input");
    if (Number(r.value) !== Math.round(lv * 100)) r.value = Math.round(lv * 100);
  }
  if (lv > 0 && !engine.playing) play();
  if (engine.ctx) engine.setLevel(id, lv);
  renderNowPlaying();
  updateMediaSession();
}

function renderBreath() {
  $("b-pattern").innerHTML = Object.entries(PATTERNS).map(([k, p]) =>
    `<button data-v="${k}" class="${k === state.breath.pattern ? "on" : ""}">${p.ko}<span class="en-sub">${p.en}</span></button>`).join("");
  const p = PATTERNS[state.breath.pattern] || PATTERNS.relax;
  $("b-custom").hidden = state.breath.pattern !== "custom";
  $("b-custom").querySelectorAll("input").forEach(inp => { inp.value = state.breath.custom[Number(inp.dataset.i)]; });
  const seq = breathSeq();
  $("b-desc").textContent = `${p.desc} (들숨 ${seq[0]} · 멈춤 ${seq[1]} · 날숨 ${seq[2]} · 멈춤 ${seq[3]}초)` + (p.caution ? " ⚠️" : "");
  $("b-vibrate-wrap").hidden = !navigator.vibrate;
  renderBreathBtn();
}

function renderBreathBtn() {
  $("breath-btn").innerHTML = breath
    ? `호흡 가이드 멈추기 <span class="en-sub">Stop breathing</span>`
    : `호흡 가이드 시작 <span class="en-sub">Start breathing</span>`;
  loop();
}

// ---------- 프리셋 ----------
const PRESETS = [
  { cat: "sleep", ko: "깊은 잠", en: "Deep Sleep", s: { music: { src: "gen", mood: "deep", density: 0.3, bright: 0.25 }, levels: { rain: 0.5, brown: 0.35 }, tab: "sleep" } },
  { cat: "sleep", ko: "빗속의 오두막", en: "Rainy Cabin", s: { music: { src: "none" }, levels: { rain: 0.7, thunder: 0.35, fire: 0.45 }, tab: "sleep" } },
  { cat: "sleep", ko: "여름밤", en: "Summer Night", s: { music: { src: "gen", mood: "cosmos", density: 0.25, bright: 0.3 }, levels: { crickets: 0.5, wind: 0.25 }, tab: "sleep" } },
  { cat: "focus", ko: "몰입", en: "Deep Focus", s: { music: { src: "none" }, levels: { pink: 0.45, rain: 0.35 }, tab: "meditate" } },
  { cat: "focus", ko: "숲속 작업실", en: "Forest Studio", s: { music: { src: "gen", mood: "forest", density: 0.45, bright: 0.55 }, levels: { birds: 0.35, stream: 0.4 }, tab: "meditate" } },
  { cat: "focus", ko: "브라운 노이즈", en: "Brown Noise", s: { music: { src: "none" }, levels: { brown: 0.6 }, tab: "meditate" } },
  { cat: "relax", ko: "바닷가 명상", en: "Seaside", s: { music: { src: "gen", mood: "calm", density: 0.4, bright: 0.5 }, levels: { waves: 0.65, wind: 0.2 }, tab: "meditate" } },
  { cat: "relax", ko: "새벽 산사", en: "Dawn Temple", s: { music: { src: "gen", mood: "dawn", density: 0.35, bright: 0.5 }, levels: { birds: 0.3, stream: 0.3 }, timer: { startBell: "temple", endBell: "temple" }, tab: "meditate" } },
  { cat: "relax", ko: "우주 유영", en: "Cosmic Drift", s: { music: { src: "gen", mood: "cosmos", density: 0.5, bright: 0.45 }, levels: {}, tab: "meditate" } }
];
const CATS = { sleep: ["🌙 수면", "Sleep"], focus: ["🎯 집중", "Focus"], relax: ["🌿 휴식", "Relax"] };

// 프리셋·공유 링크에 담는 범위 (기기 설정·즐겨찾기는 제외)
function snapshot() {
  return clone({ music: state.music, levels: state.levels, musicVol: state.musicVol, natureVol: state.natureVol, timer: state.timer, sleep: state.sleep, breath: state.breath, tab: state.tab });
}

function applySnapshot(s, autoplay = true) {
  if (sess) stopSession();
  const levels = s.levels || {};
  for (const n of NATURE) {
    const lv = levels[n.id] || 0;
    if ((state.levels[n.id] || 0) !== lv) {
      if (lv > 0) state.levels[n.id] = lv; else delete state.levels[n.id];
      if (engine.ctx) engine.setLevel(n.id, lv);
    }
  }
  const prevMusic = clone(state.music);
  if (s.music) state.music = merge(state.music, s.music);
  for (const k of ["timer", "sleep", "breath"]) if (s[k]) state[k] = merge(state[k], s[k]);
  for (const k of ["musicVol", "natureVol"]) if (typeof s[k] === "number") { state[k] = s[k]; if (engine.ctx) engine.setBusVolume(k === "musicVol" ? "musicBus" : "natureBus", s[k]); }
  if (s.tab && ["meditate", "sleep", "guided"].includes(s.tab)) state.tab = s.tab;
  save();
  // 생성형 설정이 바뀌면 새 흐름으로
  if (gen.running && (prevMusic.mood !== state.music.mood || prevMusic.seed !== state.music.seed)) gen.stop(4);
  else if (gen.running) gen.setParams({ density: state.music.density, bright: state.music.bright });
  renderAll();
  if (autoplay) play(); else syncMusic();
}

function renderPresets() {
  $("presets").innerHTML = Object.entries(CATS).map(([cat, [ko, en]]) => `
    <div class="preset-cat"><span class="cat">${ko} · ${en}</span>
      <div class="chips">${PRESETS.map((p, i) => p.cat === cat ? `<button data-p="${i}">${p.ko}<span class="en-sub">${p.en}</span></button>` : "").join("")}</div>
    </div>`).join("");
  const mine = loadPresets();
  $("my-presets").innerHTML = mine.length ? mine.map((p, i) => `
    <div class="item">
      <button class="main" data-mp="${i}">${esc(p.name)}<span class="en-sub">${esc(describe(p.s))}</span></button>
      <span class="acts"><button data-del="${i}" aria-label="삭제">✕</button></span>
    </div>`).join("") : `<div class="empty">지금 소리 조합과 타이머를 이름 붙여 저장해 두면 한 번에 불러올 수 있습니다.<span class="en-sub">Save your current mix to reuse it.</span></div>`;
}

function describe(s) {
  const parts = [];
  if (s.music?.src === "gen") parts.push(`생성형·${MOODS[s.music.mood]?.ko || ""}`);
  if (s.music?.src === "album") parts.push("앨범 음원");
  if (s.music?.src === "stems") parts.push("스템");
  for (const n of NATURE) if (s.levels?.[n.id] > 0) parts.push(n.ko);
  return parts.join(" · ") || "소리 없음";
}

function loadPresets() { try { return JSON.parse(localStorage.getItem(LS_PRESETS) || "[]"); } catch (e) { return []; } }
function storePresets(list) { try { localStorage.setItem(LS_PRESETS, JSON.stringify(list.slice(0, 30))); } catch (e) { /* 무시 */ } }

// ---------- 공유 링크 (#mix=...) ----------
function shareUrl() {
  const p = new URLSearchParams();
  const m = state.music;
  p.set("src", m.src);
  if (m.src === "gen") { p.set("mood", m.mood); p.set("seed", m.seed); p.set("d", Math.round(m.density * 100)); p.set("b", Math.round(m.bright * 100)); }
  if (m.src === "album" && m.album !== "all") p.set("al", m.album);
  if (m.src === "stems" && m.set !== "all") p.set("set", m.set);
  const n = Object.entries(state.levels).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${Math.round(v * 100)}`).join(",");
  if (n) p.set("n", n);
  p.set("tab", state.tab);
  if (state.tab === "meditate") p.set("t", state.timer.dur);
  if (state.tab === "sleep") p.set("t", state.sleep.dur);
  p.set("br", state.breath.pattern);
  return `${SITE}#${p.toString()}`;
}

function readShare() {
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.slice(1));
  const s = {};
  if (q.get("album")) s.music = { src: "album", album: q.get("album") };
  if (h.has("src")) {
    const src = h.get("src");
    if (!["none", "gen", "stems", "album"].includes(src)) return null;
    const num = (k, lo, hi, d) => { const v = Number(h.get(k)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
    s.music = { src };
    if (MOODS[h.get("mood")]) s.music.mood = h.get("mood");
    if (h.has("seed")) s.music.seed = Math.floor(num("seed", 1, 99999, 1));
    if (h.has("d")) s.music.density = num("d", 0, 100, 50) / 100;
    if (h.has("b")) s.music.bright = num("b", 0, 100, 50) / 100;
    if (h.get("al")) s.music.album = h.get("al");
    if (h.get("set")) s.music.set = h.get("set");
    s.levels = {};
    for (const pair of (h.get("n") || "").split(",")) {
      const [k, v] = pair.split(":");
      if (NATURE.some(n => n.id === k) && Number(v) > 0) s.levels[k] = Math.min(100, Number(v)) / 100;
    }
    const tab = h.get("tab");
    if (["meditate", "sleep", "guided"].includes(tab)) s.tab = tab;
    const t = Number(h.get("t"));
    if (tab === "meditate" && t >= 0 && t <= 240) s.timer = { dur: t };
    if (tab === "sleep" && (t === -1 || (t > 0 && t <= 240))) s.sleep = { dur: t };
    if (PATTERNS[h.get("br")]) s.breath = { pattern: h.get("br") };
  }
  return Object.keys(s).length ? s : null;
}

// ---------- 캘린더 알림 ----------
function nextAt(time) {
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  if (d < new Date()) d.setDate(d.getDate() + 1);
  return d;
}
const pad = n => String(n).padStart(2, "0");
const localStamp = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

function renderReminder() {
  const time = state.prefs.remindTime || "21:30";
  $("remind-time").value = time;
  const start = nextAt(time), end = new Date(start.getTime() + 15 * 60000);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul";
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: "명상 시간 · Meditation",
    details: `Rebroni Meditate에서 잠시 쉬어 가세요.\n${SITE}`,
    dates: `${localStamp(start)}/${localStamp(end)}`,
    recur: "RRULE:FREQ=DAILY",
    ctz: tz
  });
  $("gcal-btn").href = `https://calendar.google.com/calendar/render?${p.toString()}`;
}

function downloadIcs() {
  const start = nextAt(state.prefs.remindTime || "21:30"), end = new Date(start.getTime() + 15 * 60000);
  const now = new Date();
  const utc = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Rebroni Music//Meditate//KO", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:meditate-${now.getTime()}@music.rebroni.com`,
    `DTSTAMP:${utc}`,
    `DTSTART:${localStamp(start)}`,
    `DTEND:${localStamp(end)}`,
    "RRULE:FREQ=DAILY",
    "SUMMARY:명상 시간 · Meditation",
    `DESCRIPTION:Rebroni Meditate에서 잠시 쉬어 가세요. ${SITE}`,
    `URL:${SITE}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:명상 시간입니다 · Time to meditate", "TRIGGER:PT0M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"
  ].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  a.download = "rebroni-meditate.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- 야간 모드 · 테마 ----------
function setNight(on) {
  state.prefs.night = on;
  save();
  if (on) document.documentElement.setAttribute("data-night", "1");
  else document.documentElement.removeAttribute("data-night");
  $("night-btn").setAttribute("aria-pressed", on);
  $("night-ask").hidden = true;
  document.querySelector('meta[name="theme-color"]').content = on ? "#050403" : (currentTheme() === "nature" ? "#eef4ec" : "#0b0d14");
}

function currentTheme() { try { return localStorage.getItem("theme") || "dark"; } catch (e) { return "dark"; } }
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("theme", t); } catch (e) { /* 무시 */ }
  $("theme-btn").textContent = t === "dark" ? "🌿" : "🌌";
  $("theme-btn").title = t === "dark" ? "Nature Green 테마로 전환" : "Cosmic Dark 테마로 전환";
  setNight(state.prefs.night);
}

// ---------- 화면 켜짐 유지 ----------
let wakeLock = null;
async function syncWake() {
  const w = state.prefs.wake;
  const want = !document.hidden && engine.playing && (w === "session" ? !!(sess || breath) : w === "breath" ? !!breath : false);
  try {
    if (want && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!want && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { wakeLock = null; }
}

// ---------- 잠금 화면 · 알림창 (Media Session) ----------
function absUrl(u) { try { return new URL(u, location.origin + "/").href; } catch (e) { return ""; } }

function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  let title = "Rebroni Meditate", albumName = "Rebroni Meditate";
  let artwork = [{ src: absUrl("/meditate/icon-512.png"), sizes: "512x512", type: "image/png" }];
  const tr = album.current;
  if (sess?.mode === "guided" && sess.item) title = sess.item.title;
  else if (state.music.src === "album" && tr) {
    title = tr.title;
    albumName = tr.albumTitle;
    if (tr.cover) artwork = [{ src: absUrl(tr.cover), sizes: "512x512" }];
  } else if (state.music.src === "gen") title = `Generative · ${MOODS[state.music.mood]?.en || ""}`;
  else if (state.music.src === "stems") title = "Stems · 스템 재조합";
  else {
    const names = NATURE.filter(n => state.levels[n.id] > 0).map(n => n.ko);
    if (names.length) title = names.join(" · ");
  }
  if (sess) title = `${{ meditate: "🧘", sleep: "🌙", guided: "🎧" }[sess.mode]} ${title}`;
  try { ms.metadata = new MediaMetadata({ title, artist: "SHINCHEOLHO-rebroni", album: albumName, artwork }); } catch (e) { /* 무시 */ }
  ms.playbackState = engine.playing ? "playing" : (engine.ctx ? "paused" : "none");
  const albumMode = state.music.src === "album" && album.running;
  const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch (e) { /* 미지원 */ } };
  set("play", () => play());
  set("pause", () => pause());
  set("stop", () => { if (sess) stopSession(); else pause(); });
  set("nexttrack", albumMode ? () => album.next() : null);
  set("previoustrack", albumMode ? () => album.prev() : null);
  updatePosition();
}

function updatePosition() {
  const ms = navigator.mediaSession;
  if (!ms?.setPositionState) return;
  try {
    if (sess && isFinite(sess.end) && engine.now >= sess.t0) {
      const duration = sess.end - sess.t0;
      ms.setPositionState({ duration, position: Math.min(duration, Math.max(0, engine.now - sess.t0)), playbackRate: 1 });
    } else ms.setPositionState();
  } catch (e) { /* 무시 */ }
}

// ---------- 콘텐츠 불러오기 ----------
async function loadContent() {
  try {
    albums = await loadAlbums();
    tracks = [];
    for (const a of albums) {
      for (const t of a.tracks || []) {
        if (!t.audioUrl || t.unlisted) continue;
        tracks.push({ key: `${a.id}-${t.no}`, albumId: a.id, albumTitle: a.title || a.id, cover: a.cover || "", title: t.title || `Track ${t.no}`, url: t.audioUrl, no: t.no });
      }
    }
  } catch (e) { console.warn("[meditate] 앨범 로드 실패", e); }
  renderMusic();

  if (!firebaseConfigReady()) return;
  try {
    const VER = "10.12.2";
    const { initializeApp, getApps } = await import(`https://www.gstatic.com/firebasejs/${VER}/firebase-app.js`);
    const { getFirestore, collection, getDocs, query, where } = await import(`https://www.gstatic.com/firebasejs/${VER}/firebase-firestore.js`);
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    const snap = await getDocs(query(collection(getFirestore(app), "meditate"), where("published", "==", true)));
    const items = snap.docs.map(d => ({ ...d.data(), id: d.id })).filter(x => x.url);
    items.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.title).localeCompare(String(b.title)));
    guidedItems = items.filter(x => x.kind === "guided");
    stemItems = items.filter(x => x.kind === "stem" && STEM_ROLES[x.role]);
  } catch (e) {
    console.warn("[meditate] 명상 콘텐츠 로드 실패 (보안 규칙 게시 전이면 정상)", e);
  }
  renderGuided();
  renderMusic();
  if (engine.playing) syncMusic();
}

// ---------- 이벤트 ----------
let bellTestT = 0;
function bind() {
  $("play-btn").addEventListener("click", () => (engine.playing ? pause() : play()));
  $("prev-btn").addEventListener("click", () => album.prev());
  $("next-btn").addEventListener("click", () => album.next());
  $("session-btn").addEventListener("click", startSession);
  $("session-stop").addEventListener("click", () => stopSession());
  $("night-btn").addEventListener("click", () => setNight(!state.prefs.night));
  $("theme-btn").addEventListener("click", () => applyTheme(currentTheme() === "dark" ? "nature" : "dark"));
  $("night-yes").addEventListener("click", () => setNight(true));
  $("night-no").addEventListener("click", () => { $("night-ask").hidden = true; });

  $("tabs").addEventListener("click", e => {
    const b = e.target.closest("button[data-tab]");
    if (!b || sess) return;
    state.tab = b.dataset.tab;
    save();
    renderTabs();
    renderTransport();
  });

  // 칩(시간 선택)
  for (const id of ["t-dur", "s-dur"]) {
    $(id).addEventListener("click", e => {
      const b = e.target.closest("button[data-v]");
      if (!b) return;
      setPath($(id).dataset.key, Number(b.dataset.v));
      renderTimer();
      frame();
    });
  }
  $("t-dur-custom").addEventListener("change", e => {
    const v = Math.round(Number(e.target.value));
    if (v >= 1 && v <= 240) { state.timer.dur = v; save(); }
    renderTimer();
    frame();
  });

  // data-key 입력 (select · checkbox)
  document.querySelectorAll("select[data-key], input[type=checkbox][data-key]").forEach(el => {
    el.addEventListener("change", () => {
      const v = el.type === "checkbox" ? el.checked : el.hasAttribute("data-num") ? Number(el.value) : el.value;
      setPath(el.dataset.key, v);
      if (el.dataset.key === "prefs.wake") syncWake();
      if (el.dataset.key === "prefs.quality") engine.setQuality(v); // 잔향은 바로, 생성형 음은 다음 음부터 바뀜
      if (el.dataset.key === "breath.cue" && breath) { engine.cancelScheduled("cue"); restartBreathCues(); }
    });
  });

  $("bell-test").addEventListener("click", async () => {
    ensureAudio();
    await engine.ctx.resume();
    const type = state.timer.startBell === "none" ? "bowl" : state.timer.startBell;
    engine.bell(type, engine.now + 0.05, 1);
    clearTimeout(bellTestT);
    bellTestT = setTimeout(() => { if (!engine.playing && !sess) engine.ctx.suspend().catch(() => {}); }, 15000);
  });

  // 볼륨
  const vol = (id, key, apply) => {
    const el = $(id);
    el.value = Math.round(state[key] * 100);
    el.addEventListener("input", () => { state[key] = Number(el.value) / 100; save(); if (engine.ctx) apply(state[key]); });
  };
  vol("vol", "vol", v => engine.setMasterVolume(v));
  vol("music-vol", "musicVol", v => engine.setBusVolume("musicBus", v));
  vol("nature-vol", "natureVol", v => engine.setBusVolume("natureBus", v));

  // 음악 소스
  $("music-src").addEventListener("click", e => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    state.music.src = b.dataset.v;
    save();
    renderMusic();
    if (state.music.src !== "none" && !engine.playing) play(); else syncMusic();
  });
  $("g-mood").addEventListener("click", e => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    state.music.mood = b.dataset.v;
    save();
    renderMusic();
    gen.setParams({ mood: state.music.mood });
    if (state.music.src === "gen") syncMusic();
  });
  for (const [id, key] of [["g-density", "density"], ["g-bright", "bright"]]) {
    $(id).addEventListener("input", e => {
      state.music[key] = Number(e.target.value) / 100;
      save();
      gen.setParams({ [key]: state.music[key] });
    });
  }
  $("g-reseed").addEventListener("click", () => {
    state.music.seed = 1 + Math.floor(Math.random() * 99999);
    save();
    $("g-seed").textContent = state.music.seed;
    gen.setParams({ seed: state.music.seed });
    renderNowPlaying();
  });
  $("st-set").addEventListener("change", e => {
    state.music.set = e.target.value;
    save();
    renderMusic();
    if (stems.running) { stems.stop(4); setTimeout(syncMusic, 100); }
  });

  // 앨범
  $("al-album").addEventListener("change", e => { state.music.album = e.target.value; save(); restartAlbum(); });
  $("al-shuffle").addEventListener("change", e => { state.music.shuffle = e.target.checked; save(); album.setShuffle(e.target.checked); });
  $("al-fav").addEventListener("change", e => { state.music.favOnly = e.target.checked; save(); restartAlbum(); });
  $("al-list").addEventListener("click", async e => {
    const fav = e.target.closest("button.fav");
    if (fav) {
      const k = fav.dataset.key;
      state.favs = state.favs.includes(k) ? state.favs.filter(x => x !== k) : [...state.favs, k];
      save();
      renderAlbumPanel();
      return;
    }
    const b = e.target.closest("button.main");
    if (!b) return;
    if (!engine.playing) { ensureAudio(); await engine.play(); }
    gen.stop(3); stems.stop(3);
    album.setShuffle(state.music.shuffle);
    album.setList(albumList());
    album.play(Number(b.dataset.i));
  });
  album.onchange = () => { renderAlbumPanel(); renderNowPlaying(); updateMediaSession(); };

  // 믹서
  $("mixer").addEventListener("input", e => {
    const id = e.target.dataset.level;
    if (id) setLevel(id, Number(e.target.value) / 100);
  });
  $("mixer").addEventListener("click", e => {
    const b = e.target.closest("button[data-toggle]");
    if (!b) return;
    const id = b.dataset.toggle;
    setLevel(id, state.levels[id] > 0 ? 0 : 0.5);
  });
  $("mix-clear").addEventListener("click", () => NATURE.forEach(n => { if (state.levels[n.id]) setLevel(n.id, 0); }));
  $("mix-random").addEventListener("click", () => {
    const pool = [...NATURE].sort(() => Math.random() - 0.5);
    const pick = new Set(pool.slice(0, 2 + Math.floor(Math.random() * 2)).map(n => n.id));
    NATURE.forEach(n => setLevel(n.id, pick.has(n.id) ? 0.3 + Math.random() * 0.4 : 0));
  });

  // 호흡
  $("b-pattern").addEventListener("click", e => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    state.breath.pattern = b.dataset.v;
    save();
    renderBreath();
    if (breath) { stopBreath(); startBreath(); }
  });
  $("b-custom").addEventListener("change", e => {
    const i = Number(e.target.dataset.i);
    if (!Number.isInteger(i)) return;
    state.breath.custom[i] = Math.max(0, Math.min(20, Number(e.target.value) || 0));
    save();
    renderBreath();
    if (breath) { stopBreath(); startBreath(); }
  });
  $("breath-btn").addEventListener("click", () => (breath ? stopBreath() : startBreath()));

  // 프리셋
  $("presets").addEventListener("click", e => {
    const b = e.target.closest("button[data-p]");
    if (b) applySnapshot(PRESETS[Number(b.dataset.p)].s);
  });
  $("my-presets").addEventListener("click", e => {
    const list = loadPresets();
    const del = e.target.closest("button[data-del]");
    if (del) {
      const i = Number(del.dataset.del);
      if (confirm(`"${list[i]?.name}" 프리셋을 삭제할까요?`)) { list.splice(i, 1); storePresets(list); renderPresets(); }
      return;
    }
    const b = e.target.closest("button[data-mp]");
    if (b && list[Number(b.dataset.mp)]) applySnapshot(list[Number(b.dataset.mp)].s);
  });
  $("preset-form").addEventListener("submit", e => {
    e.preventDefault();
    const name = $("preset-name").value.trim() || `프리셋 ${loadPresets().length + 1}`;
    const list = loadPresets().filter(p => p.name !== name);
    list.unshift({ name, s: snapshot() });
    storePresets(list);
    $("preset-name").value = "";
    renderPresets();
  });
  $("share-btn").addEventListener("click", async () => {
    const url = shareUrl();
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ title: "Rebroni Meditate", url });
      else { await navigator.clipboard.writeText(url); $("share-status").textContent = "링크를 복사했습니다."; }
    } catch (err) {
      if (err?.name !== "AbortError") { $("share-status").textContent = url; }
    }
  });

  // 알림 · 설치
  $("remind-time").addEventListener("change", e => { state.prefs.remindTime = e.target.value || "21:30"; save(); renderReminder(); });
  $("ics-btn").addEventListener("click", downloadIcs);
  let installEvt = null;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; $("install-btn").hidden = false; });
  $("install-btn").addEventListener("click", async () => {
    if (!installEvt) return;
    installEvt.prompt();
    await installEvt.userChoice.catch(() => {});
    installEvt = null;
    $("install-btn").hidden = true;
  });
}

function restartBreathCues() {
  if (!breath) return;
  // 지금 이후의 다음 경계부터 다시 예약
  const t = engine.now;
  let b = breath.t0 + Math.floor((t - breath.t0) / breath.cycle) * breath.cycle, i = 0;
  while (b <= t) { b += breath.seq[i]; i = (i + 1) % 4; }
  breath.nextB = b;
  breath.nextIdx = i;
}

function restartAlbum() {
  renderAlbumPanel();
  if (state.music.src === "album" && album.running) {
    album.stop(2);
    setTimeout(syncMusic, 50);
  }
}

function renderAll() {
  renderTabs();
  renderTimer();
  renderMixer();
  renderMusic();
  renderGuided();
  renderBreath();
  renderPresets();
  renderReminder();
  renderNowPlaying();
  renderSession();
}

// ---------- 시작 ----------
function init() {
  const bellOpts = BELLS.map(b => `<option value="${b.id}">${b.ko}</option>`).join("");
  document.querySelectorAll(".bell-select").forEach(s => { s.innerHTML = bellOpts; });

  const shared = readShare();
  if (shared) {
    applySnapshot(shared, false);
    $("share-note").hidden = !location.hash;
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }

  applyTheme(currentTheme());
  bind();
  renderAll();

  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  $("ios-note").hidden = !ios;
  const h = new Date().getHours();
  $("night-ask").hidden = !(state.prefs.nightAsk && !state.prefs.night && (h >= 21 || h < 5));

  loadContent();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();
