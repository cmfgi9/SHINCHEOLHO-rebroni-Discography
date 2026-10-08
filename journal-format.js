// 창작 노트 서식(HTML) 공용 모듈 — 관리자 편집기와 공개 Journal 페이지가 함께 사용
// 허용 목록에 있는 태그·속성만 남기고 나머지는 제거해 스크립트 삽입 등을 막는다.

// 태그 → 허용 속성
const ALLOWED = {
  P: [], DIV: [], BR: [],
  B: [], STRONG: [], I: [], EM: [], U: [], S: [], STRIKE: [],
  H3: [], H4: [], BLOCKQUOTE: [], UL: [], OL: [], LI: [],
  A: ["href"], SPAN: ["style"],
  FIGURE: ["data-kind"], FIGCAPTION: [], IMG: ["src", "alt"], AUDIO: ["src"]
};
// 내용까지 통째로 버리는 태그 (그 외 모르는 태그는 껍데기만 벗기고 내용은 유지)
const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "NOSCRIPT", "TEMPLATE",
  "SVG", "MATH", "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "LINK", "META", "VIDEO", "SOURCE", "TITLE", "HEAD"]);
// 붙여넣은 큰 제목은 소제목으로 맞춤
const RENAME = { H1: "H3", H2: "H3", H5: "H4", H6: "H4" };

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\))$/i;

function safeUrl(v, { allowMailto = false } = {}) {
  try {
    const u = new URL(v, location.href);
    if (u.protocol === "https:" || u.protocol === "http:") return u.href;
    if (allowMailto && u.protocol === "mailto:") return u.href;
  } catch { /* 잘못된 URL */ }
  return "";
}

// 인라인 style에서 글자색만 남김 (예: "color: rgb(255, 0, 0); font-size: 40px" → "color: rgb(255, 0, 0)")
function safeStyle(v) {
  const m = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(v || "");
  const c = m && m[1].trim();
  return c && COLOR_RE.test(c) ? `color: ${c}` : "";
}

function cleanNode(node, out, doc) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3) { // 텍스트
      out.appendChild(doc.createTextNode(child.nodeValue));
      continue;
    }
    if (child.nodeType !== 1) continue; // 주석 등 제거

    let tag = child.tagName.toUpperCase();
    if (DROP.has(tag)) continue;

    // 예전 방식의 <font color>는 <span style="color">로 변환
    if (tag === "FONT") {
      const style = safeStyle(`color: ${child.getAttribute("color") || ""}`);
      if (style) {
        const span = doc.createElement("span");
        span.setAttribute("style", style);
        cleanNode(child, span, doc);
        out.appendChild(span);
      } else {
        cleanNode(child, out, doc);
      }
      continue;
    }

    tag = RENAME[tag] || tag;
    if (!ALLOWED[tag]) { // 모르는 태그: 내용만 살림
      cleanNode(child, out, doc);
      continue;
    }

    const el = doc.createElement(tag);
    for (const name of ALLOWED[tag]) {
      const v = child.getAttribute(name);
      if (v == null) continue;
      let safe = v;
      if (name === "href") safe = safeUrl(v, { allowMailto: true });
      else if (name === "src") safe = safeUrl(v).startsWith("https:") ? safeUrl(v) : "";
      else if (name === "style") safe = safeStyle(v);
      else if (name === "data-kind") safe = ["image", "audio"].includes(v) ? v : "";
      else if (name === "alt") safe = v.slice(0, 200);
      if (safe) el.setAttribute(name, safe);
    }

    // 주소가 없는 사진/음원·링크, 색이 없는 span은 의미가 없으므로 정리
    if ((tag === "IMG" || tag === "AUDIO") && !el.getAttribute("src")) continue;
    if ((tag === "SPAN" && !el.getAttribute("style")) || (tag === "A" && !el.getAttribute("href"))) {
      cleanNode(child, out, doc);
      continue;
    }
    if (tag !== "IMG" && tag !== "AUDIO") cleanNode(child, el, doc);
    out.appendChild(el);
  }
}

// 신뢰할 수 없는 HTML 문자열 → 허용된 서식만 남은 HTML 문자열
export function sanitizeHtml(html) {
  // DOMParser로 만든 문서는 스크립트가 실행되지 않고 이미지도 로드되지 않음
  const src = new DOMParser().parseFromString(`<body>${html || ""}</body>`, "text/html");
  const doc = document.implementation.createHTMLDocument("");
  const root = doc.createElement("div");
  cleanNode(src.body, root, doc);
  return root.innerHTML.trim();
}

// 화면 표시용: 정리한 HTML에 링크 새 창 열기, 음원 컨트롤, 이미지 지연 로딩을 붙임
export function renderHtml(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = sanitizeHtml(html);
  tpl.content.querySelectorAll("a").forEach(a => {
    a.target = "_blank";
    a.rel = "noopener";
  });
  tpl.content.querySelectorAll("audio").forEach(a => {
    a.controls = true;
    a.preload = "none";
  });
  tpl.content.querySelectorAll("img").forEach(img => {
    img.loading = "lazy";
  });
  return tpl.content;
}

export function escapeHtml(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

// 서식 기능 이전에 작성된 일반 텍스트 본문 → 문단 HTML
export function plainToHtml(text) {
  return String(text || "").split(/\n{2,}/)
    .map(p => `<p>${escapeHtml(p).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

// 서식 HTML → 일반 텍스트 (검색·미리보기용)
export function htmlToText(html) {
  const d = new DOMParser().parseFromString(`<body>${sanitizeHtml(html)}</body>`, "text/html");
  d.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
  d.querySelectorAll("p, div, h3, h4, li, blockquote, figcaption").forEach(el => el.append("\n"));
  return d.body.textContent.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// HTML 안에서 참조 중인 Storage 경로 목록 (예: "journal/xxx.jpg")
export function storagePathsIn(html) {
  const paths = new Set();
  for (const m of String(html || "").matchAll(/\/o\/(journal%2F[^?"'\s&]+)/g)) {
    try { paths.add(decodeURIComponent(m[1])); } catch { /* 무시 */ }
  }
  return [...paths];
}
