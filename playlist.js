// 전체 앨범 통합 플레이리스트 (YouTube 기반)
// · 전체 곡 선택 / 앨범 단위 선택 / 개별 곡 선택
// · 선택한 곡을 YouTube IFrame API로 연속 재생 (셔플·반복 지원)
// · 선택 목록은 브라우저에 저장되어 다음 방문 시 복원됩니다.

import { loadAlbums } from "./data-service.js";

const LS_KEY = "rebroni:playlist:v1";        // 현재 선택 상태
const LS_SAVED = "rebroni:playlists:v1";     // 이름을 붙여 저장한 목록들

let albums = [];          // 원본 앨범 데이터
let items = [];           // 재생 가능한 전체 곡 [{key, albumId, albumTitle, no, title, ytId}]
let selected = new Set(); // 선택된 곡 key
let queue = [];           // 현재 재생 큐 (items의 부분집합)
let qIndex = 0;
let player = null;        // YT.Player
let apiReady = false;
let wantPlay = false;     // API 준비 전 재생 요청 보류
let shuffle = false;
let repeat = true;
let errStreak = 0;        // 연속 재생 실패 카운터 (무한 스킵 방지)

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function ytIdOf(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.split("/").filter(Boolean)[0] || null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/\/embed\/([^\/?]+)/);
    return m ? m[1] : null;
  } catch (e) {
    const m = String(url).match(/[?&]v=([^&]+)/);
    return m ? m[1] : null;
  }
}

function splitTitle(title) {
  const m = String(title || "").match(/^(.+?)\s*\((.+)\)\s*$/);
  if (m) return { main: m[1].trim(), sub: m[2].trim() };
  return { main: String(title || "").trim(), sub: "" };
}

// ---------- 데이터 준비 ----------
// app.js가 이미 불러온 albums를 재사용 (중복 네트워크 요청 방지)
function getAlbums() {
  if (window.__albums) return Promise.resolve(window.__albums);
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    window.addEventListener("albums:loaded", () => finish(window.__albums || []), { once: true });
    setTimeout(() => { if (!done) loadAlbums().then(finish).catch(() => finish([])); }, 8000);
  });
}

function buildItems() {
  items = [];
  albums.forEach(a => {
    (a.tracks || []).forEach(t => {
      if (t.unlisted) return;                       // 비발매 곡은 제외
      const ytId = ytIdOf(t.links?.youtube);
      if (!ytId) return;                            // YouTube 링크가 있는 곡만
      items.push({
        key: `${a.id}-${t.no}`,
        albumId: a.id,
        albumTitle: `${a.ordinal || ""} · ${a.title || ""}`.trim(),
        no: t.no,
        title: t.title || "",
        ytId
      });
    });
  });
}

function loadSelection() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    const valid = new Set(items.map(i => i.key));
    (saved.selected || []).forEach(k => { if (valid.has(k)) selected.add(k); });
    shuffle = !!saved.shuffle;
    repeat = saved.repeat !== false;
  } catch (e) { /* 저장값 없음/손상 — 무시 */ }
}

function saveSelection() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      selected: [...selected], shuffle, repeat
    }));
  } catch (e) { /* 용량 초과 등 — 무시 */ }
}

// ---------- 저장된 플레이리스트 ----------
function loadSaved() {
  try {
    const raw = localStorage.getItem(LS_SAVED);
    const obj = raw ? JSON.parse(raw) : {};
    return (obj && typeof obj === "object" && !Array.isArray(obj)) ? obj : {};
  } catch (e) { return {}; }
}

function writeSaved(obj) {
  try { localStorage.setItem(LS_SAVED, JSON.stringify(obj)); } catch (e) { /* 무시 */ }
}

function renderSaved() {
  const box = $("pl-saved-list");
  if (!box) return;
  const saved = loadSaved();
  const names = Object.keys(saved);
  if (!names.length) {
    box.innerHTML = `<span class="pl-saved-empty">저장된 목록이 없습니다. 곡을 고른 뒤 이름을 입력해 저장하세요.</span>`;
    return;
  }
  box.innerHTML = names.map(n => `
    <span class="pl-chip">
      <button class="pl-chip-load" data-name="${esc(n)}" title="이 목록 불러오기">${esc(n)} <em>${(saved[n] || []).length}곡</em></button>
      <button class="pl-chip-del" data-del="${esc(n)}" aria-label="삭제" title="삭제">✕</button>
    </span>`).join("");
}

function savedFlash(msg) {
  const el = $("pl-selected-count");
  if (!el) return;
  const prev = el.textContent;
  el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) updateCounts(); else void prev; }, 1800);
}

