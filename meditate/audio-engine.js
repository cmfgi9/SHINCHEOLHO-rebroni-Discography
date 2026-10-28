// 명상 페이지 오디오 엔진
// - AudioContext 하나에 버스(음악·자연의 소리·가이드 음성·벨)를 묶고 페이드·일시정지를 담당
// - 자연의 소리·백색 소음·벨은 모두 브라우저 안에서 합성 (음원 파일·외부 요청 없음)
// - 벨·페이드 같은 시간 이벤트는 JS 타이머가 아니라 오디오 시계(ctx.currentTime)에 예약한다.
//   화면이 꺼져 타이머가 느려져도 정확한 시점에 울리고 줄어든다.

export const NATURE = [
  { id: "rain", ko: "빗소리", en: "Rain", icon: "🌧️" },
  { id: "thunder", ko: "먼 천둥", en: "Thunder", icon: "⛈️" },
  { id: "waves", ko: "파도", en: "Waves", icon: "🌊" },
  { id: "stream", ko: "시냇물", en: "Stream", icon: "💧" },
  { id: "wind", ko: "바람", en: "Wind", icon: "🍃" },
  { id: "fire", ko: "모닥불", en: "Campfire", icon: "🔥" },
  { id: "birds", ko: "새소리", en: "Birds", icon: "🐦" },
  { id: "crickets", ko: "풀벌레", en: "Crickets", icon: "🦗" },
  { id: "white", ko: "백색 소음", en: "White noise", icon: "⚪" },
  { id: "pink", ko: "핑크 소음", en: "Pink noise", icon: "🌸" },
  { id: "brown", ko: "브라운 소음", en: "Brown noise", icon: "🟤" }
];

export const BELLS = [
  { id: "bowl", ko: "싱잉볼", en: "Singing bowl" },
  { id: "temple", ko: "범종", en: "Temple bell" },
  { id: "chime", ko: "틴샤", en: "Tingsha" },
  { id: "moktak", ko: "목탁", en: "Moktak" },
  { id: "none", ko: "없음", en: "None" }
];

const LOOKAHEAD = 3; // 초 — 백그라운드에서 타이머가 1초 단위로 느려져도 끊기지 않을 만큼 앞서 예약

const rnd = (a, b) => a + Math.random() * (b - a);

export class Engine {
  constructor() {
    this.ctx = null;
    this.layers = new Map();   // id → { out, nodes, ticker, cleanup }
    this.levels = {};          // id → 0..1
    this.tickers = new Set();  // (now, until) => void
    this.scheduled = new Set(); // 예약된 벨·신호음 (세션 취소 시 정지)
    this.buffers = {};
    this.playing = false;
    this.onstate = null;       // 재생 상태 변화 콜백
    // 음질: auto(휴대폰=가볍게, PC=풍부하게) | rich | lite
    // 가벼운 모드는 연산 여유가 적은 휴대폰용 — 컨볼버 잔향을 짧게 + 가벼운 꼬리(FDN), 생성형 음악의 음을 단순하게
    this.quality = "auto";
    this.lite = Engine.autoLite();
  }

  static autoLite() {
    return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  }

  setQuality(q) {
    this.quality = q;
    const lite = q === "lite" || (q === "auto" && Engine.autoLite());
    if (lite === this.lite) return;
    this.lite = lite;
    if (this.ctx) this._buildReverbs();
  }

  // 사용자 탭 안에서 호출해야 한다 (모바일 자동 재생 정책)
  ensure() {
    if (!this.ctx) this._build();
    return this.ctx;
  }

