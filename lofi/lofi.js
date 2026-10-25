/* Rebroni Lofi Visualizer (16:9, YouTube 롱폼)
 *
 * - 미리보기: <audio> + AnalyserNode로 플레이리스트를 실시간 재생하며 캔버스에 장면을 그림
 * - 렌더링: 실시간 녹화가 아니라 "오프라인 렌더링".
 *   곡을 하나씩 디코딩(48kHz)해 직접 FFT로 스펙트럼을 계산하고, 프레임을 한 장씩 그려
 *   WebCodecs(Mediabunny CanvasSource/AudioBufferSource)로 인코딩한다.
 *   결과는 File System Access API로 디스크에 바로 써서(StreamTarget) 1~3시간 영상도 메모리를 넘지 않는다.
 * - 장면은 시간(t)만으로 결정되도록 그려서(입자 위치 등) 미리보기와 결과가 같다.
 */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const MB_URL = "../visualizer/vendor/mediabunny.min.mjs";

  // ---------- 설정 (localStorage) ----------
  const DEFAULTS = {
    target: 0, shuffleRepeat: false, gap: 2, edgeFade: 1.5,
    dim: 0.2, tint: "warm", vizStyle: "bars", sens: 1, accent: "#ffd6a5",
    title: "", artist: "SHINCHEOLHO-rebroni", font: "mono", showTitle: true, showNow: true,
    grain: 0.35, vignette: 0.5, rain: false, dust: true, snow: false, scanlines: false, breathe: true,
    res: 1080, fps: 24, quality: "std",
  };
  const STORE_KEY = "rebroni-lofi-settings";
  const cfg = Object.assign({}, DEFAULTS);
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); } catch (e) { /* ignore */ }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ } };

  const fmtTime = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(r).padStart(2, "0");
  };
  const fmtSize = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + "GB" : Math.round(b / 1e6) + "MB");
  const baseName = (n) => n.replace(/\.[^.]+$/, "");
  // 결정적 난수 (같은 i,k → 같은 값): 입자 위치를 시간만으로 정하기 위해 사용
  const hash = (i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };

  // ---------- 플레이리스트 ----------
  const tracks = []; // { id, file, url, title, dur }
  let trackSeq = 0;

  function addTracks(files) {
    const list = Array.from(files).filter((f) => f.type.startsWith("audio/") || /\.(wav|flac|mp3|m4a|aac|ogg|opus)$/i.test(f.name));
    for (const file of list) {
      const t = { id: ++trackSeq, file, url: URL.createObjectURL(file), title: baseName(file.name), dur: 0 };
      const probe = new Audio();
      probe.preload = "metadata";
      probe.onloadedmetadata = () => { t.dur = probe.duration || 0; probe.removeAttribute("src"); refreshList(); };
      probe.onerror = () => { removeTrack(t.id); alert(`"${file.name}" 파일을 이 브라우저에서 재생할 수 없습니다.`); };
      probe.src = t.url;
      tracks.push(t);
    }
    if (current < 0 && tracks.length) selectTrack(0, false);
    refreshList();
    loadFonts();
  }
  function removeTrack(id) {
    const i = tracks.findIndex((x) => x.id === id);
    if (i < 0) return;
    const [t] = tracks.splice(i, 1);
    URL.revokeObjectURL(t.url);
    if (i === current) { audio.pause(); audio.removeAttribute("src"); current = -1; if (tracks.length) selectTrack(Math.min(i, tracks.length - 1), false); }
    else if (i < current) current--;
    refreshList();
  }
  function moveTrack(id, dir) {
    const i = tracks.findIndex((x) => x.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= tracks.length) return;
    [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    if (current === i) current = j; else if (current === j) current = i;
    refreshList();
  }

  function renderTracks() {
    const ul = $("#track-list");
    ul.innerHTML = "";
    tracks.forEach((t, i) => {
      const li = document.createElement("li");
      if (i === current) li.className = "on";
      li.innerHTML = `<span class="no">${i + 1}</span><input class="title" type="text" maxlength="100" aria-label="곡 제목">
        <span class="meta">${t.dur ? fmtTime(t.dur) : "…"}</span>
        <button class="del" data-act="play" aria-label="재생">▶</button>
        <button class="del" data-act="up" aria-label="위로" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="del" data-act="down" aria-label="아래로" ${i === tracks.length - 1 ? "disabled" : ""}>↓</button>
        <button class="del" data-act="del" aria-label="삭제">✕</button>`;
      const input = li.querySelector("input.title");
      input.value = t.title;
      input.addEventListener("input", () => { t.title = input.value; updateChapters(); if (i === current) $("#now-title").textContent = t.title; });
      input.addEventListener("change", () => loadFonts());
      li.addEventListener("click", (e) => {
        const act = e.target.closest("button")?.dataset.act;
        if (act === "play") selectTrack(i, true);
        else if (act === "up") moveTrack(t.id, -1);
        else if (act === "down") moveTrack(t.id, 1);
        else if (act === "del") removeTrack(t.id);
      });
      ul.appendChild(li);
    });
  }

  // 섞기용 결정적 난수 (같은 바퀴 번호 → 같은 순서라 예상 챕터와 실제 결과가 같음)
  function seededOrder(n, seed) {
    const idx = [...Array(n).keys()];
    let s = seed * 9301 + 49297;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    return idx;
  }

  // 영상 타임라인: [{ ti(곡 index), start, dur }]. durOf로 곡 길이를 바꿔 끼울 수 있음(렌더링 시 실제 디코딩 길이)
  function buildTimeline(durOf = (i) => tracks[i].dur) {
    const segs = [];
    const n = tracks.length;
    if (!n) return { segs, total: 0, loops: 0 };
    let cursor = 0, loops = 0;
    while (true) {
      const order = loops > 0 && cfg.shuffleRepeat ? seededOrder(n, loops) : [...Array(n).keys()];
      for (const ti of order) {
        const d = durOf(ti) || 0;
        segs.push({ ti, start: cursor, dur: d });
        cursor += d + cfg.gap;
        if (cfg.target && cursor - cfg.gap >= cfg.target) break;
      }
      loops++;
      const total = cursor - cfg.gap;
      if (!cfg.target || total >= cfg.target || segs.length > 3000) return { segs, total: Math.max(0, total), loops };
    }
  }

  function chapterText(tl) {
    const long = tl.total >= 3600;
    return tl.segs.map((s) => {
      let sec = Math.floor(s.start);
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), r = sec % 60;
      const ts = long ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${Math.floor(sec / 60)}:${String(r).padStart(2, "0")}`;
      return `${ts} ${tracks[s.ti].title}`;
    }).join("\n");
  }
  function updateChapters() {
    const tl = buildTimeline();
    $("#chapters").value = tl.segs.length ? chapterText(tl) : "";
  }

  function refreshList() {
    renderTracks();
    const has = tracks.length > 0;
    $("#play-btn").disabled = !has;
    $("#seek").disabled = !has;
    $("#render-btn").disabled = !has;
    $("#thumb-btn").disabled = false;
    const one = tracks.reduce((a, t) => a + (t.dur || 0), 0) + Math.max(0, tracks.length - 1) * cfg.gap;
    const tl = buildTimeline();
    $("#list-info").textContent = has
      ? `${tracks.length}곡 · 한 바퀴 ${fmtTime(one)} · 최종 영상 ${fmtTime(tl.total)}` + (tl.loops > 1 ? ` (${tl.loops}바퀴 반복)` : "")
      : "";
    updateChapters();
    updateEstimate();
  }

  // ---------- 배경 ----------
  const bgVideo = $("#bg-video");
  Object.assign(bgVideo.style, { position: "fixed", left: "-10px", top: "0", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" });
  const bg = { kind: null, file: null, url: null, img: null, w: 0, h: 0 };

  function setBackground(file) {
    clearBackground();
    bg.file = file; bg.url = URL.createObjectURL(file);
    if (file.type.startsWith("video/")) {
      bg.kind = "video";
      bgVideo.src = bg.url;
      bgVideo.onloadedmetadata = () => { bg.w = bgVideo.videoWidth; bg.h = bgVideo.videoHeight; showBgInfo(); };
      bgVideo.play().catch(() => {});
    } else {
      bg.kind = "image";
      const img = new Image();
      img.onload = () => { bg.img = img; bg.w = img.naturalWidth; bg.h = img.naturalHeight; showBgInfo(); };
      img.onerror = () => { clearBackground(); alert("이미지를 불러올 수 없습니다. (HEIC 등은 JPG/PNG로 변환해 주세요)"); };
      img.src = bg.url;
    }
  }
  function showBgInfo() {
    const r = bg.w / bg.h;
    $("#bg-info").textContent = `${bg.kind === "video" ? "🎬 반복 영상" : "🖼 이미지"} · ${bg.w}×${bg.h}` + (Math.abs(r - 16 / 9) < 0.02 ? " · 16:9 ✓" : " · 16:9가 아니면 꽉 차게 잘립니다");
  }
  function clearBackground() {
    bgVideo.pause(); bgVideo.removeAttribute("src"); bgVideo.load();
    if (bg.url) URL.revokeObjectURL(bg.url);
    Object.assign(bg, { kind: null, file: null, url: null, img: null, w: 0, h: 0 });
    $("#bg-info").textContent = "";
  }

  // ---------- 스펙트럼 ----------
  const FFT_SIZE = 2048, MIN_DB = -90, MAX_DB = -15;

  // AnalyserNode와 같은 방식(Blackman 창 → FFT → 시간 평활 → dB → 0~255)으로 오프라인 계산
  class SpectrumAnalyzer {
    constructor(n, smoothing) {
      this.n = n; this.smoothing = smoothing;
      this.win = new Float32Array(n);
      for (let i = 0; i < n; i++) this.win[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / n) + 0.08 * Math.cos((4 * Math.PI * i) / n);
      this.re = new Float32Array(n); this.im = new Float32Array(n);
      this.prev = new Float32Array(n / 2); this.bytes = new Uint8Array(n / 2);
      this.rev = new Uint32Array(n);
      const bits = Math.log2(n);
      for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); this.rev[i] = r; }
      this.cos = new Float32Array(n / 2); this.sin = new Float32Array(n / 2);
      for (let i = 0; i < n / 2; i++) { this.cos[i] = Math.cos((2 * Math.PI * i) / n); this.sin[i] = -Math.sin((2 * Math.PI * i) / n); }
    }
    reset() { this.prev.fill(0); }
    // ch0/ch1: Float32Array, end: 창의 끝 샘플 위치 (null이면 무음)
    analyze(ch0, ch1, end) {
      const { n, re, im, rev, win } = this;
      for (let i = 0; i < n; i++) {
        const idx = end - n + i;
        let v = 0;
        if (ch0 && idx >= 0 && idx < ch0.length) v = ch1 ? (ch0[idx] + ch1[idx]) * 0.5 : ch0[idx];
        re[rev[i]] = v * win[i];
        im[rev[i]] = 0;
      }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let s = 0; s < n; s += size) {
          for (let j = 0; j < half; j++) {
            const c = this.cos[j * step], sn = this.sin[j * step];
            const a = s + j, b = a + half;
            const tr = re[b] * c - im[b] * sn, ti = re[b] * sn + im[b] * c;
            re[b] = re[a] - tr; im[b] = im[a] - ti;
            re[a] += tr; im[a] += ti;
          }
        }
      }
      const k = this.smoothing, range = MAX_DB - MIN_DB;
      for (let i = 0; i < n / 2; i++) {
        const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / n;
        this.prev[i] = k * this.prev[i] + (1 - k) * mag;
        const db = 20 * Math.log10(this.prev[i] + 1e-12);
        this.bytes[i] = Math.max(0, Math.min(255, Math.round((255 * (db - MIN_DB)) / range)));
      }
      return this.bytes;
    }
  }

  // 주파수 bin(0~255) → 막대 값(0~1). dt에 맞춘 시간 기준 평활이라 24fps 렌더와 60fps 미리보기가 비슷하게 움직임
  const N_BANDS = 48;
  function updateBands(bytes, sampleRate, out, dt) {
    const binHz = sampleRate / FFT_SIZE, fMin = 40, fMax = Math.min(14000, sampleRate / 2), ratio = fMax / fMin;
    const up = 1 - Math.exp(-dt / 0.05), down = 1 - Math.exp(-dt / 0.25);
    for (let i = 0; i < out.length; i++) {
      let v = 0;
      if (bytes) {
        const lo = Math.floor((fMin * Math.pow(ratio, i / out.length)) / binHz);
        const hi = Math.max(lo + 1, Math.floor((fMin * Math.pow(ratio, (i + 1) / out.length)) / binHz));
        let m = 0;
        for (let b = lo; b < hi && b < bytes.length; b++) if (bytes[b] > m) m = bytes[b];
        v = Math.min(1, Math.pow(m / 255, 1.7) * (1 + 0.6 * i / out.length) * cfg.sens);
      }
      out[i] += (v - out[i]) * (v > out[i] ? up : down);
    }
    return out;
  }

  // ---------- 장면 그리기 (기준 해상도 1920×1080, K = W / 1920) ----------
  const FONTS = {
    mono: { family: '"IBM Plex Mono", "Courier New", "Apple SD Gothic Neo", "Noto Sans KR", monospace', scale: 1 },
    hand: { family: '"Nanum Pen Script", "Apple SD Gothic Neo", cursive', scale: 1.45 },
    sans: { family: '-apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif', scale: 1 },
  };

  // 화면에 쓰일 글자의 글꼴 조각(한글은 글자 범위별로 나뉨)을 미리 불러옴. 오프라인 렌더 첫 프레임부터 맞는 글꼴로 그리기 위함
  async function loadFonts(extra = "") {
    const f = FONTS[cfg.font] || FONTS.mono;
    const textAll = [cfg.title, cfg.artist, "♪ NOW PLAYING 0123456789:/ …", extra, ...tracks.map((t) => t.title)].join(" ");
    try {
      await Promise.all([400, 600].map((w) => document.fonts.load(`${w} 40px ${f.family}`, textAll)));
    } catch (e) { /* 글꼴을 못 불러오면 대체 글꼴로 그림 */ }
  }

  function createScene(canvas) {
    const ctx = canvas.getContext("2d", { alpha: false });
    const cache = { bgKey: "", bg: null, vigKey: "", vig: null, scanKey: "", scan: null, grain: null };
    const mk = (w, h) => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }));

    function grainTiles() {
      if (cache.grain) return cache.grain;
      cache.grain = [0, 1, 2].map((s) => {
        const c = mk(256, 256), g = c.getContext("2d"), d = g.createImageData(256, 256);
        for (let i = 0; i < d.data.length; i += 4) {
          const v = Math.floor(hash(i + s * 99991, s) * 255);
          d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255;
        }
        g.putImageData(d, 0, 0);
        return c;
      });
      return cache.grain;
    }

    function tintAndDim(g, W, H) {
      if (cfg.tint === "mono") {
        g.save(); g.globalCompositeOperation = "saturation"; g.fillStyle = "#808080"; g.fillRect(0, 0, W, H); g.restore();
      } else if (cfg.tint === "warm" || cfg.tint === "cool") {
        g.save(); g.globalCompositeOperation = "overlay"; g.globalAlpha = 0.22;
        g.fillStyle = cfg.tint === "warm" ? "#ff9a4d" : "#4d7dff"; g.fillRect(0, 0, W, H); g.restore();
      }
      if (cfg.dim > 0) { g.fillStyle = `rgba(0,0,0,${cfg.dim})`; g.fillRect(0, 0, W, H); }
    }

    function drawCover(g, src, sw, sh, W, H) {
      const s = Math.max(W / sw, H / sh), dw = sw * s, dh = sh * s;
      g.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }

    function defaultBg(g, W, H) {
      const gr = g.createLinearGradient(0, 0, W, H);
      gr.addColorStop(0, "#2a2140"); gr.addColorStop(0.55, "#3b2b3f"); gr.addColorStop(1, "#1b2236");
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }

    // 정적 배경(이미지 또는 기본 그라데이션) + 색감 + 어둡게를 한 번만 그려 둠
    function staticBg(W, H) {
      const key = [W, H, bg.img ? bg.url : "", cfg.tint, cfg.dim].join("|");
      if (cache.bgKey !== key) {
        cache.bg = cache.bg && cache.bg.width === W && cache.bg.height === H ? cache.bg : mk(W, H);
        const g = cache.bg.getContext("2d");
        if (bg.img) { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); drawCover(g, bg.img, bg.w, bg.h, W, H); }
        else defaultBg(g, W, H);
        tintAndDim(g, W, H);
        cache.bgKey = key;
      }
      return cache.bg;
    }

    function vignette(W, H) {
      const key = [W, H, cfg.vignette].join("|");
      if (cache.vigKey !== key) {
        cache.vig = mk(W, H);
        const g = cache.vig.getContext("2d");
        const r = Math.hypot(W, H) / 2;
        const gr = g.createRadialGradient(W / 2, H / 2, r * 0.35, W / 2, H / 2, r);
        gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, `rgba(0,0,0,${0.85 * cfg.vignette})`);
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
        cache.vigKey = key;
      }
      return cache.vig;
    }

    function scanPattern(K) {
      const step = Math.max(2, Math.round(3 * K));
      const key = String(step);
      if (cache.scanKey !== key) {
        const c = mk(4, step), g = c.getContext("2d");
        g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(0, 0, 4, Math.max(1, Math.round(step / 3)));
        cache.scan = ctx.createPattern(c, "repeat");
        cache.scanKey = key;
      }
      return cache.scan;
    }

    function rgba(hex, a) {
      const n = parseInt(hex.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }

    function drawParticles(t, W, H, K) {
      if (cfg.dust) {
        const levels = [[], [], []];
        for (let i = 0; i < 46; i++) {
          const sp = (8 + hash(i, 4) * 14) * K;
          const x = hash(i, 1) * W + Math.sin(t * (0.08 + hash(i, 2) * 0.12) + i) * 50 * K;
          const y = (((hash(i, 3) * H - t * sp) % H) + H) % H;
          const tw = 0.5 + 0.5 * Math.sin(t * (0.6 + hash(i, 5)) + i * 3);
          levels[Math.min(2, Math.floor(tw * 3))].push([x, y, (1.2 + hash(i, 6) * 2.4) * K]);
        }
        levels.forEach((pts, li) => {
          if (!pts.length) return;
          ctx.fillStyle = `rgba(255,236,200,${0.12 + li * 0.14})`;
          ctx.beginPath();
          pts.forEach(([x, y, r]) => { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); });
          ctx.fill();
        });
      }
      if (cfg.snow) {
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.beginPath();
        for (let i = 0; i < 110; i++) {
          const sp = (25 + hash(i, 7) * 45) * K, r = (1.4 + hash(i, 8) * 2.6) * K;
          const y = ((hash(i, 9) * H + t * sp) % (H + 20 * K)) - 10 * K;
          const x = hash(i, 10) * W + Math.sin(t * 0.7 + i) * 30 * K;
          ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      if (cfg.rain) {
        ctx.strokeStyle = "rgba(200,220,255,0.28)";
        ctx.lineWidth = 1.3 * K;
        ctx.beginPath();
        for (let i = 0; i < 170; i++) {
          const sp = (900 + hash(i, 11) * 700) * K, len = (30 + hash(i, 12) * 45) * K;
          const y = ((hash(i, 13) * H + t * sp) % (H + len)) - len;
          const x = hash(i, 14) * W * 1.1 - W * 0.05 + y * 0.12;
          ctx.moveTo(x, y); ctx.lineTo(x + len * 0.12, y + len);
        }
        ctx.stroke();
      }
    }

    function roundBar(x, y, w, h) {
      const r = Math.min(w / 2, h / 2);
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, [r, r, 0, 0]); else ctx.rect(x, y, w, h);
    }

    function drawViz(t, bands, W, H, K) {
      const col = cfg.accent;
      if (cfg.vizStyle === "bars") {
        const n = bands.length, x0 = W * 0.58, x1 = W * 0.94, base = H * 0.905, maxH = 150 * K;
        const slot = (x1 - x0) / n, bw = slot * 0.55;
        ctx.beginPath();
        for (let i = 0; i < n; i++) { const h = Math.max(3 * K, bands[i] * maxH); roundBar(x0 + i * slot, base - h, bw, h); }
        ctx.fillStyle = rgba(col, 0.88);
        ctx.shadowColor = rgba(col, 0.6); ctx.shadowBlur = 14 * K;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = rgba(col, 0.25);
        ctx.fillRect(x0, base + 6 * K, x1 - x0 - slot + bw, 2 * K);
      } else if (cfg.vizStyle === "wave") {
        const n = bands.length, x0 = W * 0.58, x1 = W * 0.94, base = H * 0.87, amp = 80 * K;
        const pts = [];
        for (let i = 0; i < n; i++) pts.push([x0 + ((x1 - x0) * i) / (n - 1), bands[i] * amp * (0.6 + 0.4 * Math.sin(t * 2 + i * 0.5))]);
        [[1, 0.9, 3], [-1, 0.35, 2]].forEach(([dir, a, lw]) => {
          ctx.beginPath();
          pts.forEach(([x, v], i) => {
            const y = base - dir * v;
            if (!i) ctx.moveTo(x, y);
            else { const [px, pv] = pts[i - 1]; const py = base - dir * pv; ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2); }
          });
          ctx.strokeStyle = rgba(col, a); ctx.lineWidth = lw * K; ctx.lineJoin = "round";
          ctx.shadowColor = rgba(col, 0.6); ctx.shadowBlur = dir > 0 ? 12 * K : 0;
          ctx.stroke();
        });
        ctx.shadowBlur = 0;
      } else if (cfg.vizStyle === "vinyl") {
        const cx = W * 0.84, cy = H * 0.7, R = 165 * K;
        // 레코드 주변 스펙트럼
        ctx.beginPath();
        const n = 72;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          const v = bands[Math.floor(((i < n / 2 ? i : n - 1 - i) / (n / 2)) * bands.length) % bands.length];
          const r1 = R + 10 * K, r2 = r1 + 4 * K + v * 70 * K;
          ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
          ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        }
        ctx.strokeStyle = rgba(col, 0.85); ctx.lineWidth = 4 * K; ctx.lineCap = "round";
        ctx.stroke();
        // 레코드판 (33⅓rpm으로 회전)
        const ang = t * Math.PI * 2 * (33.3 / 60);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 30 * K;
        ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1 * K;
        for (let r = R * 0.42; r < R * 0.97; r += 6 * K) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke(); }
        // 고정된 반사광
        const sheen = ctx.createLinearGradient(-R, -R, R, R);
        sheen.addColorStop(0.35, "rgba(255,255,255,0)"); sheen.addColorStop(0.5, "rgba(255,255,255,0.10)"); sheen.addColorStop(0.65, "rgba(255,255,255,0)");
        ctx.fillStyle = sheen; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
        ctx.rotate(ang);
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, R * 0.34, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.arc(0, -R * 0.2, R * 0.05, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(0, 0, R * 0.035, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

    function text(str, x, y, size, color, weight = 400, maxW = 0) {
      const f = FONTS[cfg.font] || FONTS.mono;
      ctx.font = `${weight} ${Math.round(size * f.scale)}px ${f.family}`;
      ctx.fillStyle = color;
      let s = str || "";
      if (maxW) while (s.length > 1 && ctx.measureText(s).width > maxW) s = s.slice(0, -2) + "…";
      ctx.fillText(s, x, y);
    }

    function drawText(st, W, H, K) {
      ctx.save();
      ctx.textBaseline = "alphabetic";
      ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 12 * K; ctx.shadowOffsetY = 2 * K;
      const L = 80 * K;
      if (cfg.showTitle) {
        if (cfg.title) text(cfg.title, L, 120 * K, 50 * K, "rgba(255,255,255,0.94)", 600, W * 0.6);
        if (cfg.artist) text(cfg.artist, L, (cfg.title ? 170 : 120) * K, 26 * K, "rgba(255,255,255,0.72)", 400, W * 0.5);
      }
      if (cfg.showNow && st.track) {
        const maxW = cfg.vizStyle === "none" ? W * 0.8 : W * 0.48;
        text("♪ NOW PLAYING", L, H - 205 * K, 20 * K, rgba(cfg.accent, 0.9), 600);
        text(st.track, L, H - 150 * K, 40 * K, "rgba(255,255,255,0.95)", 600, maxW);
        if (cfg.artist) text(cfg.artist, L, H - 112 * K, 22 * K, "rgba(255,255,255,0.7)", 400, maxW);
        const bw = 520 * K, by = H - 78 * K, p = st.dur ? Math.min(1, st.pos / st.dur) : 0;
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.fillRect(L, by, bw, 4 * K);
        ctx.fillStyle = rgba(cfg.accent, 0.95); ctx.fillRect(L, by, bw * p, 4 * K);
        ctx.beginPath(); ctx.arc(L + bw * p, by + 2 * K, 6 * K, 0, Math.PI * 2); ctx.fill();
        text(`${fmtTime(st.pos)} / ${fmtTime(st.dur)}`, L + bw + 20 * K, by + 8 * K, 20 * K, "rgba(255,255,255,0.75)");
      }
      ctx.restore();
    }

    // st: { t, frame, bands, bgFrame(영상 배경의 현재 프레임), track, pos, dur }
    function draw(st) {
      const W = canvas.width, H = canvas.height, K = W / 1920;
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.shadowBlur = 0;
      const zoom = cfg.breathe ? 1.025 + 0.025 * Math.sin((st.t * Math.PI * 2) / 40) : 1;
      if (bg.kind === "video" && st.bgFrame) {
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
        ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(zoom, zoom); ctx.translate(-W / 2, -H / 2);
        const sw = st.bgFrame.videoWidth || st.bgFrame.width, sh = st.bgFrame.videoHeight || st.bgFrame.height;
        drawCover(ctx, st.bgFrame, sw, sh, W, H);
        ctx.restore();
        tintAndDim(ctx, W, H);
      } else {
        const c = staticBg(W, H);
        if (zoom === 1) ctx.drawImage(c, 0, 0);
        else { const sw = W / zoom, sh = H / zoom; ctx.drawImage(c, (W - sw) / 2, (H - sh) / 2, sw, sh, 0, 0, W, H); }
      }
      drawParticles(st.t, W, H, K);
      if (cfg.vizStyle !== "none") drawViz(st.t, st.bands, W, H, K);
      drawText(st, W, H, K);
      if (cfg.vignette > 0) ctx.drawImage(vignette(W, H), 0, 0);
      if (cfg.scanlines) { ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = scanPattern(K); ctx.fillRect(0, 0, W, H); ctx.restore(); }
      if (cfg.grain > 0) {
        const tiles = grainTiles(), f = st.frame || 0;
        ctx.save();
        ctx.globalCompositeOperation = "overlay"; ctx.globalAlpha = cfg.grain * 0.45;
        const pat = ctx.createPattern(tiles[f % 3], "repeat");
        ctx.translate(-Math.floor(hash(f, 21) * 256), -Math.floor(hash(f, 22) * 256));
        ctx.fillStyle = pat; ctx.fillRect(0, 0, W + 256, H + 256);
        ctx.restore();
      }
    }
    return { draw, canvas };
  }

  // ---------- 미리보기 ----------
  const stage = $("#stage");
  const preview = createScene(stage);
  const audio = $("#audio");
  let actx = null, analyser = null, freq = null;
  let current = -1, gapTimer = null, rendering = false;
  const previewBands = new Float32Array(N_BANDS);

  function ensureAudio() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const src = actx.createMediaElementSource(audio);
    analyser = actx.createAnalyser();
    analyser.fftSize = FFT_SIZE; analyser.minDecibels = MIN_DB; analyser.maxDecibels = MAX_DB; analyser.smoothingTimeConstant = 0.8;
    src.connect(analyser); analyser.connect(actx.destination);
    freq = new Uint8Array(analyser.frequencyBinCount);
  }
  function selectTrack(i, autoplay) {
    if (i < 0 || i >= tracks.length) return;
    clearTimeout(gapTimer);
    current = i;
    audio.src = tracks[i].url;
    $("#now-title").textContent = tracks[i].title;
    if (autoplay) play();
    renderTracks();
  }
  function play() { if (current < 0 || rendering) return; ensureAudio(); audio.play().catch(() => {}); if (bg.kind === "video") bgVideo.play().catch(() => {}); }
  audio.addEventListener("play", () => { $("#play-btn").textContent = "❚❚"; });
  audio.addEventListener("pause", () => { $("#play-btn").textContent = "▶"; });
  audio.addEventListener("timeupdate", () => {
    $("#seek").max = audio.duration || 0; $("#seek").value = audio.currentTime;
    $("#cur").textContent = fmtTime(audio.currentTime); $("#dur").textContent = fmtTime(audio.duration);
  });
  audio.addEventListener("ended", () => {
    if (!tracks.length) return;
    gapTimer = setTimeout(() => selectTrack((current + 1) % tracks.length, true), cfg.gap * 1000);
  });
  $("#play-btn").addEventListener("click", () => { if (audio.paused) play(); else audio.pause(); });
  $("#prev-btn").addEventListener("click", () => { if (tracks.length) selectTrack((current - 1 + tracks.length) % tracks.length, true); });
  $("#next-btn").addEventListener("click", () => { if (tracks.length) selectTrack((current + 1) % tracks.length, true); });
  $("#seek").addEventListener("input", (e) => { audio.currentTime = +e.target.value; });

  let lastNow = performance.now(), previewFrame = 0;
  function previewLoop(now) {
    const dt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
    if (!rendering) {
      const playing = analyser && !audio.paused;
      if (playing) analyser.getByteFrequencyData(freq);
      updateBands(playing ? freq : null, actx ? actx.sampleRate : 48000, previewBands, dt);
      // 미리보기 시간: 첫 바퀴 기준 현재 곡의 시작 + 재생 위치 (입자·회전 등에 사용)
      let t = audio.currentTime || 0;
      for (let i = 0; i < current; i++) t += (tracks[i].dur || 0) + cfg.gap;
      preview.draw({
        t: playing ? t : now / 1000, frame: previewFrame++, bands: previewBands,
        bgFrame: bg.kind === "video" && bgVideo.readyState >= 2 ? bgVideo : null,
        track: current >= 0 ? tracks[current].title : "Lofi Visualizer", pos: audio.currentTime || 0, dur: audio.duration || (current >= 0 ? tracks[current].dur : 0),
      });
    }
    requestAnimationFrame(previewLoop);
  }

  // ---------- 렌더링 (오프라인) ----------
  const RES = { 720: [1280, 720], 1080: [1920, 1080], 1440: [2560, 1440] };
  const VBITRATE = { std: { 720: 2_500_000, 1080: 4_500_000, 1440: 8_000_000 }, high: { 720: 5_000_000, 1080: 8_000_000, 1440: 14_000_000 } };
  const ABITRATE = 192_000, SR = 48000;
  const canStreamToDisk = typeof window.showSaveFilePicker === "function";
  const MEMORY_LIMIT_SEC = 20 * 60; // 파일 직접 저장이 안 되는 브라우저는 20분까지만
  let renderJob = null;

  function updateEstimate() {
    const tl = buildTimeline();
    const vb = VBITRATE[cfg.quality][cfg.res];
    const size = ((vb + ABITRATE) * tl.total) / 8;
    $("#render-estimate").textContent = tracks.length
      ? `예상: ${fmtTime(tl.total)} · ${RES[cfg.res].join("×")} ${cfg.fps}fps · 약 ${fmtSize(size)}`
        + (!canStreamToDisk && tl.total > MEMORY_LIMIT_SEC ? " ⚠ 이 브라우저는 20분까지만 만들 수 있어요 (PC용 Chrome·Edge 권장)" : "")
      : "";
  }

  // 곡 디코딩: 48kHz로 변환된 AudioBuffer
  async function decodeTrack(t) {
    const buf = await t.file.arrayBuffer();
    const oac = new OfflineAudioContext(2, SR, SR);
    return oac.decodeAudioData(buf);
  }

  // 메인 스레드를 잠깐 양보 (setTimeout은 백그라운드 탭에서 크게 지연되므로 MessageChannel 사용)
  const yieldNow = (() => {
    const ch = new MessageChannel(), q = [];
    ch.port1.onmessage = () => { const r = q.shift(); r && r(); };
    return () => new Promise((r) => { q.push(r); ch.port2.postMessage(0); });
  })();

  async function startRender() {
    if (renderJob || !tracks.length) return;
    const est = buildTimeline();
    // 파일 저장 창은 클릭 직후(await 전)에 열어야 브라우저가 허용함
    let fileHandle = null;
    if (canStreamToDisk) {
      const name = ((cfg.title || "rebroni-lofi").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80)) + ".mp4";
      try { fileHandle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }] }); }
      catch (e) { return; } // 사용자가 취소
    } else if (est.total > MEMORY_LIMIT_SEC) {
      alert("이 브라우저는 파일을 바로 저장하는 기능이 없어 20분 이하 영상만 만들 수 있습니다.\nPC용 Chrome 또는 Edge에서 열어 주세요.");
      return;
    }

    const job = renderJob = { cancelled: false };
    rendering = true;
    audio.pause();
    document.body.classList.add("exporting");
    $("#render-overlay").hidden = false;
    $("#render-result").hidden = true;
    $("#render-btn").disabled = true;
    let wakeLock = null;
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch (e) { /* ignore */ }
    const setText = (s) => { $("#render-text").textContent = s; };

    let output = null, writable = null;
    try {
      const mb = await import(MB_URL);
      const [W, H] = RES[cfg.res], fps = cfg.fps;
      const vb = VBITRATE[cfg.quality][cfg.res];
      // 코덱: H.264/AAC 우선, 기기에서 안 되면 VP9/Opus (MP4에 담김, 유튜브 업로드 가능)
      const vCodec = (await mb.canEncodeVideo("avc", { width: W, height: H, bitrate: vb })) ? "avc"
        : (await mb.canEncodeVideo("vp9", { width: W, height: H, bitrate: vb })) ? "vp9" : null;
      const aCodec = (await mb.canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: SR, bitrate: ABITRATE })) ? "aac"
        : (await mb.canEncodeAudio("opus", { numberOfChannels: 2, sampleRate: SR, bitrate: ABITRATE })) ? "opus" : null;
      if (!vCodec || !aCodec) throw new Error("이 브라우저는 영상 인코딩(WebCodecs)을 지원하지 않습니다. PC용 Chrome·Edge를 사용해 주세요.");

      await loadFonts();

      const rc = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
      const scene = createScene(rc);

      let target;
      if (fileHandle) {
        // 라이브러리는 취소할 때도 스트림을 close()하는데, 파일 스트림을 close하면 만들다 만 파일이 확정·저장됨.
        // 중간 스트림을 둬서 취소·실패 시에는 abort()로 임시 파일을 버리게 함
        const fileStream = await fileHandle.createWritable();
        writable = new WritableStream({
          write: (chunk) => fileStream.write(chunk),
          close: () => (job.cancelled || job.failed ? fileStream.abort() : fileStream.close()),
          abort: (reason) => fileStream.abort(reason),
        });
        target = new mb.StreamTarget(writable, { chunked: true, chunkSize: 16 * 1024 * 1024 });
      }
      else target = new mb.BufferTarget();
      output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: fileHandle ? false : "in-memory" }), target });
      const vSource = new mb.CanvasSource(rc, { codec: vCodec, bitrate: vb, keyFrameInterval: 2 });
      const aSource = new mb.AudioBufferSource({ codec: aCodec, bitrate: ABITRATE });
      output.addVideoTrack(vSource, { frameRate: fps });
      output.addAudioTrack(aSource);
      await output.start();

      // 배경 영상: 처음부터 순서대로 디코딩하며, 출력 시각에 맞는 프레임을 고름. 끝에 닿으면 처음부터 다시(반복)
      let bgAt = null, lastBg = null;
      const notes = [];
      if (bg.kind === "video") {
        const input = new mb.Input({ source: new mb.BlobSource(bg.file), formats: mb.ALL_FORMATS });
        const vt = await input.getPrimaryVideoTrack();
        if (vt && !(await vt.canDecode())) {
          // 이 브라우저가 디코딩할 수 없는 영상 코덱이면 미리보기의 현재 장면을 정지 배경으로 사용
          notes.push("배경 영상을 이 브라우저에서 디코딩할 수 없어 첫 장면을 정지 배경으로 사용했습니다 (MP4·H.264 영상 권장).");
          if (bgVideo.readyState >= 2) {
            const c = Object.assign(document.createElement("canvas"), { width: bgVideo.videoWidth, height: bgVideo.videoHeight });
            c.getContext("2d").drawImage(bgVideo, 0, 0);
            lastBg = c;
          }
        } else if (vt) {
          const vdur = Math.max(0.1, await vt.computeDuration());
          // 현재·다음 프레임을 들고 있는 동안 덮어쓰이지 않도록 캔버스 풀은 넉넉하게
          const sink = new mb.CanvasSink(vt, { width: W, height: H, fit: "cover", poolSize: 4 });
          let it = sink.canvases(), cur = null, nxt = await it.next(), lastTb = -1;
          bgAt = async (t) => {
            const tb = t % vdur;
            if (tb < lastTb) {
              // 한 바퀴가 끝남: 남은 프레임을 끝까지 읽어 정상 종료시킨 뒤(중간에 끊으면 프레임 메모리가 새어 나감) 처음부터 다시
              while (!nxt.done) nxt = await it.next();
              it = sink.canvases(); cur = null; nxt = await it.next();
            }
            lastTb = tb;
            while (!nxt.done && nxt.value.timestamp <= tb + 1e-3) { cur = nxt.value; nxt = await it.next(); }
            if (!cur && !nxt.done) cur = nxt.value;
            return cur ? cur.canvas : null;
          };
        }
      }

      const analyzer = new SpectrumAnalyzer(FFT_SIZE, Math.pow(0.8, 60 / fps));
      const bands = new Float32Array(N_BANDS);
      const durCache = new Map(); // 곡 index → 실제 길이 (챕터용)
      const totalFrames = Math.ceil(est.total * fps);
      const started = performance.now();
      let frame = 0, audioT = 0, cursor = 0, lastUi = 0;
      const actual = [];

      // 타임라인을 실제 디코딩 길이로 다시 계산하며 진행 (예상과 수 초 차이 날 수 있음)
      const order = est.segs.map((s) => s.ti);
      for (let si = 0; si < order.length && !job.cancelled; si++) {
        const ti = order[si], t = tracks[ti];
        setText(`곡 분석 중 (${si + 1}/${order.length}) · ${t.title}`);
        const buf = await decodeTrack(t);
        durCache.set(ti, buf.duration);
        const start = cursor, dur = buf.duration, isLast = si === order.length - 1;
        const end = isLast ? start + dur : start + dur + cfg.gap;
        actual.push({ ti, start, dur });

        // --- 오디오: 곡 앞 간격(무음) + 곡(시작·끝 페이드) ---
        const ch0 = buf.getChannelData(0), ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
        if (start > audioT + 1e-6) await addSilence(aSource, start - audioT);
        const fin = Math.floor(cfg.edgeFade * SR), len = ch0.length, CH = SR * 5;
        for (let off = 0; off < len; off += CH) {
          const n = Math.min(CH, len - off);
          const ab = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: SR });
          const L = ab.getChannelData(0), R = ab.getChannelData(1);
          for (let i = 0; i < n; i++) {
            const p = off + i;
            let g = 1;
            if (fin > 0) { if (p < fin) g = p / fin; if (len - p < fin) g = Math.min(g, (len - p) / fin); }
            L[i] = ch0[p] * g; R[i] = (ch1 ? ch1[p] : ch0[p]) * g;
          }
          await aSource.add(ab);
        }
        audioT = start + dur;

        // --- 영상: 이 곡과 뒤 간격 구간의 프레임 ---
        const fEnd = Math.ceil(end * fps);
        for (; frame < fEnd && !job.cancelled; frame++) {
          const tt = frame / fps, local = tt - start;
          const inTrack = local >= 0 && local < dur;
          const bytes = analyzer.analyze(inTrack ? ch0 : null, ch1, Math.floor(local * SR));
          updateBands(bytes, SR, bands, 1 / fps);
          if (bgAt) lastBg = (await bgAt(tt)) || lastBg;
          scene.draw({ t: tt, frame, bands, bgFrame: lastBg, track: t.title, pos: Math.max(0, Math.min(local, dur)), dur });
          await vSource.add(tt, 1 / fps);

          const now = performance.now();
          if (now - lastUi > 500) {
            lastUi = now;
            const done = frame / Math.max(1, totalFrames), el = (now - started) / 1000;
            const speed = tt / Math.max(0.001, el);
            $("#render-progress").style.width = (done * 100).toFixed(1) + "%";
            setText(`렌더링 중 ${(done * 100).toFixed(1)}% · ${fmtTime(tt)} / ${fmtTime(est.total)} · ${t.title}`);
            $("#render-eta").textContent = `속도 ×${speed.toFixed(1)} 실시간 · 남은 시간 약 ${fmtTime((est.total - tt) / Math.max(0.01, speed))}`;
            preview.canvas.getContext("2d").drawImage(rc, 0, 0, preview.canvas.width, preview.canvas.height);
            await yieldNow();
          }
        }
        cursor = end;
      }

      if (job.cancelled) {
        await output.cancel();
        $("#render-result-text").textContent = "렌더링을 취소했습니다.";
        $("#render-dl").hidden = true;
      } else {
        setText("파일 마무리 중…");
        await output.finalize();
        const total = actual.length ? actual[actual.length - 1].start + actual[actual.length - 1].dur : 0;
        // 실제 길이로 챕터 갱신
        $("#chapters").value = chapterText({ segs: actual, total });
        const took = (performance.now() - started) / 1000;
        const codecName = { avc: "H.264", vp9: "VP9", aac: "AAC", opus: "Opus" };
        let msg = `완료! ${fmtTime(total)} · ${W}×${H} ${fps}fps · ${codecName[vCodec]} / ${codecName[aCodec]} · 걸린 시간 ${fmtTime(took)}.`;
        if (fileHandle) {
          msg += ` 선택한 위치에 "${fileHandle.name}"로 저장했어요.`;
          $("#render-dl").hidden = true;
        } else {
          const blob = new Blob([output.target.buffer], { type: "video/mp4" });
          const a = $("#render-dl");
          if (a.href) URL.revokeObjectURL(a.href);
          a.href = URL.createObjectURL(blob);
          a.download = ((cfg.title || "rebroni-lofi").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80)) + ".mp4";
          a.hidden = false;
          msg += ` (${fmtSize(blob.size)})`;
        }
        msg += " 플레이리스트 탭의 챕터를 유튜브 설명란에 붙여넣으세요.";
        if (notes.length) msg += " ⚠ " + notes.join(" ");
        $("#render-result-text").textContent = msg;
      }
      $("#render-result").hidden = false;
    } catch (e) {
      console.error(e);
      job.failed = true;
      try { if (output && output.state !== "finalized") await output.cancel(); } catch (e2) { /* ignore */ }
      alert("렌더링에 실패했습니다: " + (e.message || e));
    } finally {
      renderJob = null;
      rendering = false;
      document.body.classList.remove("exporting");
      $("#render-overlay").hidden = true;
      $("#render-btn").disabled = !tracks.length;
      if (wakeLock) wakeLock.release().catch(() => {});
    }
  }

  async function addSilence(aSource, sec) {
    let left = Math.round(sec * SR);
    while (left > 0) {
      const n = Math.min(left, SR * 5);
      await aSource.add(new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: SR }));
      left -= n;
    }
  }

  $("#render-btn").addEventListener("click", startRender);
  $("#render-cancel").addEventListener("click", () => { if (renderJob) { renderJob.cancelled = true; $("#render-text").textContent = "취소하는 중…"; } });
  window.addEventListener("beforeunload", (e) => { if (renderJob) { e.preventDefault(); e.returnValue = ""; } });

  // 썸네일: 현재 미리보기 장면을 1280×720 PNG로
  $("#thumb-btn").addEventListener("click", async () => {
    const c = Object.assign(document.createElement("canvas"), { width: 1280, height: 720 });
    const sc = createScene(c);
    await loadFonts();
    const fake = new Float32Array(N_BANDS).map((_, i) => 0.25 + 0.45 * Math.abs(Math.sin(i * 0.45)) * (1 - i / N_BANDS * 0.5));
    sc.draw({ t: 12, frame: 1, bands: previewBands.some((v) => v > 0.05) ? previewBands : fake,
      bgFrame: bg.kind === "video" && bgVideo.readyState >= 2 ? bgVideo : null,
      track: current >= 0 ? tracks[current].title : "", pos: audio.currentTime || 0, dur: current >= 0 ? tracks[current].dur : 0 });
    c.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = ((cfg.title || "rebroni-lofi").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80)) + "-thumbnail.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  });

  // ---------- UI 바인딩 ----------
  function activateTab(name) {
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    $$(".tabpane").forEach((p) => p.classList.toggle("active", p.dataset.pane === name));
  }
  $$(".tab").forEach((t) => t.addEventListener("click", () => activateTab(t.dataset.tab)));

  $("#audio-input").addEventListener("change", (e) => { addTracks(e.target.files); e.target.value = ""; });
  $("#tracks-clear").addEventListener("click", () => { [...tracks].forEach((t) => removeTrack(t.id)); });
  $("#bg-input").addEventListener("change", (e) => { if (e.target.files[0]) setBackground(e.target.files[0]); e.target.value = ""; });
  $("#bg-clear").addEventListener("click", clearBackground);
  $$(".drop").forEach((zone) => {
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault(); zone.classList.remove("dragover");
      if (zone.htmlFor === "audio-input") addTracks(e.dataTransfer.files);
      else if (e.dataTransfer.files[0]) setBackground(e.dataTransfer.files[0]);
    });
  });
  $("#copy-chapters").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#chapters").value); $("#copy-chapters").textContent = "복사됨 ✓"; }
    catch (e) { $("#chapters").select(); document.execCommand("copy"); }
    setTimeout(() => { $("#copy-chapters").textContent = "챕터 복사"; }, 1500);
  });

  const SEGS = [["target", "target", Number], ["tint", "tint"], ["viz-style", "vizStyle"], ["font", "font"], ["res", "res", Number], ["fps", "fps", Number], ["quality", "quality"]];
  SEGS.forEach(([id, key, parse = (v) => v]) => $$(`#${id} button`).forEach((b) => b.addEventListener("click", () => {
    if (rendering) return;
    cfg[key] = parse(b.dataset.v); syncUI(); save(); refreshList();
  })));
  const RANGES = [
    ["gap", "gap", (v) => v + "초"], ["edge-fade", "edgeFade", (v) => (v ? v + "초" : "없음")],
    ["dim", "dim", (v) => Math.round(v * 100) + "%"], ["sens", "sens", (v) => Math.round(v * 100) + "%"],
    ["grain", "grain", (v) => Math.round(v * 100) + "%"], ["vignette", "vignette", (v) => Math.round(v * 100) + "%"],
  ];
  RANGES.forEach(([id, key]) => $("#" + id).addEventListener("input", (e) => { cfg[key] = +e.target.value; syncUI(); save(); if (key === "gap") refreshList(); }));
  const CHECKS = [["shuffle-repeat", "shuffleRepeat"], ["show-title", "showTitle"], ["show-now", "showNow"], ["rain", "rain"], ["dust", "dust"], ["snow", "snow"], ["scanlines", "scanlines"], ["breathe", "breathe"]];
  CHECKS.forEach(([id, key]) => $("#" + id).addEventListener("change", (e) => { cfg[key] = e.target.checked; save(); if (key === "shuffleRepeat") refreshList(); }));
  $("#accent").addEventListener("input", (e) => { cfg.accent = e.target.value; save(); });
  $("#title-text").addEventListener("input", (e) => { cfg.title = e.target.value; save(); });
  $("#artist-text").addEventListener("input", (e) => { cfg.artist = e.target.value; save(); });
  $("#font").addEventListener("click", () => loadFonts());
  $("#title-text").addEventListener("change", () => loadFonts());

  function syncUI() {
    SEGS.forEach(([id, key]) => $$(`#${id} button`).forEach((b) => b.classList.toggle("on", b.dataset.v === String(cfg[key]))));
    RANGES.forEach(([id, key, fmt]) => { $("#" + id).value = cfg[key]; $("#" + id + "-out").textContent = fmt(cfg[key]); });
    CHECKS.forEach(([id, key]) => { $("#" + id).checked = cfg[key]; });
    $("#accent").value = cfg.accent; $("#title-text").value = cfg.title; $("#artist-text").value = cfg.artist;
  }

  (function showEnv() {
    const b = $("#env-badge");
    const ok = canStreamToDisk && typeof VideoEncoder !== "undefined";
    b.textContent = ok ? "긴 영상 렌더링 가능" : "20분 이하만 가능";
    b.className = "badge " + (ok ? "ok" : "warn");
    b.title = ok ? "파일을 컴퓨터에 바로 저장하며 만들 수 있습니다." : "PC용 Chrome·Edge에서 열면 1~3시간 영상을 만들 수 있습니다.";
  })();

  syncUI();
  refreshList();
  loadFonts();
  requestAnimationFrame(previewLoop);
})();