// ---------- 선택 UI ----------
function renderList(filter = "") {
  const body = $("pl-body");
  if (!body) return;
  const q = filter.trim().toLowerCase();

  const groups = albums.map(a => {
    const tracks = items.filter(i => i.albumId === a.id);
    if (!tracks.length) return "";
    const hit = tracks.filter(t =>
      !q || `${t.title} ${a.title} ${a.ordinal}`.toLowerCase().includes(q)
    );
    if (!hit.length) return "";

    const selCount = tracks.filter(t => selected.has(t.key)).length;
    const state = selCount === 0 ? "" : (selCount === tracks.length ? "checked" : "indeterminate");

    const rows = hit.map(t => {
      const { main, sub } = splitTitle(t.title);
      return `
        <label class="pl-track${selected.has(t.key) ? " on" : ""}" data-key="${esc(t.key)}">
          <input type="checkbox" class="pl-cb-track" data-key="${esc(t.key)}" ${selected.has(t.key) ? "checked" : ""}>
          <span class="pl-no">${esc(t.no)}.</span>
          <span class="pl-title">${esc(main)}${sub ? ` <em>(${esc(sub)})</em>` : ""}</span>
        </label>`;
    }).join("");

    return `
      <div class="pl-group" data-album="${esc(a.id)}">
        <label class="pl-group-head">
          <input type="checkbox" class="pl-cb-album" data-album="${esc(a.id)}" ${state === "checked" ? "checked" : ""}>
          <span class="pl-album-title">${esc(a.ordinal || "")} · ${esc(a.title || "")}</span>
          <span class="pl-count">${selCount} / ${tracks.length}</span>
        </label>
        <div class="pl-tracks">${rows}</div>
      </div>`;
  }).join("");

  body.innerHTML = groups || `<p class="pl-empty">표시할 곡이 없습니다.</p>`;

  // 부분 선택 앨범은 indeterminate 표시
  albums.forEach(a => {
    const tracks = items.filter(i => i.albumId === a.id);
    if (!tracks.length) return;
    const cb = body.querySelector(`.pl-cb-album[data-album="${CSS.escape(a.id)}"]`);
    if (!cb) return;
    const n = tracks.filter(t => selected.has(t.key)).length;
    cb.indeterminate = n > 0 && n < tracks.length;
  });

  updateCounts();
}

function updateCounts() {
  const n = selected.size;
  const el = $("pl-selected-count");
  if (el) el.textContent = `${n}곡 선택됨 / 전체 ${items.length}곡`;
  const playBtn = $("pl-play-selected");
  if (playBtn) playBtn.disabled = n === 0;
}

function setAlbumSelection(albumId, on) {
  items.filter(i => i.albumId === albumId).forEach(i => {
    if (on) selected.add(i.key); else selected.delete(i.key);
  });
}

// ---------- 재생 ----------
function buildQueue() {
  const list = items.filter(i => selected.has(i.key));
  queue = shuffle ? shuffled(list) : list;
  qIndex = 0;
}

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function ensurePlayer() {
  if (player || !apiReady) return;
  // 플레이어 바가 보이는 상태에서만 생성 (숨겨진 iframe은 자동재생이 차단됨)
  if (!$("pl-bar")?.classList.contains("on")) return;
  player = new window.YT.Player("pl-video", {
    height: "100%", width: "100%",
    playerVars: { autoplay: 0, rel: 0, modestbranding: 1, playsinline: 1 },
    events: {
      onReady: () => { if (wantPlay) { wantPlay = false; playCurrent(); } },
      onStateChange: e => {
        const YT = window.YT;
        if (e.data === YT.PlayerState.PLAYING) errStreak = 0;
        if (e.data === YT.PlayerState.ENDED) next(true);
        syncPlayIcon();
      },
      onError: () => {                 // 재생 불가 영상은 건너뜀 (전곡 실패 시 중단)
        errStreak++;
        if (errStreak <= queue.length) next(true);
      }
    }
  });
}

function loadYouTubeAPI() {
  if (window.YT && window.YT.Player) { apiReady = true; ensurePlayer(); return; }
  if (document.getElementById("yt-iframe-api")) return;
  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = function () {
    if (typeof prev === "function") { try { prev(); } catch (e) { /* ignore */ } }
    apiReady = true;
    ensurePlayer();
  };
  const s = document.createElement("script");
  s.id = "yt-iframe-api";
  s.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(s);
}

function startPlayback() {
  buildQueue();
  if (!queue.length) return;
  errStreak = 0;
  showBar(true);
  closeModal();
  // 기존 개별/앨범 플레이어와 동시 재생 방지
  document.querySelectorAll(".track-player, .album-player").forEach(p => p.remove());

  if (!apiReady || !player) { wantPlay = true; loadYouTubeAPI(); ensurePlayer(); renderNowPlaying(); return; }
  playCurrent();
}

function playCurrent() {
  const it = queue[qIndex];
  if (!it || !player || typeof player.loadVideoById !== "function") return;
  player.loadVideoById(it.ytId);
  renderNowPlaying();
}

