// 쉼터(Rest) 사운드
// - Meditate의 오디오 엔진(자연의 소리·벨·호흡 신호음 합성)을 그대로 쓰고, 방마다 필요한 소리만 덧붙인다.
//   (바닷속 소리·고래 노래·발소리·성냥·입김·물방울·돌 쌓는 소리)
// - 모든 소리는 브라우저 안에서 합성한다 — 음원 파일·외부 요청 없음.
// - 휴대폰 연산 부담: 음마다 무거운 노드를 만들지 않고, 짧은 소리는 몇 개의 노드로 끝낸다.
import { Engine, holdAt } from "../meditate/audio-engine.js?v=3";

const rnd = (a, b) => a + Math.random() * (b - a);

export class RestSound {
  constructor(prefs) {
    this.e = new Engine();
    this.enabled = prefs.sound !== false;
    this.volume = prefs.volume ?? 0.8;
    this.mix = {};
    this.custom = new Map(); // id → { out, nodes, ticker, level }
    this.started = false;
    this.stepInterval = 0;   // 산책 발소리 간격(초). 0이면 멈춤
  }

  get ready() { return this.started && this.enabled && !!this.e.ctx; }

  // 사용자 탭 안에서 호출해야 한다 (모바일 자동 재생 정책)
  unlock() {
    if (!this.enabled) return;
    this.e.ensure();
    this.e.setMasterVolume(this.volume);
    this.e.play();
    this.started = true;
    this._applyMix();
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) this.unlock();
    else this.e.pause(0.5);
  }

  setVolume(v) {
    this.volume = v;
    this.e.setMasterVolume(v);
  }

  // 방에 들어갈 때 소리 조합을 통째로 바꾼다. 없는 항목은 0으로 줄어든다
  setMix(mix) {
    this.mix = { ...mix };
    this._applyMix();
  }

  level(id, v) {
    if (Math.abs((this.mix[id] || 0) - v) < 0.005) return;
    this.mix[id] = v;
    if (this.e.ctx) this._set(id, v);
  }

  _applyMix() {
    if (!this.e.ctx) return;
    const ids = new Set([...Object.keys(this.mix), ...Object.keys(this.e.levels), ...this.custom.keys()]);
    for (const id of ids) this._set(id, this.mix[id] || 0);
  }

  _set(id, v) {
    if (CUSTOM[id]) this._setCustom(id, v);
    else if ((this.e.levels[id] || 0) !== v) this.e.setLevel(id, v);
  }

  _setCustom(id, level) {
    const e = this.e;
    let L = this.custom.get(id);
    if (level > 0 && !L) {
      L = { out: e._gain(0, e.natureBus), nodes: [], ticker: null, base: 1, level: 0 };
      CUSTOM[id](e, L, this);
      if (L.ticker) e.tickers.add(L.ticker);
      this.custom.set(id, L);
    }
    if (!L) return;
    L.level = level;
    clearTimeout(L.dropT);
    holdAt(L.out.gain, e.now);
    L.out.gain.setTargetAtTime(level * level * L.base, e.now, 0.4);
    if (level === 0) {
      L.dropT = setTimeout(() => {
        if (L.level > 0) return;
        if (L.ticker) e.tickers.delete(L.ticker);
        for (const n of L.nodes) { try { n.stop?.(); } catch (err) { /* 이미 정지 */ } try { n.disconnect(); } catch (err) { /* 무시 */ } }
        try { L.out.disconnect(); } catch (err) { /* 무시 */ }
        this.custom.delete(id);
      }, 3000);
    }
  }

  // ---------- 짧은 효과음 ----------
  _shot(fn) {
    if (!this.ready) return;
    fn(this.e, this.e.now + 0.01);
  }

  // 노이즈 한 번 (모양: 필터 종류·주파수, 크기, 길이)
  _burst(e, t, { type = "bandpass", freq = 1000, q = 0.8, amp = 0.2, attack = 0.005, decay = 0.05, kind = "white", dest, sweepTo }) {
    const s = e.ctx.createBufferSource();
    s.buffer = e.noise(kind);
    const f = e._filter(type, freq, q);
    if (sweepTo) {
      f.frequency.setValueAtTime(freq, t);
      f.frequency.exponentialRampToValueAtTime(sweepTo, t + attack + decay * 2);
    }
    const g = e.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + attack);
    g.gain.setTargetAtTime(0, t + attack, decay);
    s.connect(f).connect(g).connect(dest || e.natureBus);
    s.start(t, Math.random() * 6);
    s.stop(t + attack + decay * 8 + 0.05);
    s.onended = () => { try { g.disconnect(); } catch (err) { /* 무시 */ } };
  }

  // 촛불 켜기: 성냥 긋는 소리 + 불이 붙는 '훅'
  match() {
    this._shot((e, t) => {
      this._burst(e, t, { freq: 3200, q: 1.2, amp: 0.22, attack: 0.004, decay: 0.035 });
      this._burst(e, t + 0.05, { freq: 2400, q: 1, amp: 0.12, attack: 0.01, decay: 0.05 });
      this._burst(e, t + 0.12, { type: "lowpass", freq: 260, sweepTo: 900, q: 0.5, amp: 0.3, attack: 0.06, decay: 0.12, kind: "brown" });
    });
  }

  // 촛불 끄기: '후-' 입김
  blow() {
    this._shot((e, t) => {
      this._burst(e, t, { freq: 900, q: 0.6, amp: 0.16, attack: 0.08, decay: 0.12, kind: "pink" });
    });
  }

  // 소원 등 띄우기: 부드러운 바람 + 틴샤
  release() {
    this._shot((e, t) => {
      this._burst(e, t, { freq: 500, sweepTo: 1400, q: 0.7, amp: 0.12, attack: 0.3, decay: 0.35, kind: "pink" });
      e.bell("chime", t + 0.25, 1, 0.55);
    });
  }

  // 소원 탑에 돌 얹기: 돌이 맞닿는 '딱'
  stone() {
    this._shot((e, t) => {
      this._burst(e, t, { freq: rnd(1600, 2300), q: 3, amp: 0.3, attack: 0.001, decay: 0.012 });
      this._burst(e, t + 0.002, { type: "lowpass", freq: 420, q: 0.6, amp: 0.25, attack: 0.002, decay: 0.03 });
    });
  }

  // 물방울: 위로 올라가는 짧은 음 몇 개
  bubbles(n = 4) {
    this._shot((e, t) => {
      for (let i = 0; i < n; i++) {
        const at = t + i * rnd(0.03, 0.09), f0 = rnd(450, 1200), dur = rnd(0.04, 0.09);
        const o = e.ctx.createOscillator();
        o.frequency.setValueAtTime(f0, at);
        o.frequency.exponentialRampToValueAtTime(f0 * rnd(1.8, 2.6), at + dur);
        const g = e.ctx.createGain();
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(rnd(0.04, 0.09), at + 0.004);
        g.gain.linearRampToValueAtTime(0, at + dur);
        o.connect(g).connect(e.natureBus);
        g.connect(e.natureVerb);
        o.start(at);
        o.stop(at + dur + 0.02);
        o.onended = () => { try { g.disconnect(); } catch (err) { /* 무시 */ } };
      }
    });
  }

  // 고래 노래 (바다 공간에서 고래가 지나갈 때)
  whale() {
    this._shot((e, t) => whaleSong(e, t, e.natureBus));
  }

  bell(type, delay = 0, strikes = 1, vol = 1) {
    if (!this.ready) return;
    this.e.bell(type, this.e.now + 0.02 + delay, strikes, vol);
  }

  cue(kind) {
    if (!this.ready) return;
    this.e.cue(kind, this.e.now + 0.02, "tone");
  }

  cancelBells() {
    if (this.e.ctx) this.e.cancelScheduled("bell");
  }
}

