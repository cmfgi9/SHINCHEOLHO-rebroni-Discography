// 관리자 페이지: Google 로그인 + 앨범/트랙/링크 CRUD + albums.json 마이그레이션 + 창작 노트 + 영상
import { firebaseConfig } from "./firebase-config.js";
import { sanitizeHtml, plainToHtml, htmlToText, storagePathsIn } from "./journal-format.js?v=2";
import { parseYouTube, thumbUrl, fetchYouTubeTitle } from "./youtube.js";

const VER = "10.12.2";
const { initializeApp, getApps } = await import(`https://www.gstatic.com/firebasejs/${VER}/firebase-app.js`);
const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } =
  await import(`https://www.gstatic.com/firebasejs/${VER}/firebase-auth.js`);
const { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, writeBatch, query, orderBy, limit } =
  await import(`https://www.gstatic.com/firebasejs/${VER}/firebase-firestore.js`);
const { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } =
  await import(`https://www.gstatic.com/firebasejs/${VER}/firebase-storage.js`);

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const $ = id => document.getElementById(id);
const views = ["view-signin", "view-noauth", "view-list", "view-notes", "view-note", "view-videos", "view-video", "view-edit"];
function show(...ids) {
  views.forEach(v => $(v).classList.toggle("hidden", !ids.includes(v)));
}
// 관리자 첫 화면: 앨범 목록 + 창작 노트 목록 + 영상 목록
function showHome() {
  show("view-list", "view-notes", "view-videos");
}
function setStatus(id, msg, cls = "") {
  const el = $(id);
  el.textContent = msg;
  el.className = "status " + cls;
}

let currentUser = null;
let editingId = null; // null = 새 앨범

// 업로드 가능한 음원 포맷 → Storage contentType
const AUDIO_TYPES = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  opus: "audio/ogg", // Ogg Opus
  ogg: "audio/ogg",
  m4a: "audio/mp4",  // AAC (MP4 컨테이너)
  aac: "audio/aac"   // AAC (ADTS)
};
// 다른 포맷으로 다시 올려 경로가 바뀐 기존 음원 — [저장]이 끝난 뒤에 Storage에서 삭제
const replacedAudioPaths = new Set();

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
  showHome();
  await refreshList();
  await refreshNotes();
  await refreshVideos();
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
let albumCache = []; // 창작 노트의 '관련 앨범' 선택지로도 사용

async function fetchAlbums() {
  const snap = await getDocs(collection(db, "albums"));
  const albums = snap.docs.map(d => ({ ...d.data(), id: d.id }));
  albums.sort((a, b) => String(b.release || "").localeCompare(String(a.release || "")));
  albumCache = albums;
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
  showHome();
  await refreshList();
});
$("btn-add-track").addEventListener("click", e => {
  e.preventDefault();
  addTrackRow();
  renumberTracks();
});

