/* Rebroni Mastering DSP
 * 순수 자바스크립트 신호 처리 모음입니다. 서버·외부 라이브러리 없이 브라우저 안에서만 동작합니다.
 *  - 분석: 라우드니스(ITU-R BS.1770-4 / EBU R128), 트루 피크(4배 오버샘플링), 1/3옥타브 스펙트럼, 스테레오 상관
 *  - 처리: EQ → 컴프레서 → 새츄레이션 → 스테레오(M/S) → 트루 피크 리미터 → 목표 라우드니스 맞춤
 *  - 자동 설정: 분석 결과와 무드(또는 레퍼런스 곡)를 비교해 EQ·압축·폭·목표 라우드니스를 제안
 * 메인 스레드(자동 설정·그래프)와 Worker(무거운 처리)가 같은 파일을 씁니다.
 */
(function (root) {
  "use strict";

  const LN10_20 = Math.LN10 / 20;
  const dbToLin = (db) => Math.exp(db * LN10_20);
  const linToDb = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ---------- Biquad (RBJ Audio EQ Cookbook) ----------
  function biquad(type, f0, fs, q, gainDb) {
    const A = Math.pow(10, (gainDb || 0) / 40);
    const w0 = 2 * Math.PI * Math.min(f0, fs * 0.49) / fs;
    const cs = Math.cos(w0), alpha = Math.sin(w0) / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case "highpass":
        b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
      case "peaking":
        b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A; break;
      case "lowshelf": {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) - (A - 1) * cs + s); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - s);
        a0 = (A + 1) + (A - 1) * cs + s; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - s; break;
      }
      case "highshelf": {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) + (A - 1) * cs + s); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - s);
        a0 = (A + 1) - (A - 1) * cs + s; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - s; break;
      }
      default: throw new Error("unknown filter " + type);
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  // Transposed Direct Form II, 제자리 처리
  function filterInPlace(x, c) {
    const { b0, b1, b2, a1, a2 } = c;
    let z1 = 0, z2 = 0;
    for (let i = 0, n = x.length; i < n; i++) {
      const v = x[i], y = b0 * v + z1;
      z1 = b1 * v - a1 * y + z2;
      z2 = b2 * v - a2 * y;
      x[i] = y;
    }
  }

  // 필터 묶음의 주파수 응답(dB) — EQ 곡선 그래프용
  function responseDb(filters, f, fs) {
    const w = 2 * Math.PI * f / fs;
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    let db = 0;
    for (const { b0, b1, b2, a1, a2 } of filters) {
      const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
      const dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
      db += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
    }
    return db;
  }

  // ---------- 라우드니스 (BS.1770-4 K-weighting, 400ms/3s 블록, 게이팅) ----------
  // libebur128과 같은 방식으로 표본화율별 계수를 계산 (48kHz에서 BS.1770 표의 계수와 일치)
  function kFilters(fs) {
    let K = Math.tan(Math.PI * 1681.974450955533 / fs), Q = 0.7071752369554196;
    const Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q + K * K;
    const shelf = {
      b0: (Vh + Vb * K / Q + K * K) / a0, b1: 2 * (K * K - Vh) / a0, b2: (Vh - Vb * K / Q + K * K) / a0,
      a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0,
    };
    K = Math.tan(Math.PI * 38.13547087602444 / fs); Q = 0.5003270373238773;
    a0 = 1 + K / Q + K * K;
    const hp = { b0: 1, b1: -2, b2: 1, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 };
    return [shelf, hp];
  }
  const powToLufs = (p) => (p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity);

  // chs: Float32Array[] / gain: 스칼라 배율 / env: 샘플별 배율(리미터 게인, 선택)
  function loudness(chs, fs, gain = 1, env = null) {
    const n = chs[0].length, hop = Math.max(1, Math.round(fs * 0.1));
    const nSeg = Math.floor(n / hop);
    const seg = new Float64Array(nSeg);
    const [k1, k2] = kFilters(fs);
    for (const x of chs) {
      let p1 = 0, p2 = 0, q1 = 0, q2 = 0;
      for (let s = 0; s < nSeg; s++) {
        let acc = 0;
        for (let i = s * hop, end = i + hop; i < end; i++) {
          const v = env ? x[i] * env[i] * gain : x[i] * gain;
          const y1 = k1.b0 * v + p1; p1 = k1.b1 * v - k1.a1 * y1 + p2; p2 = k1.b2 * v - k1.a2 * y1;
          const y2 = k2.b0 * y1 + q1; q1 = k2.b1 * y1 - k2.a1 * y2 + q2; q2 = k2.b2 * y1 - k2.a2 * y2;
          acc += y2 * y2;
        }
        seg[s] += acc;
      }
    }
    const blocks = (len) => {
      const out = new Float64Array(Math.max(0, nSeg - len + 1));
      let acc = 0;
      for (let s = 0; s < nSeg; s++) {
        acc += seg[s];
        if (s >= len) acc -= seg[s - len];
        if (s >= len - 1) out[s - len + 1] = Math.max(0, acc) / (len * hop);
      }
      return out;
    };
    const mom = blocks(4), st = blocks(30);
    const ABS = Math.pow(10, (-70 + 0.691) / 10);

    // 통합 라우드니스: 절대 게이트 -70 LUFS, 상대 게이트 -10 LU
    let integrated = -Infinity;
    let sum = 0, cnt = 0;
    for (const p of mom) if (p > ABS) { sum += p; cnt++; }
    if (cnt) {
      const rel = (sum / cnt) * 0.1;
      let s2 = 0, c2 = 0;
      for (const p of mom) if (p > ABS && p > rel) { s2 += p; c2++; }
      integrated = powToLufs(s2 / c2);
    }

    // 라우드니스 범위(LRA, EBU Tech 3342): 숏텀, 상대 게이트 -20 LU, 10~95 백분위
    let lra = 0;
    let sSum = 0, sCnt = 0;
    for (const p of st) if (p > ABS) { sSum += p; sCnt++; }
    if (sCnt) {
      const rel = (sSum / sCnt) * 0.01;
      const vals = [];
      for (const p of st) if (p > ABS && p > rel) vals.push(powToLufs(p));
      vals.sort((a, b) => a - b);
      if (vals.length > 1) {
        const pc = (q) => vals[Math.min(vals.length - 1, Math.round(q * (vals.length - 1)))];
        lra = pc(0.95) - pc(0.1);
      }
    }

    let momentaryMax = -Infinity, shortTermMax = -Infinity;
    for (const p of mom) momentaryMax = Math.max(momentaryMax, powToLufs(p));
    const shortTerm = new Float32Array(st.length);
    for (let j = 0; j < st.length; j++) {
      shortTerm[j] = Math.max(-70, powToLufs(st[j]));
      shortTermMax = Math.max(shortTermMax, shortTerm[j]);
    }
    return { integrated, lra, momentaryMax, shortTermMax, shortTerm, hop: 0.1 };
  }

  // ---------- 트루 피크 (4배 오버샘플링, 48탭 폴리페이즈) ----------
  const OS = 4, TPP = 12;
  let tpPhases = null;
  function tpFilter() {
    if (tpPhases) return tpPhases;
    // 49점 Blackman 창 sinc에서 끝점(값 0)을 뺀 48탭 — 중심이 24라서 보간점이 정확히 1/4 샘플 간격에 놓임
    const N = OS * TPP, mid = N / 2;
    const h = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      const t = (n - mid) / OS;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * n / N) + 0.08 * Math.cos(4 * Math.PI * n / N);
      h[n] = sinc * w;
    }
    tpPhases = [];
    for (let p = 0; p < OS; p++) {
      const ph = new Float64Array(TPP);
      let s = 0;
      for (let k = 0; k < TPP; k++) { ph[k] = h[p + OS * k]; s += ph[k]; }
      for (let k = 0; k < TPP; k++) ph[k] /= s; // 위상별 DC 이득 1
      tpPhases.push(ph);
    }
    return tpPhases;
  }

  /* 반환: 전체 트루 피크(선형). out이 있으면 샘플별(채널 최대) 피크를 기록 — 리미터 검출용
   * 위상 p의 보간점은 원래 시간축에서 i - 6 + p/4 에 놓입니다. 위상 0은 원래 샘플 그대로라 계산을 생략하고
   * 위상 1은 i-6, 위상 2·3은 i-5 샘플 위치로 모읍니다.
   * floor: 이웃 두 샘플이 모두 이 값 미만이면 보간을 건너뜀 (상한 검사처럼 큰 피크만 궁금할 때 속도용) */
  function truePeak(chs, out = null, floor = 0) {
    const [, c1, c2, c3] = tpFilter();
    const n = chs[0].length;
    let max = 0;
    if (out) out.fill(0);
    for (const x of chs) {
      for (let i = 0; i < n; i++) {
        const xi = x[i] < 0 ? -x[i] : x[i];
        if (xi > max) max = xi;
        if (out && xi > out[i]) out[i] = xi;
      }
      for (let i = TPP - 1; i < n; i++) {
        if (floor > 0 && x[i - 6] < floor && x[i - 6] > -floor && x[i - 5] < floor && x[i - 5] > -floor) continue;
        let a1 = 0, a2 = 0, a3 = 0;
        for (let k = 0; k < TPP; k++) {
          const v = x[i - k];
          a1 += c1[k] * v; a2 += c2[k] * v; a3 += c3[k] * v;
        }
        a1 = Math.abs(a1); a2 = Math.abs(a2); a3 = Math.abs(a3);
        const m23 = a2 > a3 ? a2 : a3;
        if (out) {
          if (a1 > out[i - 6]) out[i - 6] = a1;
          if (m23 > out[i - 5]) out[i - 5] = m23;
        }
        const m = a1 > m23 ? a1 : m23;
        if (m > max) max = m;
      }
    }
    return max;
  }

  // ---------- 스펙트럼 (장시간 평균, 1/3옥타브) ----------
  const THIRD = [25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250,
    1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < half; k++) {
          const a = i + k, b = a + half;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }

  function spectrum(L, R, fs) {
    const N = 16384, n = L.length, half = N / 2;
    const win = new Float64Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    const frames = n <= N ? 1 : Math.min(240, Math.floor((n - N) / half) + 1);
    const step = frames > 1 ? (n - N) / (frames - 1) : 0;
    const pm = new Float64Array(half), ps = new Float64Array(half);
    const mr = new Float64Array(N), mi = new Float64Array(N), sr = new Float64Array(N), si = new Float64Array(N);
    let used = 0;
    for (let f = 0; f < frames; f++) {
      const st = Math.round(f * step);
      let e = 0;
      for (let i = 0; i < N; i++) {
        const l = st + i < n ? L[st + i] : 0, r = st + i < n ? R[st + i] : 0;
        const m = (l + r) * 0.5, s = (l - r) * 0.5;
        e += m * m + s * s;
        mr[i] = m * win[i]; mi[i] = 0; sr[i] = s * win[i]; si[i] = 0;
      }
      if (e / N < 1e-8) continue; // 무음 구간 제외 (-80 dBFS 미만)
      fft(mr, mi); fft(sr, si);
      for (let k = 0; k < half; k++) { pm[k] += mr[k] * mr[k] + mi[k] * mi[k]; ps[k] += sr[k] * sr[k] + si[k] * si[k]; }
      used++;
    }
    const binHz = fs / N, norm = used ? 1 / (used * N * N) : 0;
    const band = (pw, fc) => {
      const lo = fc / Math.pow(2, 1 / 6), hi = fc * Math.pow(2, 1 / 6);
      if (hi > fs / 2 || !used) return NaN;
      let s = 0;
      for (let k = Math.max(1, Math.ceil(lo / binHz)); k * binHz < hi && k < half; k++) s += pw[k];
      if (!s) s = pw[Math.max(1, Math.round(fc / binHz))];
      return 10 * Math.log10(s * norm * 4 + 1e-20);
    };
    const mid = THIRD.map((fc) => band(pm, fc)), side = THIRD.map((fc) => band(ps, fc));
    // 150Hz 이하에서 사이드/미드 에너지 비 — 저역이 퍼져 있는지 진단
    let lm = 0, ls = 0;
    for (let k = 1; k * binHz < 150 && k < half; k++) { lm += pm[k]; ls += ps[k]; }
    const lowSideDb = lm > 0 ? 10 * Math.log10((ls + 1e-20) / lm) : -Infinity;
    return { freqs: THIRD, mid, side, lowSideDb };
  }

  function stereoStats(L, R) {
    let ll = 0, rr = 0, lr = 0, mm = 0, ss = 0;
    for (let i = 0, n = L.length; i < n; i++) {
      const l = L[i], r = R[i], m = l + r, s = l - r;
      ll += l * l; rr += r * r; lr += l * r; mm += m * m; ss += s * s;
    }
    return {
      corr: ll && rr ? lr / Math.sqrt(ll * rr) : 1,
      sideMidDb: mm > 0 ? 10 * Math.log10((ss + 1e-20) / mm) : 0,
    };
  }

  function analyze(chs, fs, opts = {}) {
    const [L, R] = chs;
    const loud = loudness(chs, fs);
    const tpLin = opts.tpLin != null ? opts.tpLin : truePeak(chs);
    let sp = 0;
    for (const x of chs) for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > sp) sp = a; }
    const tp = linToDb(tpLin);
    return {
      fs, duration: L.length / fs, loud,
      tp, samplePeak: linToDb(sp), plr: tp - loud.integrated,
      ...stereoStats(L, R),
      spec: spectrum(L, R, fs),
    };
  }

  // ---------- 처리 블록 ----------
  function compress(L, R, fs, { thresholdDb, ratio, attackMs, releaseMs, kneeDb = 6 }) {
    const aD = Math.exp(-1 / (0.01 * fs)); // 10ms RMS 검출
    const aA = Math.exp(-1 / (attackMs * 0.001 * fs)), aR = Math.exp(-1 / (releaseMs * 0.001 * fs));
    const slope = 1 / ratio - 1, k2 = kneeDb / 2;
    let env = 0, gr = 0, maxGr = 0, sumGr = 0, cnt = 0;
    for (let i = 0, n = L.length; i < n; i++) {
      const l = L[i], r = R[i];
      const p = (l * l + r * r) * 0.5;
      env = p + aD * (env - p);
      const lev = 4.342944819032518 * Math.log(env + 1e-12);
      const over = lev - thresholdDb;
      let target = 0;
      if (over > k2) target = slope * over;
      else if (over > -k2) target = slope * (over + k2) * (over + k2) / (2 * kneeDb);
      gr = target < gr ? target + aA * (gr - target) : target + aR * (gr - target);
      const g = Math.exp(gr * LN10_20);
      L[i] = l * g; R[i] = r * g;
      if (gr < maxGr) maxGr = gr;
      if (lev > thresholdDb - 20) { sumGr += gr; cnt++; }
    }
    return { maxGr: -maxGr, avgGr: cnt ? -sumGr / cnt : 0 };
  }

  // tanh 유리함수 근사 (|x|≤3에서 오차 2% 이내, 이후 ±1로 포화) — Math.tanh보다 수 배 빠름
  const fastTanh = (x) => (x > 3 ? 1 : x < -3 ? -1 : x * (27 + x * x) / (27 + 9 * x * x));

  // 부드러운 tanh 새츄레이션을 원음과 섞어 배음을 더합니다 (따뜻함)
  function saturate(L, R, amount) {
    const mix = 0.5 * amount, d = 1.5;
    for (const x of [L, R]) for (let i = 0, n = x.length; i < n; i++) {
      const v = x[i];
      x[i] = v + mix * (fastTanh(d * v) / d - v);
    }
  }

  // M/S 스테레오 폭 + 저역 모노화(사이드 신호를 4차 하이패스)
  function stereo(L, R, fs, width, monoHz) {
    const n = L.length, S = new Float32Array(n);
    for (let i = 0; i < n; i++) { S[i] = (L[i] - R[i]) * 0.5; L[i] = (L[i] + R[i]) * 0.5; } // L ← Mid
    if (monoHz > 0) { const hp = biquad("highpass", monoHz, fs, Math.SQRT1_2); filterInPlace(S, hp); filterInPlace(S, hp); }
    for (let i = 0; i < n; i++) { const m = L[i], s = S[i] * width; L[i] = m + s; R[i] = m - s; }
  }

  /* 룩어헤드 브릭월 리미터의 샘플별 게인을 g에 기록합니다.
   * r[i] = min(1, 상한 / (G·트루피크[i])) 일 때
   *  m[i] = min(r[i..i+L])  →  L 길이 이동평균  →  릴리즈 스무딩
   * 이동평균 창 안의 모든 m이 r[i] 이하이므로 g[i] ≤ r[i]가 수학적으로 보장됩니다. */
  function limiterGain(tpx, G, ceil, L, releaseCoef, g) {
    const n = tpx.length, cap = L + 2, thr = ceil / G;
    const dq = new Int32Array(cap), rv = new Float32Array(cap);
    let head = 0, size = 0;
    for (let j = n - 1; j >= 0; j--) {
      const t = tpx[j], r = t > thr ? thr / t : 1;
      while (size && rv[(head + size - 1) % cap] >= r) size--;
      const pos = (head + size) % cap;
      dq[pos] = j; rv[pos] = r; size++;
      while (dq[head] > j + L) { head = (head + 1) % cap; size--; }
      g[j] = rv[head];
    }
    const ring = new Float32Array(L);
    let sum = 0, prev = 1, minG = 1, grSum = 0;
    for (let i = 0; i < n; i++) {
      const k = i % L;
      if (i >= L) sum -= ring[k];
      ring[k] = g[i]; sum += g[i];
      const a = sum / Math.min(i + 1, L);
      prev = a < prev ? a : prev + (a - prev) * releaseCoef;
      g[i] = prev;
      if (prev < minG) minG = prev;
      if ((i & 63) === 0) grSum += prev;
    }
    return { maxGr: -linToDb(minG), avgGr: -linToDb(grSum / Math.ceil(n / 64)) };
  }

  /* 마스터링 체인 — src는 스테레오 Float32Array 2개(원본은 건드리지 않음)
   * P: { eq:[{type,f,q,g}], hpf, comp(0~1), warmth(0~1), width, monoHz, targetLufs, ceiling } */
  function master(src, fs, P, progress = () => {}) {
    const L = src[0].slice(), R = src[1].slice(), chs = [L, R], n = L.length;
    const steps = [];

    progress("EQ", 0.05);
    const filters = eqFilters(P, fs);
    for (const f of filters) { filterInPlace(L, f); filterInPlace(R, f); }

    // 게인 스테이징: 이후 처리(압축·새츄레이션)가 곡 음량과 무관하게 같은 강도로 동작하도록 -18 LUFS로 맞춤
    progress("게인 스테이징", 0.15);
    const pre = loudness(chs, fs).integrated;
    if (!isFinite(pre)) throw new Error("소리가 거의 없거나 너무 짧은 음원입니다.");
    const stage = dbToLin(-18 - pre);
    for (const x of chs) for (let i = 0; i < n; i++) x[i] *= stage;

    let comp = null;
    if (P.comp > 0.01) {
      progress("컴프레서", 0.25);
      comp = compress(L, R, fs, {
        thresholdDb: -18 + 4 - 8 * P.comp, ratio: 1 + 2.5 * P.comp, attackMs: 25 - 10 * P.comp, releaseMs: 220,
      });
    }
    if (P.warmth > 0.01) { progress("새츄레이션", 0.35); saturate(L, R, P.warmth); }
    if (Math.abs(P.width - 1) > 0.005 || P.monoHz > 0) { progress("스테레오", 0.4); stereo(L, R, fs, P.width, P.monoHz); }

    progress("트루 피크 검출", 0.45);
    const tpx = new Float32Array(n);
    truePeak(chs, tpx);
    const g = new Float32Array(n);
    const ceil = dbToLin(P.ceiling);
    const look = Math.max(1, Math.round(0.002 * fs));
    const rc = 1 - Math.exp(-1 / (0.08 * fs));
    const base = loudness(chs, fs).integrated;

    // 리미터를 거친 뒤 목표 라우드니스가 되도록 입력 게인을 반복 보정 (할선법)
    let gDb = P.targetLufs - base, prevM = null, prevG = null, M = base, lim = null, it = 0;
    for (; it < 8; it++) {
      progress("라우드니스 맞춤 " + (it + 1), 0.55 + it * 0.04);
      lim = limiterGain(tpx, dbToLin(gDb), ceil, look, rc, g);
      M = loudness(chs, fs, dbToLin(gDb), g).integrated;
      const err = P.targetLufs - M;
      steps.push({ gainDb: gDb, lufs: M, limGr: lim.maxGr });
      if (Math.abs(err) < 0.05) break;
      let slope = 1;
      if (prevM !== null && Math.abs(gDb - prevG) > 1e-3) slope = clamp((M - prevM) / (gDb - prevG), 0.15, 1);
      prevM = M; prevG = gDb;
      gDb = Math.min(gDb + err / slope, 36);
    }

    progress("렌더링", 0.9);
    const G = dbToLin(gDb);
    for (const x of chs) for (let i = 0; i < n; i++) x[i] *= G * g[i];

    // 최종 안전장치: 오버샘플링 피크가 상한을 넘으면 전체를 살짝 낮춤
    progress("최종 검사", 0.94);
    let tpLin = truePeak(chs, null, ceil * 0.5); // 상한보다 6dB 이상 낮은 구간은 넘칠 수 없으므로 건너뜀
    let trimDb = 0;
    if (tpLin > ceil) {
      trimDb = linToDb(ceil / tpLin) - 0.01;
      const t = dbToLin(trimDb);
      for (const x of chs) for (let i = 0; i < n; i++) x[i] *= t;
      tpLin *= t;
    }
    const out = analyze(chs, fs, { tpLin });
    return {
      chs, analysis: out,
      stats: {
        stageDb: linToDb(stage), gainDb: gDb, trimDb, iterations: it + 1, steps,
        comp, limiter: lim,
      },
    };
  }

  function eqFilters(P, fs) {
    const out = [];
    if (P.hpf > 0) out.push(biquad("highpass", P.hpf, fs, Math.SQRT1_2));
    for (const b of P.eq || []) if (Math.abs(b.g) >= 0.1 && b.f < fs * 0.45) out.push(biquad(b.type, b.f, fs, b.q, b.g));
    return out;
  }

  // ---------- 자동 설정 (분석 기반 제안) ----------
  const MOODS = {
    balanced: { name: "Balanced", ko: "밸런스", desc: "어떤 곡에도 무난한 기본값", slope: 1.7, lra: 7, width: 1.05, warmth: 0.1, lufs: -14 },
    warm: { name: "Warm Breath", ko: "따뜻한 숨결", desc: "부드러운 고역 · 두툼한 중저역", slope: 2.3, lra: 8, width: 1.0, warmth: 0.35, lufs: -14 },
    cosmic: { name: "Cosmic", ko: "우주의 깨어남", desc: "넓은 스테레오와 공기감", slope: 1.5, lra: 9, width: 1.2, warmth: 0.1, lufs: -14 },
    serenity: { name: "Serenity", ko: "고요한 여정", desc: "다이내믹을 살린 앰비언트 · 피아노", slope: 2.0, lra: 12, width: 1.1, warmth: 0.15, lufs: -16 },
    city: { name: "City Vibe", ko: "도시의 리듬", desc: "선명하고 펀치감 있는 비트", slope: 1.3, lra: 6, width: 1.08, warmth: 0.2, lufs: -11 },
  };

  // 무드별 목표 스펙트럼 모양 (1/3옥타브 대역 파워, 1kHz 기준 상대값)
  function moodCurve(slope) {
    return THIRD.map((f) => {
      let t = -slope * Math.log2(f / 1000);
      if (f < 40) t -= 12 * Math.log2(40 / f);
      if (f > 14000) t -= 6 * Math.log2(f / 14000);
      return t;
    });
  }

  // 목표 대비 차이(dB, 레벨 오프셋 제거·평활화). 양수 = 목표보다 부족
  function curveDiff(src, tgt) {
    const d = THIRD.map((f, i) => (f >= 31.5 && f <= 16000 && isFinite(src[i]) && isFinite(tgt[i]) ? tgt[i] - src[i] : NaN));
    let s = 0, c = 0;
    THIRD.forEach((f, i) => { if (f >= 100 && f <= 8000 && isFinite(d[i])) { s += d[i]; c++; } });
    const off = c ? s / c : 0;
    const centered = d.map((v) => v - off);
    return centered.map((v, i) => {
      if (!isFinite(v)) return NaN;
      const a = isFinite(centered[i - 1]) ? centered[i - 1] : v, b = isFinite(centered[i + 1]) ? centered[i + 1] : v;
      return 0.25 * a + 0.5 * v + 0.25 * b;
    });
  }

  const regionAvg = (d, lo, hi) => {
    let s = 0, c = 0;
    THIRD.forEach((f, i) => { if (f >= lo && f <= hi && isFinite(d[i])) { s += d[i]; c++; } });
    return c ? s / c : 0;
  };

  // 옥타브 피킹 EQ 10밴드(목표 곡선 매칭) + 사용자 톤 3밴드
  function buildEq(diff, amount, tone) {
    const bands = [];
    for (let i = 1; i < THIRD.length - 1; i += 3) {
      const vals = [diff[i - 1], diff[i], diff[i + 1]].filter(isFinite);
      if (!vals.length) continue;
      const lim = i === 1 || i >= 28 ? 3 : 5;
      const g = clamp((vals.reduce((a, b) => a + b, 0) / vals.length) * amount * 0.85, -lim, lim);
      bands.push({ type: "peaking", f: THIRD[i], q: 1.41, g: Math.round(g * 10) / 10 });
    }
    bands.push({ type: "lowshelf", f: 100, q: Math.SQRT1_2, g: tone.low || 0 });
    bands.push({ type: "peaking", f: 3000, q: 0.9, g: tone.presence || 0 });
    bands.push({ type: "highshelf", f: 12000, q: Math.SQRT1_2, g: tone.air || 0 });
    return bands;
  }

  const f1 = (v) => (v > 0 ? "+" : "") + v.toFixed(1);

  /* 분석 결과 → 제안 설정 + 진단 메시지
   * ref가 있으면 무드 대신 레퍼런스 곡의 스펙트럼·라우드니스·다이내믹·폭을 목표로 삼습니다. */
  function suggest(an, moodId, ref) {
    const mood = MOODS[moodId] || MOODS.balanced;
    const target = ref ? ref.spec.mid : moodCurve(mood.slope);
    const diff = curveDiff(an.spec.mid, target);
    const tgtLra = ref ? ref.loud.lra : mood.lra;
    const lra = an.loud.lra;
    const notes = [];

    const comp = clamp(0.15 + (lra - tgtLra) * 0.07, 0, 0.75);
    let width = mood.width;
    if (ref) width = clamp(Math.pow(10, (ref.sideMidDb - an.sideMidDb) / 20), 0.7, 1.4);
    if (an.corr < 0.2) width = Math.min(width, 0.9);
    else if (an.sideMidDb > -6) width = Math.min(width, 1.0);
    const targetLufs = ref ? clamp(Math.round(ref.loud.integrated * 2) / 2, -20, -8) : mood.lufs;

    // 진단 (목표 라우드니스 안내는 사용자가 목표를 바꿀 수 있어 화면 쪽에서 붙임)
    if (an.tp > -0.1) notes.push({ lv: "warn", t: `트루 피크 ${f1(an.tp)} dBTP — 클리핑 위험. 리미터로 상한을 지킵니다.` });
    if (lra > tgtLra + 3) notes.push({ lv: "warn", t: `다이내믹 범위(LRA) ${lra.toFixed(1)} LU로 목표(${tgtLra.toFixed(0)} LU)보다 넓음 → 글루 압축 ${Math.round(comp * 100)}%` });
    else if (lra < tgtLra - 3) notes.push({ lv: "info", t: `다이내믹 범위 ${lra.toFixed(1)} LU로 이미 촘촘함 → 압축 최소화` });
    else notes.push({ lv: "ok", t: `다이내믹 범위 ${lra.toFixed(1)} LU — 적정` });

    const regions = [
      [20, 120, "저역(킥·베이스)"], [160, 500, "중저역(탁함)"], [630, 2000, "중역(보컬·악기 몸통)"],
      [2500, 6300, "존재감(선명도)"], [8000, 16000, "공기감(고역)"],
    ];
    let balanced = true;
    for (const [lo, hi, name] of regions) {
      const v = regionAvg(diff, lo, hi);
      if (Math.abs(v) >= 2) {
        balanced = false;
        notes.push({ lv: "warn", t: `${name}이 ${ref ? "레퍼런스" : "목표"}보다 ${Math.abs(v).toFixed(1)} dB ${v > 0 ? "부족" : "과다"} → EQ로 ${v > 0 ? "보강" : "감쇄"}` });
      }
    }
    if (balanced) notes.push({ lv: "ok", t: `주파수 밸런스가 ${ref ? "레퍼런스와" : "목표 곡선과"} 2 dB 이내로 잘 맞습니다` });

    if (an.corr < 0) notes.push({ lv: "warn", t: `스테레오 상관 ${an.corr.toFixed(2)} — 위상 반전 의심. 모노 재생 시 소리가 사라질 수 있어 폭을 줄입니다.` });
    else if (an.corr < 0.2) notes.push({ lv: "warn", t: `스테레오 상관 ${an.corr.toFixed(2)} — 매우 넓음. 모노 호환성을 위해 폭을 ${Math.round(width * 100)}%로 제한` });
    else notes.push({ lv: "ok", t: `스테레오 상관 ${an.corr.toFixed(2)} — 모노 호환 양호 (폭 ${Math.round(width * 100)}%)` });
    if (an.spec.lowSideDb > -12) notes.push({ lv: "warn", t: `150Hz 이하 저역이 좌우로 퍼져 있음(사이드 ${an.spec.lowSideDb.toFixed(1)} dB) → 저역 모노화 권장` });

    return {
      target, diff, notes,
      settings: { comp: Math.round(comp * 100) / 100, width: Math.round(width * 100) / 100, warmth: ref ? 0.1 : mood.warmth, targetLufs },
    };
  }

  // ---------- 스트리밍 플랫폼 재생 레벨 추정 ----------
  // 공개적으로 알려진 기본 정규화 기준값 (정책은 바뀔 수 있어 추정치로 표시)
  const PLATFORMS = [
    { id: "spotify", name: "Spotify", lufs: -14, up: true },
    { id: "youtube", name: "YouTube", lufs: -14, up: false },
    { id: "apple", name: "Apple Music", lufs: -16, up: true },
    { id: "amazon", name: "Amazon Music", lufs: -14, up: false },
    { id: "tidal", name: "TIDAL", lufs: -14, up: false },
    { id: "deezer", name: "Deezer", lufs: -15, up: false },
  ];
  // 볼륨을 올리는 플랫폼도 트루 피크 -1 dBTP 를 넘기지 않는 범위까지만 올린다고 가정
  function platformGain(p, lufs, tp) {
    const d = p.lufs - lufs;
    if (d <= 0) return d;
    return p.up ? Math.max(0, Math.min(d, -1 - tp)) : 0;
  }

  root.RDSP = {
    dbToLin, linToDb, clamp, biquad, responseDb, loudness, truePeak, analyze, master, eqFilters,
    MOODS, THIRD, moodCurve, curveDiff, buildEq, suggest, PLATFORMS, platformGain,
  };
})(typeof self !== "undefined" ? self : this);
