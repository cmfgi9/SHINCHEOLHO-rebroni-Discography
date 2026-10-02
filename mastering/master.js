/* Rebroni Mastering — 화면 로직
 * 음원 디코딩 → Worker에서 분석 → 무드/레퍼런스 기반 자동 설정 → Worker에서 마스터링
 * → A/B 비교 재생(라우드니스 맞춤·플랫폼 시뮬레이션) → WAV·리포트 저장, 비주얼라이저로 전달
 */
(() => {
  "use strict";

  const D = window.RDSP;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // ---------- 설정 ----------
  const DEFAULTS = {
    mood: "balanced", useRef: false, targetLufs: -14, ceiling: -1,
    eqAmount: 0.6, low: 0, presence: 0, air: 0, comp: 0.2, warmth: 0.1, width: 1.05, monoBass: true,
    bits: 24, monitor: "match",
  };
  const STORE_KEY = "rebroni-mastering-settings";
  const SAVED_KEYS = ["mood", "ceiling", "bits", "monitor"]; // 곡마다 자동으로 정해지는 값은 저장하지 않음
  const cfg = Object.assign({}, DEFAULTS);
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    SAVED_KEYS.forEach((k) => { if (k in s) cfg[k] = s[k]; });
  } catch (e) { /* ignore */ }
  const save = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(SAVED_KEYS.map((k) => [k, cfg[k]])))); } catch (e) { /* ignore */ }
  };

  // ---------- 상태 ----------
  const st = {
    name: "", fileName: "", fs: 0,
    srcBuf: null, outBuf: null, srcAn: null, outAn: null, stats: null,
    refAn: null, refName: "", sug: null,
  };

  const fmtTime = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  };
  const sgn = (v, d = 1) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
  const num = (v, d = 1) => (isFinite(v) ? (v < 0 ? "−" + Math.abs(v).toFixed(d) : v.toFixed(d)) : "—");
  const baseName = (n) => n.replace(/\.[^.]+$/, "");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- Worker ----------
  const worker = new Worker("worker.js?v=1");
  let reqId = 0;
  const pending = new Map();
  worker.onmessage = (e) => {
    const m = e.data, p = pending.get(m.id);
    if (!p) return;
    if (m.type === "progress") { if (p.onProgress) p.onProgress(m.label, m.pct); return; }
    pending.delete(m.id);
    if (m.type === "error") p.reject(new Error(m.message)); else p.resolve(m);
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || "처리 중 오류가 발생했습니다 (메모리 부족일 수 있습니다).");
    pending.forEach((p) => p.reject(err));
    pending.clear();
  };
  function call(msg, transfer = [], onProgress) {
    const id = ++reqId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress });
      worker.postMessage(Object.assign({ id }, msg), transfer);
    });
  }

  // ---------- 진행 표시 ----------
  function setBusy(label, pct) {
    const box = $("#busy");
    if (label == null) { box.hidden = true; return; }
    box.hidden = false;
    $("#busy-label").textContent = label;
    $("#busy-pct").textContent = pct != null ? Math.round(pct * 100) + "%" : "";
    $("#busy-bar").style.width = Math.round((pct || 0) * 100) + "%";
  }
  function setStatus(text, cls) {
    const b = $("#status-badge");
    b.textContent = text;
    b.className = "badge" + (cls ? " " + cls : "");
  }

  // ---------- 디코딩 ----------
  // decodeAudioData는 컨텍스트의 표본화율로 변환하므로, 원본 표본화율을 헤더에서 읽어 그 값으로 디코딩합니다.
  function sniffRate(ab) {
    try {
      const v = new DataView(ab);
      const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
      if (tag(0) === "RIFF" && tag(8) === "WAVE") {
        for (let o = 12; o + 8 <= v.byteLength;) {
          const size = v.getUint32(o + 4, true);
          if (tag(o) === "fmt ") return v.getUint32(o + 12, true);
          o += 8 + size + (size & 1);
        }
      }
      // Ogg: Opus는 항상 48kHz로 디코딩, Vorbis는 식별 헤더의 표본화율
      if (tag(0) === "OggS") {
        if (tag(28) === "Opus" && tag(32) === "Head") return 48000;
        if (v.getUint8(28) === 1 && tag(29) === "vorb") return v.getUint32(40, true);
      }
      if (tag(0) === "fLaC") return (v.getUint8(18) << 12) | (v.getUint8(19) << 4) | (v.getUint8(20) >> 4);
      if (tag(0) === "FORM" && (tag(8) === "AIFF" || tag(8) === "AIFC")) {
        for (let o = 12; o + 8 <= v.byteLength;) {
          const size = v.getUint32(o + 4, false);
          if (tag(o) === "COMM") { // 80비트 확장 정밀도 실수
            const p = o + 16, exp = v.getUint16(p, false) & 0x7fff, mant = v.getUint32(p + 2, false);
            return Math.round(mant * Math.pow(2, exp - 16383 - 31));
          }
          o += 8 + size + (size & 1);
        }
      }
    } catch (e) { /* 알 수 없는 포맷 */ }
    return 0;
  }

  let actx = null, gA = null, gB = null;
  function getCtx() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      actx = new AC();
      gA = actx.createGain(); gB = actx.createGain();
      gA.connect(actx.destination); gB.connect(actx.destination);
    }
    return actx;
  }
  function makeBuffer(chs, fs) {
    const buf = getCtx().createBuffer(2, chs[0].length, fs);
    chs.forEach((c, i) => buf.getChannelData(i).set(c));
    return buf;
  }

  async function decode(ab) {
    let sr = sniffRate(ab);
    if (!(sr >= 8000 && sr <= 384000)) sr = 44100;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const tryDecode = (rate) => new Promise((res, rej) => {
      const c = new OAC(2, 1, rate);
      const p = c.decodeAudioData(ab.slice(0), res, rej);
      if (p && p.then) p.then(res, rej);
    });
    let buf;
    try { buf = await tryDecode(sr); } catch (e) {
      if (sr === 44100) throw e;
      buf = await tryDecode(44100);
    }
    // 모노는 듀얼 모노로, 3채널 이상은 앞의 두 채널만 사용
    const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    return { chs: [L, R], fs: buf.sampleRate, channels: buf.numberOfChannels };
  }

  // ---------- 음원 불러오기 ----------
  let gen = 0;
  async function loadSource(file) {
    const my = ++gen;
    stopPlayback(true);
    st.srcAn = st.outAn = st.outBuf = st.sug = st.stats = null;
    renderAll();
    setStatus("분석 중…");
    try {
      setBusy("음원 디코딩 중…", 0.02);
      const dec = await decode(await file.arrayBuffer());
      if (my !== gen) return;
      const dur = dec.chs[0].length / dec.fs;
      st.name = baseName(file.name); st.fileName = file.name; st.fs = dec.fs;
      st.srcBuf = makeBuffer(dec.chs, dec.fs);
      $("#file-info").hidden = false;
      $("#file-info").innerHTML = `<b>${esc(file.name)}</b>
        <span>${(dec.fs / 1000).toFixed(1)} kHz · ${dec.channels === 1 ? "모노→스테레오" : dec.channels + "ch"} · ${fmtTime(dur)}</span>
        ${dur > 15 * 60 ? '<span style="color:var(--warn)">곡이 길어 처리에 시간이 걸리고 메모리를 많이 씁니다.</span>' : ""}`;
      setBusy("라우드니스 · 스펙트럼 분석 중…", 0.08);
      const chs = dec.chs.map((c) => c.slice());
      const m = await call({ type: "load", chs, fs: dec.fs }, chs.map((c) => c.buffer));
      if (my !== gen) return;
      st.srcAn = m.analysis;
      if (!isFinite(st.srcAn.loud.integrated)) throw new Error("소리가 거의 없거나 너무 짧은 음원입니다.");
      applySuggestion();
      setStatus("분석 완료");
      $("#ab-play").disabled = false;
      $("#auto-btn").disabled = false;
      renderAll();
      runMaster();
    } catch (e) {
      if (my !== gen) return;
      setBusy(null);
      setStatus("오류", "warn");
      alert(`"${file.name}" 파일을 처리할 수 없습니다.\n${e.message || e}\n다른 포맷(WAV/MP3)으로 시도하거나 다른 브라우저를 사용해 보세요.`);
    }
  }

  async function loadRef(ab, name) {
    try {
      setBusy("레퍼런스 분석 중…", 0.1);
      const dec = await decode(ab);
      const chs = dec.chs.map((c) => c.slice());
      const m = await call({ type: "analyzeRef", chs, fs: dec.fs }, chs.map((c) => c.buffer));
      st.refAn = m.analysis; st.refName = name;
      const r = st.refAn;
      $("#ref-info").hidden = false;
      $("#ref-info").innerHTML = `<div class="row"><b>${esc(name)}</b><button class="btn ghost small" id="ref-clear">✕ 제거</button></div>
        <span>${num(r.loud.integrated)} LUFS · LRA ${num(r.loud.lra)} LU · ${num(r.tp)} dBTP · 상관 ${r.corr.toFixed(2)}</span>`;
      $("#ref-clear").addEventListener("click", clearRef);
      cfg.useRef = true;
      if (!running) setBusy(null);
      if (st.srcAn) { applySuggestion(); renderAll(); scheduleMaster(0); } else syncUI();
    } catch (e) {
      if (!running) setBusy(null);
      alert("레퍼런스를 불러올 수 없습니다.\n" + (e.message || e));
    }
  }

  function clearRef() {
    st.refAn = null; st.refName = "";
    cfg.useRef = false;
    $("#ref-info").hidden = true;
    $("#catalog-select").value = "";
    if (st.srcAn) { applySuggestion(); renderAll(); scheduleMaster(0); } else syncUI();
  }

  // Rebroni 발매곡 목록 (Cloudflare Pages Function /api/tracks)
  async function loadCatalog() {
    const btn = $("#catalog-btn");
    btn.disabled = true; btn.textContent = "불러오는 중…";
    let list = null;
    for (const url of ["/api/tracks", "https://music.rebroni.com/api/tracks"]) {
      try {
        const r = await fetch(url);
        if (r.ok) { const j = await r.json(); if (Array.isArray(j) && j.length) { list = j; break; } }
      } catch (e) { /* 다음 주소 시도 */ }
    }
    btn.disabled = false; btn.textContent = "💿 Rebroni 발매곡에서 고르기";
    if (!list) { alert("발매곡 목록을 불러오지 못했습니다. 레퍼런스 파일을 직접 선택해 주세요."); return; }
    const sel = $("#catalog-select");
    sel.innerHTML = '<option value="">— 발매곡 선택 —</option>';
    list.filter((t) => !t.unlisted && t.url).forEach((t) => {
      const o = document.createElement("option");
      o.value = t.url;
      o.textContent = t.titleKo + (t.titleEn && t.titleEn !== t.titleKo ? ` (${t.titleEn})` : "") + (t.released ? ` · ${t.released}` : "");
      sel.appendChild(o);
    });
    sel.hidden = false;
    btn.hidden = true;
  }

  async function loadCatalogTrack(url, title) {
    try {
      setBusy("발매곡 내려받는 중…", 0.05);
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      await loadRef(await r.arrayBuffer(), title);
    } catch (e) {
      if (!running) setBusy(null);
      alert("발매곡을 내려받지 못했습니다.\n" + (e.message || e));
    }
  }

  // ---------- 자동 설정 ----------
  function applySuggestion() {
    st.sug = D.suggest(st.srcAn, cfg.mood, cfg.useRef ? st.refAn : null);
    Object.assign(cfg, st.sug.settings, { eqAmount: 0.6, low: 0, presence: 0, air: 0, monoBass: true });
    syncUI();
  }

  function params() {
    return {
      hpf: 25, eq: D.buildEq(st.sug.diff, cfg.eqAmount, cfg),
      comp: cfg.comp, warmth: cfg.warmth, width: cfg.width, monoHz: cfg.monoBass ? 120 : 0,
      targetLufs: cfg.targetLufs, ceiling: cfg.ceiling,
    };
  }

  // ---------- 마스터링 실행 ----------
  let timer = 0, running = false, dirty = false;
  function scheduleMaster(delay = 700) {
    if (!st.srcAn) return;
    clearTimeout(timer);
    timer = setTimeout(runMaster, delay);
    setStatus("변경됨 — 곧 다시 적용");
  }
  async function runMaster() {
    clearTimeout(timer);
    if (!st.srcAn) return;
    if (running) { dirty = true; return; }
    running = true; dirty = false;
    const my = gen;
    setStatus("마스터링 중…");
    try {
      const m = await call({ type: "master", params: params() }, [], (label, pct) => setBusy(label, pct));
      if (my !== gen) return;
      st.outBuf = makeBuffer(m.chs, st.fs);
      st.outAn = m.analysis; st.stats = m.stats;
      setStatus(`✓ 마스터 ${num(st.outAn.loud.integrated)} LUFS`, "ok");
      if (playing) startPlayback(position()); else updateGains(true);
      renderAll();
    } catch (e) {
      if (my === gen) { setStatus("오류", "warn"); alert("마스터링 중 오류가 발생했습니다.\n" + (e.message || e)); }
    } finally {
      running = false;
      setBusy(null);
      if (dirty) runMaster();
    }
  }

  // ---------- A/B 재생 ----------
  // 원본과 마스터를 동시에 재생하고 게인만 바꿔서, 전환 순간에도 위치가 정확히 같습니다.
  let srcNodes = [], playing = false, startAt = 0, offset = 0, which = "out";
  const duration = () => (st.srcBuf ? st.srcBuf.duration : 0);
  const position = () => (playing ? Math.min(duration(), actx.currentTime - startAt) : offset);

  function stopSources() {
    srcNodes.forEach((s) => { try { s.stop(); } catch (e) { /* 이미 정지 */ } s.disconnect(); });
    srcNodes = [];
  }
  function startPlayback(from) {
    if (!st.srcBuf) return;
    const ctx = getCtx();
    if (ctx.state === "suspended") ctx.resume();
    stopSources();
    from = Math.max(0, Math.min(from, duration() - 0.05));
    const t = ctx.currentTime + 0.05;
    [[st.srcBuf, gA], [st.outBuf, gB]].forEach(([buf, g]) => {
      if (!buf) return;
      const s = ctx.createBufferSource();
      s.buffer = buf; s.connect(g); s.start(t, from);
      srcNodes.push(s);
    });
    startAt = t - from; offset = from; playing = true;
    updateGains(true);
    $("#ab-play").textContent = "❚❚";
    requestAnimationFrame(tick);
  }
  function stopPlayback(reset) {
    if (playing) offset = position();
    stopSources();
    playing = false;
    if (reset) offset = 0;
    $("#ab-play").textContent = "▶";
    drawTimeline();
  }

  function levelGains() {
    const a = st.srcAn, b = st.outAn;
    let ga = 0, gb = 0;
    if (cfg.monitor === "match") {
      // 더 작은 쪽에 맞춰 큰 쪽을 줄임 — "크면 좋게 들리는" 착각 없이 소리 자체를 비교
      if (a && b) {
        const ref = Math.min(a.loud.integrated, b.loud.integrated);
        ga = ref - a.loud.integrated; gb = ref - b.loud.integrated;
      }
    } else if (cfg.monitor !== "raw") {
      const p = D.PLATFORMS.find((x) => x.id === cfg.monitor);
      if (a) ga = D.platformGain(p, a.loud.integrated, a.tp);
      if (b) gb = D.platformGain(p, b.loud.integrated, b.tp);
    }
    return { ga, gb };
  }
  function updateGains(instant) {
    const { ga, gb } = levelGains();
    const useB = which === "out" && !!st.outBuf;
    const note = $("#monitor-note");
    if (!st.srcAn) note.textContent = "";
    else if (cfg.monitor === "raw") note.textContent = "보정 없이 실제 파일 음량으로 재생합니다.";
    else note.textContent = `재생 게인 — A 원본 ${sgn(ga)} dB · B 마스터 ${st.outAn ? sgn(gb) + " dB" : "준비 중"}`;
    if (!actx) return;
    const t = actx.currentTime, ramp = instant ? 0.005 : 0.04;
    const set = (node, v) => {
      node.gain.cancelScheduledValues(t);
      node.gain.setValueAtTime(node.gain.value, t);
      node.gain.linearRampToValueAtTime(v, t + ramp);
    };
    set(gA, useB ? 0 : D.dbToLin(ga));
    set(gB, useB ? D.dbToLin(gb) : 0);
  }

  function tick() {
    if (!playing) return;
    if (position() >= duration() - 0.01) { stopPlayback(true); return; }
    drawTimeline();
    requestAnimationFrame(tick);
  }

  // ---------- 그래프 ----------
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  function prep(canvas) {
    if (!canvas.dataset.h) canvas.dataset.h = canvas.getAttribute("height");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 300, h = +canvas.dataset.h;
    canvas.style.height = h + "px";
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = "10px -apple-system, 'Noto Sans KR', sans-serif";
    return { ctx, w, h };
  }
  const logX = (f, x0, x1) => x0 + (Math.log(f / 20) / Math.log(1000)) * (x1 - x0);
  function freqGrid(ctx, x0, x1, h) {
    ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1;
    [[50, "50"], [100, "100"], [200, "200"], [500, "500"], [1000, "1k"], [2000, "2k"], [5000, "5k"], [10000, "10k"]].forEach(([f, t]) => {
      const x = Math.round(logX(f, x0, x1)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h - 14); ctx.stroke();
      ctx.fillText(t, x - 8, h - 3);
    });
  }
  function line(ctx, pts, color, width, dash) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []);
    ctx.beginPath();
    let on = false;
    pts.forEach(([x, y]) => {
      if (!isFinite(y)) { on = false; return; }
      if (on) ctx.lineTo(x, y); else { ctx.moveTo(x, y); on = true; }
    });
    ctx.stroke(); ctx.setLineDash([]);
  }
  // 곡선 모양 비교용: 100Hz~8kHz 평균을 0 dB로 맞춤
  function centered(vals) {
    let s = 0, c = 0;
    D.THIRD.forEach((f, i) => { if (f >= 100 && f <= 8000 && isFinite(vals[i])) { s += vals[i]; c++; } });
    const off = c ? s / c : 0;
    return vals.map((v) => v - off);
  }

  function drawSpectrum() {
    const { ctx, w, h } = prep($("#spec-canvas"));
    const x0 = 6, x1 = w - 6;
    freqGrid(ctx, x0, x1, h);
    const series = [];
    if (st.sug) series.push([centered(st.sug.target), css("--accent-2"), 1.5, [5, 4]]);
    if (st.srcAn) series.push([centered(st.srcAn.spec.mid), css("--src"), 1.5]);
    if (st.outAn) series.push([centered(st.outAn.spec.mid), css("--accent"), 2.2]);
    if (!series.length) {
      ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.font = "12px sans-serif";
      ctx.fillText("음원을 추가하면 주파수 분포가 표시됩니다", x0 + 8, h / 2);
      return;
    }
    let top = -Infinity;
    series.forEach(([v]) => D.THIRD.forEach((f, i) => { if (f >= 31.5 && f <= 16000 && isFinite(v[i])) top = Math.max(top, v[i]); }));
    top = Math.ceil((top + 3) / 6) * 6;
    const range = 42, y = (v) => 4 + ((top - v) / range) * (h - 22);
    ctx.strokeStyle = "rgba(255,255,255,.05)";
    for (let v = top; v >= top - range; v -= 6) { ctx.beginPath(); ctx.moveTo(x0, y(v)); ctx.lineTo(x1, y(v)); ctx.stroke(); }
    series.forEach(([vals, color, lw, dash]) => {
      line(ctx, D.THIRD.map((f, i) => [logX(f, x0, x1), f >= 25 && f <= 20000 && vals[i] > top - range - 6 ? y(vals[i]) : NaN]), color, lw, dash);
    });
  }

  function drawTimeline() {
    const { ctx, w, h } = prep($("#time-canvas"));
    const dur = duration();
    if (!st.srcAn || !dur) return;
    const lo = -40, hi = 0, y = (v) => 4 + ((hi - Math.max(lo, v)) / (hi - lo)) * (h - 8);
    ctx.fillStyle = "rgba(255,255,255,.35)";
    [-10, -20, -30].forEach((v) => {
      ctx.strokeStyle = "rgba(255,255,255,.06)";
      ctx.beginPath(); ctx.moveTo(0, y(v)); ctx.lineTo(w, y(v)); ctx.stroke();
      ctx.fillText(String(v), 3, y(v) - 2);
    });
    const plot = (an, color, lw) => {
      const s = an.loud.shortTerm, step = Math.max(1, Math.floor(s.length / w));
      const pts = [];
      for (let j = 0; j < s.length; j += step) pts.push([((j * 0.1 + 1.5) / dur) * w, y(s[j])]);
      line(ctx, pts, color, lw);
    };
    plot(st.srcAn, css("--src"), 1.2);
    if (st.outAn) plot(st.outAn, css("--accent"), 1.6);
    line(ctx, [[0, y(cfg.targetLufs)], [w, y(cfg.targetLufs)]], css("--accent-2"), 1, [4, 4]);
    const px = Math.round((position() / dur) * w) + 0.5;
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    $("#ab-time").textContent = `${fmtTime(position())} / ${fmtTime(dur)}`;
  }

  function drawEq() {
    const { ctx, w, h } = prep($("#eq-canvas"));
    const x0 = 6, x1 = w - 6, fs = st.fs || 48000;
    freqGrid(ctx, x0, x1, h);
    const filters = st.sug ? D.eqFilters(params(), fs) : [];
    const pts = [];
    let peak = 6;
    for (let i = 0; i <= 160; i++) {
      const f = 20 * Math.pow(1000, i / 160);
      const v = filters.length ? D.responseDb(filters, f, fs) : 0;
      if (f > 30) peak = Math.max(peak, Math.abs(v));
      pts.push([logX(f, x0, x1), v]);
    }
    const range = Math.ceil(peak / 3) * 3, mid = (h - 16) / 2, y = (v) => mid - (Math.max(-range, Math.min(range, v)) / range) * (mid - 4);
    ctx.strokeStyle = "rgba(255,255,255,.15)";
    ctx.beginPath(); ctx.moveTo(x0, y(0)); ctx.lineTo(x1, y(0)); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.35)";
    ctx.fillText(`+${range}dB`, x0 + 2, 10); ctx.fillText(`−${range}`, x0 + 2, h - 18);
    line(ctx, pts.map(([x, v]) => [x, y(v)]), css("--accent"), 2);
  }

  // ---------- 화면 갱신 ----------
  function renderMeters() {
    const a = st.srcAn, b = st.outAn;
    const get = {
      lufs: (x) => x.loud.integrated, tp: (x) => x.tp, lra: (x) => x.loud.lra,
      plr: (x) => x.plr, corr: (x) => x.corr, width: (x) => x.sideMidDb,
    };
    $$(".meter").forEach((el) => {
      const k = el.dataset.k, d = k === "corr" ? 2 : 1;
      const main = b || a;
      el.querySelector(".mv").textContent = main ? num(get[k](main), d) : "—";
      el.querySelector(".ms").textContent = b ? `원본 ${num(get[k](a), d)}` : a ? "원본" : "";
      let cls = "";
      if (main) {
        const v = get[k](main);
        if (k === "lufs" && b) cls = Math.abs(v - cfg.targetLufs) <= 0.5 ? "ok" : "warn";
        if (k === "tp") cls = v > cfg.ceiling + 0.05 ? "bad" : b ? "ok" : "";
        if (k === "corr") cls = v < 0 ? "bad" : v < 0.2 ? "warn" : "";
        if (k === "plr" && b) cls = v < 7 ? "warn" : "";
      }
      el.className = "meter" + (cls ? " " + cls : "");
    });
  }

  function currentNotes() {
    const I = st.srcAn.loud.integrated;
    const notes = [{ lv: "info", t: `통합 라우드니스 ${num(I)} LUFS → 목표 ${num(cfg.targetLufs)} LUFS (${sgn(cfg.targetLufs - I)} dB)` }]
      .concat(st.sug.notes);
    const s = st.stats;
    if (s && s.limiter) {
      const gr = s.limiter.maxGr;
      if (gr > 8) notes.push({ lv: "warn", t: `리미터 최대 ${gr.toFixed(1)} dB 감쇄 — 과한 리미팅으로 타격감이 줄 수 있습니다. 목표 라우드니스를 낮추거나 글루 압축을 올려 보세요.` });
      else notes.push({ lv: "ok", t: `리미터 최대 ${gr.toFixed(1)} dB · 평균 ${s.limiter.avgGr.toFixed(1)} dB 감쇄 — 자연스러운 범위` });
    }
    return notes;
  }

  function renderNotes() {
    const ul = $("#notes");
    if (!st.sug) { ul.innerHTML = '<li class="muted">음원을 추가하면 분석 결과가 표시됩니다.</li>'; return; }
    ul.innerHTML = "";
    currentNotes().forEach((n) => {
      const li = document.createElement("li");
      li.className = n.lv; li.textContent = n.t;
      ul.appendChild(li);
    });
  }

  function renderPlatforms() {
    const tb = $("#ptable tbody");
    tb.innerHTML = "";
    D.PLATFORMS.forEach((p) => {
      const tr = document.createElement("tr");
      const cell = (an) => {
        if (!an) return "<td>—</td>";
        const g = D.platformGain(p, an.loud.integrated, an.tp);
        return `<td class="${g < -0.5 ? "down" : Math.abs(g) <= 0.5 ? "flat" : ""}">${sgn(g)} dB</td>`;
      };
      tr.innerHTML = `<td>${p.name}</td><td>${p.lufs}</td>${cell(st.srcAn)}${cell(st.outAn)}`;
      tb.appendChild(tr);
    });
  }

  function renderAll() {
    renderMeters(); renderNotes(); renderPlatforms();
    drawSpectrum(); drawTimeline(); drawEq();
    const ready = !!st.outBuf;
    ["#dl-btn", "#viz-btn", "#report-btn"].forEach((s) => { $(s).disabled = !ready; });
    $("#ab-play").disabled = !st.srcBuf;
    updateGains(true);
  }

  // ---------- 추출 ----------
  function encodeWav(buf, bits) {
    const n = buf.length, bps = bits / 8, dataLen = n * 2 * bps;
    const ab = new ArrayBuffer(44 + dataLen), v = new DataView(ab);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); str(8, "WAVE");
    str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
    v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * 2 * bps, true);
    v.setUint16(32, 2 * bps, true); v.setUint16(34, bits, true);
    str(36, "data"); v.setUint32(40, dataLen, true);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    if (bits === 16) {
      // TPDF 디더 (±1 LSB 삼각 분포) — 16비트로 줄일 때 생기는 양자화 왜곡을 잡음으로 바꿈
      const out = new Int16Array(ab, 44, n * 2);
      for (let i = 0, o = 0; i < n; i++) {
        for (const x of [L[i], R[i]]) {
          const s = Math.round(x * 32767 + Math.random() - Math.random());
          out[o++] = s > 32767 ? 32767 : s < -32768 ? -32768 : s;
        }
      }
    } else {
      const out = new Uint8Array(ab, 44);
      for (let i = 0, o = 0; i < n; i++) {
        for (const x of [L[i], R[i]]) {
          let s = Math.round(x * 8388607);
          s = s > 8388607 ? 8388607 : s < -8388608 ? -8388608 : s;
          out[o++] = s & 255; out[o++] = (s >> 8) & 255; out[o++] = (s >> 16) & 255;
        }
      }
    }
    return new Blob([ab], { type: "audio/wav" });
  }

  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  const outName = () => `${st.name}_master_${cfg.targetLufs}LUFS`;

  function reportText() {
    const a = st.srcAn, b = st.outAn, s = st.stats, mood = D.MOODS[cfg.mood];
    // 한글은 고정폭 글꼴에서 두 칸을 차지하므로 표시 폭 기준으로 채움
    const pad = (t, n) => { t = String(t); const w = [...t].reduce((a, c) => a + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFF00-\uFF60]/.test(c) ? 2 : 1), 0); return t + " ".repeat(Math.max(1, n - w)); };
    const row = (k, x, y, u) => `${pad(k, 22)}${pad(x, 10)}${pad(y, 10)}${u}`;
    const L = [];
    L.push("Rebroni Mastering Report", "=".repeat(48));
    L.push(`파일      : ${st.fileName}`, `표본화율  : ${st.fs} Hz · 길이 ${fmtTime(a.duration)}`, `생성 일시 : ${new Date().toLocaleString()}`, "");
    L.push("[설정]");
    L.push(`목표 사운드 : ${cfg.useRef && st.refAn ? "레퍼런스 매칭 — " + st.refName : `${mood.ko} (${mood.name})`}`);
    L.push(`목표        : ${cfg.targetLufs} LUFS / 트루 피크 상한 ${cfg.ceiling} dBTP`);
    L.push(`AI EQ ${Math.round(cfg.eqAmount * 100)}% · 저역 ${sgn(cfg.low)} · 존재감 ${sgn(cfg.presence)} · 공기감 ${sgn(cfg.air)} dB`);
    L.push(`글루 압축 ${Math.round(cfg.comp * 100)}% · 따뜻함 ${Math.round(cfg.warmth * 100)}% · 폭 ${Math.round(cfg.width * 100)}% · 저역 모노화 ${cfg.monoBass ? "120Hz" : "끔"}`);
    const eq = params().eq.filter((e) => Math.abs(e.g) >= 0.1).map((e) => `${e.f >= 1000 ? e.f / 1000 + "k" : e.f}Hz ${sgn(e.g)}`);
    L.push("EQ 밴드  : " + (eq.length ? eq.join(", ") : "보정 없음 (25Hz 하이패스만)"), "");
    L.push("[측정]", row("", "원본", "마스터", ""));
    L.push(row("통합 라우드니스", num(a.loud.integrated), num(b.loud.integrated), "LUFS"));
    L.push(row("트루 피크", num(a.tp), num(b.tp), "dBTP"));
    L.push(row("샘플 피크", num(a.samplePeak), num(b.samplePeak), "dBFS"));
    L.push(row("라우드니스 범위(LRA)", num(a.loud.lra), num(b.loud.lra), "LU"));
    L.push(row("최대 숏텀", num(a.loud.shortTermMax), num(b.loud.shortTermMax), "LUFS"));
    L.push(row("PLR", num(a.plr), num(b.plr), "dB"));
    L.push(row("스테레오 상관", num(a.corr, 2), num(b.corr, 2), ""));
    L.push(row("사이드/미드", num(a.sideMidDb), num(b.sideMidDb), "dB"), "");
    if (s) {
      L.push("[처리]");
      if (s.comp) L.push(`컴프레서 감쇄 : 평균 ${s.comp.avgGr.toFixed(1)} dB · 최대 ${s.comp.maxGr.toFixed(1)} dB`);
      if (s.limiter) L.push(`리미터 감쇄   : 평균 ${s.limiter.avgGr.toFixed(1)} dB · 최대 ${s.limiter.maxGr.toFixed(1)} dB`);
      L.push(`라우드니스 맞춤 반복 ${s.iterations}회`, "");
    }
    L.push("[플랫폼 재생 예상 — 추정치]", row("플랫폼", "원본", "마스터", ""));
    D.PLATFORMS.forEach((p) => L.push(row(`${p.name} (${p.lufs})`, sgn(D.platformGain(p, a.loud.integrated, a.tp)) + " dB",
      sgn(D.platformGain(p, b.loud.integrated, b.tp)) + " dB", "")));
    L.push("", "[진단]");
    currentNotes().forEach((n) => L.push(`- ${n.t}`));
    L.push("", "music.rebroni.com/mastering — 음원은 기기 밖으로 전송되지 않았습니다.");
    return L.join("\n");
  }

  // 같은 사이트의 비주얼라이저로 마스터 음원을 넘김 (IndexedDB 경유, 서버 업로드 없음)
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("rebroni-handoff", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("files");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function sendToVisualizer() {
    const btn = $("#viz-btn");
    btn.disabled = true;
    try {
      const blob = encodeWav(st.outBuf, 16);
      const db = await idb();
      await new Promise((res, rej) => {
        const tx = db.transaction("files", "readwrite");
        tx.objectStore("files").put({ name: st.name + ".wav", blob }, "pending");
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      location.href = "../visualizer/?from=mastering";
    } catch (e) {
      btn.disabled = false;
      alert("비주얼라이저로 넘기지 못했습니다. WAV를 저장한 뒤 비주얼라이저에서 직접 추가해 주세요.\n" + (e.message || e));
    }
  }

  // ---------- UI 바인딩 ----------
  function activateTab(name) {
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    $$(".tabpane").forEach((p) => p.classList.toggle("active", p.dataset.pane === name));
    if (name === "tune") drawEq();
  }
  $$(".tab").forEach((t) => t.addEventListener("click", () => activateTab(t.dataset.tab)));

  $("#file-input").addEventListener("change", (e) => { if (e.target.files[0]) loadSource(e.target.files[0]); e.target.value = ""; });
  $("#ref-input").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) loadRef(await f.arrayBuffer(), baseName(f.name));
  });
  $$(".drop").forEach((zone) => {
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", async (e) => {
      e.preventDefault(); zone.classList.remove("dragover");
      const f = e.dataTransfer.files[0];
      if (!f) return;
      if (zone.dataset.role === "ref") loadRef(await f.arrayBuffer(), baseName(f.name));
      else loadSource(f);
    });
  });
  $("#catalog-btn").addEventListener("click", loadCatalog);
  $("#catalog-select").addEventListener("change", (e) => {
    const o = e.target.selectedOptions[0];
    if (e.target.value) loadCatalogTrack(e.target.value, o.textContent);
  });

  // 무드
  const moodGrid = $("#mood-grid");
  Object.entries(D.MOODS).forEach(([id, m]) => {
    const b = document.createElement("button");
    b.dataset.v = id;
    b.innerHTML = `<b>${m.ko}</b><span>${m.name} · ${m.desc}</span>`;
    b.addEventListener("click", () => {
      cfg.mood = id; cfg.useRef = false; save();
      if (st.srcAn) { applySuggestion(); renderAll(); scheduleMaster(0); } else syncUI();
    });
    moodGrid.appendChild(b);
  });
  $("#use-ref").addEventListener("change", (e) => {
    cfg.useRef = e.target.checked;
    if (st.srcAn) { applySuggestion(); renderAll(); scheduleMaster(0); } else syncUI();
  });
  $("#auto-btn").addEventListener("click", () => {
    if (!st.srcAn) return;
    applySuggestion(); renderAll(); scheduleMaster(0);
  });

  const pct = (v) => Math.round(v * 100) + "%";
  const db = (v) => (v ? sgn(v) + " dB" : "0 dB");
  const RANGES = [
    ["target", "targetLufs", (v) => v.toFixed(1) + " LUFS"],
    ["ceiling", "ceiling", (v) => v.toFixed(1) + " dBTP"],
    ["eqAmount", "eqAmount", pct],
    ["low", "low", db], ["presence", "presence", db], ["air", "air", db],
    ["comp", "comp", pct], ["warmth", "warmth", pct],
    ["width", "width", pct],
  ];
  RANGES.forEach(([id, key]) => $("#" + id).addEventListener("input", (e) => {
    cfg[key] = +e.target.value; syncUI(); save(); drawEq(); scheduleMaster();
  }));
  $$("#target-seg button").forEach((b) => b.addEventListener("click", () => {
    cfg.targetLufs = +b.dataset.v; syncUI(); scheduleMaster(300);
  }));
  $$("#bits-seg button").forEach((b) => b.addEventListener("click", () => { cfg.bits = +b.dataset.v; syncUI(); save(); }));
  $("#monoBass").addEventListener("change", (e) => { cfg.monoBass = e.target.checked; scheduleMaster(); });
  $("#monitor-mode").addEventListener("change", (e) => { cfg.monitor = e.target.value; save(); updateGains(false); });

  $("#ab-play").addEventListener("click", () => { if (playing) stopPlayback(); else startPlayback(offset); });
  $$("#ab-which button").forEach((b) => b.addEventListener("click", () => {
    which = b.dataset.v; syncUI(); updateGains(false);
  }));
  $("#time-canvas").addEventListener("click", (e) => {
    if (!st.srcBuf) return;
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * duration();
    if (playing) startPlayback(t); else { offset = t; drawTimeline(); }
  });

  $("#dl-btn").addEventListener("click", () => download(encodeWav(st.outBuf, cfg.bits), outName() + ".wav"));
  $("#report-btn").addEventListener("click", () => download(new Blob(["﻿" + reportText()], { type: "text/plain;charset=utf-8" }), outName() + "_report.txt"));
  $("#viz-btn").addEventListener("click", sendToVisualizer);

  function syncUI() {
    $$("#mood-grid button").forEach((b) => b.classList.toggle("on", !cfg.useRef && b.dataset.v === cfg.mood));
    RANGES.forEach(([id, key, fmt]) => { $("#" + id).value = cfg[key]; $("#" + id + "-out").textContent = fmt(cfg[key]); });
    $$("#target-seg button").forEach((b) => b.classList.toggle("on", +b.dataset.v === cfg.targetLufs));
    $$("#bits-seg button").forEach((b) => b.classList.toggle("on", +b.dataset.v === cfg.bits));
    $$("#ab-which button").forEach((b) => b.classList.toggle("on", b.dataset.v === which));
    $("#monoBass").checked = cfg.monoBass;
    $("#monitor-mode").value = cfg.monitor;
    const ur = $("#use-ref");
    ur.disabled = !st.refAn; ur.checked = !!st.refAn && cfg.useRef;
    $("#use-ref-note").textContent = st.refAn ? `(${st.refName})` : "(음원 탭에서 레퍼런스를 추가하세요)";
  }

  let resizeT = 0;
  window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { drawSpectrum(); drawTimeline(); drawEq(); }, 150); });

  syncUI();
  renderAll();
})();