function openEdit(albumId) {
  editingId = albumId;
  replacedAudioPaths.clear();
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
    "f-spotify-album", "f-apple-album", "f-youtube-album", "f-concept-ko", "f-concept-en",
    "f-story-ko", "f-story-en"]
    .forEach(id => $(id).value = "");
  $("f-artist").value = "SHINCHEOLHO-rebroni";
  $("f-label").value = "Rebroni Music";
  $("tracks").innerHTML = "";
  $("cover-upload-status").textContent = "";
  updateCoverPreview();
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
  $("f-story-ko").value = a.story?.ko || "";
  $("f-story-en").value = a.story?.en || "";
  $("tracks").innerHTML = "";
  (a.tracks || []).forEach(t => addTrackRow(t));
  renumberTracks();
  updateCoverPreview();
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
    <label>가사 — 한국어 (선택)</label>
    <textarea class="t-lyrics-ko" placeholder="가사를 입력하면 사이트에 [Lyrics] 버튼이 생깁니다">${esc(t.lyrics?.ko || "")}</textarea>
    <label>가사 — English (선택)</label>
    <textarea class="t-lyrics-en">${esc(t.lyrics?.en || "")}</textarea>
    <label>음원 파일 (mp3/wav/opus/m4a·aac, 곡당 최대 20MB)</label>
    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
      <input type="file" class="t-audio-file hidden" accept="${Object.keys(AUDIO_TYPES).map(e => "." + e).join(",")},audio/*">
      <button class="btn small t-audio-upload">음원 파일 업로드</button>
      <button class="btn small t-audio-copy ${t.audioUrl ? "" : "hidden"}">URL 복사</button>
      <button class="btn small danger t-audio-del ${t.audioUrl ? "" : "hidden"}">음원 삭제</button>
      <span class="muted t-audio-status"></span>
    </div>
    <input type="url" class="t-audio-url" readonly placeholder="업로드하면 다운로드 URL이 자동 입력됩니다" value="${escAttr(t.audioUrl || "")}">
    <input type="hidden" class="t-audio-path" value="${escAttr(t.audioPath || "")}">
    <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
      <input type="checkbox" class="t-unlisted" style="width:auto;" ${t.unlisted ? "checked" : ""}>
      비발매 (게임/비공개용) — 사이트 공개 목록에 노출하지 않음
    </label>
  `;
  div.querySelector(".t-del").addEventListener("click", async e => {
    e.preventDefault();
    const audioPath = div.querySelector(".t-audio-path").value.trim();
    if (audioPath) {
      if (!confirm("이 곡의 음원 파일도 Storage에서 함께 삭제됩니다. 진행할까요?")) return;
      try {
        await deleteObject(ref(storage, audioPath));
      } catch (err) {
        if (err.code !== "storage/object-not-found") {
          setStatus("edit-status", "음원 파일 삭제 실패: " + err.message, "err");
          return;
        }
      }
    }
    div.remove();
    renumberTracks();
  });

  // ----- 음원 업로드 / URL 복사 / 음원 삭제 -----
  const audioFile = div.querySelector(".t-audio-file");
  const audioUrlEl = div.querySelector(".t-audio-url");
  const audioPathEl = div.querySelector(".t-audio-path");
  const audioStatus = div.querySelector(".t-audio-status");
  const btnCopy = div.querySelector(".t-audio-copy");
  const btnAudioDel = div.querySelector(".t-audio-del");

  function syncAudioButtons() {
    const has = !!audioUrlEl.value.trim();
    btnCopy.classList.toggle("hidden", !has);
    btnAudioDel.classList.toggle("hidden", !has);
  }

  div.querySelector(".t-audio-upload").addEventListener("click", e => {
    e.preventDefault();
    audioFile.click();
  });

  audioFile.addEventListener("change", async e => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!AUDIO_TYPES[ext]) {
      audioStatus.textContent = "mp3 · wav · opus · ogg · m4a · aac 파일만 업로드할 수 있습니다.";
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      audioStatus.textContent = `파일이 20MB를 초과합니다 (${Math.round(file.size / 1024 / 1024)}MB).`;
      return;
    }
    const slug = slugify(file.name.replace(/\.[^.]+$/, ""))
      || slugify(div.querySelector(".t-title").value);
    if (!slug) {
      audioStatus.textContent = "영문 슬러그를 만들 수 없습니다. 파일명 또는 곡 제목에 영문을 포함하세요.";
      return;
    }

    try {
      audioStatus.textContent = "업로드 중…";
      const path = `tracks/${slug}.${ext}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file, { contentType: AUDIO_TYPES[ext] });
      const url = await getDownloadURL(storageRef);
      const oldPath = audioPathEl.value.trim();
      if (oldPath && oldPath !== path) replacedAudioPaths.add(oldPath);
      audioUrlEl.value = url;
      audioPathEl.value = path;
      syncAudioButtons();
      audioStatus.textContent = `업로드 완료 (${Math.round(file.size / 1024)}KB)`;
      setStatus("edit-status", "음원 업로드 완료. [저장]을 눌러야 앨범에 반영됩니다.", "ok");
    } catch (err) {
      audioStatus.textContent = "";
      setStatus("edit-status", "음원 업로드 실패: " + err.message, "err");
    }
  });

  btnCopy.addEventListener("click", async e => {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(audioUrlEl.value.trim());
      audioStatus.textContent = "URL 복사 완료.";
    } catch {
      audioStatus.textContent = "복사 실패 — URL을 직접 선택해 복사하세요.";
    }
  });

  btnAudioDel.addEventListener("click", async e => {
    e.preventDefault();
    if (!confirm("이 곡의 음원 파일을 Storage에서 삭제할까요?")) return;
    const path = audioPathEl.value.trim();
    try {
      if (path) await deleteObject(ref(storage, path));
      audioUrlEl.value = "";
      audioPathEl.value = "";
      syncAudioButtons();
      audioStatus.textContent = "음원 삭제 완료.";
      setStatus("edit-status", "음원 삭제 완료. [저장]을 눌러야 앨범에 반영됩니다.", "ok");
    } catch (err) {
      if (err.code === "storage/object-not-found") {
        audioUrlEl.value = "";
        audioPathEl.value = "";
        syncAudioButtons();
        audioStatus.textContent = "파일이 이미 없어 URL만 제거했습니다.";
      } else {
        setStatus("edit-status", "음원 삭제 실패: " + err.message, "err");
      }
    }
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
    const lko = el.querySelector(".t-lyrics-ko").value.trim();
    const len = el.querySelector(".t-lyrics-en").value.trim();
    if (lko || len) t.lyrics = { ko: lko, en: len };
    const audioUrl = el.querySelector(".t-audio-url").value.trim();
    const audioPath = el.querySelector(".t-audio-path").value.trim();
    if (audioUrl) t.audioUrl = audioUrl;
    if (audioPath) t.audioPath = audioPath;
    if (el.querySelector(".t-unlisted").checked) t.unlisted = true;
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
    story: {
      ko: $("f-story-ko").value.trim(),
      en: $("f-story-en").value.trim()
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
    // 새 포맷으로 교체된 기존 음원 정리 (이 앨범에서 아직 쓰는 경로는 남김)
    const inUse = new Set(data.tracks.map(t => t.audioPath).filter(Boolean));
    for (const path of replacedAudioPaths) {
      if (inUse.has(path)) continue;
      try {
        await deleteObject(ref(storage, path));
      } catch (err) {
        if (err.code !== "storage/object-not-found") console.warn("기존 음원 삭제 실패:", path, err);
      }
    }
    replacedAudioPaths.clear();
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
  if (!confirm(`앨범 "${editingId}"을(를) 삭제합니다. 등록된 음원 파일도 Storage에서 함께 삭제되며, 되돌릴 수 없습니다. 진행할까요?`)) return;
  try {
    // 앨범에 등록된 음원 파일 Storage 정리
    const snap = await getDoc(doc(db, "albums", editingId));
    if (snap.exists()) {
      const tracks = snap.data().tracks || [];
      for (const t of tracks) {
        if (!t.audioPath) continue;
        try {
          await deleteObject(ref(storage, t.audioPath));
        } catch (err) {
          if (err.code !== "storage/object-not-found") console.warn("음원 삭제 실패:", t.audioPath, err);
        }
      }
    }
    await deleteDoc(doc(db, "albums", editingId));
    showHome();
    await refreshList();
    setStatus("list-status", `앨범 "${editingId}" 삭제 완료.`, "ok");
    editingId = null;
  } catch (e) {
    setStatus("edit-status", "삭제 실패: " + e.message, "err");
  }
});

// ---------- 방명록 관리 ----------
$("btn-load-gb").addEventListener("click", loadGuestbookAdmin);

async function loadGuestbookAdmin() {
  const listEl = $("admin-gb-list");
  listEl.innerHTML = '<p class="muted">불러오는 중…</p>';
  try {
    const q = query(collection(db, "guestbook"), orderBy("createdAt", "desc"), limit(200));
    const snap = await getDocs(q);
    if (snap.empty) {
      listEl.innerHTML = '<p class="muted">방명록이 비어 있습니다.</p>';
      return;
    }
    listEl.innerHTML = "";
    snap.docs.forEach(d => {
      const x = d.data();
      const row = document.createElement("div");
      row.className = "album-row";
      row.innerHTML = `
        <div class="t">
          <strong>${esc(x.name || "")}</strong>
          ${x.deleted ? '<span style="color:var(--danger); font-size:12px;"> (작성자 삭제됨)</span>' : ""}
          <small>${esc((x.createdAt || "").slice(0, 16).replace("T", " "))} — ${esc(x.message || "")}</small>
        </div>
        <button class="btn small danger" data-gbdel="${esc(d.id)}">삭제</button>
      `;
      listEl.appendChild(row);
    });
    listEl.querySelectorAll("[data-gbdel]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("이 메시지를 영구 삭제할까요?")) return;
        try {
          await deleteDoc(doc(db, "guestbook", btn.getAttribute("data-gbdel")));
          setStatus("gb-admin-status", "삭제 완료.", "ok");
          await loadGuestbookAdmin();
        } catch (e) {
          setStatus("gb-admin-status", "삭제 실패: " + e.message, "err");
        }
      });
    });
  } catch (e) {
    listEl.innerHTML = "";
    setStatus("gb-admin-status", "로드 실패: " + e.message, "err");
  }
}

