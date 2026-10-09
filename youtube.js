// 유튜브 공용 도구 — 관리자 페이지, 영상(Videos) 페이지, 창작 노트가 함께 사용

export const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// 유튜브 주소(또는 영상 ID) → { id, isShort }. 알아볼 수 없으면 null
// 지원: watch?v=, youtu.be/, /shorts/, /live/, /embed/, music.youtube.com, m.youtube.com
export function parseYouTube(input) {
  const s = String(input || "").trim();
  if (YT_ID_RE.test(s)) return { id: s, isShort: false };
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  let id = null;
  let isShort = false;
  if (host === "youtu.be") {
    id = u.pathname.split("/")[1];
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = u.searchParams.get("v");
    const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/);
    if (!id && m) {
      id = m[2];
      isShort = m[1] === "shorts";
    }
  }
  return id && YT_ID_RE.test(id) ? { id, isShort } : null;
}

export function thumbUrl(id, quality = "hqdefault") {
  return `https://i.ytimg.com/vi/${id}/${quality}.jpg`;
}

export function watchUrl(id, isShort = false) {
  return isShort ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;
}

// 플레이어 주소 — 디스코그래피의 곡별 Play와 같은 방식(일반 youtube.com, 자동 재생 없음).
// 방문자가 플레이어의 재생 버튼을 직접 눌러야 유튜브 조회수로 집계됨
// (youtube-nocookie + 자동 재생 방식은 YouTube 스튜디오에서 조회수가 잡히지 않는 것을 확인함)
export function embedUrl(id) {
  return `https://www.youtube.com/embed/${id}?autoplay=0&rel=0&playsinline=1`;
}

// 처음에는 썸네일만 보여주고, 누르면 그 자리에 유튜브 플레이어를 불러옴 (재생은 플레이어에서 직접)
export function createLitePlayer(id, { isShort = false, title = "" } = {}) {
  const box = document.createElement("div");
  box.className = "yt-lite" + (isShort ? " yt-short" : "");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-label", `${title || "YouTube 영상"} 재생`);
  btn.style.backgroundImage = `url("${thumbUrl(id)}")`;
  btn.innerHTML = '<span class="yt-play-icon" aria-hidden="true"></span>';
  btn.addEventListener("click", () => {
    const iframe = document.createElement("iframe");
    iframe.src = embedUrl(id);
    iframe.title = title || "YouTube video player";
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    box.replaceChildren(iframe);
  }, { once: true });
  box.appendChild(btn);
  return box;
}

// 영상 제목 가져오기 (관리자 입력 편의용 — 실패하면 빈 문자열, 제목은 직접 입력)
export async function fetchYouTubeTitle(id) {
  const target = encodeURIComponent(`https://www.youtube.com/watch?v=${id}`);
  const endpoints = [
    `https://www.youtube.com/oembed?format=json&url=${target}`,
    `https://noembed.com/embed?url=${target}`
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (data && typeof data.title === "string" && data.title) return data.title;
    } catch { /* CORS·네트워크 오류 → 다음 방법 시도 */ }
  }
  return "";
}
