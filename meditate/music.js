// 명상 페이지 음악 소스
// - GenerativeMusic: 브라우저에서 실시간 합성하는 생성형 앰비언트 (무한, 파일·서버 없음, 시드로 재현)
// - StemMusic: 아티스트가 올린 스템(트랙 조각)을 역할별로 무작위 재조합
// - AlbumPlayer: 업로드된 앨범 음원(audioUrl)을 두 개의 <audio>로 크로스페이드 재생
import { holdAt, curve } from "./audio-engine.js?v=1";

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MOODS = {
  calm: { ko: "고요", en: "Calm", root: 146.83, scale: [0, 2, 4, 7, 9], bright: 0.5, shimmer: 0.2, fm: 2 },
  deep: { ko: "깊은 밤", en: "Deep Night", root: 110, scale: [0, 3, 5, 7, 10], bright: 0.3, shimmer: 0.1, fm: 2 },
  dawn: { ko: "새벽", en: "Dawn", root: 174.61, scale: [0, 2, 4, 6, 7, 9, 11], bright: 0.65, shimmer: 0.35, fm: 3 },
  forest: { ko: "숲", en: "Forest", root: 196, scale: [0, 2, 3, 5, 7, 9, 10], bright: 0.55, shimmer: 0.25, fm: 2 },
  cosmos: { ko: "우주", en: "Cosmos", root: 130.81, scale: [0, 2, 4, 7, 11], bright: 0.45, shimmer: 0.6, fm: 3.5 }
};

// ================= 생성형 앰비언트 =================
export class GenerativeMusic {
  constructor(engine) {
    this.e = engine;
    this.running = false;
    this.params = { mood: "calm", density: 0.5, bright: 0.5, seed: 1 };
  }

  setParams(p) {
    const moodChanged = p.mood && p.mood !== this.params.mood;
    const seedChanged = p.seed !== undefined && p.seed !== this.params.seed;
    Object.assign(this.params, p);
    if (!this.running) return;
    if (moodChanged || seedChanged) { this.stop(5); this.start(); return; }
    if (this.droneFilter) this.e.smooth(this.droneFilter.frequency, this._droneCut(), 2);
  }

  _droneCut() { return 180 + this.params.bright * 520; }
  _cut() { return 700 + this.params.bright * this.params.bright * 4200; }

  freq(deg, oct = 0) {
    const sc = this.mood.scale, n = sc.length;
    const o = Math.floor(deg / n), i = ((deg % n) + n) % n;
    return this.mood.root * Math.pow(2, (sc[i] + 12 * (o + oct)) / 12);
  }

  start() {
    const e = this.e, ctx = e.ctx;
    this.running = true;
    this.mood = MOODS[this.params.mood] || MOODS.calm;
    this.rand = mulberry32(this.params.seed || 1);
    const t0 = ctx.currentTime + 0.05;

    this.out = e._gain(0, e.musicBus);
    this.out.gain.setValueCurveAtTime(curve(0, 1, "in"), t0, 6);
    this.wet = e._gain(1, e.reverb);
    this.out.connect(this.wet);

    // 멜로디 메아리 (딜레이 피드백)
    this.melody = e._gain(1, this.out);
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.62;
    const fb = e._gain(0.32);
    const dlp = e._filter("lowpass", 2600, 0.5);
    this.melody.connect(delay);
    delay.connect(dlp).connect(fb).connect(delay);
    dlp.connect(e._gain(0.5, this.out));
    this.nodes = [delay, fb, dlp];

    // 드론: 근음 + 5도, 천천히 움직이는 필터
    this.droneFilter = e._filter("lowpass", this._droneCut(), 0.8, e._gain(0.16, this.out));
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.031;
    const lfoAmt = e._gain(90);
    lfo.connect(lfoAmt).connect(this.droneFilter.frequency);
    lfo.start(t0);
    const r = this.mood.root;
    [[r / 2, "sine", 0], [r / 2, "triangle", 6], [r * 0.75, "sine", -4]].forEach(([f, type, cents]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = cents;
      o.connect(this.droneFilter);
      o.start(t0);
      this.nodes.push(o);
    });
    this.nodes.push(lfo, lfoAmt, this.droneFilter);

    this.nextChord = t0 + 0.5;
    this.nextNote = t0 + 4;
    this.deg = 7;
    this.ticker = (now, until) => this._schedule(until);
    e.tickers.add(this.ticker);
  }