// ---------- 구독자 관리 ----------
let subscriberEmails = [];

$("btn-load-subs").addEventListener("click", async () => {
  const listEl = $("admin-subs-list");
  listEl.innerHTML = '<p class="muted">불러오는 중…</p>';
  try {
    const snap = await getDocs(query(collection(db, "subscribers"), orderBy("createdAt", "desc")));
    subscriberEmails = snap.docs.map(d => d.data().email).filter(Boolean);
    if (!subscriberEmails.length) {
      listEl.innerHTML = '<p class="muted">아직 구독자가 없습니다.</p>';
      $("btn-copy-subs").disabled = true;
      return;
    }
    listEl.innerHTML = `
      <p class="muted" style="margin-top:10px;">총 ${subscriberEmails.length}명</p>
      <textarea readonly style="min-height:120px; font-family:monospace; font-size:12px;">${esc(subscriberEmails.join("\n"))}</textarea>
    `;
    $("btn-copy-subs").disabled = false;
  } catch (e) {
    listEl.innerHTML = "";
    setStatus("subs-admin-status", "로드 실패: " + e.message, "err");
  }
});

$("btn-copy-subs").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(subscriberEmails.join("\n"));
    setStatus("subs-admin-status", `이메일 ${subscriberEmails.length}건 복사 완료. STIBEE/Mailchimp 등에 붙여넣으세요.`, "ok");
  } catch (e) {
    setStatus("subs-admin-status", "복사 실패 — 목록을 직접 선택해 복사하세요.", "err");
  }
});

// ---------- 창작 노트 (Creator's Journal) ----------
// notes/{autoId}: { title, body(일반 텍스트 사본), html(서식 본문), media[](첨부 Storage 경로),
//                   date(YYYY-MM-DD), tags[], albumId, published, createdAt, updatedAt }
let notesCache = [];
let editingNoteId = null; // null = 새 노트
let noteSnapshot = "";    // 저장하지 않은 변경 감지용

function todayLocal() {
  return new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD (로컬 시간대)
}

// 기록일 내림차순(최신이 위), 같은 날은 작성 시각 내림차순
function sortNotes(notes) {
  return notes.sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || ""))
    || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

