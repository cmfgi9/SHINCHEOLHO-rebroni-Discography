// 관리자 페이지: Google 로그인 + 앨범/트랙/링크 CRUD + albums.json 마이그레이션
import { firebaseConfig } from "./firebase-config.js";

const VER = "10.12.2";
const { initializeApp, getApps } = await import(`https://www.gstatic.com/firebasejs/${VER}/firebase-app.js`);
const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } =
  await import(`https://www.gstatic.com/firebasejs/${VER}/firebase-auth.js`);
const { getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch } =
  await import(`https://www.gstatic.com/firebasejs/${VER}/firebase-firestore.js`);

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);
const views = ["view-signin", "view-noauth", "view-list", "view-edit"];
function show(...ids) {
  views.forEach(v => $(v).classList.toggle("hidden", !ids.includes(v)));
}
function setStatus(id, msg, cls = "") {
  const el = $(id);
  el.textContent = msg;
  el.className = "status " + cls;
}

let currentUser = null;
let editingId = null; // null = 새 앨범

// ---------- 인증 ----------
$("btn-signin").addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    setStatus("signin-status", "로그인 실패: " + e.message, "err");
  }
});
$("btn-signout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) {
    $("who").textContent = "";
    $("btn-signout").classList.add("hidden");
    show("view-signin");
    return;
  }
  $("who").textContent = user.displayName || user.email;
  $("btn-signout").classList.remove("hidden");

  const isAdmin = await checkAdmin(user.uid);
  if (!isAdmin) {
    $("my-uid").textContent = user.uid;
    show("view-noauth");
    return;
  }
  show("view-list");
  await refreshList();
});

async function checkAdmin(uid) {
  try {
    const snap = await getDoc(doc(db, "admins", uid));
    return snap.exists();
  } catch (e) {
    console.warn("admin check failed:", e);
    return false;
  }
}

// ---------- 앨범 목록 ----------
async function fetchAlbums() {
  const snap = await getDocs(collection(db, "albums"));
  const albums = snap.docs.map(d => ({ ...d.data(), id: d.id }));
  albums.sort((a, b) => String(b.release || "").localeCompare(String(a.release || "")));
  return albums;
}

async function refreshList() {
  const listEl = $("album-list");
  listEl.innerHTML = '<p class="muted">불러오는 중…</p>';
  try {
    const albums = await fetchAlbums();
    if (!albums.length) {
      listEl.innerHTML = '<p class="muted">Firestore에 앨범이 없습니다. "albums.json 가져오기"로 시작하세요.</p>';
      return;
    }
    listEl.innerHTML = "";
    albums.forEach(a => {
      const row = document.createElement("div");
      row.className = "album-row";
      row.innerHTML = `
        <div class="t">
          <strong>${esc(a.ordinal || "")} · ${esc(a.title || "")}</strong>
          <small>id: ${esc(a.id)} · 발매 ${esc(a.release || "-")} · 트랙 ${(a.tracks || []).length}곡</small>
        </div>
        <button class="btn small" data-edit="${esc(a.id)}">편집</button>
      `;
      listEl.appendChild(row);
    });
    listEl.querySelectorAll("[data-edit]").forEach(btn => {
      btn.addEventListener("click", () => openEdit(btn.getAttribute("data-edit")));
    });
  } catch (e) {
    listEl.innerHTML = "";
    setStatus("list-status", "목록 로드 실패: " + e.message, "err");
  }
}

// ---------- albums.json 마이그레이션 ----------
$("btn-import").addEventListener("click", async () => {
  if (!confirm("albums.json의 모든 앨범을 Firestore로 가져옵니다.\n같은 ID의 문서는 덮어씁니다. 진행할까요?")) return;
  const btn = $("btn-import");
  btn.disabled = true;
  setStatus("list-status", "가져오는 중…");
  try {
    const res = await fetch("albums.json", { cache: "no-store" });
    if (!res.ok) throw new Error("albums.json 로드 실패");
    const albums = await res.json();
    const batch = writeBatch(db);
    albums.forEach(a => {
      const { id, ...data } = a;
      batch.set(doc(db, "albums", id), data);
    });
    await batch.commit();
    setStatus("list-status", `완료: 앨범 ${albums.length}장을 가져왔습니다.`, "ok");
    await refreshList();
  } catch (e) {
    setStatus("list-status", "가져오기 실패: " + e.message, "err");
  } finally {
    btn.disabled = false;
  }
});