  _schedule(until) {
    const R = this.rand, p = this.params;
    while (this.nextChord < until) {
      const t = this.nextChord;
      const len = (16 + R() * 14) * (1.3 - p.density * 0.6);
      const roots = [0, 3, 4, 5, 1, 2];
      const base = roots[Math.floor(R() * roots.length)];
      const n = this.mood.scale.length;
      const chord = [base, base + 2, base + 4];
      if (R() < 0.5) chord.push(base + n); // 옥타브 위
      chord.forEach((d, i) => this._pad(t + i * 0.4, len, this.freq(d, R() < 0.3 ? 1 : 0)));
      this.nextChord = t + len * 0.75; // 앞 화음의 여운과 겹치며 넘어감
    }
    while (this.nextNote < until) {
      const t = this.nextNote;
      if (R() < 0.82) {
        this.deg += [-2, -1, -1, 1, 1, 2, 0][Math.floor(R() * 7)];
        this.deg = Math.max(4, Math.min(13, this.deg));
        this._bellNote(t, this.freq(this.deg, 1), 0.05 + R() * 0.06);
        if (R() < 0.18) this._bellNote(t + 0.45 + R() * 0.3, this.freq(this.deg + 2, 1), 0.04);
      }
      if (R() < this.mood.shimmer * 0.35) this._shimmer(t + R() * 2, this.freq(Math.floor(R() * 5), 3));
      const gap = 7 - p.density * 5.4;
      this.nextNote = t + gap * (0.6 + R() * 0.8);
    }
  }

  _pad(t, len, f) {
    const e = this.e, ctx = e.ctx;
    const g = ctx.createGain();
    const atk = 5 + this.rand() * 3, rel = 8;
    const peak = 0.045;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.setValueAtTime(peak, t + len);
    g.gain.linearRampToValueAtTime(0, t + len + rel);
    const lp = e._filter("lowpass", this._cut(), 0.6);
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.rand() * 1.4 - 0.7;
    lp.connect(g).connect(pan).connect(this.out);
    for (const [type, cents] of [["triangle", -5], ["sine", 5]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = cents;
      o.connect(lp);
      o.start(t);
      o.stop(t + len + rel + 0.1);
    }
  }

  _bellNote(t, f, vel) {
    const e = this.e, ctx = e.ctx;
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * this.mood.fm;
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(f * 1.1 * (0.4 + this.params.bright), t);
    idx.gain.setTargetAtTime(0, t, 0.4);
    mod.connect(idx).connect(car.frequency);
    const g = ctx.createGain();
    const dec = 2.5 + this.rand() * 2.5;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.012);
    g.gain.setTargetAtTime(0, t + 0.012, dec / 4);
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.rand() * 1.2 - 0.6;
    car.connect(g).connect(pan).connect(this.melody);
    for (const o of [car, mod]) { o.start(t); o.stop(t + dec * 1.4); }
  }

  _shimmer(t, f) {
    const ctx = this.e.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.012, t + 2);
    g.gain.linearRampToValueAtTime(0, t + 6);
    o.connect(g).connect(this.wet);
    o.start(t);
    o.stop(t + 6.1);
  }

  stop(fade = 4) {
    if (!this.running) return;
    this.running = false;
    const e = this.e;
    e.tickers.delete(this.ticker);
    const out = this.out, wet = this.wet, nodes = this.nodes;
    e.smooth(out.gain, 0, fade);
    setTimeout(() => {
      for (const n of nodes) { try { n.stop?.(); } catch (err) { /* 무시 */ } try { n.disconnect(); } catch (err) { /* 무시 */ } }
      try { out.disconnect(); wet.disconnect(); } catch (err) { /* 무시 */ }
    }, fade * 1000 + 200);
  }
}

// ================= 스템 재조합 =================
// stems: [{ id, url, role: drone|pad|melody|texture, set, title }]
export const STEM_ROLES = {
  drone: { ko: "바탕", en: "Drone", level: 0.8, loop: true },
  pad: { ko: "패드", en: "Pad", level: 0.7, loop: true },
  melody: { ko: "멜로디", en: "Melody", level: 0.6, loop: false },
  texture: { ko: "질감", en: "Texture", level: 0.5, loop: true }
};

export class StemMusic {
  constructor(engine) {
    this.e = engine;
    this.stems = [];
    this.cache = new Map(); // url → Promise<AudioBuffer>
    this.running = false;
    this.set = "all";
    this.bad = new Set(); // 불러오지 못한 스템 — 이번 재생 동안 건너뜀
    this.onerror = null;
  }

  setStems(list) { this.stems = list || []; }

  sets() { return [...new Set(this.stems.map(s => s.set || "default"))]; }

  _pool(role) {
    return this.stems.filter(s => s.role === role && !this.bad.has(s.id) && (this.set === "all" || (s.set || "default") === this.set));
  }

  _load(url) {
    if (!this.cache.has(url)) {
      const p = fetch(url, { mode: "cors" })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
        .then(b => this.e.ctx.decodeAudioData(b));
      p.catch(err => { this.cache.delete(url); this.onerror?.(err, url); });
      this.cache.set(url, p);
      // 디코딩된 음원은 메모리를 많이 차지 → 최근 8개만 유지
      while (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value);
    }
    return this.cache.get(url);
  }

