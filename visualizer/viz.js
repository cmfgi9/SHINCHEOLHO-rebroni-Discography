/* Rebroni Visualizer
 * 음원 재생 → Web Audio AnalyserNode로 소리를 캡처 → 9:16 캔버스에 배경 + 비주얼라이저 합성
 * → canvas.captureStream + 오디오 스트림을 MediaRecorder로 녹화해 MP4로 추출합니다.
 */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // ---------- 설정 (localStorage에 저장) ----------
  const DEFAULTS = {
    style: "bars", color1: "#00e5ff", color2: "#ff2bd6", position: "bottom",
    size: 1, sens: 1, smooth: 0.8, bands: 64, glow: true,
    artist: "SHINCHEOLHO-rebroni", showText: true, showProgress: true,
    fit: "cover", dim: 0.25, blur: 0, beatZoom: true, bgc1: "#14112a", bgc2: "#03030a",
    res: 1080, fps: 30, volume: 1, loopOne: false,
    fadeIn: 0.5, fadeOut: 3, fadeVideo: false,
  };
  const STORE_KEY = "rebroni-visualizer-settings";
  const cfg = Object.assign({}, DEFAULTS);
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); } catch (e) { /* ignore */ }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ } };

  const STYLES = [
    { id: "bars", name: "막대", ico: "▮▮▮" },
    { id: "mirror", name: "미러 막대", ico: "⧗" },
    { id: "circle", name: "원형 스펙트럼", ico: "✺" },
    { id: "wave", name: "파형", ico: "∿" },
    { id: "mountain", name: "산맥", ico: "⛰" },
    { id: "ring", name: "원형 파형", ico: "◎" },
    { id: "dots", name: "LED 도트", ico: "⠿" },
    { id: "particles", name: "파티클", ico: "✦" },
  ];
  const PALETTES = [
    ["#00e5ff", "#ff2bd6"], ["#ffb347", "#ff3d6e"], ["#43e97b", "#38bdf8"], ["#a78bfa", "#f472b6"],
    ["#fde68a", "#f59e0b"], ["#ffffff", "#9ca3af"], ["#ff4d4d", "#ffd84d"], ["#22d3ee", "#6366f1"],
  ];

  // ---------- DOM ----------
  const canvas = $("#stage");
  const ctx = canvas.getContext("2d");
  const audio = $("#audio");
  const bgVideo = $("#bg-video");
  // iOS Safari는 display:none 비디오의 프레임을 갱신하지 않을 수 있어 화면 밖에 작게 둡니다.
  bgVideo.hidden = false;
  Object.assign(bgVideo.style, { position: "fixed", left: "-10px", top: "0", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" });

  let W = 1080, H = 1920, K = 1;
  function setResolution(r) {
    W = r === 720 ? 720 : 1080;
    H = Math.round(W * 16 / 9);
    K = W / 1080;
    canvas.width = W; canvas.height = H;
  }
  setResolution(cfg.res);

  // ---------- 오디오 그래프 ----------
  let actx = null, analyser = null, recDest = null, gainNode = null, fadeGain = null;
  let freq = new Uint8Array(0), wave = new Uint8Array(0);

  function ensureAudio() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    actx = new AC();
    const src = actx.createMediaElementSource(audio);
    analyser = actx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -15;
    analyser.smoothingTimeConstant = cfg.smooth;
    gainNode = actx.createGain();
    gainNode.gain.value = cfg.volume;
    fadeGain = actx.createGain();         // 추출 시 페이드 인/아웃 (비주얼라이저 분석은 페이드 전 신호 사용)
    src.connect(analyser);
    analyser.connect(fadeGain);
    fadeGain.connect(gainNode);
    gainNode.connect(actx.destination);   // 스피커 (볼륨 적용)
    recDest = actx.createMediaStreamDestination();
    fadeGain.connect(recDest);            // 녹화용 (볼륨과 무관하게 원음 레벨)
    freq = new Uint8Array(analyser.frequencyBinCount);
    wave = new Uint8Array(analyser.fftSize);
  }

  // ---------- 트랙 목록 ----------
  const tracks = []; // {file, url, name}
  let current = -1;

  function baseName(n) { return n.replace(/\.[^.]+$/, ""); }
  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ":" + String(r).padStart(2, "0");
  }
  function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + "MB" : Math.round(b / 1024) + "KB"; }

  function addAudioFiles(files) {
    const list = Array.from(files).filter((f) => f.type.startsWith("audio/") || /\.(wav|flac|mp3|m4a|aac|ogg|opus)$/i.test(f.name));
    if (!list.length) return;
    list.forEach((file) => tracks.push({ file, url: URL.createObjectURL(file), name: baseName(file.name) }));
    renderTracks();
    if (current < 0) selectTrack(tracks.length - list.length, false);
  }

  function renderTracks() {
    const ul = $("#track-list");
    ul.innerHTML = "";
    tracks.forEach((t, i) => {
      const li = document.createElement("li");
      if (i === current) li.className = "on";
      const ext = (t.file.name.split(".").pop() || "").toUpperCase();
      li.innerHTML = `<span>${i === current && !audio.paused ? "♪" : i + 1}</span>
        <span class="name"></span><span class="meta">${ext} · ${fmtSize(t.file.size)}</span>
        <button class="del" aria-label="삭제">✕</button>`;
      li.querySelector(".name").textContent = t.name;
      li.addEventListener("click", (e) => {
        if (exporting) return;
        if (e.target.closest(".del")) { removeTrack(i); return; }
        selectTrack(i, true);
      });
      ul.appendChild(li);
    });
    const has = tracks.length > 0;
    $("#play-btn").disabled = !has;
    $("#seek").disabled = !has;
    $("#export-btn").disabled = !has;
  }

  function removeTrack(i) {
    const [t] = tracks.splice(i, 1);
    if (i === current) {
      audio.pause(); audio.removeAttribute("src"); audio.load();
      current = -1;
      URL.revokeObjectURL(t.url);
      if (tracks.length) selectTrack(Math.min(i, tracks.length - 1), false);
      else { $("#now-title").textContent = "음원을 추가하세요"; updateTime(); }
    } else {
      URL.revokeObjectURL(t.url);
      if (i < current) current--;
    }
    renderTracks();
  }

  function selectTrack(i, autoplay) {
    if (i < 0 || i >= tracks.length) return;
    current = i;
    audio.src = tracks[i].url;
    audio.load();
    $("#now-title").textContent = tracks[i].name;
    $("#ex-end").value = "";
    if (autoplay) play();
    renderTracks();
    if ("mediaSession" in navigator) {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: currentTitle(), artist: cfg.artist }); } catch (e) { /* ignore */ }
    }
  }

  function currentTitle() {
    const t = $("#title-text").value.trim();
    return t || (tracks[current] ? tracks[current].name : "");
  }

  async function play() {
    if (current < 0) return;
    ensureAudio();
    try { await audio.play(); } catch (e) { console.warn(e); }
  }

  $("#audio-input").addEventListener("change", (e) => { addAudioFiles(e.target.files); e.target.value = ""; });
  $("#play-btn").addEventListener("click", () => {
    if (exporting) return;
    if (audio.paused) play(); else audio.pause();
  });
  $("#prev-btn").addEventListener("click", () => {
    if (exporting || !tracks.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    selectTrack((current - 1 + tracks.length) % tracks.length, true);
  });
  $("#next-btn").addEventListener("click", () => {
    if (exporting || !tracks.length) return;
    selectTrack((current + 1) % tracks.length, true);
  });
  $("#seek").addEventListener("input", (e) => { if (!exporting) audio.currentTime = +e.target.value; });

  audio.addEventListener("play", () => { $("#play-btn").textContent = "❚❚"; renderTracks(); });
  audio.addEventListener("pause", () => { $("#play-btn").textContent = "▶"; renderTracks(); });
  audio.addEventListener("loadedmetadata", updateTime);
  audio.addEventListener("timeupdate", updateTime);
  audio.addEventListener("ended", () => {
    if (exporting) { finishExport(); return; }
    if (cfg.loopOne) { audio.currentTime = 0; play(); return; }
    if (current < tracks.length - 1) selectTrack(current + 1, true);
  });
  audio.addEventListener("error", () => {
    if (!audio.getAttribute("src")) return;
    const name = tracks[current] ? tracks[current].file.name : "";
    alert(`"${name}" 파일을 이 브라우저에서 재생할 수 없습니다.\n다른 포맷(MP3/WAV/M4A)으로 시도하거나 다른 브라우저를 사용해 보세요.`);
  });

  function updateTime() {
    const d = audio.duration || 0;
    const seek = $("#seek");
    seek.max = isFinite(d) ? d : 0;
    seek.value = audio.currentTime || 0;
    $("#cur").textContent = fmtTime(audio.currentTime);
    $("#dur").textContent = fmtTime(d);
  }

  // ---------- 배경 ----------
  let bgImage = null, bgKind = null, bgUrl = null;

  function setBackground(file) {
    clearBackground();
    bgUrl = URL.createObjectURL(file);
    if (file.type.startsWith("video/")) {
      bgKind = "video";
      bgVideo.src = bgUrl;
      bgVideo.play().catch(() => { /* 사용자 제스처 후 재시도 */ });
      bgVideo.onloadedmetadata = () => showBgInfo(file, bgVideo.videoWidth, bgVideo.videoHeight);
    } else {
      bgKind = "image";
      const img = new Image();
      img.onload = () => { bgImage = img; showBgInfo(file, img.naturalWidth, img.naturalHeight); };
      img.onerror = () => alert("이미지를 불러올 수 없습니다. (HEIC 등은 JPG/PNG로 변환 후 사용하세요)");
      img.src = bgUrl;
    }
  }
  function showBgInfo(file, w, h) {
    const ratio = w && h ? (w / h) : 0;
    const is916 = Math.abs(ratio - 9 / 16) < 0.02;
    $("#bg-info").textContent = `${w}×${h}` + (is916 ? " · 9:16 ✓" : " · 9:16 아님 (맞춤 옵션 적용)");
  }
  function clearBackground() {
    bgVideo.pause(); bgVideo.removeAttribute("src"); bgVideo.load();
    bgImage = null; bgKind = null;
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    bgUrl = null;
    $("#bg-info").textContent = "";
  }
  $("#bg-input").addEventListener("change", (e) => { if (e.target.files[0]) setBackground(e.target.files[0]); e.target.value = ""; });
  $("#bg-clear").addEventListener("click", clearBackground);

  // 드래그 앤 드롭 (데스크톱)
  $$(".drop").forEach((zone) => {
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault(); zone.classList.remove("dragover");
      if (zone.htmlFor === "audio-input") addAudioFiles(e.dataTransfer.files);
      else if (e.dataTransfer.files[0]) setBackground(e.dataTransfer.files[0]);
    });
  });

  // 블러용 저해상도 버퍼 (Safari는 ctx.filter 미지원 → 다운스케일 블러)
  const blurCanvas = document.createElement("canvas");
  const blurCtx = blurCanvas.getContext("2d");

  function drawBackground(bass) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, cfg.bgc1); g.addColorStop(1, cfg.bgc2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    let src = null, sw = 0, sh = 0;
    if (bgKind === "image" && bgImage) { src = bgImage; sw = bgImage.naturalWidth; sh = bgImage.naturalHeight; }
    else if (bgKind === "video" && bgVideo.readyState >= 2) {
      src = bgVideo; sw = bgVideo.videoWidth; sh = bgVideo.videoHeight;
      if (bgVideo.paused) bgVideo.play().catch(() => {});
    }
    if (src && sw && sh) {
      const s = cfg.fit === "cover" ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
      const zoom = cfg.beatZoom ? 1 + Math.pow(bass, 2) * 0.07 : 1;
      const dw = sw * s * zoom, dh = sh * s * zoom;
      const dx = (W - dw) / 2, dy = (H - dh) / 2;
      if (cfg.blur > 0) {
        const f = 1 + cfg.blur * 0.6;
        const bw = Math.max(8, Math.round(W / f)), bh = Math.max(8, Math.round(H / f));
        if (blurCanvas.width !== bw || blurCanvas.height !== bh) { blurCanvas.width = bw; blurCanvas.height = bh; }
        else blurCtx.clearRect(0, 0, bw, bh);
        blurCtx.imageSmoothingQuality = "high";
        blurCtx.drawImage(src, dx / f, dy / f, dw / f, dh / f);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(blurCanvas, 0, 0, W, H);
      } else {
        ctx.drawImage(src, dx, dy, dw, dh);
      }
    }
    if (cfg.dim > 0) {
      ctx.fillStyle = `rgba(0,0,0,${cfg.dim})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------- 분석 데이터 ----------
  let bandVals = new Float32Array(cfg.bands);
  let peaks = new Float32Array(cfg.bands);
  let bassEnv = 0;
  let idleT = 0;

  function computeBands(n) {
    if (bandVals.length !== n) { bandVals = new Float32Array(n); peaks = new Float32Array(n); }
    const playing = analyser && !audio.paused;
    if (!playing) {
      // 정지 상태: 스타일 미리보기용 잔잔한 가상 데이터
      idleT += 0.02;
      for (let i = 0; i < n; i++) {
        const target = 0.08 + 0.06 * Math.sin(idleT * 2 + i * 0.35) + 0.04 * Math.sin(idleT * 3.1 + i * 0.9);
        bandVals[i] += (target - bandVals[i]) * 0.1;
        peaks[i] = Math.max(bandVals[i], peaks[i] - 0.01);
      }
      bassEnv *= 0.95;
      return;
    }
    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(wave);
    const binHz = actx.sampleRate / analyser.fftSize;
    const fMin = 35, fMax = Math.min(16000, actx.sampleRate / 2);
    const ratio = fMax / fMin;
    for (let i = 0; i < n; i++) {
      const lo = Math.floor(fMin * Math.pow(ratio, i / n) / binHz);
      const hi = Math.max(lo + 1, Math.floor(fMin * Math.pow(ratio, (i + 1) / n) / binHz));
      let m = 0;
      for (let b = lo; b < hi && b < freq.length; b++) if (freq[b] > m) m = freq[b];
      let v = Math.pow(m / 255, 1.6) * (1 + 0.5 * i / n) * cfg.sens;
      v = Math.min(1, v);
      bandVals[i] = v;
      peaks[i] = Math.max(v, peaks[i] - 0.012);
    }
    // 저음(35~150Hz) 에너지
    let sum = 0, cnt = 0;
    for (let b = Math.floor(35 / binHz); b <= Math.ceil(150 / binHz); b++) { sum += freq[b]; cnt++; }
    const bass = Math.min(1, Math.pow(sum / cnt / 255, 2) * 1.4 * cfg.sens);
    bassEnv = Math.max(bass, bassEnv * 0.9);
  }

  function getWave(points) {
    const out = new Float32Array(points);
    if (analyser && !audio.paused && wave.length) {
      const step = wave.length / points;
      for (let i = 0; i < points; i++) out[i] = ((wave[Math.floor(i * step)] - 128) / 128) * cfg.sens;
    } else {
      for (let i = 0; i < points; i++) out[i] = 0.08 * Math.sin(i / points * Math.PI * 6 + idleT * 4) * Math.sin(i / points * Math.PI);
    }
    return out;
  }

  // ---------- 색 유틸 ----------
  function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(t, a = 1) {
    const c1 = hexToRgb(cfg.color1), c2 = hexToRgb(cfg.color2);
    const c = c1.map((v, i) => Math.round(v + (c2[i] - v) * t));
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  }
  function hGrad(x0, x1) {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, cfg.color1); g.addColorStop(1, cfg.color2);
    return g;
  }
  function vGrad(y0, y1) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, cfg.color2); g.addColorStop(1, cfg.color1);
    return g;
  }
  function glow(on, color) {
    ctx.shadowBlur = on && cfg.glow ? 28 * K : 0;
    ctx.shadowColor = color || cfg.color1;
  }

  function centerY() {
    return cfg.position === "top" ? H * 0.27 : cfg.position === "center" ? H * 0.5 : H * 0.73;
  }

  // ---------- 비주얼라이저 스타일 ----------
  const draw = {};

  draw.bars = () => {
    const n = cfg.bands, cy = centerY();
    const total = Math.min(W * 0.96, W * 0.86 * cfg.size);
    const maxH = H * 0.2 * cfg.size;
    const slot = total / n, bw = slot * 0.68;
    const x0 = (W - total) / 2, base = cy + maxH / 2;
    const path = new Path2D(), caps = new Path2D();
    for (let i = 0; i < n; i++) {
      const h = Math.max(3 * K, bandVals[i] * maxH);
      const x = x0 + i * slot + (slot - bw) / 2;
      path.rect(x, base - h, bw, h);
      caps.rect(x, base - peaks[i] * maxH - 8 * K, bw, 4 * K);
    }
    glow(true);
    ctx.fillStyle = vGrad(base - maxH, base);
    ctx.fill(path);
    glow(false);
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.fill(caps);
    // 바닥 반사
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.translate(0, base * 2 + 6 * K);
    ctx.scale(1, -1);
    ctx.fillStyle = vGrad(base - maxH, base);
    ctx.fill(path);
    ctx.restore();
  };

  draw.mirror = () => {
    const n = Math.round(cfg.bands / 2), cy = centerY();
    const total = Math.min(W * 0.96, W * 0.86 * cfg.size);
    const maxH = H * 0.11 * cfg.size;
    const slot = total / (n * 2), bw = slot * 0.6;
    const path = new Path2D();
    for (let i = 0; i < n; i++) {
      const v = bandVals[Math.floor(i * cfg.bands / n)];
      const h = Math.max(2 * K, v * maxH);
      const xr = W / 2 + i * slot + (slot - bw) / 2;
      const xl = W / 2 - (i + 1) * slot + (slot - bw) / 2;
      path.rect(xr, cy - h, bw, h * 2);
      path.rect(xl, cy - h, bw, h * 2);
    }
    glow(true);
    ctx.fillStyle = hGrad(W / 2 - total / 2, W / 2 + total / 2);
    ctx.fill(path);
    glow(false);
  };

  function radialPoint(cx, cy, r, a) { return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; }

  draw.circle = () => {
    const n = cfg.bands, cx = W / 2, cy = centerY();
    const R = W * 0.2 * cfg.size * (1 + bassEnv * 0.08);
    const L = W * 0.17 * cfg.size;
    const bw = Math.max(2 * K, (Math.PI * R / n) * 0.55);
    ctx.lineCap = "round";
    ctx.lineWidth = bw;
    glow(true);
    // 좌우 대칭: 아래쪽에서 시작해 양쪽으로
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < n; i++) {
        const a = Math.PI / 2 + side * (i + 0.5) / n * Math.PI;
        const v = bandVals[i];
        const [x1, y1] = radialPoint(cx, cy, R + 6 * K, a);
        const [x2, y2] = radialPoint(cx, cy, R + 6 * K + Math.max(3 * K, v * L), a);
        ctx.strokeStyle = mix(i / n);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
    }
    ctx.lineWidth = 5 * K;
    ctx.strokeStyle = hGrad(cx - R, cx + R);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    glow(false);
    ctx.fillStyle = `rgba(255,255,255,${0.04 + bassEnv * 0.12})`;
    ctx.beginPath(); ctx.arc(cx, cy, R - 10 * K, 0, Math.PI * 2); ctx.fill();
  };

  draw.wave = () => {
    const pts = 256, cy = centerY();
    const amp = H * 0.13 * cfg.size;
    const data = getWave(pts);
    const x0 = W * 0.04, w = W * 0.92;
    ctx.lineJoin = "round";
    [[1, 6, 1], [0.6, 3, 0.35]].forEach(([scale, lw, alpha], k) => {
      ctx.beginPath();
      for (let i = 0; i < pts; i++) {
        const env = Math.sin(i / (pts - 1) * Math.PI); // 양 끝을 0으로
        const x = x0 + i / (pts - 1) * w;
        const y = cy + data[i] * amp * env * scale * (k ? -1 : 1);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lw * K;
      ctx.strokeStyle = hGrad(x0, x0 + w);
      glow(k === 0);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    glow(false);
  };

  draw.mountain = () => {
    const n = cfg.bands, cy = centerY();
    const maxH = H * 0.2 * cfg.size;
    const base = cy + maxH / 2;
    // 저음을 가운데로 오도록 좌우 대칭 배열
    const vals = [];
    for (let i = n - 1; i >= 0; i--) vals.push(bandVals[i]);
    for (let i = 0; i < n; i++) vals.push(bandVals[i]);
    const m = vals.length, step = W / (m - 1);
    const ys = vals.map((v) => base - v * maxH);
    const curve = new Path2D();
    curve.moveTo(0, ys[0]);
    for (let i = 1; i < m; i++) {
      const xc = (i - 0.5) * step;
      curve.quadraticCurveTo((i - 1) * step, ys[i - 1], xc, (ys[i - 1] + ys[i]) / 2);
    }
    curve.lineTo(W, ys[m - 1]);
    const fill = new Path2D(curve);
    fill.lineTo(W, base); fill.lineTo(0, base); fill.closePath();
    const g = ctx.createLinearGradient(0, base - maxH, 0, base);
    g.addColorStop(0, mix(1, 0.85)); g.addColorStop(1, mix(0, 0.05));
    ctx.fillStyle = g;
    ctx.fill(fill);
    glow(true, cfg.color2);
    ctx.lineWidth = 4 * K;
    ctx.strokeStyle = hGrad(0, W);
    ctx.stroke(curve);
    glow(false);
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.translate(0, base * 2);
    ctx.scale(1, -0.5);
    ctx.fillStyle = g;
    ctx.fill(fill);
    ctx.restore();
  };

  draw.ring = () => {
    const pts = 240, cx = W / 2, cy = centerY();
    const R = W * 0.25 * cfg.size * (1 + bassEnv * 0.06);
    const amp = W * 0.12 * cfg.size;
    const data = getWave(pts);
    ctx.lineJoin = "round";
    [[cfg.color1, 1, 0], [cfg.color2, -1, 0.6]].forEach(([col, dir, rot], k) => {
      ctx.beginPath();
      for (let i = 0; i <= pts; i++) {
        const idx = i % pts;
        const a = idx / pts * Math.PI * 2 + rot + idleT * 0.2;
        const r = R + data[idx] * amp * dir;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.lineWidth = (k ? 3 : 5) * K;
      ctx.strokeStyle = col;
      ctx.globalAlpha = k ? 0.7 : 1;
      glow(true, col);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    glow(false);
  };

  draw.dots = () => {
    const cols = Math.min(cfg.bands, 40), rows = 18, cy = centerY();
    const total = Math.min(W * 0.96, W * 0.86 * cfg.size);
    const cell = total / cols;
    const r = cell * 0.32;
    const x0 = (W - total) / 2;
    const top = cy - rows * cell / 2;
    for (let c = 0; c < cols; c++) {
      const v = bandVals[Math.floor(c * cfg.bands / cols)];
      const lit = Math.round(v * rows);
      const pk = Math.min(rows - 1, Math.round(peaks[Math.floor(c * cfg.bands / cols)] * rows));
      for (let rr = 0; rr < rows; rr++) {
        const on = rr < lit, isPeak = rr === pk && pk > 0;
        const x = x0 + c * cell + cell / 2;
        const y = top + (rows - 1 - rr) * cell + cell / 2;
        ctx.fillStyle = on || isPeak ? mix(rr / (rows - 1)) : "rgba(255,255,255,.06)";
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
  };

  const particles = [];
  draw.particles = () => {
    const cx = W / 2, cy = centerY();
    const R = W * 0.16 * cfg.size * (1 + bassEnv * 0.3);
    const emit = Math.floor(2 + bassEnv * 10);
    for (let i = 0; i < emit && particles.length < 500; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (2 + Math.random() * 6 + bassEnv * 14) * K;
      particles.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, s: (2 + Math.random() * 5) * K, t: Math.random() });
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vx *= 0.985; p.vy *= 0.985; p.life -= 0.012;
      if (p.life <= 0 || p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) { particles.splice(i, 1); continue; }
      ctx.fillStyle = mix(p.t, p.life);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (0.5 + p.life), 0, Math.PI * 2); ctx.fill();
    }
    // 중앙 펄스 링 + 짧은 스펙트럼 틱
    glow(true);
    ctx.lineWidth = 6 * K;
    ctx.strokeStyle = hGrad(cx - R, cx + R);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    glow(false);
    const n = 48;
    ctx.lineWidth = 3 * K; ctx.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 - Math.PI / 2;
      const v = bandVals[Math.floor((i < n / 2 ? i : n - 1 - i) * 2 * cfg.bands / n) % cfg.bands];
      const [x1, y1] = radialPoint(cx, cy, R - 12 * K, a);
      const [x2, y2] = radialPoint(cx, cy, R - 12 * K - v * R * 0.5, a);
      ctx.strokeStyle = mix(i / n, 0.9);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
  };

  // ---------- 텍스트 / 진행바 ----------
  function drawOverlay() {
    const textY = cfg.position === "bottom" ? H * 0.12 : H * 0.84;
    if (cfg.showText) {
      const title = currentTitle(), artist = cfg.artist;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 16 * K;
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${72 * K}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
      fitText(title, W / 2, textY, W * 0.86);
      ctx.fillStyle = "rgba(255,255,255,.75)";
      ctx.font = `500 ${42 * K}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
      fitText(artist, W / 2, textY + 82 * K, W * 0.86);
      ctx.shadowBlur = 0;
    }
    if (cfg.showProgress && audio.duration) {
      const y = textY + (cfg.showText ? 160 : 0) * K;
      const x0 = W * 0.12, w = W * 0.76;
      const p = Math.min(1, audio.currentTime / audio.duration);
      ctx.fillStyle = "rgba(255,255,255,.2)";
      roundRect(x0, y - 4 * K, w, 8 * K, 4 * K); ctx.fill();
      ctx.fillStyle = hGrad(x0, x0 + w);
      roundRect(x0, y - 4 * K, Math.max(8 * K, w * p), 8 * K, 4 * K); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.7)";
      ctx.font = `500 ${30 * K}px -apple-system, sans-serif`;
      ctx.textAlign = "left"; ctx.fillText(fmtTime(audio.currentTime), x0, y + 40 * K);
      ctx.textAlign = "right"; ctx.fillText(fmtTime(audio.duration), x0 + w, y + 40 * K);
    }
  }
  function fitText(t, x, y, maxW) {
    if (!t) return;
    let s = t;
    while (s.length > 1 && ctx.measureText(s).width > maxW) s = s.slice(0, -2) + "…";
    ctx.fillText(s, x, y);
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------- 렌더 루프 ----------
  function frame() {
    if (analyser) analyser.smoothingTimeConstant = cfg.smooth;
    computeBands(cfg.bands);
    ctx.save();
    drawBackground(bassEnv);
    (draw[cfg.style] || draw.bars)();
    drawOverlay();
    if (exporting && cfg.fadeVideo) {
      const g = fadeLevel();
      if (g < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - g})`; ctx.fillRect(0, 0, W, H); }
    }
    ctx.restore();
    if (exporting) tickExport();
    requestAnimationFrame(frame);
  }

  // ---------- MP4 추출 ----------
  const MIME_CANDIDATES = [
    "video/mp4;codecs=avc1.640028,mp4a.40.2",
    "video/mp4;codecs=avc1.4d002a,mp4a.40.2",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a",
    "video/mp4;codecs=avc1,opus",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  function pickMime() {
    if (typeof MediaRecorder === "undefined" || !canvas.captureStream) return null;
    return MIME_CANDIDATES.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || "";
  }
  const exportMime = pickMime();
  (function showFormat() {
    const b = $("#fmt-badge");
    if (exportMime === null) { b.textContent = "녹화 미지원"; b.className = "badge warn"; return; }
    if (exportMime.startsWith("video/mp4")) { b.textContent = "MP4 추출 가능"; b.className = "badge ok"; }
    else {
      b.textContent = "WebM 추출"; b.className = "badge warn";
      $("#export-btn").textContent = "🎬 영상 추출 (WebM)";
      $("#export-note").textContent += " 이 브라우저는 MP4 녹화를 지원하지 않아 WebM으로 저장됩니다. 최신 Chrome(안드로이드) 또는 Safari(iOS)에서는 MP4로 저장됩니다.";
    }
  })();

  let exporting = false, recorder = null, chunks = [], exStart = 0, exEnd = 0, cancelled = false, wakeLock = null;

  async function startExport() {
    if (exporting || current < 0) return;
    if (exportMime === null) { alert("이 브라우저는 캔버스 녹화를 지원하지 않습니다. 최신 Chrome 또는 Safari를 사용해 주세요."); return; }
    ensureAudio();
    await actx.resume();
    if (!isFinite(audio.duration) || !audio.duration) {
      await new Promise((r) => audio.addEventListener("loadedmetadata", r, { once: true }));
    }
    const dur = audio.duration;
    exStart = Math.max(0, Math.min(dur - 0.5, parseFloat($("#ex-start").value) || 0));
    const endIn = parseFloat($("#ex-end").value);
    exEnd = isFinite(endIn) && endIn > exStart ? Math.min(dur, endIn) : dur;

    audio.pause();
    audio.currentTime = exStart;
    await new Promise((r) => { audio.addEventListener("seeked", r, { once: true }); setTimeout(r, 1500); });
    if (bgKind === "video") { bgVideo.currentTime = 0; bgVideo.play().catch(() => {}); }

    const vStream = canvas.captureStream(cfg.fps);
    const stream = new MediaStream([...vStream.getVideoTracks(), ...recDest.stream.getAudioTracks()]);
    const opts = { videoBitsPerSecond: W >= 1080 ? 10_000_000 : 6_000_000, audioBitsPerSecond: 256_000 };
    if (exportMime) opts.mimeType = exportMime;
    try { recorder = new MediaRecorder(stream, opts); }
    catch (e) { delete opts.mimeType; recorder = new MediaRecorder(stream, opts); }

    chunks = []; cancelled = false;
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      vStream.getTracks().forEach((t) => t.stop());
      const raw = new Blob(chunks, { type: recorder.mimeType || exportMime || "video/webm" });
      chunks = [];
      if (!cancelled) finalizeVideo(raw).then(showResult);
    };

    exporting = true;
    document.body.classList.add("exporting");
    $("#rec-overlay").hidden = false;
    $("#export-btn").disabled = true;
    $("#result").hidden = true;
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch (e) { wakeLock = null; }

    if (cfg.fadeIn > 0) { fadeGain.gain.cancelScheduledValues(actx.currentTime); fadeGain.gain.setValueAtTime(0, actx.currentTime); }
    recorder.start(1000);
    try { await audio.play(); } catch (e) { cancelExport(); alert("재생을 시작할 수 없습니다: " + e.message); }
  }

  // 추출 구간 기준 페이드 레벨 (0~1). 재생 위치로 계산하므로 일시정지/재개에도 어긋나지 않습니다.
  function fadeLevel() {
    const t = audio.currentTime;
    const len = exEnd - exStart;
    const fi = Math.min(cfg.fadeIn, len / 2), fo = Math.min(cfg.fadeOut, len / 2);
    let g = 1;
    if (fi > 0) g = Math.min(g, (t - exStart) / fi);
    if (fo > 0) g = Math.min(g, (exEnd - t) / fo);
    return Math.max(0, Math.min(1, g));
  }

  function tickExport() {
    if (fadeGain && !audio.paused) fadeGain.gain.setTargetAtTime(fadeLevel(), actx.currentTime, 0.015);
    const p = (audio.currentTime - exStart) / (exEnd - exStart);
    $("#rec-progress").style.width = Math.max(0, Math.min(100, p * 100)) + "%";
    $("#rec-text").textContent = `녹화 중… ${fmtTime(audio.currentTime - exStart)} / ${fmtTime(exEnd - exStart)}`;
    if (audio.currentTime >= exEnd - 0.03) finishExport();
  }

  function endExportState() {
    exporting = false;
    audio.pause();
    if (fadeGain) { fadeGain.gain.cancelScheduledValues(actx.currentTime); fadeGain.gain.setValueAtTime(1, actx.currentTime); }
    document.body.classList.remove("exporting");
    $("#rec-overlay").hidden = true;
    $("#export-btn").disabled = !tracks.length;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }
  function finishExport() {
    if (!exporting) return;
    endExportState();
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }
  function cancelExport() {
    if (!exporting) return;
    cancelled = true;
    endExportState();
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }
  $("#rec-cancel").addEventListener("click", cancelExport);

  // 화면이 꺼지거나 앱을 벗어나면 녹화를 일시정지 → 돌아오면 이어서 녹화
  document.addEventListener("visibilitychange", () => {
    if (!exporting || !recorder) return;
    if (document.hidden) {
      audio.pause();
      if (recorder.state === "recording") recorder.pause();
    } else {
      if (recorder.state === "paused") recorder.resume();
      audio.play().catch(() => {});
      navigator.wakeLock?.request("screen").then((l) => { wakeLock = l; }).catch(() => {});
    }
  });
  // 녹화 중 외부(잠금화면 등)에서 일시정지된 경우 표시
  audio.addEventListener("pause", () => {
    if (exporting && !document.hidden) $("#rec-text").textContent = "일시정지됨 — 여기를 탭하면 이어서 녹화합니다";
  });
  $("#rec-overlay").addEventListener("click", (e) => {
    if (exporting && audio.paused && !e.target.closest("#rec-cancel")) {
      if (recorder.state === "paused") recorder.resume();
      audio.play().catch(() => {});
    }
  });

  // MediaRecorder 결과는 조각난(fragmented) MP4/WebM이라 헤더의 영상 길이가 0으로 기록됩니다.
  // 폰 플레이어는 끝까지 재생하지만 VLLO·TikTok 등은 앞부분(몇 초)만 인식하므로,
  // 재인코딩 없이 일반 MP4(faststart)/WebM으로 다시 포장(remux)해 길이 정보를 채웁니다.
  async function finalizeVideo(raw) {
    $("#export-btn").disabled = true;
    $("#rec-overlay").hidden = false;
    $("#rec-cancel").hidden = true;
    $("#rec-text").textContent = "영상 정리 중… (업로드용 변환)";
    $("#rec-progress").style.width = "0%";
    try {
      const mb = await import("./vendor/mediabunny.min.mjs");
      try {
        return await remux(mb, raw, true);
      } catch (e) {
        // H.264/AAC 변환이 실패해도 길이 정보만은 고친 파일을 만듭니다
        console.warn("코덱 변환 실패, 재포장만 시도합니다", e);
        return await remux(mb, raw, false);
      }
    } catch (e) {
      console.warn("remux 실패, 원본 녹화 파일을 사용합니다", e);
      return { blob: raw, codecs: "" };
    } finally {
      $("#rec-overlay").hidden = true;
      $("#rec-cancel").hidden = false;
      $("#export-btn").disabled = !tracks.length;
    }
  }

  async function remux(mb, raw, transcode) {
    const isMp4 = raw.type.includes("mp4");
    const input = new mb.Input({ source: new mb.BlobSource(raw), formats: mb.ALL_FORMATS });
    const output = new mb.Output({
      format: isMp4 ? new mb.Mp4OutputFormat({ fastStart: "in-memory" }) : new mb.WebMOutputFormat(),
      target: new mb.BufferTarget(),
    });
    const vt = await input.getPrimaryVideoTrack(), at = await input.getPrimaryAudioTrack();
    const opts = { input, output, showWarnings: false };
    let vCodec = vt ? vt.codec : null, aCodec = at ? at.codec : null;
    // 일부 브라우저는 MP4 안에 VP9/Opus를 넣어 녹화합니다. 편집·업로드 앱 호환을 위해
    // 기기에서 인코딩이 가능하면 H.264/AAC로 변환합니다 (불가하면 원래 코덱 유지).
    if (transcode && isMp4 && vt && vCodec !== "avc" && await mb.canEncodeVideo("avc", { width: W, height: H })) {
      opts.video = { codec: "avc", bitrate: W >= 1080 ? 10_000_000 : 6_000_000 };
      vCodec = "avc";
      $("#rec-text").textContent = "H.264로 변환 중… (업로드용)";
    }
    if (transcode && isMp4 && at && aCodec !== "aac" && await mb.canEncodeAudio("aac")) {
      opts.audio = { codec: "aac", bitrate: 192_000 };
      aCodec = "aac";
    }
    const conversion = await mb.Conversion.init(opts);
    if (!conversion.isValid) throw new Error("conversion invalid");
    conversion.onProgress = (p) => { $("#rec-progress").style.width = Math.round(p * 100) + "%"; };
    await conversion.execute();
    const blob = new Blob([output.target.buffer], { type: isMp4 ? "video/mp4" : "video/webm" });
    return { blob, codecs: codecLabel(vCodec, aCodec) };
  }

  function codecLabel(v, a) {
    const names = { avc: "H.264", hevc: "H.265", vp9: "VP9", vp8: "VP8", av1: "AV1", aac: "AAC", opus: "Opus", mp3: "MP3" };
    return [v, a].filter(Boolean).map((c) => names[c] || c).join(" / ");
  }

  let resultUrl = null, resultFile = null;
  function showResult({ blob, codecs }) {
    const isMp4 = blob.type.includes("mp4");
    const ext = isMp4 ? "mp4" : "webm";
    const safe = (currentTitle() || "visualizer").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60);
    const name = `${safe}_visualizer.${ext}`;
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(blob);
    resultFile = new File([blob], name, { type: isMp4 ? "video/mp4" : "video/webm" });
    $("#result-video").src = resultUrl;
    const a = $("#dl-link");
    a.href = resultUrl; a.download = name;
    $("#result-info").textContent = `${name} · ${fmtSize(blob.size)} · ${W}×${H} ${cfg.fps}fps` + (codecs ? ` · ${codecs}` : "");
    $("#share-btn").hidden = !(navigator.canShare && navigator.canShare({ files: [resultFile] }));
    $("#result").hidden = false;
    activateTab("export");
    $("#result").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  $("#share-btn").addEventListener("click", async () => {
    if (!resultFile) return;
    try { await navigator.share({ files: [resultFile], title: currentTitle() }); }
    catch (e) { if (e.name !== "AbortError") alert("공유 실패: " + e.message); }
  });
  $("#export-btn").addEventListener("click", startExport);

  // 구간 프리셋
  $("#ex-full").addEventListener("click", () => { $("#ex-start").value = 0; $("#ex-end").value = ""; });
  $("#ex-60").addEventListener("click", () => { $("#ex-start").value = 0; $("#ex-end").value = 60; });
  $("#ex-here").addEventListener("click", () => {
    const s = Math.floor((audio.currentTime || 0) * 10) / 10;
    $("#ex-start").value = s; $("#ex-end").value = (s + 60).toFixed(1);
  });

  // ---------- UI 바인딩 ----------
  function activateTab(name) {
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    $$(".tabpane").forEach((p) => p.classList.toggle("active", p.dataset.pane === name));
  }
  $$(".tab").forEach((t) => t.addEventListener("click", () => activateTab(t.dataset.tab)));

  // 스타일 선택
  const grid = $("#style-grid");
  STYLES.forEach((s) => {
    const b = document.createElement("button");
    b.dataset.v = s.id;
    b.innerHTML = `<span class="ico">${s.ico}</span>${s.name}`;
    b.addEventListener("click", () => { cfg.style = s.id; particles.length = 0; syncUI(); save(); });
    grid.appendChild(b);
  });

  // 팔레트
  const pal = $("#palette");
  PALETTES.forEach(([a, b]) => {
    const btn = document.createElement("button");
    btn.style.background = `linear-gradient(135deg, ${a}, ${b})`;
    btn.setAttribute("aria-label", `${a} → ${b}`);
    btn.addEventListener("click", () => { cfg.color1 = a; cfg.color2 = b; syncUI(); save(); });
    pal.appendChild(btn);
  });

  function bindSeg(id, key, parse = (v) => v, after) {
    $$(`#${id} button`).forEach((b) => b.addEventListener("click", () => {
      if (exporting && (key === "res" || key === "fps")) return;
      cfg[key] = parse(b.dataset.v); syncUI(); save(); if (after) after();
    }));
  }
  bindSeg("position", "position");
  bindSeg("fit", "fit");
  bindSeg("res", "res", Number, () => setResolution(cfg.res));
  bindSeg("fps", "fps", Number);

  const RANGES = [
    ["size", "size", (v) => Math.round(v * 100) + "%"],
    ["sens", "sens", (v) => Math.round(v * 100) + "%"],
    ["smooth", "smooth", (v) => v.toFixed(2)],
    ["bands", "bands", (v) => String(v)],
    ["dim", "dim", (v) => Math.round(v * 100) + "%"],
    ["blur", "blur", (v) => v + "px"],
    ["fade-in", "fadeIn", (v) => v ? v.toFixed(1) + "초" : "없음"],
    ["fade-out", "fadeOut", (v) => v ? v.toFixed(1) + "초" : "없음"],
  ];
  RANGES.forEach(([id, key]) => $("#" + id).addEventListener("input", (e) => { cfg[key] = +e.target.value; syncUI(); save(); }));

  [["glow", "glow"], ["show-text", "showText"], ["show-progress", "showProgress"], ["beat-zoom", "beatZoom"], ["loop-one", "loopOne"], ["fade-video", "fadeVideo"]]
    .forEach(([id, key]) => $("#" + id).addEventListener("change", (e) => { cfg[key] = e.target.checked; save(); }));
  [["color1", "color1"], ["color2", "color2"], ["bgc1", "bgc1"], ["bgc2", "bgc2"]]
    .forEach(([id, key]) => $("#" + id).addEventListener("input", (e) => { cfg[key] = e.target.value; syncUI(); save(); }));
  $("#artist-text").addEventListener("input", (e) => { cfg.artist = e.target.value; save(); });
  $("#volume").addEventListener("input", (e) => {
    cfg.volume = +e.target.value; save();
    if (gainNode) gainNode.gain.value = cfg.volume;
  });

  function syncUI() {
    $$("#style-grid button").forEach((b) => b.classList.toggle("on", b.dataset.v === cfg.style));
    $$("#palette button").forEach((b, i) => b.classList.toggle("on", PALETTES[i][0] === cfg.color1 && PALETTES[i][1] === cfg.color2));
    [["position", cfg.position], ["fit", cfg.fit], ["res", String(cfg.res)], ["fps", String(cfg.fps)]]
      .forEach(([id, v]) => $$(`#${id} button`).forEach((b) => b.classList.toggle("on", b.dataset.v === v)));
    RANGES.forEach(([id, key, fmt]) => { $("#" + id).value = cfg[key]; $("#" + id + "-out").textContent = fmt(cfg[key]); });
    $("#color1").value = cfg.color1; $("#color2").value = cfg.color2;
    $("#bgc1").value = cfg.bgc1; $("#bgc2").value = cfg.bgc2;
    $("#glow").checked = cfg.glow; $("#show-text").checked = cfg.showText;
    $("#show-progress").checked = cfg.showProgress; $("#beat-zoom").checked = cfg.beatZoom;
    $("#loop-one").checked = cfg.loopOne; $("#fade-video").checked = cfg.fadeVideo; $("#volume").value = cfg.volume;
    $("#artist-text").value = cfg.artist;
    document.documentElement.style.setProperty("--accent", cfg.color1);
    document.documentElement.style.setProperty("--accent-2", cfg.color2);
  }
  syncUI();

  // ---------- PWA ----------
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  renderTracks();
  requestAnimationFrame(frame);
})();