function next(auto) {
  if (!queue.length) return;
  if (qIndex + 1 >= queue.length) {
    if (!repeat) { if (auto) { pause(); renderNowPlaying(); } return; }
    if (shuffle) queue = shuffled(queue);
    qIndex = 0;
  } else {
    qIndex++;
  }
  playCurrent();
}

function prev() {
  if (!queue.length) return;
  // 재생 3초 이후면 현재 곡을 처음부터
  try {
    if (player && player.getCurrentTime && player.getCurrentTime() > 3) {
      player.seekTo(0); return;
    }
  } catch (e) { /* ignore */ }
  qIndex = (qIndex - 1 + queue.length) % queue.length;
  playCurrent();
}

function togglePlay() {
  if (!player) { startPlayback(); return; }
  try {
    const st = player.getPlayerState();
    if (st === window.YT.PlayerState.PLAYING) player.pauseVideo();
    else player.playVideo();
  } catch (e) { /* ignore */ }
}

function pause() { try { player?.pauseVideo(); } catch (e) { /* ignore */ } }

function syncPlayIcon() {
  const btn = $("pl-toggle");
  if (!btn || !player || !window.YT) return;
  let playing = false;
  try { playing = player.getPlayerState() === window.YT.PlayerState.PLAYING; } catch (e) { /* ignore */ }
  btn.textContent = playing ? "⏸" : "▶";
  btn.setAttribute("aria-label", playing ? "일시정지" : "재생");
}

function renderNowPlaying() {
  const it = queue[qIndex];
  const titleEl = $("pl-now-title");
  const subEl = $("pl-now-sub");
  const posEl = $("pl-position");
  if (!it) {
    if (titleEl) titleEl.textContent = "—";
    if (subEl) subEl.textContent = "";
    if (posEl) posEl.textContent = "";
    return;
  }
  const { main, sub } = splitTitle(it.title);
  if (titleEl) titleEl.textContent = main + (sub ? ` (${sub})` : "");
  if (subEl) subEl.textContent = it.albumTitle;
  if (posEl) posEl.textContent = `${qIndex + 1} / ${queue.length}`;
  syncPlayIcon();

  // 사이트 본문에서 현재 곡 강조
  document.querySelectorAll(".track.pl-current").forEach(el => el.classList.remove("pl-current"));
  document.getElementById(it.key)?.classList.add("pl-current");

  // 큐 패널이 열려 있으면 현재 곡 표시 갱신
  renderQueuePanel();
}

function renderQueuePanel() {
  const box = $("pl-queue-list");
  if (!box || !box.parentElement.classList.contains("open")) return;
  box.innerHTML = queue.map((it, i) => {
    const { main } = splitTitle(it.title);
    return `<button class="pl-q-row${i === qIndex ? " on" : ""}" data-i="${i}">
      <span class="pl-q-i">${i + 1}</span>
      <span class="pl-q-t">${esc(main)}<em>${esc(it.albumTitle)}</em></span>
    </button>`;
  }).join("") || `<p class="pl-empty">재생 목록이 비어 있습니다.</p>`;
  box.querySelector(".pl-q-row.on")?.scrollIntoView({ block: "nearest" });
}

// ---------- 화면 제어 ----------
function openModal() {
  loadYouTubeAPI();               // 재생 버튼을 누르기 전에 미리 준비
  renderList($("pl-search")?.value || "");
  $("pl-modal")?.classList.add("open");
  document.body.classList.add("pl-modal-open");
}
function closeModal() {
  $("pl-modal")?.classList.remove("open");
  document.body.classList.remove("pl-modal-open");
}
function showBar(on) {
  $("pl-bar")?.classList.toggle("on", !!on);
  document.body.classList.toggle("pl-bar-on", !!on);
}
function closeBar() {
  pause();
  showBar(false);
  $("pl-queue-panel")?.classList.remove("open");
  document.querySelectorAll(".track.pl-current").forEach(el => el.classList.remove("pl-current"));
}