  async start(set = "all") {
    const e = this.e;
    this.set = set;
    this.bad.clear();
    this.running = true;
    this.out = e._gain(1, e.musicBus);
    this.state = {};
    this.voices = new Set();
    const now = e.ctx.currentTime;
    // 역할별 첫 곡을 미리 받아 둔다
    await Promise.allSettled(Object.keys(STEM_ROLES).map(role => {
      const pick = this._pick(role);
      this.state[role] = { nextAt: now + 0.3 + Math.random() * (role === "melody" ? 12 : 2), pick, last: null };
      return pick ? this._load(pick.url) : null;
    }));
    if (!this.running) return;
    this.ticker = (n, until) => this._schedule(n, until);
    e.tickers.add(this.ticker);
  }

  _pick(role, avoid) {
    const pool = this._pool(role);
    if (!pool.length) return null;
    const cand = pool.length > 1 ? pool.filter(s => s.id !== avoid) : pool;
    return cand[Math.floor(Math.random() * cand.length)];
  }

  _schedule(now, until) {
    for (const role of Object.keys(STEM_ROLES)) {
      const st = this.state[role];
      if (!st || st.nextAt >= until || st.busy) continue;
      const pick = st.pick || this._pick(role, st.last);
      if (!pick) { st.nextAt = Infinity; continue; }
      st.busy = true;
      this._load(pick.url).then(buf => {
        st.busy = false;
        if (!this.running) return;
        const at = Math.max(st.nextAt, this.e.ctx.currentTime + 0.1);
        this._play(role, buf, at, st);
        st.last = pick.id;
        st.pick = this._pick(role, pick.id);
        if (st.pick) this._load(st.pick.url).catch(() => {}); // 다음 곡 미리 받기
      }, () => {
        st.busy = false;
        this.bad.add(pick.id);
        st.pick = this._pick(role, pick.id);
        st.nextAt = this.e.ctx.currentTime + 1;
      });
    }
  }

  _play(role, buf, at, st) {
    const ctx = this.e.ctx;
    const cfg = STEM_ROLES[role];
    const fade = Math.min(8, buf.duration / 3);
    let len;
    if (role === "melody") len = buf.duration;
    else if (role === "texture" && Math.random() < 0.4) { st.nextAt = at + 20 + Math.random() * 40; return; } // 쉬어 가기
    else len = 45 + Math.random() * 75;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = cfg.loop;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(cfg.level, at + fade);
    g.gain.setValueAtTime(cfg.level, Math.max(at + fade, at + len - fade));
    g.gain.linearRampToValueAtTime(0, at + len);
    src.connect(g).connect(this.out);
    src.start(at, cfg.loop ? Math.random() * buf.duration : 0);
    src.stop(at + len + 0.1);
    this.voices.add(src);
    src.onended = () => { this.voices.delete(src); try { g.disconnect(); } catch (e) { /* 무시 */ } };
    st.nextAt = role === "melody" ? at + len + 8 + Math.random() * 25 : at + len - fade;
  }

  stop(fade = 4) {
    if (!this.running) return;
    this.running = false;
    this.e.tickers.delete(this.ticker);
    const out = this.out, voices = this.voices;
    this.e.smooth(out.gain, 0, fade);
    setTimeout(() => {
      for (const v of voices) { try { v.stop(); } catch (e) { /* 무시 */ } }
      try { out.disconnect(); } catch (e) { /* 무시 */ }
    }, fade * 1000 + 200);
  }
}

// ================= 앨범 음원 =================
export class AlbumPlayer {
  constructor(engine) {
    this.e = engine;
    this.list = [];
    this.idx = -1;
    this.shuffle = false;
    this.xfade = 5;
    this.running = false;
    this.stopAfterCurrent = false;
    this.onchange = null;  // (track) => void
    this.onfinish = null;  // 목록/현재 곡 재생이 끝났을 때
    this.decks = null;
  }

  _decks() {
    if (this.decks) return this.decks;
    const e = this.e;
    this.decks = [0, 1].map(() => {
      const el = new Audio();
      el.crossOrigin = "anonymous";
      el.preload = "auto";
      const g = e._gain(0, e.musicBus);
      e.ctx.createMediaElementSource(el).connect(g);
      const d = { el, g, track: null, fading: false };
      el.addEventListener("timeupdate", () => this._onTime(d));
      el.addEventListener("ended", () => { if (d === this.cur) this._advance(true); });
      el.addEventListener("error", () => { if (d === this.cur) this._onError(); });
      return d;
    });
    return this.decks;
  }

  setList(tracks) {
    this.list = tracks;
    this.order = tracks.map((_, i) => i);
    if (this.shuffle) this._shuffle();
  }

