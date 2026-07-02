// 앨범 데이터 로딩 계층
// 1순위: Firestore (설정이 완료된 경우)
// 2순위: albums.json (폴백 — Firebase 미설정, 네트워크 오류, 빈 컬렉션 등)

import { firebaseConfig } from "./firebase-config.js";

const FIREBASE_VER = "10.12.2";

export function firebaseConfigReady() {
  return !!(firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR_"));
}

async function loadFromFirestore() {
  const { initializeApp, getApps } = await import(
    `https://www.gstatic.com/firebasejs/${FIREBASE_VER}/firebase-app.js`
  );
  const { getFirestore, collection, getDocs } = await import(
    `https://www.gstatic.com/firebasejs/${FIREBASE_VER}/firebase-firestore.js`
  );

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const snap = await getDocs(collection(db, "albums"));
  if (snap.empty) throw new Error("Firestore albums collection is empty");

  const albums = snap.docs.map(d => ({ ...d.data(), id: d.id }));

  // 발매일 내림차순 (최신 앨범이 위로). order 필드가 있으면 우선 적용.
  albums.sort((a, b) => {
    const ao = a.order, bo = b.order;
    if (typeof ao === "number" && typeof bo === "number") return ao - bo;
    if (typeof ao === "number") return -1;
    if (typeof bo === "number") return 1;
    return String(b.release || "").localeCompare(String(a.release || ""));
  });
  return albums;
}

async function loadFromJson() {
  const res = await fetch("albums.json", {
    cache: "default",
    headers: { "Cache-Control": "max-age=3600" }
  });
  if (!res.ok) throw new Error("Failed to load albums.json");
  return res.json();
}

export async function loadAlbums() {
  if (firebaseConfigReady()) {
    try {
      return await loadFromFirestore();
    } catch (e) {
      console.warn("[data-service] Firestore 로드 실패 → albums.json 폴백:", e);
    }
  }
  return loadFromJson();
}