// ---------- 편집 폼 ----------
$("btn-new").addEventListener("click", () => openEdit(null));
$("btn-cancel").addEventListener("click", async () => {
  show("view-list");
  await refreshList();
});
$("btn-add-track").addEventListener("click", e => {
  e.preventDefault();
  addTrackRow();
  renumberTracks();
});

function openEdit(albumId) {
  editingId = albumId;
  $("edit-title").textContent = albumId ? `앨범 편집 — ${albumId}` : "새 앨범 추가";
  $("btn-delete").classList.toggle("hidden", !albumId);
  $("f-id").disabled = !!albumId;
  setStatus("edit-status", "");
  clearForm();
  show("view-edit");

  if (albumId) {
    getDoc(doc(db, "albums", albumId)).then(snap => {
      if (snap.exists()) fillForm({ ...snap.data(), id: snap.id });
      else setStatus("edit-status", "문서를 찾을 수 없습니다.", "err");
    });
  } else {
    addTrackRow(); // 새 앨범은 빈 트랙 1개로 시작
    renumberTracks();
  }
}

function clearForm() {
  ["f-id", "f-ordinal", "f-upc", "f-title", "f-upload", "f-release", "f-cover",
    "f-spotify-album", "f-apple-album", "f-youtube-album", "f-concept-ko", "f-concept-en"]
    .forEach(id => $(id).value = "");
  $("f-artist").value = "SHINCHEOLHO-rebroni";
  $("f-label").value = "Rebroni Music";
  $("tracks").innerHTML = "";
}

function fillForm(a) {
  $("f-id").value = a.id || "";
  $("f-ordinal").value = a.ordinal || "";
  $("f-upc").value = a.upc || "";
  $("f-title").value = a.title || "";
  $("f-artist").value = a.artist || "";
  $("f-label").value = a.label || "";
  $("f-upload").value = a.upload || "";
  $("f-release").value = a.release || "";
  $("f-cover").value = a.cover || "";
  $("f-spotify-album").value = a.links?.spotify_album || "";
  $("f-apple-album").value = a.links?.apple_album || "";
  $("f-youtube-album").value = a.links?.youtube_album || "";
  $("f-concept-ko").value = a.concept?.ko || "";
  $("f-concept-en").value = a.concept?.en || "";
  $("tracks").innerHTML = "";
  (a.tracks || []).forEach(t => addTrackRow(t));
  renumberTracks();
}

function addTrackRow(t = {}) {
  const div = document.createElement("div");
  div.className = "track-item";
  div.innerHTML = `
    <div class="track-head">
      <span class="no"></span>
      <span class="spacer"></span>
      <button class="btn small t-up" title="위로">↑</button>
      <button class="btn small t-down" title="아래로">↓</button>
      <button class="btn small danger t-del">삭제</button>
    </div>
    <label>곡 제목 *</label>
    <input type="text" class="t-title" value="${escAttr(t.title || "")}">
    <div class="grid2">
      <div>
        <label>ISRC</label>
        <input type="text" class="t-isrc" value="${escAttr(t.isrc || "")}">
      </div>
      <div></div>
    </div>
    <label>Spotify</label>
    <input type="url" class="t-spotify" value="${escAttr(t.links?.spotify || "")}">
    <label>Apple Music</label>
    <input type="url" class="t-apple" value="${escAttr(t.links?.apple || "")}">
    <label>YouTube</label>
    <input type="url" class="t-youtube" value="${escAttr(t.links?.youtube || "")}">
  `;
  div.querySelector(".t-del").addEventListener("click", e => {
    e.preventDefault();
    div.remove();
    renumberTracks();
  });
  div.querySelector(".t-up").addEventListener("click", e => {
    e.preventDefault();
    const prev = div.previousElementSibling;
    if (prev) div.parentNode.insertBefore(div, prev);
    renumberTracks();
  });
  div.querySelector(".t-down").addEventListener("click", e => {
    e.preventDefault();
    const next = div.nextElementSibling;
    if (next) div.parentNode.insertBefore(next, div);
    renumberTracks();
  });
  $("tracks").appendChild(div);
}