function whaleSong(e, t, dest) {
  const ctx = e.ctx;
  const dur = rnd(3.5, 6);
  const f0 = rnd(140, 220);
  const o = ctx.createOscillator();
  o.type = "triangle";
  o.frequency.setValueAtTime(f0, t);
  o.frequency.linearRampToValueAtTime(f0 * rnd(1.5, 2.1), t + dur * 0.45);
  o.frequency.linearRampToValueAtTime(f0 * rnd(0.6, 0.85), t + dur);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rnd(4, 6.5);
  const lfoG = ctx.createGain();
  lfoG.gain.value = f0 * 0.025;
  lfo.connect(lfoG).connect(o.frequency);
  const lp = e._filter("lowpass", 900, 0.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.12, t + dur * 0.3);
  g.gain.linearRampToValueAtTime(0.09, t + dur * 0.75);
  g.gain.linearRampToValueAtTime(0, t + dur);
  const p = ctx.createStereoPanner();
  p.pan.value = rnd(-0.5, 0.5);
  o.connect(lp).connect(g).connect(p);
  p.connect(dest);
  p.connect(e.natureVerb);
  o.start(t); lfo.start(t);
  o.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
  o.onended = () => { for (const n of [lp, g, p, lfoG]) { try { n.disconnect(); } catch (err) { /* 무시 */ } } };
}