  _build() {
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "playback" });

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.005;
    limiter.release.value = 0.3;
    limiter.connect(ctx.destination);

    // 소스 → 버스 → duck(가이드 음성 중 낮춤) → transport(일시정지 페이드) → session(세션 페이드) → master(볼륨)
    this.master = this._gain(1, limiter);
    this.session = this._gain(1, this.master);
    this.transport = this._gain(0, this.session);
    this.duck = this._gain(1, this.transport);
    this.musicBus = this._gain(0.8, this.duck);
    this.natureBus = this._gain(0.8, this.duck);
    this.voiceBus = this._gain(1, this.transport);
    this.cueBus = this._gain(0.7, this.transport);

    // 벨은 세션 페이드를 거치지 않는다 → 소리가 모두 줄어든 뒤에도 종료 벨이 들림
    this.bellBus = this._gain(0.9, this.master);

    // 잔향 보내기 입구 (고정) — 실제 잔향은 _buildReverbs()가 음질에 맞춰 만든다
    this.reverb = this._gain(1);          // 생성형 음악 → 음악 버스로
    this.natureVerb = this._gain(0.5);    // 새소리 등 → 자연의 소리 버스로 (음악 볼륨과 무관)
    // 잔향 돌아오는 소리의 고역을 깎아 '쉬익' 하는 잡음처럼 들리지 않게
    this.reverbTone = this._filter("lowpass", 4500, 0.5, this._gain(1, this.musicBus));
    this._buildReverbs();

    this._keepAliveEl = this._makeKeepAlive();
    this._timer = setInterval(() => this._tick(), 250);
  }

  // 잔향 길이가 연산량을 좌우한다. 풍부하게: 컨볼버 3초 / 가볍게: 컨볼버 2초 + 가벼운 꼬리(FDN)로 울림을 길게
  _buildReverbs() {
    const old = this._verb;
    if (old) {
      this.reverb.disconnect();
      this.natureVerb.disconnect();
      this.bellBus.disconnect(old.bell);
      for (const n of old.nodes) { try { n.disconnect(); } catch (e) { /* 무시 */ } }
    }
    const ctx = this.ctx, lite = this.lite;
    const nodes = [];
    const conv = (buf, src, dest, level) => {
      const c = ctx.createConvolver();
      c.buffer = buf;
      const g = this._gain(level, dest);
      src.connect(c);
      c.connect(g);
      nodes.push(c, g);
      return c;
    };
    const ir = this._impulse(lite ? 2 : 3, 2);
    conv(ir, this.reverb, this.reverbTone, 1);
    conv(ir, this.natureVerb, this.natureBus, 0.6);
    const bell = conv(this._impulse(lite ? 2.5 : 3, 1.8), this.bellBus, this.master, 0.35);
    if (lite) nodes.push(...this._fdnTail(this.reverb, this.reverbTone, 4.5, 0.55));
    this._verb = { nodes, bell };
  }

  // 가벼운 꼬리: 지연선 4개를 하우스홀더 행렬로 섞어 되먹이는 FDN 잔향. 컨볼버보다 훨씬 가볍다
  _fdnTail(input, output, rt60, level) {
    const ctx = this.ctx, nodes = [];
    const inG = this._gain(0.35);
    input.connect(inG);
    const sum = this._gain(1);
    const mix = this._gain(-0.5); // (I − ½·11ᵀ): 직교 행렬 → 되먹임 이득 < 1이면 안정
    sum.connect(mix);
    const out = this._gain(level, output);
    nodes.push(inG, sum, mix, out);
    [0.0797, 0.1013, 0.1229, 0.1471].forEach((dt, i) => {
      const d = ctx.createDelay(1);
      d.delayTime.value = dt;
      // 주의: Web Audio의 lowpass Q는 dB 단위. 0보다 크면 공진(증폭)이 생겨 되먹임 안에서 소리가 점점 커진다 → −3dB
      const lp = this._filter("lowpass", 3000, -3);
      const g = this._gain(Math.pow(10, -3 * dt / rt60)); // rt60초 동안 −60dB
      inG.connect(d);
      d.connect(lp).connect(g);
      g.connect(d);
      g.connect(sum);
      mix.connect(d);
      const pan = ctx.createStereoPanner();
      pan.pan.value = [-0.7, 0.7, -0.35, 0.35][i];
      lp.connect(pan).connect(out);
      nodes.push(d, lp, g, pan);
    });
    return nodes;
  }

  _gain(v, dest) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  _tick() {
    if (!this.ctx || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    const until = now + LOOKAHEAD;
    for (const fn of this.tickers) {
      try { fn(now, until); } catch (e) { console.warn("[meditate] ticker", e); }
    }
  }

  // ---------- 재생 / 일시정지 ----------
  async play() {
    this.ensure();
    const ctx = this.ctx;
    if (ctx.state !== "running") await ctx.resume().catch(() => {});
    this.smooth(this.transport.gain, 1, 1.2);
    this._keepAliveEl.play().catch(() => {});
    if (!this.playing) { this.playing = true; this.onstate?.(true); }
  }

  async pause(fade = 0.6) {
    if (!this.ctx || !this.playing) return;
    this.playing = false;
    this.onstate?.(false);
    this.smooth(this.transport.gain, 0, fade);
    this._keepAliveEl.pause();
    clearTimeout(this._suspendT);
    this._suspendT = setTimeout(() => {
      if (!this.playing) this.ctx.suspend().catch(() => {});
    }, fade * 1000 + 80);
  }

  setMasterVolume(v) { if (this.ctx) this.smooth(this.master.gain, v * v, 0.1); }
  setBusVolume(bus, v) { if (this.ctx) this.smooth(this[bus].gain, v * v, 0.1); }

  // 현재 값에서 target까지 부드럽게 (S자 곡선)
  smooth(param, target, secs, at) {
    const ctx = this.ctx;
    const t = Math.max(at ?? ctx.currentTime, ctx.currentTime);
    holdAt(param, t);
    const from = param.value;
    if (secs <= 0.02 || Math.abs(from - target) < 1e-4) { param.setValueAtTime(target, t); return; }
    param.setValueCurveAtTime(curve(from, target, "s"), t, secs);
  }

  // ---------- 자연의 소리 믹서 ----------
  setLevel(id, level) {
    level = Math.max(0, Math.min(1, level));
    this.levels[id] = level;
    if (!this.ctx) return;
    let layer = this.layers.get(id);
    if (level > 0 && !layer) {
      layer = this._buildLayer(id);
      if (!layer) return;
      this.layers.set(id, layer);
    }
    if (!layer) return;
    clearTimeout(layer.cleanupT);
    const g = layer.out.gain;
    holdAt(g, this.ctx.currentTime);
    g.setTargetAtTime(level * level * (layer.base || 1), this.ctx.currentTime, 0.25);
    if (level === 0) {
      layer.cleanupT = setTimeout(() => this._dropLayer(id), 2500);
    }
  }

  activeLayers() { return [...this.layers.keys()].filter(id => this.levels[id] > 0); }

  _dropLayer(id) {
    const layer = this.layers.get(id);
    if (!layer || this.levels[id] > 0) return;
    if (layer.ticker) this.tickers.delete(layer.ticker);
    for (const n of layer.nodes) { try { n.stop?.(); } catch (e) { /* 이미 정지 */ } try { n.disconnect(); } catch (e) { /* 무시 */ } }
    try { layer.out.disconnect(); } catch (e) { /* 무시 */ }
    this.layers.delete(id);
  }

  _buildLayer(id) {
    const b = LAYER_BUILDERS[id];
    if (!b) return null;
    const out = this._gain(0, this.natureBus);
    const layer = { out, nodes: [], ticker: null, base: 1 };
    b(this, layer);
    if (layer.ticker) this.tickers.add(layer.ticker);
    return layer;
  }

  _loop(buf, dest) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(dest);
    s.start(0, Math.random() * buf.duration);
    return s;
  }

  _filter(type, freq, q = 0.7, dest) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    if (dest) f.connect(dest);
    return f;
  }

  // ---------- 노이즈·효과음 버퍼 (최초 1회 생성 후 재사용) ----------
  noise(kind) {
    if (this.buffers[kind]) return this.buffers[kind];
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 8);
    const fade = Math.floor(sr * 0.5);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const raw = new Float32Array(len + fade);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < raw.length; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === "white") raw[i] = w * 0.5;
        else if (kind === "pink") { // Paul Kellet
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        } else { // brown
          last = (last + 0.02 * w) / 1.02;
          raw[i] = last * 3.5;
        }
      }
      // 끝부분을 앞부분에 겹쳐 반복 이음새를 없앤다
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = raw[i];
      for (let i = 0; i < fade; i++) {
        const x = i / fade;
        const a = kind === "brown" ? x : Math.sin(x * Math.PI / 2);
        const b = kind === "brown" ? 1 - x : Math.cos(x * Math.PI / 2);
        d[i] = raw[i] * a + raw[len + i] * b;
      }
    }
    return (this.buffers[kind] = buf);
  }

  // 짧은 소리 이벤트를 흩뿌린 반복 버퍼 (빗방울·장작·물방울·풀벌레). 넘치는 꼬리는 앞으로 감아 이음새 없음
  sprinkle(name, seconds, count, render) {
    if (this.buffers[name]) return this.buffers[name];
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, len, sr);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let k = 0; k < count; k++) {
      const start = Math.floor(Math.random() * len);
      const pan = Math.random();
      const gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
      render(sr, (i, v) => {
        const j = (start + i) % len;
        L[j] += v * gl;
        R[j] += v * gr;
      }, k);
    }
    return (this.buffers[name] = buf);
  }

  _impulse(seconds, decay) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const x = i / len, t = i / sr;
        // 뒤로 갈수록 어두워지는 잔향. 밝기를 '초' 기준으로 줄여 짧은 잔향도 고역이 쉬익거리지 않게
        lp += (Math.random() * 2 - 1 - lp) * Math.max(0.035, 0.38 * Math.exp(-t / 0.45));
        d[i] = lp * Math.pow(1 - x, decay);
      }
    }
    return buf;
  }

  // 화면이 꺼져도 "미디어 재생 중"으로 인식되도록 무음 오디오를 반복 재생 (Media Session 알림 표시용)
  _makeKeepAlive() {
    const sr = 8000, secs = 10, n = sr * secs;
    const bytes = new ArrayBuffer(44 + n * 2);
    const v = new DataView(bytes);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, n * 2, true);
    const el = new Audio(URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })));
    el.loop = true;
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  // ---------- 벨 (합성) ----------
  // type: bowl | temple | chime | moktak, when: 오디오 시계 기준 시각, strikes: 타종 횟수
  bell(type, when, strikes = 1, vol = 1) {
    if (!this.ctx || type === "none") return;
    const gap = { bowl: 4.5, temple: 7, chime: 3, moktak: 0.55 }[type] || 4;
    for (let s = 0; s < strikes; s++) this._strike(type, when + s * gap, vol);
  }

  _strike(type, t, vol) {
    const ctx = this.ctx;
    const out = this.bellBus;
    const partial = (f, amp, decay, detune = 0) => {
      for (const df of detune ? [-detune / 2, detune / 2] : [0]) {
        const o = ctx.createOscillator();
        o.frequency.value = f + df;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol * amp / (detune ? 2 : 1), t + 0.006);
        g.gain.setTargetAtTime(0, t + 0.006, decay / 5);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + decay * 1.3 + 0.1);
        this._track(o, t, "bell");
      }
    };
    if (type === "bowl") {
      const f0 = 220;
      [[1, 0.5, 13, 0.9], [2.71, 0.26, 8, 1.6], [5.15, 0.12, 4.5, 2.4], [8.43, 0.06, 2.6, 3]]
        .forEach(([r, a, d, b]) => partial(f0 * r, a, d, b));
    } else if (type === "temple") {
      // 범종: 낮은 울림 + 맥놀이(가까운 두 주파수의 맥동)
      const f0 = 72;
      [[1, 0.33, 20, 0.35], [2, 0.2, 14, 0.6], [2.41, 0.13, 10, 0.9], [3.02, 0.11, 7, 1.2], [4.12, 0.06, 5, 1.5], [5.4, 0.04, 3.5, 2]]
        .forEach(([r, a, d, b]) => partial(f0 * r, a, d, b));
      this._thump(t, out, 140, 0.25 * vol, 0.25);
    } else if (type === "chime") {
      [[1, 0.2, 6, 5.5], [2.32, 0.09, 3.2, 7], [4.08, 0.04, 1.6, 9]]
        .forEach(([r, a, d, b]) => partial(2100 * r, a, d, b));
    } else if (type === "moktak") {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(560, t);
      o.frequency.exponentialRampToValueAtTime(470, t + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.7 * vol, t + 0.002);
      g.gain.setTargetAtTime(0, t + 0.002, 0.045);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.5);
      this._track(o, t, "bell");
      this._thump(t, out, 1300, 0.25 * vol, 0.012, "bandpass");
    }
  }

  _thump(t, dest, freq, amp, decay, type = "lowpass") {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise("white");
    const f = this._filter(type, freq, type === "bandpass" ? 2 : 0.7);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.003, decay);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 4);
    s.stop(t + decay * 8 + 0.1);
    this._track(s, t, "bell");
  }

  // 호흡 신호음: inhale(올라가는 음) / exhale(내려가는 음) / hold(짧은 음). style: tone | chime
  cue(kind, t, style = "tone") {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    let end;
    if (style === "chime") {
      o.frequency.value = kind === "inhale" ? 880 : kind === "exhale" ? 660 : 990;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.01);
      g.gain.setTargetAtTime(0, t + 0.01, 0.5);
      end = t + 3;
    } else {
      const [a, b] = kind === "inhale" ? [196, 294] : kind === "exhale" ? [294, 196] : [392, 392];
      const len = kind === "hold" ? 0.35 : 1.4;
      o.frequency.setValueAtTime(a, t);
      o.frequency.exponentialRampToValueAtTime(b, t + len);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(kind === "hold" ? 0.05 : 0.08, t + 0.15);
      g.gain.setTargetAtTime(0, t + len * 0.6, len * 0.3);
      end = t + len * 2.5;
    }
    o.connect(g).connect(this.cueBus);
    o.start(t);
    o.stop(end);
    this._track(o, t, "cue");
  }

  _track(node, t, kind) {
    node.__t = t;
    node.__kind = kind;
    this.scheduled.add(node);
    node.onended = () => { this.scheduled.delete(node); try { node.disconnect(); } catch (e) { /* 무시 */ } };
  }

  // 아직 울리지 않은 벨·신호음 취소 (이미 울리는 소리는 자연스럽게 끝나도록 둠)
  // kind: "bell" | "cue" | 생략(전부)
  cancelScheduled(kind) {
    const now = this.now;
    for (const n of [...this.scheduled]) {
      if (n.__t > now + 0.05 && (!kind || n.__kind === kind)) {
        try { n.stop(0); } catch (e) { /* 무시 */ }
      }
    }
  }
}