async function refreshNotes() {
  const listEl = $("note-list");
  listEl.innerHTML = '<p class="muted">불러오는 중…</p>';
  setStatus("note-list-status", "");
  try {
    const snap = await getDocs(collection(db, "notes"));
    notesCache = sortNotes(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    renderNotes();
  } catch (e) {
    listEl.innerHTML = "";
    setStatus("note-list-status", "노트 로드 실패: " + e.message +
      " (firestore.rules에 notes 규칙을 게시했는지 확인하세요)", "err");
  }
}

function renderNotes() {
  const listEl = $("note-list");
  const q = $("note-filter").value.trim().toLowerCase();
  const items = q
    ? notesCache.filter(n => [n.title, n.body, (n.tags || []).join(" ")].join(" ").toLowerCase().includes(q))
    : notesCache;
  if (!notesCache.length) {
    listEl.innerHTML = '<p class="muted">아직 노트가 없습니다. [+ 새 노트]로 첫 아이디어를 기록하세요.</p>';
    return;
  }
  if (!items.length) {
    listEl.innerHTML = '<p class="muted">검색 결과가 없습니다.</p>';
    return;
  }
  listEl.innerHTML = "";
  items.forEach(n => {
    const album = albumCache.find(a => a.id === n.albumId);
    const meta = [
      n.date || "-",
      album ? album.title : (n.albumId || ""),
      (n.tags || []).map(t => "#" + t).join(" ")
    ].filter(Boolean).join(" · ");
    const preview = String(n.body || "").replace(/\s+/g, " ").slice(0, 80);
    const row = document.createElement("div");
    row.className = "album-row";
    row.innerHTML = `
      <div class="t">
        <strong>${esc(n.title || "(제목 없음)")}</strong>
        <span class="badge ${n.published ? "pub" : ""}">${n.published ? "공개" : "비공개"}</span>
        <small>${esc(meta)}</small>
        <small>${esc(preview)}${String(n.body || "").length > 80 ? "…" : ""}</small>
      </div>
      <button class="btn small" data-note="${esc(n.id)}">편집</button>
    `;
    listEl.appendChild(row);
  });
  listEl.querySelectorAll("[data-note]").forEach(btn => {
    btn.addEventListener("click", () => openNote(btn.getAttribute("data-note")));
  });
}

$("note-filter").addEventListener("input", renderNotes);
$("btn-new-note").addEventListener("click", () => openNote(null));

function fillAlbumOptions(selected, selectId = "n-album") {
  const sel = $(selectId);
  sel.innerHTML = '<option value="">— 없음 —</option>' + albumCache
    .map(a => `<option value="${esc(a.id)}">${esc(a.ordinal || a.id)} · ${esc(a.title || "")}</option>`)
    .join("");
  // 삭제된 앨범을 가리키는 노트·영상도 값이 사라지지 않도록 유지
  if (selected && !albumCache.some(a => a.id === selected)) {
    sel.insertAdjacentHTML("beforeend", `<option value="${esc(selected)}">${esc(selected)} (삭제된 앨범)</option>`);
  }
  sel.value = selected || "";
}

// ----- 서식 편집기 (본문) -----
const editor = $("n-body");
let savedRange = null;          // 툴바·색상 선택 창을 누르는 동안 잃어버리는 선택 영역 보관
const sessionUploads = new Set(); // 이 편집 중에 올린 파일 — 저장하지 않고 나가면 Storage에서 정리

document.execCommand("defaultParagraphSeparator", false, "p"); // Enter → <p> 문단

document.addEventListener("selectionchange", () => {
  const sel = getSelection();
  if (sel.rangeCount && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    savedRange = sel.getRangeAt(0).cloneRange();
  }
});

function restoreSelection() {
  editor.focus();
  const sel = getSelection();
  sel.removeAllRanges();
  if (savedRange && editor.contains(savedRange.commonAncestorContainer)) {
    sel.addRange(savedRange);
  } else { // 커서 위치가 없으면 본문 끝에
    const r = document.createRange();
    r.selectNodeContents(editor);
    r.collapse(false);
    sel.addRange(r);
  }
}

function exec(cmd, value = null) {
  restoreSelection();
  document.execCommand(cmd, false, value);
}

function applyColor(color) {
  restoreSelection();
  document.execCommand("styleWithCSS", false, true); // <font> 대신 <span style="color">로 저장
  document.execCommand("foreColor", false, color);
  document.execCommand("styleWithCSS", false, false);
}

// 편집 화면에서만 쓰는 장치: 사진/음원 블록은 통째로 다루고, 설명만 편집 + 삭제 버튼
function decorateEditor() {
  editor.querySelectorAll("figure").forEach(fig => {
    fig.contentEditable = "false";
    if (!fig.querySelector("figcaption")) fig.appendChild(document.createElement("figcaption"));
    fig.querySelector("figcaption").contentEditable = "true";
    fig.querySelector("audio")?.setAttribute("controls", "");
    // 유튜브 블록은 편집 중에는 썸네일만 보여줌 (공개 페이지에서 플레이어로 표시)
    if (fig.dataset.kind === "youtube" && !fig.querySelector("img") && fig.dataset.id) {
      fig.insertAdjacentHTML("afterbegin", `<img src="${escAttr(thumbUrl(fig.dataset.id))}" alt="">`);
    }
    if (!fig.querySelector(".fig-del")) {
      fig.insertAdjacentHTML("afterbegin", '<button type="button" class="btn small danger fig-del" style="float:right;">✕ 빼기</button>');
    }
  });
}

editor.addEventListener("click", e => {
  const del = e.target.closest(".fig-del");
  if (!del) return;
  e.preventDefault();
  del.closest("figure").remove();
});

// 툴바 버튼을 눌러도 본문의 선택 영역이 풀리지 않도록
$("rte-toolbar").addEventListener("mousedown", e => {
  if (e.target.closest("button")) e.preventDefault();
});
$("rte-toolbar").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.cmd) exec(b.dataset.cmd);
  else if (b.dataset.color) applyColor(b.dataset.color);
  else if (b.dataset.block) {
    restoreSelection();
    const cur = String(document.queryCommandValue("formatBlock") || "").toUpperCase();
    document.execCommand("formatBlock", false, cur === b.dataset.block ? "P" : b.dataset.block);
  }
});
$("rte-color").addEventListener("input", e => applyColor(e.target.value));