// ---------- 초기화 ----------
async function init() {
  if (!$("pl-modal")) return;   // 마크업이 없으면 조용히 종료

  albums = await getAlbums();
  buildItems();
  loadSelection();

  const openBtn = $("playlist-btn");
  if (!items.length) {
    // 재생 가능한 곡이 없으면 버튼 숨김
    if (openBtn) openBtn.style.display = "none";
    return;
  }

  $("pl-shuffle")?.classList.toggle("on", shuffle);
  $("pl-repeat")?.classList.toggle("on", repeat);

  openBtn?.addEventListener("click", openModal);
  $("pl-close")?.addEventListener("click", closeModal);
  $("pl-modal")?.addEventListener("click", e => { if (e.target === $("pl-modal")) closeModal(); });

  $("pl-select-all")?.addEventListener("click", () => {
    items.forEach(i => selected.add(i.key));
    saveSelection();
    renderList($("pl-search")?.value || "");
  });
  $("pl-clear-all")?.addEventListener("click", () => {
    selected.clear();
    saveSelection();
    renderList($("pl-search")?.value || "");
  });
  $("pl-search")?.addEventListener("input", e => renderList(e.target.value));

  // 체크박스 (이벤트 위임)
  $("pl-body")?.addEventListener("change", e => {
    const tcb = e.target.closest(".pl-cb-track");
    if (tcb) {
      const key = tcb.getAttribute("data-key");
      if (tcb.checked) selected.add(key); else selected.delete(key);
      saveSelection();
      renderList($("pl-search")?.value || "");
      return;
    }
    const acb = e.target.closest(".pl-cb-album");
    if (acb) {
      setAlbumSelection(acb.getAttribute("data-album"), acb.checked);
      saveSelection();
      renderList($("pl-search")?.value || "");
    }
  });

  $("pl-play-selected")?.addEventListener("click", () => {
    loadYouTubeAPI();
    startPlayback();
  });

  // 저장된 플레이리스트: 저장 / 불러오기 / 삭제
  renderSaved();
  const doSave = () => {
    const input = $("pl-save-name");
    const name = (input?.value || "").trim();
    if (!name) { savedFlash("이름을 입력하세요."); input?.focus(); return; }
    if (!selected.size) { savedFlash("선택된 곡이 없습니다."); return; }
    const saved = loadSaved();
    if (saved[name] && !confirm(`"${name}" 목록을 덮어쓸까요?`)) return;
    saved[name] = [...selected];
    writeSaved(saved);
    if (input) input.value = "";
    renderSaved();
    savedFlash(`"${name}" 저장 완료 (${selected.size}곡)`);
  };
  $("pl-save")?.addEventListener("click", doSave);
  $("pl-save-name")?.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); doSave(); }
  });

  $("pl-saved-list")?.addEventListener("click", e => {
    const del = e.target.closest(".pl-chip-del");
    if (del) {
      const name = del.getAttribute("data-del");
      if (!confirm(`"${name}" 목록을 삭제할까요?`)) return;
      const saved = loadSaved();
      delete saved[name];
      writeSaved(saved);
      renderSaved();
      return;
    }
    const load = e.target.closest(".pl-chip-load");
    if (load) {
      const name = load.getAttribute("data-name");
      const keys = loadSaved()[name] || [];
      const valid = new Set(items.map(i => i.key));
      selected = new Set(keys.filter(k => valid.has(k)));
      saveSelection();
      renderList($("pl-search")?.value || "");
      $("pl-save-name") && ($("pl-save-name").value = name);
      savedFlash(`"${name}" 불러옴 (${selected.size}곡)`);
    }
  });

  // 플레이어 바 컨트롤
  $("pl-toggle")?.addEventListener("click", togglePlay);
  $("pl-next")?.addEventListener("click", () => next(false));
  $("pl-prev")?.addEventListener("click", prev);
  $("pl-close-bar")?.addEventListener("click", closeBar);
  $("pl-expand")?.addEventListener("click", () => {
    const bar = $("pl-bar");
    bar?.classList.toggle("expanded");
    const on = bar?.classList.contains("expanded");
    $("pl-expand").textContent = on ? "▽" : "△";
    $("pl-expand").setAttribute("aria-label", on ? "영상 접기" : "영상 펼치기");
  });
  $("pl-shuffle")?.addEventListener("click", () => {
    shuffle = !shuffle;
    $("pl-shuffle").classList.toggle("on", shuffle);
    saveSelection();
    if (queue.length) {
      const cur = queue[qIndex];
      queue = shuffle ? shuffled(queue) : items.filter(i => selected.has(i.key));
      qIndex = Math.max(0, queue.findIndex(i => i.key === cur.key));
      renderNowPlaying();
    }
  });
  $("pl-repeat")?.addEventListener("click", () => {
    repeat = !repeat;
    $("pl-repeat").classList.toggle("on", repeat);
    saveSelection();
  });
  $("pl-queue-btn")?.addEventListener("click", () => {
    const panel = $("pl-queue-panel");
    panel?.classList.toggle("open");
    renderQueuePanel();
  });
  $("pl-queue-list")?.addEventListener("click", e => {
    const row = e.target.closest(".pl-q-row");
    if (!row) return;
    qIndex = Number(row.getAttribute("data-i")) || 0;
    playCurrent();
  });

  // 개별/앨범 플레이어를 사용하면 플레이리스트 재생은 일시정지
  document.addEventListener("click", e => {
    if (e.target.closest(".yt-play, .yt-album-play")) pause();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeModal();
  });

  updateCounts();
}

init();
