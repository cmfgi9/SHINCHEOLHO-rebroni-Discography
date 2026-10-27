// Cloudflare Pages Function — GET /media/{tracks|meditate}/파일명
// Cloudflare R2 버킷(바인딩 이름 MEDIA)에 저장된 음원을 같은 도메인에서 내려준다.
// - <audio>가 보내는 Range 요청(부분 전송, 206)을 지원 → 탐색·스트리밍 가능
// - R2는 다운로드 트래픽 요금이 없다. 바인딩이 없으면 404
// 업로드·삭제는 /api/media (관리자 전용)

const ALLOWED = /^(tracks|meditate)\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;

const BASE_HEADERS = {
  "Access-Control-Allow-Origin": "*", // 공개 음원 (외부 게임 등 /api/tracks 이용처에서도 재생)
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag",
  "Accept-Ranges": "bytes",
  "X-Content-Type-Options": "nosniff"
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { ...BASE_HEADERS, "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Access-Control-Allow-Headers": "Range" }
  });
}

export async function onRequestHead(ctx) { return serve(ctx, true); }
export async function onRequestGet(ctx) { return serve(ctx, false); }

async function serve({ request, env, params }, headOnly) {
  const key = Array.isArray(params.path) ? params.path.join("/") : String(params.path || "");
  if (!env.MEDIA || !ALLOWED.test(key)) return notFound();

  if (headOnly) {
    const head = await env.MEDIA.head(key);
    if (!head) return notFound();
    const h = headersFor(head);
    h.set("Content-Length", String(head.size));
    return new Response(null, { status: 200, headers: h });
  }

  const rangeHeader = request.headers.get("Range");
  let obj;
  try {
    obj = await env.MEDIA.get(key, {
      range: rangeHeader ? request.headers : undefined,
      onlyIf: request.headers
    });
  } catch (e) {
    // 파일 크기를 벗어난 Range 등
    return new Response(null, { status: 416, headers: BASE_HEADERS });
  }
  if (!obj) return notFound();

  const h = headersFor(obj);
  // onlyIf 조건(If-None-Match 등)에 걸리면 본문 없이 반환됨
  if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers: h });

  if (rangeHeader && obj.range) {
    let offset = obj.range.offset ?? 0;
    let length = obj.range.length ?? obj.size - offset;
    if (obj.range.suffix !== undefined) { length = Math.min(obj.range.suffix, obj.size); offset = obj.size - length; }
    h.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    h.set("Content-Length", String(length));
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set("Content-Length", String(obj.size));
  return new Response(obj.body, { status: 200, headers: h });
}

function headersFor(obj) {
  const h = new Headers(BASE_HEADERS);
  obj.writeHttpMetadata(h);
  h.set("ETag", obj.httpEtag);
  // 관리자 업로드 URL에는 ?v=가 붙어 교체 시 주소가 바뀐다 → 길게 캐시
  h.set("Cache-Control", "public, max-age=604800");
  return h;
}

function notFound() {
  return new Response("Not found", { status: 404, headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}