  setShuffle(on) {
    this.shuffle = on;
    this.order = this.list.map((_, i) => i);
    if (on) this._shuffle();
  }

  _shuffle() {
    for (let i = this.order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    }
  }

  get current() { return this.cur?.track || null; }

  play(i = 0) {
    if (!this.list.length) return;
    this._decks();
    this.running = true;
    this.errStreak = 0;
    this.pos = Math.max(0, this.order.indexOf(i));
    this._load(this.order[this.pos], 1.5);
  }

  _load(listIdx, fadeIn) {
    const e = this.e;
    const prev = this.cur;
    const d = this.decks.find(x => x !== prev) || this.decks[0];
    const track = this.list[listIdx];
    d.track = track;
    d.fading = false;
    d.el.src = track.url;
    const t = e.ctx.currentTime;
    holdAt(d.g.gain, t);
    d.g.gain.setValueAtTime(0, t);
    d.g.gain.setValueCurveAtTime(curve(0, 1, "s"), t + 0.05, fadeIn);
    d.el.play().catch(err => console.warn("[meditate] play", err));
    this.cur = d;
    if (prev && prev !== d) this._fadeOutDeck(prev, fadeIn);
    this.onchange?.(track);
  }

  _fadeOutDeck(d, secs) {
    this.e.smooth(d.g.gain, 0, secs);
    clearTimeout(d.stopT);
    d.stopT = setTimeout(() => { if (d !== this.cur) { d.el.pause(); d.el.removeAttribute("src"); d.el.load(); } }, secs * 1000 + 300);
  }

  _onTime(d) {
    if (d !== this.cur || d.fading || !this.running) return;
    const left = d.el.duration - d.el.currentTime;
    if (isFinite(left) && left <= this.xfade && d.el.duration > this.xfade * 3) {
      d.fading = true;
      this._advance(false);
    }
  }

  _advance(ended) {
    if (!this.running) return;
    if (this.stopAfterCurrent) {
      // 슬립 타이머 "곡이 끝나면": 다음 곡으로 넘어가지 않고 종료
      this.running = false;
      if (!ended) this._fadeOutDeck(this.cur, this.xfade);
      this.onfinish?.();
      return;
    }
    this.pos = (this.pos + 1) % this.order.length;
    if (this.pos === 0 && this.shuffle) this._shuffle();
    this._load(this.order[this.pos], ended ? 1 : this.xfade);
  }

  _onError() {
    this.errStreak = (this.errStreak || 0) + 1;
    if (this.errStreak > Math.min(5, this.list.length)) { this.running = false; this.onfinish?.("error"); return; }
    setTimeout(() => this._advance(true), 800);
  }

  next() { if (this.running) { this.cur.fading = true; this._advance(false); } }

  prev() {
    if (!this.running) return;
    this.pos = (this.pos - 1 + this.order.length) % this.order.length;
    this._load(this.order[this.pos], 2);
  }

  // 일시정지(엔진 일시정지와 함께 호출)
  pauseEls() { this.decks?.forEach(d => { if (!d.el.paused) { d.el.pause(); d.wasPlaying = true; } else d.wasPlaying = false; }); }
  resumeEls() { if (this.running) this.decks?.forEach(d => { if (d.wasPlaying) d.el.play().catch(() => {}); }); }

  stop(fade = 3) {
    if (!this.decks) return;
    this.running = false;
    this.decks.forEach(d => this._fadeOutDeck(d, fade));
    this.cur = null;
    this.onchange?.(null);
  }
}

// ================= 가이드 명상 음성 =================
export class VoicePlayer {
  constructor(engine) {
    this.e = engine;
    this.el = null;
    this.onend = null;
    this.ontime = null;
  }

  play(item) {
    const e = this.e;
    if (!this.el) {
      this.el = new Audio();
      this.el.crossOrigin = "anonymous";
      this.el.preload = "auto";
      e.ctx.createMediaElementSource(this.el).connect(e.voiceBus);
      this.el.addEventListener("ended", () => this.onend?.());
      this.el.addEventListener("error", () => this.onend?.("error"));
      this.el.addEventListener("timeupdate", () => this.ontime?.(this.el.currentTime, this.el.duration));
    }
    this.item = item;
    this.el.src = item.url;
    this.el.currentTime = 0;
    return this.el.play();
  }

  get active() { return !!(this.el && this.item && !this.el.ended && this.el.src); }
  pause() { if (this.el && !this.el.paused) { this.el.pause(); this.was = true; } else this.was = false; }
  resume() { if (this.el && this.was) this.el.play().catch(() => {}); }
  stop() { if (this.el) { this.el.pause(); this.el.removeAttribute("src"); this.el.load(); } this.item = null; }
}