function renumberTracks() {
  document.querySelectorAll("#tracks .track-item").forEach((el, i) => {
    el.querySelector(".no").textContent = `Track ${i + 1}`;
  });
}

function collectForm() {
  const id = $("f-id").value.trim();
  const title = $("f-title").value.trim();
  const ordinal = $("f-ordinal").value.trim();
  const release = $("f-release").value.trim();
  if (!id) throw new Error("앨범 ID는 필수입니다.");
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error("앨범 ID는 영문/숫자/-/_ 만 사용하세요.");
  if (!title) throw new Error("앨범 타이틀은 필수입니다.");
  if (!ordinal) throw new Error("구분(ordinal)은 필수입니다.");
  if (!release) throw new Error("발매일은 필수입니다.");

  const tracks = [...document.querySelectorAll("#tracks .track-item")].map((el, i) => {
    const t = {
      no: i + 1,
      title: el.querySelector(".t-title").value.trim(),
      isrc: el.querySelector(".t-isrc").value.trim(),
      links: {}
    };
    const s = el.querySelector(".t-spotify").value.trim();
    const a = el.querySelector(".t-apple").value.trim();
    const y = el.querySelector(".t-youtube").value.trim();
    if (s) t.links.spotify = s;
    if (a) t.links.apple = a;
    if (y) t.links.youtube = y;
    return t;
  }).filter(t => t.title);

  const links = {};
  const sa = $("f-spotify-album").value.trim();
  const aa = $("f-apple-album").value.trim();
  const ya = $("f-youtube-album").value.trim();
  if (sa) links.spotify_album = sa;
  if (aa) links.apple_album = aa;
  if (ya) links.youtube_album = ya;

  const data = {
    ordinal,
    title,
    artist: $("f-artist").value.trim(),
    label: $("f-label").value.trim(),
    upload: $("f-upload").value.trim(),
    release,
    upc: $("f-upc").value.trim(),
    cover: $("f-cover").value.trim(),
    links,
    concept: {
      ko: $("f-concept-ko").value.trim(),
      en: $("f-concept-en").value.trim()
    },
    tracks
    // 향후 커머스 연동 시: productId: "prod_xxx" 필드를 여기에 추가
  };
  return { id, data };
}

$("btn-save").addEventListener("click", async () => {
  const btn = $("btn-save");
  try {
    const { id, data } = collectForm();
    if (!editingId) {
      const dup = await getDoc(doc(db, "albums", id));
      if (dup.exists()) throw new Error(`ID "${id}"가 이미 존재합니다.`);
    }
    btn.disabled = true;
    setStatus("edit-status", "저장 중…");
    await setDoc(doc(db, "albums", id), data);
    setStatus("edit-status", "저장 완료. 사이트에 바로 반영됩니다.", "ok");
    editingId = id;
    $("f-id").disabled = true;
    $("btn-delete").classList.remove("hidden");
    $("edit-title").textContent = `앨범 편집 — ${id}`;
  } catch (e) {
    setStatus("edit-status", "저장 실패: " + e.message, "err");
  } finally {
    btn.disabled = false;
  }
});

$("btn-delete").addEventListener("click", async () => {
  if (!editingId) return;
  if (!confirm(`앨범 "${editingId}"을(를) 삭제합니다. 되돌릴 수 없습니다. 진행할까요?`)) return;
  try {
    await deleteDoc(doc(db, "albums", editingId));
    show("view-list");
    await refreshList();
    setStatus("list-status", `앨범 "${editingId}" 삭제 완료.`, "ok");
    editingId = null;
  } catch (e) {
    setStatus("edit-status", "삭제 실패: " + e.message, "err");
  }
});

// ---------- 유틸 ----------
function esc(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function escAttr(s) { return esc(s); }