// ---------- 쉼터 전용 레이어 ----------
const CUSTOM = {
  // 바닷속: 낮게 웅웅거리는 물의 울림이 천천히 밀려왔다 빠지고, 가끔 물방울이 올라간다
  underwater(e, L) {
    const swell = e._gain(0.8, L.out);
    const lp = e._filter("lowpass", 240, 0.5, swell);
    L.nodes.push(e._loop(e.noise("brown"), lp));
    const hiss = e._filter("lowpass", 650, 0.5, e._gain(0.12, L.out));
    L.nodes.push(e._loop(e.noise("pink"), hiss));
    const bub = e.sprinkle("restBubbles", 8, 26, (sr, add) => {
      const f0 = rnd(380, 1100), dur = rnd(0.03, 0.08), amp = rnd(0.02, 0.07);
      const n = Math.floor(dur * sr);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const x = i / n;
        ph += 2 * Math.PI * f0 * (1 + 1.4 * x) / sr;
        add(i, amp * Math.sin(ph) * Math.sin(Math.PI * x));
      }
    });
    L.nodes.push(e._loop(bub, e._filter("lowpass", 2200, 0.5, e._gain(0.6, L.out))));
    let next = e.now + 0.1;
    L.ticker = (now, until) => {
      while (next < until) {
        const t = next, dur = rnd(8, 14);
        swell.gain.linearRampToValueAtTime(rnd(0.85, 1.1), t + dur * 0.5);
        swell.gain.linearRampToValueAtTime(rnd(0.55, 0.7), t + dur);
        lp.frequency.linearRampToValueAtTime(rnd(220, 330), t + dur * 0.5);
        lp.frequency.linearRampToValueAtTime(rnd(170, 230), t + dur);
        next = t + dur;
      }
    };
    L.base = 1.4;
  },

  // 산책 발소리: 흙길을 밟는 소리 (뒤꿈치 + 앞꿈치)
  footsteps(e, L, s) {
    let next = e.now + 0.2;
    let foot = 0;
    L.ticker = (now) => {
      const iv = s.stepInterval;
      if (!iv) { next = now + 0.15; return; }
      if (next < now) next = now + 0.05;
      // 속도가 바뀌면 바로 따라가도록 1초 이내만 예약
      while (next < now + 1) {
        const t = next, amp = rnd(0.16, 0.26) * (foot ? 0.9 : 1);
        const pan = foot ? 0.12 : -0.12;
        const dest = e.ctx.createStereoPanner();
        dest.pan.value = pan;
        dest.connect(L.out);
        s._burst(e, t, { type: "lowpass", freq: rnd(700, 1100), q: 0.4, amp, attack: 0.006, decay: 0.035, kind: "white", dest });
        s._burst(e, t + rnd(0.05, 0.08), { freq: rnd(1400, 2200), q: 0.7, amp: amp * 0.7, attack: 0.004, decay: 0.03, kind: "white", dest });
        setTimeout(() => { try { dest.disconnect(); } catch (err) { /* 무시 */ } }, (t - now + 1.5) * 1000);
        foot ^= 1;
        next = t + iv * rnd(0.95, 1.05);
      }
    };
  }
};