$("rte-link").addEventListener("click", () => {
  const url = prompt("링크 주소를 입력하세요 (https://…)");
  if (!url) return;
  if (!/^https?:\/\//i.test(url.trim())) return alert("https:// 로 시작하는 주소를 입력하세요.");
  restoreSelection();
  if (getSelection().isCollapsed) {
    document.execCommand("insertHTML", false, `<a href="${escAttr(url.trim())}">${esc(url.trim())}</a>`);
  } else {
    document.execCommand("createLink", false, url.trim());
  }
});

// 권한 오류일 때: 규칙 재게시 안내
function rulesHint(err) {
  return /permission|unauthorized/i.test(String(err.code || err.message))
    ? " (Firebase Console에서 firestore.rules · storage.rules 최신본을 게시했는지 확인하세요)"
    : "";
}

// ----- 사진 / 음원 스케치 첨부 -----
function journalPathPrefix() {
  return `journal/${editingNoteId || "draft"}-${Date.now()}`;
}

async function uploadJournalImage(file) {
  if (!file.type.startsWith("image/")) throw new Error("이미지 파일이 아닙니다.");
  let blob = file;
  let ext = "jpg";
  let contentType = "image/jpeg";
  if (file.type === "image/gif") { // 움직이는 GIF는 변환하지 않고 그대로
    if (file.size > 10 * 1024 * 1024) throw new Error("GIF는 10MB 이하만 올릴 수 있습니다.");
    ext = "gif";
    contentType = "image/gif";
  } else {
    blob = await resizeImage(file, 1600, 0.85);
  }
  const path = `${journalPathPrefix()}.${ext}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob, { contentType });
  sessionUploads.add(path);
  return getDownloadURL(storageRef);
}

async function uploadJournalAudio(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!AUDIO_TYPES[ext]) throw new Error("mp3 · wav · opus · ogg · m4a · aac 파일만 올릴 수 있습니다.");
  if (file.size > 20 * 1024 * 1024) throw new Error(`파일이 20MB를 초과합니다 (${Math.round(file.size / 1024 / 1024)}MB).`);
  const slug = slugify(file.name.replace(/\.[^.]+$/, ""));
  const path = `${journalPathPrefix()}${slug ? "-" + slug : ""}.${ext}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType: AUDIO_TYPES[ext] });
  sessionUploads.add(path);
  return getDownloadURL(storageRef);
}

function insertFigure(html) {
  restoreSelection();
  document.execCommand("insertHTML", false, html + "<p><br></p>");
  decorateEditor();
}

async function attachFiles(files) {
  for (const file of files) {
    const isAudio = file.type.startsWith("audio/") || AUDIO_TYPES[(file.name.split(".").pop() || "").toLowerCase()];
    $("rte-status").textContent = `${file.name} 올리는 중…`;
    try {
      if (isAudio) {
        const url = await uploadJournalAudio(file);
        insertFigure(`<figure data-kind="audio"><audio controls preload="none" src="${escAttr(url)}"></audio>` +
          `<figcaption>${esc(file.name.replace(/\.[^.]+$/, ""))}</figcaption></figure>`);
      } else {
        const url = await uploadJournalImage(file);
        insertFigure(`<figure data-kind="image"><img src="${escAttr(url)}" alt=""><figcaption></figcaption></figure>`);
      }
      $("rte-status").textContent = `${file.name} 첨부 완료. [저장]을 눌러야 노트에 반영됩니다.`;
    } catch (err) {
      $("rte-status").textContent = `${file.name}: ${err.message}${rulesHint(err)}`;
    }
  }
}

$("rte-image").addEventListener("click", () => $("rte-image-file").click());
$("rte-youtube").addEventListener("click", () => {
  const url = prompt("유튜브 영상 주소를 붙여넣으세요 (일반 영상·Shorts 모두 가능)");
  if (!url) return;
  const yt = parseYouTube(url);
  if (!yt) return alert("유튜브 영상 주소를 알아볼 수 없습니다. 영상 페이지의 주소나 [공유] 링크를 붙여넣으세요.");
  insertFigure(`<figure data-kind="youtube" data-id="${yt.id}"${yt.isShort ? ' data-short="1"' : ""}>` +
    `<img src="${escAttr(thumbUrl(yt.id))}" alt=""><figcaption></figcaption></figure>`);
  $("rte-status").textContent = "유튜브 영상을 넣었습니다. 공개 페이지에서는 눌러서 재생됩니다.";
});
$("rte-audio").addEventListener("click", () => $("rte-audio-file").click());
$("rte-audio-file").accept = Object.keys(AUDIO_TYPES).map(e => "." + e).join(",") + ",audio/*";
["rte-image-file", "rte-audio-file"].forEach(id => $(id).addEventListener("change", e => {
  const files = [...(e.target.files || [])];
  e.target.value = "";
  attachFiles(files);
}));

// 붙여넣기: 이미지 파일은 업로드, 서식 있는 글은 허용된 서식만 남김
editor.addEventListener("paste", e => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) {
    e.preventDefault();
    attachFiles(files);
    return;
  }
  const html = e.clipboardData?.getData("text/html");
  if (html) {
    e.preventDefault();
    document.execCommand("insertHTML", false, sanitizeHtml(html));
    decorateEditor();
  }
});

// 끌어다 놓기: 놓은 위치에 사진/음원 첨부
editor.addEventListener("drop", e => {
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
  if (r) savedRange = r;
  attachFiles(files);
});

