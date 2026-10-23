// Cloudflare Pages Function — GET /api/tracks
// Firestore REST API로 albums 컬렉션을 읽어 audioUrl이 있는 곡만
// [{ url, titleKo, titleEn, released, unlisted }] 형태로 반환한다.
// (albums는 보안 규칙상 공개 읽기이므로 별도 인증 불필요)

const PROJECT_ID = "rebroni-music-web";
const API_KEY = "AIzaSyBp7Qaj1-JPTrVP7z7MfqXjQM7_ceW_muY"; // 웹용 공개 키 (비밀 아님)

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet() {
  try {
    const docs = await fetchAllAlbumDocs();
    const tracks = [];

    for (const d of docs) {
      const album = decodeFields(d.fields);
      const released = album.release || null; // 앨범 발매일 (YYYY-MM-DD)
      for (const t of album.tracks || []) {
        if (!t.audioUrl) continue;
        const { ko, en } = splitTitle(t.title || "");
        tracks.push({
          url: t.audioUrl,
          titleKo: ko,
          titleEn: en,
          released,
          unlisted: !!t.unlisted
        });
      }
    }

    return json(tracks, 200);
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}

async function fetchAllAlbumDocs() {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/albums`;
  let docs = [];
  let pageToken = "";
  do {
    const url = `${base}?pageSize=300&key=${API_KEY}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Firestore 응답 오류: ${res.status}`);
    const data = await res.json();
    docs = docs.concat(data.documents || []);
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return docs;
}

// Firestore REST 문서(fields) → 일반 JS 객체
function decodeValue(v) {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(decodeValue);
  if (v.mapValue !== undefined) return decodeFields(v.mapValue.fields);
  return null;
}

function decodeFields(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v);
  return out;
}

const HANGUL = /[가-힣ㄱ-ㆎ]/;

// 트랙 제목 → { ko, en }
// · 2집 이후 기본: "English (한국어)"  · 1집: "한국어 (English)" — 한글이 있는 쪽을 ko로 판정
// · "English (English)"(부제)·"English"(단일 제목)는 번역이 아니므로 ko/en 모두 원제목
// · 1집의 "-Original" 같은 꼬리 표기는 양쪽에 그대로 붙임
function splitTitle(title) {
  const full = title.trim();
  const m = full.match(/^(.+?)\s*-?\s*\((.+)\)\s*(-.*)?$/);
  if (m) {
    const a = m[1].trim(), b = m[2].trim(), tail = (m[3] || "").trim();
    const aKo = HANGUL.test(a), bKo = HANGUL.test(b);
    if (aKo !== bKo) {
      const [ko, en] = aKo ? [a, b] : [b, a];
      return { ko: ko + tail, en: en + tail };
    }
  }
  return { ko: full, en: full };
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60"
    }
  });
}
