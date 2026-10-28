// Cloudflare Pages Function — /api/media (관리자 전용 음원 업로드·삭제, Cloudflare R2)
//   GET    /api/media                         → { r2: true|false }  (R2 바인딩 연결 여부, 공개)
//   PUT    /api/media?path=tracks/파일.mp3      → 본문(파일)을 R2에 저장 → { path: "r2:…", url }
//   DELETE /api/media?path=tracks/파일.mp3      → R2에서 삭제
// 인증: 관리자 페이지가 Firebase 로그인 ID 토큰을 Authorization: Bearer 로 보낸다.
//   이 토큰으로 Firestore REST에서 admins/{uid} 문서를 읽어 본다.
//   Firestore가 토큰 서명을 검증하고, 보안 규칙상 본인 문서만 읽을 수 있으므로
//   200 응답 = "유효한 토큰 + 관리자" 로 판단한다 (서비스 계정 키 불필요).
// R2 바인딩: Pages 프로젝트 설정 > Functions(바인딩)에서 변수 이름 MEDIA 로 버킷을 연결.

const PROJECT_ID = "rebroni-music-web";
const PUBLIC_ORIGIN = "https://music.rebroni.com";
const PATH_RE = /^(tracks|meditate)\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const EXT_TYPES = { mp3: "audio/mpeg", wav: "audio/wav", opus: "audio/ogg", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac" };
const MAX_BYTES = { tracks: 20 * 1024 * 1024, meditate: 50 * 1024 * 1024 };

// 관리자 페이지를 여는 곳 (운영 도메인, Pages 기본/미리보기 주소, 로컬 개발 서버)
function allowedOrigin(origin) {
  if (!origin) return null;
  if (origin === PUBLIC_ORIGIN) return origin;
  if (/^https:\/\/([a-z0-9-]+\.)?shincheolho-rebroni-discography\.pages\.dev$/.test(origin)) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

function cors(request) {
  const o = allowedOrigin(request.headers.get("Origin"));
  return o ? {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  } : { "Vary": "Origin" };
}

function json(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(request), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: cors(request) });
}

export async function onRequestGet({ request, env }) {
  return json(request, { r2: !!env.MEDIA });
}

export async function onRequestPut({ request, env }) {
  if (!env.MEDIA) return json(request, { error: "R2 바인딩(MEDIA)이 연결되지 않았습니다." }, 503);
  const auth = await requireAdmin(request);
  if (auth.error) return json(request, { error: auth.error }, auth.status);

  const path = new URL(request.url).searchParams.get("path") || "";
  const check = checkPath(path);
  if (check.error) return json(request, { error: check.error }, 400);

  const size = Number(request.headers.get("Content-Length"));
  if (!Number.isFinite(size) || size <= 0) return json(request, { error: "파일 크기(Content-Length)를 알 수 없습니다." }, 411);
  if (size > MAX_BYTES[check.folder]) {
    return json(request, { error: `파일이 너무 큽니다 (최대 ${MAX_BYTES[check.folder] / 1024 / 1024}MB).` }, 413);
  }

  await env.MEDIA.put(path, request.body, {
    httpMetadata: { contentType: check.type, cacheControl: "public, max-age=604800" },
    customMetadata: { uploadedBy: auth.uid, uploadedAt: new Date().toISOString() }
  });
  // ?v= 를 붙여 같은 이름으로 다시 올려도 브라우저 캐시가 새 파일을 받도록
  const url = `${PUBLIC_ORIGIN}/media/${path}?v=${Date.now().toString(36)}`;
  return json(request, { path: `r2:${path}`, url, size });
}

export async function onRequestDelete({ request, env }) {
  if (!env.MEDIA) return json(request, { error: "R2 바인딩(MEDIA)이 연결되지 않았습니다." }, 503);
  const auth = await requireAdmin(request);
  if (auth.error) return json(request, { error: auth.error }, auth.status);
  const path = new URL(request.url).searchParams.get("path") || "";
  if (!PATH_RE.test(path)) return json(request, { error: "잘못된 경로입니다." }, 400);
  await env.MEDIA.delete(path);
  return json(request, { ok: true });
}

function checkPath(path) {
  if (!PATH_RE.test(path) || path.includes("..")) return { error: "잘못된 경로입니다. (tracks/ 또는 meditate/ 아래 영문 파일명)" };
  const ext = (path.split(".").pop() || "").toLowerCase();
  const type = EXT_TYPES[ext];
  if (!type) return { error: "mp3 · wav · opus · ogg · m4a · aac 파일만 올릴 수 있습니다." };
  return { folder: path.split("/")[0], type };
}

function b64urlJson(part) {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0))));
}

async function requireAdmin(request) {
  const m = (request.headers.get("Authorization") || "").match(/^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
  if (!m) return { error: "로그인이 필요합니다.", status: 401 };
  const token = m[1];
  let payload;
  try { payload = b64urlJson(token.split(".")[1]); } catch (e) { return { error: "잘못된 토큰입니다.", status: 401 }; }
  // 빠른 사전 확인 (실제 서명 검증은 아래 Firestore가 수행)
  if (payload.aud !== PROJECT_ID || payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) return { error: "잘못된 토큰입니다.", status: 401 };
  if (!payload.exp || payload.exp * 1000 < Date.now()) return { error: "로그인이 만료되었습니다. 새로고침 후 다시 시도하세요.", status: 401 };
  const uid = payload.user_id || payload.sub;
  if (typeof uid !== "string" || !/^[A-Za-z0-9]{1,128}$/.test(uid)) return { error: "잘못된 토큰입니다.", status: 401 };

  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/admins/${uid}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 200) return { uid };
  if (res.status === 401) return { error: "로그인이 만료되었거나 유효하지 않습니다.", status: 401 };
  return { error: "관리자 권한이 없습니다.", status: 403 };
}
