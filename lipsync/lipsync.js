/* Lip Sync — 캐릭터 이미지 + 입 모양 이미지 + 음원 + SRT 가사 → 노래하는 영상(MP4)
 *
 * - 가사(한글 자모·영문 철자)에서 음절별 입 모양(아·어·오·우·이·에·닫힘)을 정하고,
 *   줄 안의 음절 시간은 고르게 나눈 뒤 음원의 소리 시작점에 맞춘다.
 * - 화면은 기본 이미지 위에 입 영역(타원, 가장자리 흐림)만 입 모양 이미지로 바꿔 끼운다.
 * - 모든 장면은 시간 t만으로 결정된다(미리보기 = 결과).
 * - 렌더링은 Lofi와 같은 오프라인 방식: 프레임을 한 장씩 그려 Mediabunny(WebCodecs)로 인코딩.
 * - 파일은 브라우저 안에서만 처리하고 업로드하지 않는다.
 */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const MB_URL = "../visualizer/vendor/mediabunny.min.mjs";
  const STORE = "rebroni-lipsync-settings";
  const SR = 48000, ABITRATE = 192_000, ENV_HZ = 100;

  // ---------- 입 모양 ----------
  const SLOTS = [
    { id: "base", ko: "기본", en: "Base", kind: "base" },
    { id: "A", ko: "아", en: "A", kind: "mouth" },
    { id: "EO", ko: "어", en: "EO", kind: "mouth" },
    { id: "O", ko: "오", en: "O", kind: "mouth" },
    { id: "U", ko: "우", en: "U", kind: "mouth" },
    { id: "I", ko: "이", en: "I", kind: "mouth" },
    { id: "E", ko: "에", en: "E", kind: "mouth" },
    { id: "blink", ko: "눈 감음", en: "Blink", kind: "eyes" },
  ];
  const MOUTHS = SLOTS.filter((s) => s.kind === "mouth").map((s) => s.id);
  // 없는 모양은 왼쪽부터 가장 비슷한 모양으로 대신
  const FALLBACK = {
    A: ["A", "EO", "E", "O", "I", "U"],
    EO: ["EO", "A", "O", "E", "U", "I"],
    O: ["O", "U", "EO", "A", "E", "I"],
    U: ["U", "O", "EO", "A", "I", "E"],
    I: ["I", "E", "A", "EO", "U", "O"],
    E: ["E", "I", "A", "EO", "O", "U"],
  };
  // 파일 이름 끝 → 칸
  const NAME_MAP = {
    base: "base", rest: "base", closed: "base", close: "base", m: "base", "기본": "base", "닫힘": "base",
    a: "A", ah: "A", "아": "A",
    eo: "EO", uh: "EO", "어": "EO",
    o: "O", oh: "O", "오": "O",
    u: "U", oo: "U", "우": "U",
    i: "I", ee: "I", "이": "I",
    e: "E", eh: "E", "에": "E", "애": "E",
    blink: "blink", eyes: "blink", eye: "blink", "눈": "blink", "눈감음": "blink",
  };
  // 한글 중성(ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ) → 입 모양(이중모음은 두 개)
  const JUNG = [["A"], ["E"], ["A"], ["E"], ["EO"], ["E"], ["EO"], ["E"], ["O"], ["O", "A"], ["O", "E"], ["U", "E"], ["O"],
    ["U"], ["U", "EO"], ["U", "E"], ["U", "I"], ["U"], ["I"], ["I"], ["I"]];
  const CHO_LIP = new Set([6, 7, 8, 17]);   // ㅁ ㅂ ㅃ ㅍ
  const JONG_LIP = new Set([16, 17, 26]);   // ㅁ ㅂ ㅍ

  // ---------- 설정 ----------
  const cfg = {
    mouth: { x: 0.47, y: 0.53, rx: 0.17, ry: 0.075, feather: 0.5 },
    eyes: { x: 0.47, y: 0.385, rx: 0.21, ry: 0.04, feather: 0.5 },
    aspect: "9:16", res: 1080, fps: 30, quality: "std",
    zoom: 1, panX: 0, panY: 0,
    blend: 70, amp: 0.75, motion: 0.4, blink: true,
    offset: 0, snap: true,
    subs: true, subSize: 1, subY: 0.86, subColor: "#ffffff",
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (saved && typeof saved === "object") {
      for (const k of Object.keys(cfg)) {
        if (!(k in saved)) continue;
        if (typeof cfg[k] === "object") Object.assign(cfg[k], saved[k]);
        else if (typeof saved[k] === typeof cfg[k]) cfg[k] = saved[k];
      }
    }
  } catch (e) { /* ignore */ }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) { /* ignore */ } };

  // ---------- 상태 ----------
  const images = {};            // id → { img, w, h, name }
  let patches = {}, patchVer = 1; // 입·눈 영역만 잘라 가장자리를 흐린 조각
  let cues = [];                // [{ start, end, text }]
  let segs = [];                // [{ t0, t1, v }] 시간순, 겹치지 않음
  let sylCount = 0;
  let audioFile = null, audioBuf = null, env = null, onset = null;
  let editMode = "", forced = "";
  let dirty = true, rendering = false;
  const audio = $("#audio");
  const canvas = $("#stage"), pctx = canvas.getContext("2d");

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const fmtTime = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, "0")}`; };
  const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + " GB" : (b / 1e6).toFixed(0) + " MB");
  const makeCanvas = (w, h) => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }));

  // ---------- 가사 → 음절 → 입 모양 구간 ----------
  function parseTime(m) { return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+((m[4] || "0") + "00").slice(0, 3)) / 1000; }
  function parseCues(raw) {
    const out = [], lines = String(raw || "").replace(/\r/g, "").split("\n");
    const T = "(?:(\\d+):)?(\\d{1,2}):(\\d{2})(?:[.,](\\d{1,3}))?";
    const arrow = new RegExp("^\\s*" + T + "\\s*-->\\s*" + T);
    const lrc = /^\s*\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/;
    const clean = (s) => s.replace(/<[^>]*>/g, "").replace(/\{\\[^}]*\}/g, "").trim();
    for (let i = 0; i < lines.length; i++) {
      const m = arrow.exec(lines[i]);
      if (m) {
        const start = parseTime(m.slice(0, 5)), end = parseTime(m.slice(4, 9));
        const text = [];
        while (i + 1 < lines.length && lines[i + 1].trim() && !arrow.test(lines[i + 1])) {
          // 다음 자막의 번호 줄(숫자만, 그 뒤가 시간 줄)은 글자가 아님
          if (/^\s*\d+\s*$/.test(lines[i + 1]) && i + 2 < lines.length && arrow.test(lines[i + 2])) break;
          text.push(clean(lines[++i]));
        }
        const t = text.filter(Boolean).join("\n");
        if (t && end > start) out.push({ start, end, text: t });
        continue;
      }
      const l = lrc.exec(lines[i]);
      if (l) {
        const start = (+l[1]) * 60 + (+l[2]) + (+((l[3] || "0") + "00").slice(0, 3)) / 1000;
        out.push({ start, end: -1, text: clean(l[4]) });
      }
    }
    out.sort((a, b) => a.start - b.start);
    // 시간이 없는 줄(시작=끝)이 뒤 줄과 같은 시각에 몰려 있으면, 뒤 줄의 구간을 줄 수대로 고르게 나눔
    let fixed = 0;
    const zero = (c) => c.end >= 0 && c.end - c.start < 0.05;
    for (let i = 0; i < out.length; i++) {
      if (!zero(out[i])) continue;
      let j = i;
      while (j < out.length && zero(out[j]) && Math.abs(out[j].start - out[i].start) < 0.05) j++;
      if (j < out.length && Math.abs(out[j].start - out[i].start) < 0.05 && out[j].end - out[j].start > 0.5) {
        const s = out[i].start, e = out[j].end, n = j - i + 1;
        for (let k = i; k <= j; k++) { out[k].start = s + (e - s) * (k - i) / n; out[k].end = s + (e - s) * (k - i + 1) / n; }
        fixed += n - 1; i = j;
      }
    }
    for (let i = 0; i < out.length; i++) {
      const next = i + 1 < out.length ? out[i + 1].start : Infinity;
      if (out[i].end < 0) out[i].end = Math.min(next, out[i].start + 8); // LRC: 다음 줄 전까지
      if (out[i].end > next) out[i].end = next;                          // 겹침 방지
    }
    const res = out.filter((c) => c.text && c.end - c.start > 0.05);
    res.fixed = fixed;
    return res;
  }

  const EN_V = { a: "A", e: "E", i: "I", o: "O", u: "U", y: "I" };
  const EN_PAIR = { ai: "E", ay: "E", au: "O", aw: "O", ee: "I", ea: "I", oo: "U", ou: "U", ow: "O", oi: "O", oy: "O", ie: "I", ue: "U", ui: "U" };
  // 글 → 음절 단위 [{ on(입술 닫는 첫소리), v[입 모양], off(입술 닫는 끝소리), w(길이 비중) }]
  function unitsOf(text) {
    const units = [];
    const re = /[가-힣]|[A-Za-z']+|[぀-ヿ一-鿿]/g;
    let m;
    while ((m = re.exec(text))) {
      const tok = m[0], code = tok.charCodeAt(0);
      if (code >= 0xAC00 && code <= 0xD7A3) {
        const n = code - 0xAC00, cho = Math.floor(n / 588), jung = Math.floor((n % 588) / 28), jong = n % 28;
        units.push({ on: CHO_LIP.has(cho), v: JUNG[jung], off: JONG_LIP.has(jong), w: 1 });
      } else if (/[A-Za-z]/.test(tok)) {
        let w = tok.toLowerCase().replace(/'/g, "");
        if (!w) continue;
        // 끝의 묵음 e (love, time…)
        if (w.length > 2 && /[^aeiouy]e$/.test(w) && /[aeiouy]/.test(w.slice(0, -1))) w = w.slice(0, -1);
        const parts = w.match(/[^aeiouy]*[aeiouy]+/g);
        if (!parts) { units.push({ on: /^[mbp]/.test(w), v: ["EO"], off: false, w: 0.6 }); continue; }
        const tail = w.slice(parts.join("").length);
        parts.forEach((p, i) => {
          const vow = p.match(/[aeiouy]+$/)[0], cons = p.slice(0, p.length - vow.length);
          const v = EN_PAIR[vow.slice(0, 2)] || EN_V[vow[0]];
          units.push({ on: /[mbp]$/.test(cons), v: [v], off: i === parts.length - 1 && /^[mbp]/.test(tail), w: 1 });
        });
      } else {
        units.push({ on: false, v: ["A"], off: false, w: 1 }); // 그 밖의 글자는 한 음절로만 셈
      }
    }
    return units;
  }

  function buildSegs() {
    segs = []; sylCount = 0;
    const push = (t0, t1, v) => { if (t1 - t0 > 0.005) segs.push({ t0, t1, v }); };
    for (const c of cues) {
      const u = unitsOf(c.text);
      if (!u.length) continue;
      sylCount += u.length;
      const s = c.start + cfg.offset, e = c.end + cfg.offset;
      if (u.length > 1) u[u.length - 1].w *= 1.6; // 줄의 마지막 음절은 길게 끄는 편
      const total = u.reduce((a, x) => a + x.w, 0);
      const fr = [0];
      let acc = 0;
      for (const x of u) { acc += x.w; fr.push(acc / total); }
      const b = spread(fr, s, e);
      snapBounds(b);
      u.forEach((x, i) => {
        const a = b[i], z = b[i + 1], d = z - a;
        const p = x.on ? a + Math.min(0.06, d * 0.3) : a;
        // 끝소리가 입술소리면 닫고, 아니어도 음절 사이에 살짝 오므려 리듬이 보이게 함
        const q = z - (x.off ? Math.min(0.07, d * 0.3) : Math.min(0.03, d * 0.15));
        if (x.v.length === 2) {
          const mid = p + Math.min(0.1, (q - p) * 0.4);
          push(p, mid, x.v[0]); push(mid, q, x.v[1]);
        } else push(p, q, x.v[0]);
      });
    }
    dirty = true;
  }

  // 줄 구간 [s, e] 안에서 음절 경계(비율 fr)를 시간으로 바꿈.
  // 음원이 있으면 소리가 나는 곳에 음절이 몰리도록 음량 누적값을 따라 나눈다(조용한 구간에는 음절을 거의 두지 않음).
  function spread(fr, s, e) {
    const lin = fr.map((f) => s + (e - s) * f);
    if (!cfg.snap || !env) return lin;
    let i0 = Math.max(0, Math.floor(s * ENV_HZ)), i1 = Math.min(env.length, Math.ceil(e * ENV_HZ));
    if (i1 - i0 < 4) return lin;
    // 줄의 앞뒤에 소리가 거의 없는 구간(0.6초 평균 기준)이 길면 잘라 냄 — 마지막 음절을 반주·잔향만 남은 곳까지 끌지 않게
    const quiet = (k) => { let m = 0; for (let q = k; q < k + 60; q++) m += env[Math.min(i1 - 1, Math.max(i0, q))]; return m / 60 < 0.25; };
    let a = i0, z = i1;
    while (a < z - 60 && quiet(a)) a += 5;
    while (z > a + 60 && quiet(z - 60)) z -= 5;
    const minLen = Math.min(i1 - i0, 12 * (fr.length - 1)); // 음절당 0.12초는 남김
    if (z - a >= minLen) {
      if (a - i0 > 30) { i0 = a; s = i0 / ENV_HZ; }
      if (i1 - z > 30) { i1 = Math.min(i1, z + 25); e = Math.min(e, i1 / ENV_HZ); }
    }
    const cum = new Float32Array(i1 - i0 + 1);
    for (let i = i0; i < i1; i++) cum[i - i0 + 1] = cum[i - i0] + 0.06 + Math.max(0, env[i] - 0.12);
    const total = cum[cum.length - 1];
    let j = 0;
    return fr.map((f, k) => {
      if (k === 0) return s;
      if (k === fr.length - 1) return e;
      const target = f * total;
      while (j < cum.length - 2 && cum[j + 1] < target) j++;
      const t = (i0 + j + (target - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j])) / ENV_HZ;
      return Math.min(e, Math.max(s, t));
    });
  }

  // 음절 경계를 가까운 소리 시작점으로 옮김
  function snapBounds(b) {
    if (!cfg.snap || !onset) return;
    for (let i = 1; i < b.length - 1; i++) {
      const win = Math.min(0.12, (b[i + 1] - b[i - 1]) * 0.2);
      const i0 = Math.max(0, Math.round((b[i] - win) * ENV_HZ)), i1 = Math.min(onset.length - 1, Math.round((b[i] + win) * ENV_HZ));
      let best = -1, bv = 0.06;
      for (let j = i0; j <= i1; j++) if (onset[j] > bv) { bv = onset[j]; best = j; }
      if (best >= 0) {
        const t = best / ENV_HZ;
        if (t > b[i - 1] + 0.05 && t < b[i + 1] - 0.05) b[i] = t;
      }
    }
  }

  // ---------- 음원 분석 (음량 곡선 · 소리 시작점) ----------
  function analyze(buf) {
    const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const hop = Math.round(buf.sampleRate / ENV_HZ), n = Math.floor(L.length / hop);
    const raw = new Float32Array(n);
    // 목소리 대역(약 250Hz~3kHz)만 대강 걸러 음량을 잼
    const aH = Math.exp(-2 * Math.PI * 250 / buf.sampleRate), aL = Math.exp(-2 * Math.PI * 3000 / buf.sampleRate);
    let lpH = 0, lp = 0;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = i * hop, e = j + hop; j < e; j++) {
        const x = (L[j] + R[j]) * 0.5;
        lpH = aH * lpH + (1 - aH) * x;          // 저역
        lp = aL * lp + (1 - aL) * (x - lpH);    // 저역을 뺀 뒤 고역을 깎음
        sum += lp * lp;
      }
      raw[i] = Math.sqrt(sum / hop);
    }
    const sorted = Float32Array.from(raw).sort();
    const lo = sorted[Math.floor(n * 0.1)] || 0, hi = Math.max(sorted[Math.floor(n * 0.95)] || 0, lo + 1e-5);
    const e = new Float32Array(n), o = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = clamp01((raw[i] - lo) / (hi - lo));
    // 조용한 절에서도 입이 움직이도록 주변 ±2.5초의 최댓값에 견줘 다시 맞춤 (곡 전체에서 아주 작은 소리는 키우지 않음)
    const BW = 50, nb = Math.ceil(n / BW), blockMax = new Float32Array(nb);
    for (let i = 0; i < n; i++) { const k = (i / BW) | 0; if (raw[i] > blockMax[k]) blockMax[k] = raw[i]; }
    let s = 0;
    for (let i = 0; i < n; i++) {
      const k = (i / BW) | 0;
      let peak = 0.2;
      for (let q = Math.max(0, k - 5); q <= Math.min(nb - 1, k + 5); q++) if (blockMax[q] > peak) peak = blockMax[q];
      const v = Math.min(1, raw[i] / peak);
      raw[i] = v;
      s += (v - s) * (v > s ? 0.6 : 0.15);      // 빠르게 열리고 천천히 닫힘
      e[i] = s;
      o[i] = i >= 2 ? Math.max(0, v - raw[i - 2]) : 0;
    }
    env = e; onset = o;
  }
  function envAt(t) {
    if (!env) return 0.6;
    const x = t * ENV_HZ, i = Math.floor(x);
    if (i < 0 || i >= env.length - 1) return 0;
    return env[i] + (env[i + 1] - env[i]) * (x - i);
  }

  // ---------- 입 모양 비중 ----------
  let resolveMap = {};
  function rebuildResolve() {
    resolveMap = {};
    for (const id of MOUTHS) resolveMap[id] = FALLBACK[id].find((x) => images[x]) || null;
  }
  const wTmp = {};
  function mouthWeights(t) {
    for (const k of MOUTHS) wTmp[k] = 0;
    if (forced && forced !== "blink") { if (images[forced]) wTmp[forced] = 1; return wTmp; }
    if (!segs.length) {
      // 가사가 없으면 음량에 따라 여닫기만
      if (env && resolveMap.A) wTmp[resolveMap.A] = clamp01((envAt(t) - 0.25) / 0.45);
      return wTmp;
    }
    const x = Math.max(0.02, cfg.blend / 1000);
    let lo = 0, hi = segs.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (segs[m].t1 < t - x) lo = m + 1; else hi = m; }
    const k = 1 - cfg.amp * (1 - Math.sqrt(clamp01((envAt(t) - 0.03) / 0.3)));
    for (let i = lo; i < segs.length && segs[i].t0 <= t + x; i++) {
      const s = segs[i], id = resolveMap[s.v];
      if (!id) continue;
      const w = clamp01((t - s.t0) / x + 0.5) - clamp01((t - s.t1) / x + 0.5);
      if (w > 0) wTmp[id] += w * k;
    }
    return wTmp;
  }
  function blinkAt(t) {
    if (forced === "blink") return 1;
    if (forced || !cfg.blink || !images.blink) return 0;
    const P = 3.7, k = Math.floor(t / P);
    const c = k * P + 0.3 + hash(k) * (P - 0.6);
    const w = clamp01(1 - Math.abs(t - c) / 0.13);
    return w * w * (3 - 2 * w);
  }

  // ---------- 그리기 ----------
  function getPatch(id, r) {
    const im = images[id], b = images.base;
    if (!im || !b) return null;
    let p = patches[id];
    if (p && p.ver === patchVer) return p;
    const w = Math.max(2, Math.round(r.rx * 2 * b.w)), h = Math.max(2, Math.round(r.ry * 2 * b.h));
    const x = Math.round(r.x * b.w - w / 2), y = Math.round(r.y * b.h - h / 2);
    const c = makeCanvas(w, h), g = c.getContext("2d");
    const kx = im.w / b.w, ky = im.h / b.h; // 크기가 다른 이미지는 기본 이미지에 맞춰 늘림
    g.drawImage(im.img, x * kx, y * ky, w * kx, h * ky, 0, 0, w, h);
    if (id !== "base") matchTone(g, b, x, y, w, h);
    g.globalCompositeOperation = "destination-in";
    g.translate(w / 2, h / 2); g.scale(w / 2, h / 2);
    const gr = g.createRadialGradient(0, 0, Math.max(0, 1 - r.feather), 0, 0, 1);
    gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(0.5, "rgba(0,0,0,.6)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(-1, -1, 2, 2);
    p = patches[id] = { ver: patchVer, c, x, y, w, h };
    return p;
  }

  // 입 모양 이미지를 통째로 다시 생성하면 색감·밝기가 기본 이미지와 조금 달라 조각 테두리가 비친다.
  // 영역 가장자리 띠(타원 반지름 70~100%)의 평균 색을 기본 이미지와 같게 맞춘다.
  function matchTone(g, b, x, y, w, h) {
    let src, ref;
    try {
      const c = makeCanvas(w, h), cg = c.getContext("2d", { willReadFrequently: true });
      cg.drawImage(b.img, x, y, w, h, 0, 0, w, h);
      ref = cg.getImageData(0, 0, w, h).data;
      src = g.getImageData(0, 0, w, h);
    } catch (e) { return; }
    const d = src.data, sum = [0, 0, 0], sumRef = [0, 0, 0];
    let n = 0;
    for (let j = 0; j < h; j += 2) {
      const ny = (j + 0.5) / h * 2 - 1;
      for (let i = 0; i < w; i += 2) {
        const nx = (i + 0.5) / w * 2 - 1, r2 = nx * nx + ny * ny;
        if (r2 < 0.49 || r2 > 1) continue;
        const k = (j * w + i) * 4;
        if (d[k + 3] < 255) continue; // 이미지 밖
        sum[0] += d[k]; sum[1] += d[k + 1]; sum[2] += d[k + 2];
        sumRef[0] += ref[k]; sumRef[1] += ref[k + 1]; sumRef[2] += ref[k + 2];
        n++;
      }
    }
    if (n < 20) return;
    const gain = [0, 1, 2].map((c) => Math.max(0.7, Math.min(1.4, sumRef[c] / Math.max(1, sum[c]))));
    if (gain.every((v) => Math.abs(v - 1) < 0.004)) return; // 같은 색감이면 그대로
    for (let k = 0; k < d.length; k += 4) { d[k] *= gain[0]; d[k + 1] *= gain[1]; d[k + 2] *= gain[2]; }
    g.putImageData(src, 0, 0);
  }

  // 이미지 → 화면 변환 (cover + 확대·위치)
  function layout(W, H) {
    const b = images.base, s = Math.max(W / b.w, H / b.h) * cfg.zoom;
    const dw = b.w * s, dh = b.h * s;
    return { s, dx: (W - dw) / 2 - cfg.panX * (dw - W) / 2, dy: (H - dh) / 2 - cfg.panY * (dh - H) / 2 };
  }

  function wrapLines(g, text, maxW) {
    const out = [];
    for (const para of text.split("\n")) {
      let line = "";
      for (const word of para.split(/(\s+)/)) {
        if (g.measureText(line + word).width <= maxW || !line.trim()) {
          line += word;
          // 한 단어가 너무 길면 글자 단위로 자름
          while (g.measureText(line).width > maxW && line.length > 1) {
            let n = line.length - 1;
            while (n > 1 && g.measureText(line.slice(0, n)).width > maxW) n--;
            out.push(line.slice(0, n)); line = line.slice(n);
          }
        } else { out.push(line.trim()); line = word.trim() ? word : ""; }
      }
      if (line.trim()) out.push(line.trim());
    }
    return out;
  }
  function cueAt(t) {
    let lo = 0, hi = cues.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cues[m].end + cfg.offset <= t) lo = m + 1; else hi = m; }
    const c = cues[lo];
    return c && c.start + cfg.offset <= t ? c : null;
  }

  // 한 프레임 그리기. still: 영역 맞추기(움직임·자막 없음)
  function drawFrame(g, W, H, t, still) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    const b = images.base;
    if (!b) {
      g.fillStyle = "#9a9ab0"; g.textAlign = "center"; g.textBaseline = "middle";
      g.font = `${Math.round(Math.min(W, H) * 0.045)}px sans-serif`;
      g.fillText("캐릭터 이미지를 넣어 주세요", W / 2, H / 2 - Math.min(W, H) * 0.04);
      g.fillText("Add a character image", W / 2, H / 2 + Math.min(W, H) * 0.04);
      return;
    }
    const L = layout(W, H), m = still ? 0 : cfg.motion;
    g.save();
    if (m > 0) {
      // 숨쉬듯 아주 느린 확대·기울임·흔들림 (가장자리가 드러나지 않을 만큼만)
      const z = 1 + m * (0.05 + 0.012 * Math.sin(t * 0.5) + 0.006 * envAt(t));
      g.translate(W / 2 + m * W * 0.008 * Math.sin(t * 0.29), H / 2 + m * H * 0.005 * Math.sin(t * 0.83 + 0.5));
      g.rotate(m * 0.006 * Math.sin(t * 0.37 + 1.3));
      g.scale(z, z);
      g.translate(-W / 2, -H / 2);
    }
    g.translate(L.dx, L.dy); g.scale(L.s, L.s);
    g.drawImage(b.img, 0, 0, b.w, b.h);

    const bw = blinkAt(t);
    if (bw > 0.01) {
      const p = getPatch("blink", cfg.eyes);
      if (p) { g.globalAlpha = bw; g.drawImage(p.c, p.x, p.y); }
    }
    // 여러 모양이 섞일 때 합이 정확히 비중대로 되도록 순서대로 덧그림
    const w = mouthWeights(t);
    let total = 0;
    for (const id of MOUTHS) total += w[id];
    if (total > 0.01) {
      const T = Math.min(1, total);
      let acc = 0, first = true;
      for (const id of MOUTHS) {
        if (w[id] <= 0.004) continue;
        const p = getPatch(id, cfg.mouth);
        if (!p) continue;
        acc += w[id];
        g.globalAlpha = first ? T : w[id] / acc;
        first = false;
        g.drawImage(p.c, p.x, p.y);
      }
    }
    g.globalAlpha = 1;

    if (still && editMode) {
      const r = cfg[editMode];
      g.lineWidth = 2 / L.s;
      g.strokeStyle = "#00e5ff";
      g.beginPath(); g.ellipse(r.x * b.w, r.y * b.h, r.rx * b.w, r.ry * b.h, 0, 0, Math.PI * 2); g.stroke();
      g.setLineDash([6 / L.s, 6 / L.s]);
      g.strokeStyle = "rgba(255,255,255,.7)";
      const k = Math.max(0.02, 1 - r.feather);
      g.beginPath(); g.ellipse(r.x * b.w, r.y * b.h, r.rx * b.w * k, r.ry * b.h * k, 0, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
    }
    g.restore();

    if (!still && cfg.subs && cues.length) {
      const c = cueAt(t);
      if (c) {
        const s = c.start + cfg.offset, e = c.end + cfg.offset;
        const a = clamp01(Math.min((t - s) / 0.15, (e - t) / 0.15));
        const fs = Math.round(Math.min(W, H) * 0.058 * cfg.subSize);
        g.font = `700 ${fs}px "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
        g.textAlign = "center"; g.textBaseline = "middle";
        g.lineJoin = "round"; g.lineWidth = fs * 0.18;
        const lines = wrapLines(g, c.text, W * 0.88), lh = fs * 1.3;
        let y = H * cfg.subY - (lines.length - 1) * lh / 2;
        y = Math.max(fs, Math.min(H - fs - (lines.length - 1) * lh, y));
        g.globalAlpha = a;
        for (const line of lines) {
          g.strokeStyle = "rgba(0,0,0,.78)"; g.strokeText(line, W / 2, y);
          g.fillStyle = cfg.subColor; g.fillText(line, W / 2, y);
          y += lh;
        }
        g.globalAlpha = 1;
      }
    }
  }

  // ---------- 미리보기 ----------
  function outSize() {
    const s = cfg.res, l = Math.round(s * 16 / 9 / 2) * 2;
    return cfg.aspect === "16:9" ? [l, s] : cfg.aspect === "1:1" ? [s, s] : [s, l];
  }
  function applyAspect() {
    const [w, h] = cfg.aspect === "16:9" ? [1280, 720] : cfg.aspect === "1:1" ? [900, 900] : [720, 1280];
    canvas.width = w; canvas.height = h;
    const box = $("#stage-box"), lay = $("#layout");
    box.classList.toggle("r169", cfg.aspect === "16:9"); box.classList.toggle("r11", cfg.aspect === "1:1");
    lay.classList.toggle("wide", cfg.aspect === "16:9"); lay.classList.toggle("square", cfg.aspect === "1:1");
    dirty = true;
  }
  function loop() {
    requestAnimationFrame(loop);
    if (rendering) return;
    const playing = !audio.paused && !audio.ended;
    if (!dirty && !playing) return;
    dirty = false;
    const t = audio.currentTime || 0;
    drawFrame(pctx, canvas.width, canvas.height, t, !!editMode && !playing);
    if (playing || document.activeElement !== $("#seek")) $("#seek").value = t;
    $("#cur").textContent = fmtTime(t);
  }

  // 영역 위치: 미리보기를 누르거나 끌어서 옮김
  function pointerToRegion(ev) {
    const b = images.base;
    if (!b || !editMode) return;
    const r = canvas.getBoundingClientRect(), W = canvas.width, H = canvas.height, L = layout(W, H);
    const px = (ev.clientX - r.left) / r.width * W, py = (ev.clientY - r.top) / r.height * H;
    const reg = cfg[editMode];
    reg.x = clamp01((px - L.dx) / L.s / b.w); reg.y = clamp01((py - L.dy) / L.s / b.h);
    regionChanged();
  }
  let dragging = false;
  canvas.addEventListener("pointerdown", (e) => { if (!editMode) return; dragging = true; canvas.setPointerCapture(e.pointerId); audio.pause(); pointerToRegion(e); });
  canvas.addEventListener("pointermove", (e) => { if (dragging) pointerToRegion(e); });
  const endDrag = () => { if (dragging) { dragging = false; save(); } };
  canvas.addEventListener("pointerup", endDrag); canvas.addEventListener("pointercancel", endDrag);

  let thumbTimer = 0;
  function regionChanged() {
    patchVer++; dirty = true;
    clearTimeout(thumbTimer); thumbTimer = setTimeout(drawThumbs, 120);
  }

  // ---------- 이미지 칸 ----------
  function buildSlots() {
    const box = $("#slots");
    box.innerHTML = "";
    for (const s of SLOTS) {
      const el = document.createElement("div");
      el.className = "slot"; el.dataset.id = s.id;
      el.innerHTML = `<label><div class="thumb"><canvas width="160" height="120" hidden></canvas><span class="plus">＋</span></div>
        <span class="name">${s.ko} <small>${s.en}</small></span><input type="file" accept="image/*" hidden></label>
        <div class="slot-btns"><button type="button" class="see" disabled>보기</button><button type="button" class="del" aria-label="${s.ko} 이미지 제거" disabled>✕</button></div>`;
      el.querySelector("input").addEventListener("change", async (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) { await setImage(s.id, f); refreshSlots(); } });
      el.querySelector(".see").addEventListener("click", () => { forced = forced === s.id ? "" : s.id; audio.pause(); refreshSlots(); dirty = true; });
      el.querySelector(".del").addEventListener("click", () => { removeImage(s.id); refreshSlots(); });
      if (s.id === "base") el.querySelector(".see").hidden = true;
      box.appendChild(el);
    }
  }
  function drawThumbs() {
    for (const s of SLOTS) {
      const el = $(`.slot[data-id="${s.id}"]`), im = images[s.id], cv = el.querySelector("canvas");
      cv.hidden = !im; el.querySelector(".plus").hidden = !!im;
      if (!im) continue;
      const g = cv.getContext("2d");
      g.fillStyle = "#000"; g.fillRect(0, 0, 160, 120);
      let sx = 0, sy = 0, sw = im.w, sh = im.h;
      if (s.kind !== "base") {
        // 입·눈 영역 둘레만 크게 보여 줌
        const r = cfg[s.kind];
        sw = Math.min(im.w, r.rx * 2 * im.w * 1.5); sh = Math.min(im.h, r.ry * 2 * im.h * 1.5);
        if (sw / sh > 4 / 3) sh = sw * 3 / 4; else sw = sh * 4 / 3;
        sx = r.x * im.w - sw / 2; sy = r.y * im.h - sh / 2;
        g.drawImage(im.img, sx, sy, sw, sh, 0, 0, 160, 120);
      } else {
        const k = Math.min(160 / sw, 120 / sh);
        g.drawImage(im.img, (160 - sw * k) / 2, (120 - sh * k) / 2, sw * k, sh * k);
      }
    }
  }
  function refreshSlots() {
    for (const s of SLOTS) {
      const el = $(`.slot[data-id="${s.id}"]`), has = !!images[s.id];
      el.classList.toggle("filled", has);
      el.classList.toggle("forced", forced === s.id);
      el.querySelector(".see").disabled = !has || !images.base;
      el.querySelector(".del").disabled = !has;
      el.querySelector(".see").textContent = forced === s.id ? "보는 중" : "보기";
    }
    drawThumbs();
    const have = MOUTHS.filter((id) => images[id]);
    const names = (ids) => ids.map((id) => SLOTS.find((s) => s.id === id).ko).join("·");
    let msg = "";
    if (!images.base) msg = "먼저 [기본] 이미지(입을 다문 정면)를 넣어 주세요.";
    else if (!have.length) msg = "입 모양 이미지를 한 장 이상 넣어 주세요. [아]만 있어도 동작합니다.";
    else {
      const miss = MOUTHS.filter((id) => !images[id]);
      msg = `입 모양 ${have.length}/6` + (miss.length ? ` · 없는 모양(${names(miss)})은 비슷한 모양으로 대신합니다.` : " · 모두 준비됐어요.");
      const b = images.base, odd = SLOTS.filter((s) => images[s.id] && Math.abs(images[s.id].w / images[s.id].h - b.w / b.h) > 0.01).map((s) => s.id);
      if (odd.length) msg += ` ⚠ 기본 이미지와 비율이 다른 이미지: ${names(odd)}`;
    }
    $("#slot-info").textContent = msg;
    updateButtons();
  }
  async function setImage(id, file) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch (e) { alert(`이미지를 열 수 없습니다: ${file.name}`); return; }
    if (images[id] && images[id].img.close) images[id].img.close();
    images[id] = { img: bmp, w: bmp.width, h: bmp.height, name: file.name };
    patchVer++; rebuildResolve(); dirty = true;
  }
  function removeImage(id) {
    if (!images[id]) return;
    if (images[id].img.close) images[id].img.close();
    delete images[id];
    if (forced === id) forced = "";
    patchVer++; rebuildResolve(); dirty = true;
  }
  async function addImages(files) {
    const skipped = [];
    for (const f of files) {
      if (!/^image\//.test(f.type)) continue;
      const stem = f.name.replace(/\.[^.]+$/, "").toLowerCase();
      const toks = stem.split(/[\s_\-.()\[\]]+/).filter(Boolean);
      let id = NAME_MAP[toks[toks.length - 1]] || (toks.length === 1 ? null : NAME_MAP[toks[0]]);
      if (!id && !images.base) id = "base";
      if (!id) { skipped.push(f.name); continue; }
      await setImage(id, f);
    }
    refreshSlots();
    if (skipped.length) alert("어느 칸인지 알 수 없는 파일은 넣지 않았습니다. 해당 칸을 눌러 직접 넣어 주세요:\n" + skipped.join("\n"));
  }

  // ---------- 음원·가사 ----------
  async function setAudio(file) {
    audioFile = file; audioBuf = null; env = null; onset = null;
    if (audio.src) URL.revokeObjectURL(audio.src);
    audio.src = URL.createObjectURL(file);
    $("#now-title").textContent = file.name;
    $("#song-info").textContent = `${file.name} · 분석 중…`;
    updateButtons();
    try {
      const data = await file.arrayBuffer();
      const buf = await new OfflineAudioContext(2, SR, SR).decodeAudioData(data);
      if (audioFile !== file) return;
      audioBuf = buf;
      analyze(buf);
      buildSegs();
      $("#song-info").textContent = `${file.name} · ${fmtTime(buf.duration)}`;
    } catch (e) {
      console.error(e);
      if (audioFile === file) { audioFile = null; $("#song-info").textContent = "이 음원 파일을 열 수 없습니다. 다른 형식(WAV·MP3·M4A)으로 시도해 주세요."; }
    }
    updateButtons();
  }
  function lyricsChanged() {
    cues = parseCues($("#lyrics").value);
    buildSegs();
    const raw = $("#lyrics").value.trim();
    $("#lyrics-info").textContent = cues.length
      ? `가사 ${cues.length}줄 · 음절 ${sylCount}개 · ${fmtTime(cues[0].start)} ~ ${fmtTime(cues[cues.length - 1].end)}`
        + (cues.fixed ? ` · ⚠ 시간이 없는 줄 ${cues.fixed}개는 바로 뒤 줄의 구간을 고르게 나눠 배치했습니다(정확히 하려면 시간을 고쳐 주세요).` : "")
      : raw ? "시간 정보를 찾지 못했습니다. SRT(00:00:12,300 --> 00:00:16,800) 또는 LRC([00:12.30]) 형식이어야 합니다." : "";
    updateButtons();
  }
  async function addSongFiles(files) {
    for (const f of files) {
      if (/\.(srt|vtt|lrc|txt)$/i.test(f.name)) { $("#lyrics").value = await f.text(); lyricsChanged(); }
      else if (/^audio\//.test(f.type) || /\.(wav|flac|mp3|m4a|aac|ogg|opus)$/i.test(f.name)) await setAudio(f);
    }
  }

  // ---------- 조작 ----------
  function updateButtons() {
    const ready = !!images.base && MOUTHS.some((id) => images[id]) && !!audioBuf;
    $("#render-btn").disabled = !ready || rendering;
    $("#play-btn").disabled = !audioFile;
    $("#seek").disabled = !audioFile;
    const [W, H] = outSize();
    const need = [];
    if (!images.base) need.push("기본 이미지"); else if (!MOUTHS.some((id) => images[id])) need.push("입 모양 이미지");
    if (!audioFile) need.push("음원"); else if (!audioBuf) need.push("음원 분석 완료");
    $("#render-estimate").textContent = ready
      ? `예상: ${fmtTime(audioBuf.duration)} · ${W}×${H} ${cfg.fps}fps · 약 ${fmtSize((vBitrate() + ABITRATE) * audioBuf.duration / 8)}` + (cues.length ? "" : " · 가사 없음(음량으로만 입을 움직임)")
      : `필요: ${need.join(", ")}`;
  }
  const vBitrate = () => ({ std: { 720: 3_500_000, 1080: 6_000_000 }, high: { 720: 6_000_000, 1080: 10_000_000 } })[cfg.quality][cfg.res];

  function bindRange(id, obj, key, fmt, after) {
    const el = $("#" + id), out = $("#" + id + "-out");
    el.value = obj[key];
    const show = () => { if (out) out.textContent = fmt(+el.value); };
    show();
    el.addEventListener("input", () => { obj[key] = +el.value; show(); dirty = true; if (after) after(); });
    el.addEventListener("change", save);
  }
  function bindSeg(id, key, parse, after) {
    const box = $("#" + id);
    const show = () => box.querySelectorAll("button").forEach((b) => b.classList.toggle("on", parse(b.dataset.v) === cfg[key]));
    show();
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      cfg[key] = parse(b.dataset.v); show(); save(); dirty = true; if (after) after();
    });
  }
  function bindCheck(id, key, after) {
    const el = $("#" + id);
    el.checked = !!cfg[key];
    el.addEventListener("change", () => { cfg[key] = el.checked; save(); dirty = true; if (after) after(); });
  }
  const pct = (v) => Math.round(v * 100) + "%";

  function init() {
    buildSlots(); refreshSlots(); applyAspect();

    document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === tab));
      document.querySelectorAll(".tabpane").forEach((p) => p.classList.toggle("active", p.dataset.pane === tab.dataset.tab));
    }));

    bindRange("m-rx", cfg.mouth, "rx", pct, regionChanged);
    bindRange("m-ry", cfg.mouth, "ry", pct, regionChanged);
    bindRange("m-feather", cfg.mouth, "feather", pct, regionChanged);
    bindRange("e-rx", cfg.eyes, "rx", pct, regionChanged);
    bindRange("e-ry", cfg.eyes, "ry", pct, regionChanged);
    bindRange("offset", cfg, "offset", (v) => (v > 0 ? "+" : "") + v.toFixed(2) + "초", buildSegs);
    bindRange("blend", cfg, "blend", (v) => v + "ms");
    bindRange("amp", cfg, "amp", pct);
    bindRange("motion", cfg, "motion", pct);
    bindRange("zoom", cfg, "zoom", (v) => "×" + v.toFixed(2));
    bindRange("panx", cfg, "panX", (v) => v.toFixed(2));
    bindRange("pany", cfg, "panY", (v) => v.toFixed(2));
    bindRange("subsize", cfg, "subSize", pct);
    bindRange("suby", cfg, "subY", pct);
    bindCheck("snap", "snap", buildSegs);
    bindCheck("blink", "blink");
    bindCheck("subs", "subs");
    $("#subcolor").value = cfg.subColor;
    $("#subcolor").addEventListener("input", (e) => { cfg.subColor = e.target.value; dirty = true; save(); });
    bindSeg("aspect", "aspect", String, () => { applyAspect(); updateButtons(); });
    bindSeg("res", "res", Number, updateButtons);
    bindSeg("fps", "fps", Number, updateButtons);
    bindSeg("quality", "quality", String, updateButtons);

    $("#edit-mode").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      editMode = b.dataset.v;
      $("#edit-mode").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      $("#mouth-opts").hidden = editMode === "eyes"; $("#eyes-opts").hidden = editMode !== "eyes";
      canvas.classList.toggle("editing", !!editMode);
      if (editMode) audio.pause();
      dirty = true;
    });

    $("#multi-input").addEventListener("change", (e) => { const f = [...e.target.files]; e.target.value = ""; addImages(f); });
    $("#song-input").addEventListener("change", (e) => { const f = [...e.target.files]; e.target.value = ""; addSongFiles(f); });
    for (const [zone, fn] of [[$("#multi-drop"), addImages], [$("#song-drop"), addSongFiles]]) {
      zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
      zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("dragover"); fn([...e.dataTransfer.files]); });
    }
    let lt = 0;
    $("#lyrics").addEventListener("input", () => { clearTimeout(lt); lt = setTimeout(lyricsChanged, 300); });

    $("#play-btn").addEventListener("click", () => {
      if (audio.paused) { forced = ""; refreshSlots(); audio.play().catch(() => {}); } else audio.pause();
    });
    audio.addEventListener("play", () => { $("#play-btn").textContent = "⏸"; });
    audio.addEventListener("pause", () => { $("#play-btn").textContent = "▶"; dirty = true; });
    audio.addEventListener("ended", () => { $("#play-btn").textContent = "▶"; });
    audio.addEventListener("loadedmetadata", () => { $("#seek").max = audio.duration || 0; $("#dur").textContent = fmtTime(audio.duration); });
    audio.addEventListener("seeked", () => { dirty = true; });
    $("#seek").addEventListener("input", (e) => { audio.currentTime = +e.target.value; dirty = true; });

    const ok = typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined";
    const badge = $("#env-badge");
    badge.textContent = ok ? "MP4 인코딩 가능" : "인코딩 미지원 브라우저";
    badge.classList.add(ok ? "ok" : "warn");

    $("#render-btn").addEventListener("click", startRender);
    $("#render-cancel").addEventListener("click", () => { if (renderJob) { renderJob.cancelled = true; $("#render-text").textContent = "취소하는 중…"; } });
    window.addEventListener("beforeunload", (e) => { if (renderJob) { e.preventDefault(); e.returnValue = ""; } });
    window.addEventListener("resize", () => { dirty = true; });

    updateButtons();
    requestAnimationFrame(loop);
  }

  // ---------- 렌더링 (오프라인) ----------
  let renderJob = null;
  const canStreamToDisk = typeof window.showSaveFilePicker === "function";
  // 메인 스레드를 잠깐 양보 (setTimeout은 백그라운드 탭에서 크게 지연되므로 MessageChannel 사용)
  const yieldNow = (() => {
    const ch = new MessageChannel(), q = [];
    ch.port1.onmessage = () => { const r = q.shift(); r && r(); };
    return () => new Promise((r) => { q.push(r); ch.port2.postMessage(0); });
  })();

  async function startRender() {
    if (renderJob || !audioBuf || !images.base) return;
    const baseName = (audioFile.name.replace(/\.[^.]+$/, "") || "rebroni").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 70) + "-lipsync.mp4";
    // 파일 저장 창은 클릭 직후(await 전)에 열어야 브라우저가 허용함
    let fileHandle = null;
    if (canStreamToDisk) {
      try { fileHandle = await window.showSaveFilePicker({ suggestedName: baseName, types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }] }); }
      catch (e) { return; } // 사용자가 취소
    }
    const job = renderJob = { cancelled: false };
    rendering = true; forced = "";
    audio.pause();
    refreshSlots();
    $("#render-overlay").hidden = false;
    $("#render-result").hidden = true;
    $("#render-progress").style.width = "0";
    $("#render-eta").textContent = "";
    let wakeLock = null;
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch (e) { /* ignore */ }
    const setText = (s) => { $("#render-text").textContent = s; };

    let output = null, writable = null;
    try {
      setText("렌더링 준비 중…");
      const mb = await import(MB_URL);
      const [W, H] = outSize(), fps = cfg.fps, vb = vBitrate();
      // 코덱: H.264/AAC 우선, 기기에서 안 되면 VP9/Opus (MP4에 담김, 유튜브 업로드 가능)
      const vCodec = (await mb.canEncodeVideo("avc", { width: W, height: H, bitrate: vb })) ? "avc"
        : (await mb.canEncodeVideo("vp9", { width: W, height: H, bitrate: vb })) ? "vp9" : null;
      const aCodec = (await mb.canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: SR, bitrate: ABITRATE })) ? "aac"
        : (await mb.canEncodeAudio("opus", { numberOfChannels: 2, sampleRate: SR, bitrate: ABITRATE })) ? "opus" : null;
      if (!vCodec || !aCodec) throw new Error("이 브라우저는 영상 인코딩(WebCodecs)을 지원하지 않습니다. PC용 Chrome·Edge를 사용해 주세요.");

      const rc = makeCanvas(W, H), rg = rc.getContext("2d");
      let target;
      if (fileHandle) {
        // 취소·실패 시에는 abort()로 만들다 만 파일을 버리게 중간 스트림을 둠
        const fileStream = await fileHandle.createWritable();
        writable = new WritableStream({
          write: (chunk) => fileStream.write(chunk),
          close: () => (job.cancelled || job.failed ? fileStream.abort() : fileStream.close()),
          abort: (reason) => fileStream.abort(reason),
        });
        target = new mb.StreamTarget(writable, { chunked: true, chunkSize: 16 * 1024 * 1024 });
      } else target = new mb.BufferTarget();
      output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: fileHandle ? false : "in-memory" }), target });
      const vSource = new mb.CanvasSource(rc, { codec: vCodec, bitrate: vb, keyFrameInterval: 2 });
      const aSource = new mb.AudioBufferSource({ codec: aCodec, bitrate: ABITRATE });
      output.addVideoTrack(vSource, { frameRate: fps });
      output.addAudioTrack(aSource);
      await output.start();

      const buf = audioBuf, dur = buf.duration;
      const ch0 = buf.getChannelData(0), ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
      const totalFrames = Math.ceil(dur * fps), CH = SR * 5, started = performance.now();
      let frame = 0, lastUi = 0;
      // 음원 5초 분량을 넣고, 그 구간의 프레임을 그리는 식으로 번갈아 진행
      for (let off = 0; off < ch0.length && !job.cancelled; off += CH) {
        const n = Math.min(CH, ch0.length - off);
        const ab = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: SR });
        ab.copyToChannel(ch0.subarray(off, off + n), 0); ab.copyToChannel(ch1.subarray(off, off + n), 1);
        await aSource.add(ab);
        const fEnd = Math.min(totalFrames, Math.ceil((off + n) / SR * fps));
        for (; frame < fEnd && !job.cancelled; frame++) {
          const t = frame / fps;
          drawFrame(rg, W, H, t, false);
          await vSource.add(t, 1 / fps);
          const now = performance.now();
          if (now - lastUi > 400) {
            lastUi = now;
            const done = frame / Math.max(1, totalFrames), speed = t / Math.max(0.001, (now - started) / 1000);
            $("#render-progress").style.width = (done * 100).toFixed(1) + "%";
            setText(`렌더링 중 ${(done * 100).toFixed(1)}% · ${fmtTime(t)} / ${fmtTime(dur)}`);
            $("#render-eta").textContent = `속도 ×${speed.toFixed(1)} 실시간 · 남은 시간 약 ${fmtTime((dur - t) / Math.max(0.01, speed))}`;
            pctx.setTransform(1, 0, 0, 1, 0, 0);
            pctx.drawImage(rc, 0, 0, canvas.width, canvas.height);
            await yieldNow();
          }
        }
      }

      if (job.cancelled) {
        await output.cancel();
        $("#render-result-text").textContent = "렌더링을 취소했습니다.";
        $("#render-dl").hidden = true;
      } else {
        setText("파일 마무리 중…");
        await output.finalize();
        const took = (performance.now() - started) / 1000;
        const codecName = { avc: "H.264", vp9: "VP9", aac: "AAC", opus: "Opus" };
        let msg = `완료! ${fmtTime(dur)} · ${W}×${H} ${fps}fps · ${codecName[vCodec]} / ${codecName[aCodec]} · 걸린 시간 ${fmtTime(took)}.`;
        if (fileHandle) {
          msg += ` 선택한 위치에 "${fileHandle.name}"로 저장했어요.`;
          $("#render-dl").hidden = true;
        } else {
          const blob = new Blob([output.target.buffer], { type: "video/mp4" });
          const a = $("#render-dl");
          if (a.href) URL.revokeObjectURL(a.href);
          a.href = URL.createObjectURL(blob);
          a.download = baseName;
          a.hidden = false;
          msg += ` (${fmtSize(blob.size)})`;
        }
        $("#render-result-text").textContent = msg;
      }
      $("#render-result").hidden = false;
    } catch (e) {
      console.error(e);
      job.failed = true;
      try { if (output && output.state !== "finalized") await output.cancel(); } catch (e2) { /* ignore */ }
      alert("렌더링에 실패했습니다: " + (e.message || e));
    } finally {
      renderJob = null; rendering = false; dirty = true;
      $("#render-overlay").hidden = true;
      updateButtons();
      if (wakeLock) wakeLock.release().catch(() => {});
    }
  }

  init();
  if (location.hostname === "localhost") window.__lipsync = { get segs() { return segs; }, get cues() { return cues; }, envAt };
})();