// 예약된 자동화가 남아 있어도 현재 값에서 멈춘 뒤 새 자동화를 이어 붙인다
export function holdAt(param, t) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else { const v = param.value; param.cancelScheduledValues(t); param.setValueAtTime(v, t); }
}

// shape: s(S자) | out(페이드아웃: 앞은 천천히, 끝은 길게 꼬리) | in
export function curve(from, to, shape = "s", n = 256) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    let y;
    if (shape === "out") y = 1 - Math.pow(1 - x, 2);      // gain = (1-x)^2 형태로 감소
    else if (shape === "in") y = x * x;
    else y = (1 - Math.cos(Math.PI * x)) / 2;
    c[i] = from + (to - from) * y;
  }
  return c;
}

// ---------- 자연의 소리 레이어 ----------
const LAYER_BUILDERS = {
  rain(e, L) {
    const lp = e._filter("lowpass", 8500, 0.5, L.out);
    const hp = e._filter("highpass", 450, 0.5, lp);
    L.nodes.push(e._loop(e.noise("pink"), hp));
    const drops = e.sprinkle("drops", 6, 520, (sr, add) => {
      const f = rnd(1800, 6500), tau = rnd(0.002, 0.012), amp = 0.04 + 0.3 * Math.pow(Math.random(), 3);
      const n = Math.floor(tau * 6 * sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        add(i, amp * Math.sin(2 * Math.PI * f * (1 - 0.25 * t / (tau * 6)) * t) * Math.exp(-t / tau));
      }
    });
    L.nodes.push(e._loop(drops, e._gain(0.55, L.out)));
    L.base = 0.9;
  },

  thunder(e, L) {
    // 잔잔한 저음 + 15~50초마다 멀리서 구르는 천둥
    const bed = e._filter("lowpass", 110, 0.5, e._gain(0.25, L.out));
    L.nodes.push(e._loop(e.noise("brown"), bed));
    let next = e.now + rnd(3, 10);
    L.ticker = (now, until) => {
      while (next < until) {
        const t = next, dur = rnd(5, 10), peak = rnd(0.5, 1);
        const s = e.ctx.createBufferSource();
        s.buffer = e.noise("brown");
        const f = e._filter("lowpass", 320, 0.6);
        f.frequency.setValueAtTime(380, t);
        f.frequency.exponentialRampToValueAtTime(70, t + dur);
        const g = e.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + rnd(0.4, 1.4));
        g.gain.setTargetAtTime(0, t + 1.5, dur / 4);
        const p = e.ctx.createStereoPanner();
        p.pan.value = rnd(-0.6, 0.6);
        s.connect(f).connect(g).connect(p).connect(L.out);
        s.start(t, Math.random() * 6);
        s.stop(t + dur + 2);
        next = t + rnd(15, 50);
      }
    };
    L.base = 1.2;
  },

  waves(e, L) {
    const g = e._gain(0.25, L.out);
    const pan = e.ctx.createStereoPanner();
    pan.connect(g);
    const lp = e._filter("lowpass", 400, 0.6, pan);
    L.nodes.push(e._loop(e.noise("brown"), lp));
    L.nodes.push(e._loop(e.noise("pink"), e._gain(0.5, lp)));
    let next = e.now + 0.1;
    L.ticker = (now, until) => {
      while (next < until) {
        const t = next, dur = rnd(7, 12), crest = t + dur * rnd(0.38, 0.5), peak = rnd(0.75, 1);
        lp.frequency.setValueAtTime(380, t);
        lp.frequency.exponentialRampToValueAtTime(rnd(1300, 2300), crest);
        lp.frequency.exponentialRampToValueAtTime(330, t + dur);
        g.gain.setValueAtTime(0.22, t);
        g.gain.linearRampToValueAtTime(peak, crest);
        g.gain.linearRampToValueAtTime(0.22, t + dur);
        pan.pan.linearRampToValueAtTime(rnd(-0.4, 0.4), t + dur);
        next = t + dur;
      }
    };
  },

  stream(e, L) {
    const bp = e._filter("bandpass", 1100, 0.5, e._gain(0.9, L.out));
    L.nodes.push(e._loop(e.noise("pink"), bp));
    const bubbles = e.sprinkle("bubbles", 6, 420, (sr, add) => {
      const f0 = rnd(350, 1100), dur = rnd(0.015, 0.06), amp = rnd(0.03, 0.14);
      const n = Math.floor(dur * sr);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const x = i / n;
        ph += 2 * Math.PI * f0 * (1 + 1.6 * x) / sr;
        add(i, amp * Math.sin(ph) * Math.sin(Math.PI * x));
      }
    });
    L.nodes.push(e._loop(bubbles, e._gain(0.8, L.out)));
  },

  wind(e, L) {
    const g = e._gain(0.4, L.out);
    const bp = e._filter("bandpass", 500, 1.1, g);
    L.nodes.push(e._loop(e.noise("pink"), bp));
    const wg = e._gain(0.03, L.out);
    const whistle = e._filter("bandpass", 1700, 9, wg);
    L.nodes.push(e._loop(e.noise("white"), whistle));
    let next = e.now + 0.1;
    L.ticker = (now, until) => {
      while (next < until) {
        const t = next, dur = rnd(4, 10), peak = rnd(0.45, 1);
        bp.frequency.linearRampToValueAtTime(rnd(280, 900), t + dur * 0.5);
        g.gain.linearRampToValueAtTime(peak, t + dur * 0.5);
        g.gain.linearRampToValueAtTime(rnd(0.2, 0.4), t + dur);
        whistle.frequency.linearRampToValueAtTime(rnd(1400, 2200), t + dur);
        wg.gain.linearRampToValueAtTime(rnd(0, 0.06), t + dur * 0.6);
        next = t + dur;
      }
    };
    L.base = 2.5;
  },

  fire(e, L) {
    const roar = e._filter("lowpass", 480, 0.6, e._gain(0.5, L.out));
    L.nodes.push(e._loop(e.noise("brown"), roar));
    const crackle = e.sprinkle("crackle", 7, 150, (sr, add) => {
      // 장작 타는 소리: 짧은 클릭이 1~6개씩 뭉쳐서
      const clicks = 1 + Math.floor(Math.random() * 6);
      let off = 0;
      for (let c = 0; c < clicks; c++) {
        const tau = rnd(0.0004, 0.003), amp = 0.08 + 0.6 * Math.pow(Math.random(), 2.5);
        const n = Math.floor(tau * 8 * sr);
        let prev = 0;
        for (let i = 0; i < n; i++) {
          const w = (Math.random() * 2 - 1) * Math.exp(-i / sr / tau);
          add(off + i, amp * (w - prev)); // 차분 → 고역만 남은 '탁' 소리
          prev = w;
        }
        off += Math.floor(rnd(0.004, 0.05) * sr);
      }
    });
    L.nodes.push(e._loop(crackle, e._filter("highpass", 900, 0.7, e._gain(0.9, L.out))));
  },

  birds(e, L) {
    let next = e.now + rnd(0.5, 2);
    const chirp = (t, f1, f2, dur, amp, pan) => {
      const o = e.ctx.createOscillator();
      o.frequency.setValueAtTime(f1, t);
      o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      const g = e.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.008);
      g.gain.setValueAtTime(amp, t + dur * 0.7);
      g.gain.linearRampToValueAtTime(0, t + dur);
      const p = e.ctx.createStereoPanner();
      p.pan.value = pan;
      o.connect(g).connect(p);
      p.connect(L.out);
      p.connect(e.natureVerb);
      o.start(t);
      o.stop(t + dur + 0.05);
    };
    L.ticker = (now, until) => {
      while (next < until) {
        let t = next;
        const pan = rnd(-0.85, 0.85), amp = rnd(0.04, 0.12);
        const kind = Math.random();
        if (kind < 0.5) { // 짹짹
          const base = rnd(2600, 4600);
          for (let i = 0, n = 2 + Math.floor(Math.random() * 5); i < n; i++) {
            const d = rnd(0.05, 0.11);
            chirp(t, base * rnd(0.95, 1.1), base * rnd(0.65, 1.35), d, amp, pan);
            t += d + rnd(0.04, 0.09);
          }
        } else if (kind < 0.8) { // 지저귐(빠른 트릴)
          const a = rnd(3000, 5000), b = a * rnd(0.8, 0.9);
          for (let i = 0, n = 8 + Math.floor(Math.random() * 8); i < n; i++) {
            chirp(t, i % 2 ? a : b, i % 2 ? b : a, 0.025, amp * 0.8, pan);
            t += 0.035;
          }
        } else { // 휘파람
          const a = rnd(1700, 2400);
          chirp(t, a, a * rnd(1.15, 1.4), rnd(0.25, 0.4), amp, pan);
          chirp(t + 0.5, a * 1.3, a * 0.95, rnd(0.25, 0.35), amp, pan);
        }
        next = next + rnd(1.5, 7);
      }
    };
    L.base = 3;
  },

  crickets(e, L) {
    // 주기가 버퍼 길이(4초)를 나누어떨어지게 → 이음새 없는 반복
    const sr = e.ctx.sampleRate;
    if (!e.buffers.crickets) {
      const len = sr * 4;
      const buf = e.ctx.createBuffer(2, len, sr);
      const L0 = buf.getChannelData(0), R0 = buf.getChannelData(1);
      for (let c = 0; c < 4; c++) {
        const f = rnd(4200, 5400), period = 4 / (4 + Math.floor(Math.random() * 4));
        const pulses = 3 + Math.floor(Math.random() * 2), amp = rnd(0.05, 0.12);
        const pan = Math.random(), gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
        const off = Math.random() * period;
        for (let t0 = off; t0 < 4 + off; t0 += period) {
          const a = amp * rnd(0.7, 1);
          for (let p = 0; p < pulses; p++) {
            const ps = Math.floor((t0 + p * 0.028) * sr), pn = Math.floor(0.014 * sr);
            for (let i = 0; i < pn; i++) {
              const j = (ps + i) % len;
              const env = Math.pow(Math.sin(Math.PI * i / pn), 2);
              const v = a * env * Math.sin(2 * Math.PI * f * (ps + i) / sr);
              L0[j] += v * gl; R0[j] += v * gr;
            }
          }
        }
      }
      e.buffers.crickets = buf;
    }
    L.nodes.push(e._loop(e.buffers.crickets, L.out));
    L.base = 2.2;
  },

  white(e, L) { L.nodes.push(e._loop(e.noise("white"), e._filter("lowpass", 9000, 0.5, L.out))); L.base = 0.45; },
  pink(e, L) { L.nodes.push(e._loop(e.noise("pink"), L.out)); L.base = 0.8; },
  brown(e, L) { L.nodes.push(e._loop(e.noise("brown"), L.out)); L.base = 0.8; }
};
