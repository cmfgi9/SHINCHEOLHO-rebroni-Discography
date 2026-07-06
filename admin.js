// 관리자 페이지: Google 로그인 + 앨범/트랙/링크 CRUD + albums.json 마이그레이션
import { firebaseConfig } from "./firebase-config.js";

const VER = "10.12.2";
const { initializeApp, getApps } = await import(`https://www.gstatic.com/firebasejs/${VER}/firebase-app.js`);
const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } =
  await import(`https://www.gstatic.com/firebasejs/${VER}/firebase-auth.js`);
const { getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch, query, orderBy, limit } =
  await import(`https://www.gstatic.com/firebasejs/${VER}/firebase-firestore.js`);
const { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } =
  await import(`https://www.gstatic.com/firebasejs/${VER}/firebase-storage.js`);

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

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
    <label>음원 파일 (mp3/wav, 곡당 최대 20MB)</label>
    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
      <input type="file" class="t-audio-file hidden" accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav">
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
    if (!["mp3", "wav"].includes(ext)) {
      audioStatus.textContent = "mp3 또는 wav 파일만 업로드할 수 있습니다.";
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
      await uploadBytes(storageRef, file, {
        contentType: ext === "mp3" ? "audio/mpeg" : "audio/wav"
      });
      const url = await getDownloadURL(storageRef);
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
    show("view-list");
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
