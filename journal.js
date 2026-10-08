// 공개 창작 노트(Journal) 페이지: notes 컬렉션에서 published == true 인 노트만 타임라인으로 표시
import { firebaseConfig } from "./firebase-config.js";
import { firebaseConfigReady, loadAlbums } from "./data-service.js";
import { renderHtml } from "./journal-format.js";

const VER = "10.12.2";
const $ = id => document.getElementById(id);

let notes = [];
let albums = [];
let order = "new"; // "new" = 최신순, "old" = 처음부터(작성 순서대로)
let activeTag = "";

function esc(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

// 이스케이프된 본문 안의 URL을 링크로 변환
function linkify(escaped) {
  return escaped.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g,
    url => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
}

function render() {
  const listEl = $("notes");
  const items = notes
    .filter(n => !activeTag || (n.tags || []).includes(activeTag))
    .sort((a, b) => {
      const cmp = String(a.date || "").localeCompare(String(b.date || ""))
        || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
      return order === "new" ? -cmp : cmp;
    });

  $("sort-new").classList.toggle("on", order === "new");
  $("sort-old").classList.toggle("on", order === "old");
  $("tag-filter").innerHTML = activeTag
    ? `<button class="chip on" type="button" id="tag-clear">#${esc(activeTag)} ✕</button>`
    : "";
  $("tag-clear")?.addEventListener("click", () => { activeTag = ""; render(); });

  if (!items.length) {
    listEl.innerHTML = '<p class="empty">아직 공개된 노트가 없습니다.<br>No entries yet.</p>';
    return;
  }

  listEl.innerHTML = items.map(n => {
    const album = albums.find(a => a.id === n.albumId);
    const albumChip = album
      ? `<a class="chip" href="./#${esc(album.id)}">♪ ${esc(album.title)}</a>`
      : "";
    const tagChips = (n.tags || [])
      .map(t => `<button class="chip" type="button" data-tag="${esc(t)}">#${esc(t)}</button>`)
      .join("");
    return `
      <article class="note" id="note-${esc(n.id)}">
        <div class="note-date"><a href="#note-${esc(n.id)}">${esc(n.date || "")}</a></div>
        <h2>${esc(n.title || "")}</h2>
        ${n.html
          ? `<div class="note-rich" data-rich="${esc(n.id)}"></div>`
          : `<p class="note-body">${linkify(esc(n.body || ""))}</p>`}
        ${albumChip || tagChips ? `<div class="note-meta">${albumChip}${tagChips}</div>` : ""}
      </article>
    `;
  }).join("");

  // 서식 본문은 허용된 태그만 남긴 뒤 DOM으로 삽입
  listEl.querySelectorAll("[data-rich]").forEach(el => {
    const n = items.find(x => x.id === el.getAttribute("data-rich"));
    el.appendChild(renderHtml(n?.html || ""));
  });

  listEl.querySelectorAll("[data-tag]").forEach(btn => {
    btn.addEventListener("click", () => {
      activeTag = btn.getAttribute("data-tag");
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

async function init() {
  if (!firebaseConfigReady()) {
    $("notes").innerHTML = '<p class="empty">Journal을 불러올 수 없습니다.</p>';
    return;
  }
  const { initializeApp, getApps } = await import(`https://www.gstatic.com/firebasejs/${VER}/firebase-app.js`);
  const { getFirestore, collection, getDocs, query, where } =
    await import(`https://www.gstatic.com/firebasejs/${VER}/firebase-firestore.js`);

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const db = getFirestore(app);

  // 보안 규칙상 비공개 노트는 읽을 수 없으므로 반드시 published 조건으로 조회
  const [snap, albumList] = await Promise.all([
    getDocs(query(collection(db, "notes"), where("published", "==", true))),
    loadAlbums().catch(() => [])
  ]);
  notes = snap.docs.map(d => ({ ...d.data(), id: d.id }));
  albums = albumList;

  $("toolbar").hidden = false;
  $("sort-new").addEventListener("click", () => { order = "new"; render(); });
  $("sort-old").addEventListener("click", () => { order = "old"; render(); });
  render();

  // 공유 링크(#note-xxx)로 들어온 경우 해당 노트로 이동
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

init().catch(err => {
  console.warn("journal load failed:", err);
  $("notes").innerHTML = '<p class="empty">Journal을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
});
