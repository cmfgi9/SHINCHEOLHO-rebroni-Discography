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

// "한국어 제목 (English Title)" → { ko, en }
function splitTitle(title) {
  const m = title.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (m) return { ko: m[1].trim(), en: m[2].trim() };
  return { ko: title.trim(), en: title.trim() };
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