function readNoteForm() {
  const html = sanitizeHtml(editor.innerHTML);
  return {
    title: $("n-title").value.trim(),
    date: $("n-date").value.trim(),
    albumId: $("n-album").value,
    tags: $("n-tags").value.split(",").map(t => t.trim().replace(/^#/, "")).filter(Boolean),
    // 일반 텍스트 사본: 관리자 검색·미리보기용
    body: htmlToText(html),
    html,
    media: storagePathsIn(html),
    published: $("n-published").checked
  };
}

// Storage 파일 삭제 (이미 없는 파일은 무시)
async function deleteStoragePaths(paths) {
  for (const path of paths) {
    try {
      await deleteObject(ref(storage, path));
    } catch (err) {
      if (err.code !== "storage/object-not-found") console.warn("첨부 파일 삭제 실패:", path, err);
    }
  }
}

function openNote(noteId) {
  const n = noteId ? notesCache.find(x => x.id === noteId) : null;
  if (noteId && !n) {
    setStatus("note-list-status", "노트를 찾을 수 없습니다. 목록을 새로고침합니다.", "err");
    refreshNotes();
    return;
  }
  editingNoteId = noteId;
  sessionUploads.clear();
  savedRange = null;
  $("note-edit-title").textContent = n ? "노트 편집" : "새 노트";
  $("btn-note-delete").classList.toggle("hidden", !n);
  $("n-title").value = n?.title || "";
  $("n-date").value = n?.date || todayLocal();
  $("n-tags").value = (n?.tags || []).join(", ");
  // 서식 기능 이전에 쓴 노트는 일반 텍스트를 문단으로 변환해 불러옴
  editor.innerHTML = n?.html ? sanitizeHtml(n.html) : plainToHtml(n?.body || "");
  decorateEditor();
  $("n-published").checked = !!n?.published;
  $("rte-status").textContent = "";
  fillAlbumOptions(n?.albumId || "");
  noteSnapshot = JSON.stringify(readNoteForm());
  setStatus("note-edit-status", "");
  show("view-note");
  window.scrollTo(0, 0);
  $("n-title").focus();
}

function noteDirty() {
  return !$("view-note").classList.contains("hidden") && JSON.stringify(readNoteForm()) !== noteSnapshot;
}
window.addEventListener("beforeunload", e => {
  if (noteDirty()) e.preventDefault();
});

$("btn-note-cancel").addEventListener("click", async () => {
  if (noteDirty() && !confirm("저장하지 않은 변경 사항이 있습니다. 목록으로 돌아갈까요?")) return;
  // 저장하지 않은 첨부 파일 정리 (저장된 노트가 쓰는 파일은 남김)
  const saved = new Set(notesCache.find(x => x.id === editingNoteId)?.media || []);
  await deleteStoragePaths([...sessionUploads].filter(p => !saved.has(p)));
  sessionUploads.clear();
  showHome();
  renderNotes();
});

$("btn-note-save").addEventListener("click", async () => {
  const btn = $("btn-note-save");
  const data = readNoteForm();
  if (!data.title) return setStatus("note-edit-status", "제목은 필수입니다.", "err");
  if (!data.date) return setStatus("note-edit-status", "기록일은 필수입니다.", "err");
  if (!data.body && !data.media.length) return setStatus("note-edit-status", "본문을 입력하거나 사진·음원을 첨부하세요.", "err");

  btn.disabled = true;
  setStatus("note-edit-status", "저장 중…");
  try {
    const now = new Date().toISOString();
    const prev = editingNoteId ? notesCache.find(x => x.id === editingNoteId) : null;
    if (editingNoteId) {
      await setDoc(doc(db, "notes", editingNoteId), {
        ...data,
        createdAt: prev?.createdAt || now,
        updatedAt: now
      });
    } else {
      const created = await addDoc(collection(db, "notes"), { ...data, createdAt: now, updatedAt: now });
      editingNoteId = created.id;
      $("note-edit-title").textContent = "노트 편집";
      $("btn-note-delete").classList.remove("hidden");
    }
    // 본문에서 빠진 사진/음원 파일 정리
    const keep = new Set(data.media);
    await deleteStoragePaths([...new Set([...(prev?.media || []), ...sessionUploads])].filter(p => !keep.has(p)));
    sessionUploads.clear();
    noteSnapshot = JSON.stringify(data);
    await refreshNotes();
    setStatus("note-edit-status",
      data.published ? "저장 완료. Journal 페이지에 공개되었습니다." : "저장 완료 (비공개).", "ok");
  } catch (e) {
    setStatus("note-edit-status", "저장 실패: " + e.message + rulesHint(e), "err");
  } finally {
    btn.disabled = false;
  }
});

$("btn-note-delete").addEventListener("click", async () => {
  if (!editingNoteId) return;
  if (!confirm("이 노트를 삭제합니다. 첨부한 사진·음원도 함께 삭제되며 되돌릴 수 없습니다. 진행할까요?")) return;
  try {
    const prev = notesCache.find(x => x.id === editingNoteId);
    await deleteDoc(doc(db, "notes", editingNoteId));
    await deleteStoragePaths([...new Set([...(prev?.media || []), ...sessionUploads])]);
    sessionUploads.clear();
    editingNoteId = null;
    showHome();
    await refreshNotes();
    setStatus("note-list-status", "노트 삭제 완료.", "ok");
  } catch (e) {
    setStatus("note-edit-status", "삭제 실패: " + e.message, "err");
  }
});

// ---------- 영상 (YouTube Videos) ----------
// videos/{youtubeId}: { youtubeId, title, kind(album|unreleased|etc), albumId, track, date(YYYY-MM-DD),
//                       description, isShort, published, createdAt, updatedAt }
const KIND_LABEL = { album: "앨범곡", unreleased: "미발매곡", etc: "기타 영상" };
let videosCache = [];
let editingVideoId = null; // null = 새 영상
let videoSnapshot = "";

function sortVideos(list) {
  return list.sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || ""))
    || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

async function refreshVideos() {
  const listEl = $("video-list");
  listEl.innerHTML = '<p class="muted">불러오는 중…</p>';
  setStatus("video-list-status", "");
  fillAlbumOptions($("bulk-album").value, "bulk-album");
  try {
    const snap = await getDocs(collection(db, "videos"));
    videosCache = sortVideos(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    renderVideos();
  } catch (e) {
    listEl.innerHTML = "";
    setStatus("video-list-status", "영상 로드 실패: " + e.message + rulesHint(e), "err");
  }
}

function renderVideos() {
  const listEl = $("video-list");
  const q = $("video-filter").value.trim().toLowerCase();
  const items = q
    ? videosCache.filter(v => [v.title, v.track, v.description].join(" ").toLowerCase().includes(q))
    : videosCache;
  if (!videosCache.length) {
    listEl.innerHTML = '<p class="muted">아직 등록된 영상이 없습니다. 위에 유튜브 주소를 붙여넣고 [가져오기]를 누르세요.</p>';
    return;
  }
  if (!items.length) {
    listEl.innerHTML = '<p class="muted">검색 결과가 없습니다.</p>';
    return;
  }
  listEl.innerHTML = "";
  items.forEach(v => {
    const album = albumCache.find(a => a.id === v.albumId);
    const meta = [v.date, KIND_LABEL[v.kind] || v.kind, v.isShort ? "Shorts" : "", album?.title || "", v.track]
      .filter(Boolean).join(" · ");
    const row = document.createElement("div");
    row.className = "vid-row";
    row.innerHTML = `
      <img src="${escAttr(thumbUrl(v.id, "mqdefault"))}" alt="" loading="lazy">
      <div class="t">
        <strong>${esc(v.title || "(제목 없음)")}</strong>
        <small>${esc(meta)} <span class="badge ${v.published ? "pub" : ""}">${v.published ? "공개" : "비공개"}</span></small>
      </div>
      <button class="btn small" data-video="${esc(v.id)}">편집</button>
    `;
    listEl.appendChild(row);
  });
  listEl.querySelectorAll("[data-video]").forEach(btn => {
    btn.addEventListener("click", () => openVideo(btn.getAttribute("data-video")));
  });
}

$("video-filter").addEventListener("input", renderVideos);
$("btn-new-video").addEventListener("click", () => openVideo(null));

// ----- 여러 개 한 번에 추가 -----
$("btn-bulk-add").addEventListener("click", async () => {
  const btn = $("btn-bulk-add");
  const lines = $("bulk-urls").value.split(/\s+/).map(x => x.trim()).filter(Boolean);
  if (!lines.length) return setStatus("bulk-status", "유튜브 주소를 한 줄에 하나씩 붙여넣으세요.", "err");

  const kind = $("bulk-kind").value;
  const albumId = $("bulk-album").value;
  const published = $("bulk-published").checked;
  const seen = new Set(videosCache.map(v => v.id));
  const added = [], skipped = [], invalid = [], failed = [];
  let untitled = 0; // 제목을 못 가져와 임시 제목이 들어간 영상 수

  btn.disabled = true;
  try {
    for (const line of lines) {
      const yt = parseYouTube(line);
      if (!yt) { invalid.push(line); continue; }
      if (seen.has(yt.id)) { skipped.push(yt.id); continue; }
      seen.add(yt.id);
      setStatus("bulk-status", `가져오는 중… (${added.length + 1}) ${yt.id}`);
      let title = await fetchYouTubeTitle(yt.id);
      if (!title) {
        title = `YouTube ${yt.id}`;
        untitled++;
      }
      const now = new Date().toISOString();
      try {
        await setDoc(doc(db, "videos", yt.id), {
          youtubeId: yt.id, title, kind, albumId, track: "", date: todayLocal(),
          description: "", isShort: yt.isShort, published, createdAt: now, updatedAt: now
        });
        added.push(title);
      } catch (e) {
        failed.push(`${yt.id} (${e.message}${rulesHint(e)})`);
      }
    }
    const msg = [
      added.length ? `${added.length}개 추가` : "",
      skipped.length ? `이미 있는 영상 ${skipped.length}개 건너뜀` : "",
      invalid.length ? `알아볼 수 없는 주소 ${invalid.length}개: ${invalid.join(", ")}` : "",
      failed.length ? `실패 ${failed.length}개: ${failed.join(", ")}` : ""
    ].filter(Boolean).join(" · ");
    setStatus("bulk-status", msg + (untitled ? ` — 제목을 못 가져온 ${untitled}개는 'YouTube …'로 들어갔으니 [편집]에서 고쳐주세요.` : ""),
      invalid.length || failed.length ? "err" : "ok");
    if (added.length) $("bulk-urls").value = invalid.join("\n");
    await refreshVideos();
  } finally {
    btn.disabled = false;
  }
});

// ----- 영상 1개 추가/편집 -----
function readVideoForm() {
  return {
    title: $("v-title").value.trim(),
    kind: $("v-kind").value,
    albumId: $("v-album").value,
    track: $("v-track").value.trim(),
    date: $("v-date").value.trim(),
    description: $("v-desc").value.trim(),
    isShort: $("v-short").checked,
    published: $("v-published").checked
  };
}

function updateVideoPreview() {
  const yt = parseYouTube($("v-url").value);
  const img = $("v-preview");
  img.classList.toggle("hidden", !yt);
  if (yt) img.src = thumbUrl(yt.id);
  return yt;
}

function fillTrackSuggestions() {
  const album = albumCache.find(a => a.id === $("v-album").value);
  $("v-track-list").innerHTML = (album?.tracks || [])
    .map(t => `<option value="${escAttr(t.title || "")}"></option>`).join("");
}

$("v-url").addEventListener("input", () => {
  const yt = updateVideoPreview();
  if (yt?.isShort) $("v-short").checked = true;
});
$("v-album").addEventListener("change", fillTrackSuggestions);

$("btn-video-fetch").addEventListener("click", async () => {
  const yt = updateVideoPreview();
  if (!yt) return setStatus("video-edit-status", "유튜브 주소를 알아볼 수 없습니다.", "err");
  setStatus("video-edit-status", "제목 가져오는 중…");
  const title = await fetchYouTubeTitle(yt.id);
  if (title) {
    $("v-title").value = title;
    setStatus("video-edit-status", "제목을 가져왔습니다.", "ok");
  } else {
    setStatus("video-edit-status", "제목을 가져오지 못했습니다. 직접 입력하세요.", "err");
  }
});

function openVideo(videoId) {
  const v = videoId ? videosCache.find(x => x.id === videoId) : null;
  if (videoId && !v) {
    setStatus("video-list-status", "영상을 찾을 수 없습니다. 목록을 새로고침합니다.", "err");
    refreshVideos();
    return;
  }
  editingVideoId = videoId;
  $("video-edit-title").textContent = v ? "영상 편집" : "영상 추가";
  $("btn-video-delete").classList.toggle("hidden", !v);
  $("v-url").value = v ? `https://youtu.be/${v.id}` : "";
  $("v-url").disabled = !!v;
  $("btn-video-fetch").classList.toggle("hidden", !!v);
  $("v-title").value = v?.title || "";
  $("v-kind").value = v?.kind || "album";
  fillAlbumOptions(v?.albumId || "", "v-album");
  fillTrackSuggestions();
  $("v-track").value = v?.track || "";
  $("v-date").value = v?.date || todayLocal();
  $("v-desc").value = v?.description || "";
  $("v-short").checked = !!v?.isShort;
  $("v-published").checked = v ? !!v.published : true;
  updateVideoPreview();
  videoSnapshot = JSON.stringify(readVideoForm()) + $("v-url").value;
  setStatus("video-edit-status", "");
  show("view-video");
  window.scrollTo(0, 0);
  (v ? $("v-title") : $("v-url")).focus();
}

$("btn-video-cancel").addEventListener("click", () => {
  if (JSON.stringify(readVideoForm()) + $("v-url").value !== videoSnapshot
    && !confirm("저장하지 않은 변경 사항이 있습니다. 목록으로 돌아갈까요?")) return;
  showHome();
  renderVideos();
});

$("btn-video-save").addEventListener("click", async () => {
  const btn = $("btn-video-save");
  const yt = editingVideoId ? { id: editingVideoId } : parseYouTube($("v-url").value);
  const data = readVideoForm();
  if (!yt) return setStatus("video-edit-status", "유튜브 주소를 알아볼 수 없습니다.", "err");
  if (!data.title) return setStatus("video-edit-status", "제목은 필수입니다.", "err");
  if (!data.date) return setStatus("video-edit-status", "게시일은 필수입니다.", "err");

  btn.disabled = true;
  setStatus("video-edit-status", "저장 중…");
  try {
    const prev = videosCache.find(x => x.id === yt.id);
    if (!editingVideoId && prev) throw new Error("이미 등록된 영상입니다. 목록에서 [편집]하세요.");
    const now = new Date().toISOString();
    await setDoc(doc(db, "videos", yt.id), {
      youtubeId: yt.id,
      ...data,
      createdAt: prev?.createdAt || now,
      updatedAt: now
    });
    editingVideoId = yt.id;
    $("video-edit-title").textContent = "영상 편집";
    $("btn-video-delete").classList.remove("hidden");
    $("v-url").disabled = true;
    $("btn-video-fetch").classList.add("hidden");
    videoSnapshot = JSON.stringify(data) + $("v-url").value;
    await refreshVideos();
    setStatus("video-edit-status",
      data.published ? "저장 완료. Videos 페이지에 공개되었습니다." : "저장 완료 (비공개).", "ok");
  } catch (e) {
    setStatus("video-edit-status", "저장 실패: " + e.message + rulesHint(e), "err");
  } finally {
    btn.disabled = false;
  }
});

$("btn-video-delete").addEventListener("click", async () => {
  if (!editingVideoId) return;
  if (!confirm("이 영상을 사이트 목록에서 삭제할까요? (유튜브의 영상은 그대로 남습니다)")) return;
  try {
    await deleteDoc(doc(db, "videos", editingVideoId));
    editingVideoId = null;
    showHome();
    await refreshVideos();
    setStatus("video-list-status", "영상 삭제 완료.", "ok");
  } catch (e) {
    setStatus("video-edit-status", "삭제 실패: " + e.message, "err");
  }
});

// ---------- 커버 이미지 업로드 ----------
$("btn-upload-cover").addEventListener("click", e => {
  e.preventDefault();
  $("f-cover-file").click();
});

$("f-cover-file").addEventListener("change", async e => {
  const file = e.target.files?.[0];
  e.target.value = ""; // 같은 파일 재선택 가능하도록 리셋
  if (!file) return;

  const albumId = $("f-id").value.trim();
  if (!albumId) {
    setStatus("edit-status", "먼저 앨범 ID를 입력한 뒤 업로드하세요.", "err");
    return;
  }

  const statusEl = $("cover-upload-status");
  try {
    statusEl.textContent = "이미지 최적화 중…";
    const blob = await resizeImage(file, 1600, 0.85);

    statusEl.textContent = "업로드 중…";
    const path = `covers/${albumId}-${Date.now()}.jpg`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
    const url = await getDownloadURL(storageRef);

    $("f-cover").value = url;
    updateCoverPreview();
    statusEl.textContent = `업로드 완료 (${Math.round(blob.size / 1024)}KB)`;
    setStatus("edit-status", "커버 업로드 완료. [저장]을 눌러야 앨범에 반영됩니다.", "ok");
  } catch (err) {
    statusEl.textContent = "";
    setStatus("edit-status", "업로드 실패: " + err.message, "err");
  }
});

// 큰 이미지는 최대 변 기준으로 축소 후 JPEG 재인코딩 (트래픽/로딩 최적화)
async function resizeImage(file, maxSize, quality) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error("이미지 변환 실패")),
      "image/jpeg",
      quality
    );
  });
}

function updateCoverPreview() {
  const v = $("f-cover").value.trim();
  const img = $("cover-preview");
  if (!v) {
    img.classList.add("hidden");
    img.removeAttribute("src");
    return;
  }
  img.src = v; // 상대 파일명(같은 저장소)과 전체 URL 모두 동작
  img.classList.remove("hidden");
  img.onerror = () => img.classList.add("hidden");
}

$("f-cover").addEventListener("input", updateCoverPreview);

// ---------- 유틸 ----------
// 영문 슬러그화: 소문자-하이픈 (예: "City Vibe (Remix)" → "city-vibe-remix")
function slugify(s) {
  return String(s || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function esc(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function escAttr(s) { return esc(s); }
