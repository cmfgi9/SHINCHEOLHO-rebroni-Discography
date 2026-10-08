// 공개 영상(Videos) 페이지: videos 컬렉션에서 published == true 인 영상을 썸네일 갤러리로 표시
import { firebaseConfig } from "./firebase-config.js";
import { firebaseConfigReady, loadAlbums } from "./data-service.js";
import { YT_ID_RE, thumbUrl, watchUrl, embedUrl } from "./youtube.js";

const VER = "10.12.2";
const KIND_LABEL = { album: "앨범곡", unreleased: "미발매곡", etc: "기타" };
const $ = id => document.getElementById(id);

let videos = [];
let albums = [];
let kindFilter = "";   // "", album, unreleased, etc, shorts
let albumFilter = "";
let openedByPush = false; // 목록에서 눌러 연 창은 뒤로가기로 닫힘
let lastFocus = null;

function esc(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function metaText(v) {
  const album = albums.find(a => a.id === v.albumId);
  return [v.date, KIND_LABEL[v.kind] || "", album?.title || "", v.track].filter(Boolean).join(" · ");
}

function render() {
  const q = $("search").value.trim().toLowerCase();
  const items = videos.filter(v =>
    (!kindFilter || (kindFilter === "shorts" ? v.isShort : v.kind === kindFilter))
    && (!albumFilter || v.albumId === albumFilter)
    && (!q || [v.title, v.track, v.description].join(" ").toLowerCase().includes(q)));

  document.querySelectorAll("[data-kind]").forEach(b => b.classList.toggle("on", b.dataset.kind === kindFilter));

  const grid = $("videos");
  if (!items.length) {
    grid.innerHTML = `<p class="empty" style="grid-column:1/-1;">${videos.length ? "조건에 맞는 영상이 없습니다." : "아직 공개된 영상이 없습니다.<br>No videos yet."}</p>`;
    return;
  }
  grid.innerHTML = items.map(v => `
    <button class="card" type="button" data-id="${esc(v.id)}">
      <div class="thumb" style="background-image:url('${thumbUrl(v.id, "hqdefault")}')">
        ${KIND_LABEL[v.kind] ? `<span class="badge">${esc(KIND_LABEL[v.kind])}</span>` : ""}
        ${v.isShort ? '<span class="badge short">Shorts</span>' : ""}
        <span class="play" aria-hidden="true"></span>
      </div>
      <h2>${esc(v.title || "")}</h2>
      <div class="meta">${esc(metaText(v))}</div>
    </button>
  `).join("");
}

// ----- 재생 창 -----
function showModal(id) {
  const v = videos.find(x => x.id === id);
  if (!v) return hideModal();
  lastFocus = document.activeElement;
  $("modal-panel").classList.toggle("short", !!v.isShort);
  const iframe = document.createElement("iframe");
  iframe.src = embedUrl(v.id, true);
  iframe.title = v.title || "YouTube video player";
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  $("player").replaceChildren(iframe);
  $("modal-title").textContent = v.title || "";
  $("modal-meta").textContent = metaText(v);
  $("modal-desc").textContent = v.description || "";
  const album = albums.find(a => a.id === v.albumId);
  $("modal-links").innerHTML = `
    <a class="chip" href="${esc(watchUrl(v.id, v.isShort))}" target="_blank" rel="noopener">YouTube에서 보기 ↗</a>
    ${album ? `<a class="chip" href="./#${esc(album.id)}">♪ ${esc(album.title)}</a>` : ""}
    <button class="chip" type="button" id="copy-link">링크 복사</button>
  `;
  $("copy-link").addEventListener("click", async e => {
    try {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}#v=${v.id}`);
      e.target.textContent = "복사 완료";
    } catch {
      e.target.textContent = "복사 실패";
    }
  });
  $("modal").hidden = false;
  document.body.style.overflow = "hidden";
  $("modal-close").focus();
}

function hideModal() {
  $("modal").hidden = true;
  $("player").replaceChildren(); // 재생 중지
  document.body.style.overflow = "";
  lastFocus?.focus?.();
}

function hashId() {
  const m = /^#v=([A-Za-z0-9_-]{11})$/.exec(location.hash);
  return m && YT_ID_RE.test(m[1]) ? m[1] : null;
}

function openVideo(id) {
  history.pushState(null, "", `#v=${id}`);
  openedByPush = true;
  showModal(id);
}

function closeVideo() {
  if (openedByPush && hashId()) {
    history.back(); // popstate에서 창을 닫음
  } else {
    history.replaceState(null, "", location.pathname + location.search);
    hideModal();
  }
  openedByPush = false;
}

window.addEventListener("popstate", () => {
  const id = hashId();
  if (id) showModal(id);
  else if (!$("modal").hidden) hideModal();
});

async function init() {
  if (!firebaseConfigReady()) {
    $("videos").innerHTML = '<p class="empty" style="grid-column:1/-1;">영상을 불러올 수 없습니다.</p>';
    return;
  }
  const { initializeApp, getApps } = await import(`https://www.gstatic.com/firebasejs/${VER}/firebase-app.js`);
  const { getFirestore, collection, getDocs, query, where } =
    await import(`https://www.gstatic.com/firebasejs/${VER}/firebase-firestore.js`);

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const db = getFirestore(app);

  // 보안 규칙상 비공개 영상은 읽을 수 없으므로 반드시 published 조건으로 조회
  const [snap, albumList] = await Promise.all([
    getDocs(query(collection(db, "videos"), where("published", "==", true))),
    loadAlbums().catch(() => [])
  ]);
  videos = snap.docs
    .map(d => ({ ...d.data(), id: d.id }))
    .filter(v => YT_ID_RE.test(v.id))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))
      || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  albums = albumList;

  // 영상이 있는 앨범만 선택지로
  const used = new Set(videos.map(v => v.albumId).filter(Boolean));
  $("album-filter").innerHTML = '<option value="">모든 앨범</option>' + albums
    .filter(a => used.has(a.id))
    .map(a => `<option value="${esc(a.id)}">${esc(a.title || a.id)}</option>`).join("");
  $("album-filter").hidden = !used.size;

  // 주소로 앨범 지정 (예: videos.html?album=a9)
  const qsAlbum = new URLSearchParams(location.search).get("album");
  if (qsAlbum && used.has(qsAlbum)) {
    albumFilter = qsAlbum;
    $("album-filter").value = qsAlbum;
  }

  $("toolbar").hidden = false;
  document.querySelectorAll("[data-kind]").forEach(b => b.addEventListener("click", () => {
    kindFilter = b.dataset.kind;
    render();
  }));
  $("album-filter").addEventListener("change", e => { albumFilter = e.target.value; render(); });
  $("search").addEventListener("input", render);
  $("videos").addEventListener("click", e => {
    const card = e.target.closest(".card");
    if (card) openVideo(card.dataset.id);
  });
  $("modal-close").addEventListener("click", closeVideo);
  $("modal").addEventListener("click", e => { if (e.target === $("modal")) closeVideo(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("modal").hidden) closeVideo(); });

  render();

  // 공유 링크(#v=영상ID)로 들어온 경우 바로 재생 창 열기
  const id = hashId();
  if (id) showModal(id);
}

init().catch(err => {
  console.warn("videos load failed:", err);
  $("videos").innerHTML = '<p class="empty" style="grid-column:1/-1;">영상을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
});
