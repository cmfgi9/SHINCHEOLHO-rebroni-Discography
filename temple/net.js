// 온라인 법당 — 접속자 동기화
// - FirebaseNet: Firebase Realtime Database + 익명 로그인 (운영)
//     /temple/rooms/{rN}/players/{uid}  법당 N에 접속 중인 사람 (연결이 끊기면 onDisconnect로 자동 삭제)
//     /temple/presence/{rN}/{uid}       법당별 인원을 세기 위한 가벼운 접속 표시 (true)
//     /temple/lanterns/{slot}           연등 (24시간 유지 — 모든 법당이 함께 본다)
//     /temple/stats/{YYYY-MM-DD}        오늘의 합계: bows(절) · shares(나눈 음식) · offer/{rice|candle|incense|flower}(공양)
//     /temple/visits/{uid}              오늘 다녀간 이웃 (이름 번호·캐릭터·시각, 이틀 뒤 누구나 지울 수 있음)
//   규칙: 저장소 루트의 database.rules.json (Firebase Console에서 직접 게시)
//   (예전 경로 /temple/players 는 1단계까지의 화면이 쓰던 것 — 규칙에만 남겨 두었다)
// - LocalNet: 같은 브라우저의 여러 탭끼리 BroadcastChannel로 동기화 (개발 확인용, 주소에 ?net=local)
// - 어느 쪽이든 연결에 실패하면 temple.js가 '혼자 모드'로 동작한다.
//
// 플레이어 데이터 (짧은 키로 전송량 절약)
//   n 닉네임 번호 · c 캐릭터 · x,y 위치 · d 방향 · a 동작 · s 인사말 번호 · sn 인사 횟수
//   e 효과(bow·bell·moktak·give) · en 효과 횟수 · i 들고 있는 음식 · g 음식을 건넬 상대 uid · t 서버 시각
import { firebaseConfig } from "../firebase-config.js";

const VER = "10.12.2";
// Realtime Database 주소: Firebase Console → Realtime Database 화면 맨 위에 표시되는 주소
// (만들 때 고른 위치가 싱가포르가 아니면 이 주소를 바꿔 주세요)
export const DATABASE_URL = firebaseConfig.databaseURL || "https://rebroni-music-web-default-rtdb.asia-southeast1.firebasedatabase.app";
export const LANTERN_TTL = 24 * 3600 * 1000;
export const VISIT_TTL = 2 * 24 * 3600 * 1000;
export const ROOM_CAP = 30;  // 한 법당에 함께 머무는 인원 (화면에서 안내하는 값 — 규칙으로 강제하지는 못한다)
export const ROOM_MAX = 20;  // 법당 수 (규칙은 r1~r99 허용)
const STALE = 90 * 1000;     // 이보다 오래 소식이 없는 접속자는 숨김 (비정상 종료 대비)
const KST = 9 * 3600 * 1000;

export function kstDay(ms) {
  return new Date(ms + KST).toISOString().slice(0, 10);
}
export function kstDayStart(ms) {
  return Math.floor((ms + KST) / 86400000) * 86400000 - KST;
}

// 들어갈 법당 고르기: 원하는 곳에 자리가 있으면 거기, 아니면 사람이 가장 많으면서 자리가 남은 곳(함께 모이도록)
export function pickRoom(counts, want = 0, current = 0) {
  const c = (n) => (counts[n] || 0) - (n === current ? 1 : 0);
  if (want >= 1 && want <= ROOM_MAX && c(want) < ROOM_CAP) return want;
  let best = 0, bc = -1, least = 1, lc = Infinity;
  for (let n = 1; n <= ROOM_MAX; n++) {
    const k = c(n);
    if (k < ROOM_CAP && k > bc) { bc = k; best = n; }
    if (k < lc) { lc = k; least = n; }
  }
  return best || least;
}

class Base {
  constructor() {
    this.uid = null;
    this.room = 0;
    this.players = new Map(); // uid → data (나 제외, 지금 법당만)
    this.lanterns = {};       // slot → { u, c, t }
    this.stats = { bows: 0, shares: 0, offer: {} };
    this.offset = 0;          // 서버 시각 - 내 시각
    this.on = {};             // players(uid, data|null) · lanterns() · stats() · status(ok)
  }
  get bows() { return this.stats.bows || 0; }
  now() { return Date.now() + this.offset; }
  _emit(k, ...a) { this.on[k]?.(...a); }
  livePlayers() {
    const now = this.now();
    return [...this.players.entries()].filter(([, p]) => !p.t || now - p.t < STALE);
  }
  freshLanterns() {
    const now = this.now(), out = {};
    for (const [k, v] of Object.entries(this.lanterns)) if (v && now - v.t < LANTERN_TTL) out[k] = v;
    return out;
  }
}

// ---------- Firebase ----------
export class FirebaseNet extends Base {
  async connect(timeoutMs = 9000) {
    const [{ initializeApp, getApps, getApp }, A, D] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${VER}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${VER}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${VER}/firebase-database.js`)
    ]);
    this.D = D;
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    const auth = A.getAuth(app);
    const cred = await withTimeout(A.signInAnonymously(auth), timeoutMs, "auth");
    this.uid = cred.user.uid;
    const db = this.db = D.getDatabase(app, DATABASE_URL);
    // 연결 확인 (데이터베이스가 없거나 막혀 있으면 시간 초과)
    let off = null;
    await withTimeout(new Promise((res) => {
      off = D.onValue(D.ref(db, ".info/connected"), (s) => { if (s.val() === true) res(); });
    }), timeoutMs, "database").finally(() => off?.());
    D.onValue(D.ref(db, ".info/serverTimeOffset"), (s) => { this.offset = s.val() || 0; });
    let first = true;
    D.onValue(D.ref(db, ".info/connected"), (s) => {
      const ok = s.val() === true;
      // 끊겼다가 다시 연결되면 자동 삭제 예약과 접속 표시를 다시 건다 (예약은 한 번 쓰이면 사라진다)
      if (ok && !first) this._arm().catch(() => {});
      if (ok) first = false;
      this._emit("status", ok);
    });
    return this.uid;
  }

  // 연등·오늘의 합계는 모든 법당이 함께 본다
  listen() {
    const D = this.D, db = this.db;
    D.onValue(D.ref(db, "temple/lanterns"), (s) => {
      this.lanterns = s.val() || {};
      this._emit("lanterns");
      this._sweepLanterns();
    });
    this._watchStats();
    this._sweepVisits();
  }

  // 법당별 인원 { 1: 12, 2: 3, … }
  async roomCounts() {
    const D = this.D;
    const s = await withTimeout(D.get(D.ref(this.db, "temple/presence")), 7000, "presence");
    const out = {};
    for (const [k, v] of Object.entries(s.val() || {})) out[Number(k.slice(1))] = Object.keys(v || {}).length;
    return out;
  }

  // 법당 n에 들어간다 (다른 법당에 있었다면 먼저 나온다)
  async join(n) {
    const D = this.D, db = this.db;
    await this.leaveRoom();
    const id = `r${n}`;
    this._refs = {
      meRef: D.ref(db, `temple/rooms/${id}/players/${this.uid}`),
      presRef: D.ref(db, `temple/presence/${id}/${this.uid}`)
    };
    // 새 규칙이 게시되지 않았으면 여기서 거절된다 → temple.js가 혼자 모드로 넘어간다
    try { await withTimeout(this._arm(), 8000, "join"); } catch (e) { this._refs = null; throw e; }
    this.room = n;
    this.meRef = this._refs.meRef;
    const pref = D.ref(db, `temple/rooms/${id}/players`);
    const put = (s) => {
      if (s.key === this.uid) return;
      this.players.set(s.key, s.val());
      this._emit("players", s.key, s.val());
    };
    this._offs = [
      D.onChildAdded(pref, put),
      D.onChildChanged(pref, put),
      D.onChildRemoved(pref, (s) => { this.players.delete(s.key); this._emit("players", s.key, null); })
    ];
  }

  async _arm() {
    const r = this._refs;
    if (!r) return;
    const D = this.D;
    await D.onDisconnect(r.meRef).remove();
    await D.onDisconnect(r.presRef).remove();
    await D.set(r.presRef, true);
  }

  async leaveRoom() {
    const D = this.D;
    for (const off of this._offs || []) off();
    this._offs = [];
    const r = this._refs;
    this._refs = null;
    this.meRef = null;
    this.room = 0;
    this.players.clear();
    if (!r) return;
    await Promise.all([
      D.onDisconnect(r.meRef).cancel(), D.onDisconnect(r.presRef).cancel(),
      D.remove(r.meRef), D.remove(r.presRef)
    ].map((p) => p.catch(() => {})));
  }

  _watchStats() {
    const D = this.D;
    const day = kstDay(this.now());
    if (day === this._day) return;
    this._statOff?.();
    this._day = day;
    this._statOff = D.onValue(D.ref(this.db, `temple/stats/${day}`), (s) => {
      const v = s.val() || {};
      this.stats = { bows: v.bows || 0, shares: v.shares || 0, offer: v.offer || {} };
      this._emit("stats");
    });
  }

  // 24시간 지난 연등은 지운다 (규칙이 허용하는 범위)
  _sweepLanterns() {
    if (this._swept) return;
    this._swept = true;
    const now = this.now();
    for (const [k, v] of Object.entries(this.lanterns)) {
      if (v && now - v.t >= LANTERN_TTL + 60000) this.D.remove(this.D.ref(this.db, `temple/lanterns/${k}`)).catch(() => {});
    }
  }

  send(me) {
    if (!this.meRef) return Promise.resolve();
    const D = this.D;
    return D.set(this.meRef, { ...me, t: D.serverTimestamp() }).catch((e) => console.warn("[temple] send", e.code || e));
  }

  async hangLantern(slot, color) {
    const D = this.D;
    await D.set(D.ref(this.db, `temple/lanterns/${slot}`), { u: this.uid, c: color, t: D.serverTimestamp() });
  }

  // 오늘의 합계에 1을 더한다 (규칙이 +1만 허용)
  _inc(path) {
    this._watchStats();
    const D = this.D;
    return D.runTransaction(D.ref(this.db, `temple/stats/${this._day}/${path}`), (v) => (v || 0) + 1).catch(() => {});
  }
  addBow() { return this._inc("bows"); }
  addShare() { return this._inc("shares"); }
  addOffer(kind) { return this._inc(`offer/${kind}`); }

  // ---------- 오늘 다녀간 이웃 ----------
  markVisit(n, c) {
    const D = this.D;
    return D.set(D.ref(this.db, `temple/visits/${this.uid}`), { n, c, t: D.serverTimestamp() })
      .catch((e) => console.warn("[temple] visit", e.code || e));
  }
  unmarkVisit() {
    return this.D.remove(this.D.ref(this.db, `temple/visits/${this.uid}`)).catch(() => {});
  }
  async visitors() {
    const D = this.D;
    const q = D.query(D.ref(this.db, "temple/visits"), D.orderByChild("t"), D.startAt(kstDayStart(this.now())));
    const s = await withTimeout(D.get(q), 7000, "visits");
    const out = [];
    s.forEach((ch) => { out.push({ uid: ch.key, ...ch.val() }); }); // 중괄호 필수: 값을 돌려주면 순회가 멈춘다
    return out;
  }
  // 이틀 지난 방문 기록은 지운다 (한 번에 25개씩 — 접속하는 사람들이 조금씩 나눠 치운다)
  async _sweepVisits() {
    try {
      const D = this.D;
      const q = D.query(D.ref(this.db, "temple/visits"), D.orderByChild("t"), D.endAt(this.now() - VISIT_TTL), D.limitToFirst(25));
      const s = await D.get(q);
      s.forEach((ch) => { D.remove(ch.ref).catch(() => {}); });
    } catch (e) { /* 규칙이 아직 게시되지 않았거나 오프라인 — 다음 접속 때 다시 */ }
  }

  leave() {
    const r = this._refs;
    if (!r) return;
    this.D.remove(r.meRef).catch(() => {});
    this.D.remove(r.presRef).catch(() => {});
  }
  // 혼자 모드로 넘어갈 때: 더는 화면에 알리지 않는다
  mute() { this.on = {}; this.leave(); }
}

// ---------- 같은 브라우저의 탭끼리 (개발 확인용) ----------
export class LocalNet extends Base {
  async connect() {
    this.uid = "local" + Math.random().toString(36).slice(2, 10);
    this.visits = new Map();
    this.myVisit = null;
    this.all = new BroadcastChannel("rebroni-temple-local"); // 연등·합계·방문·인원: 모든 법당 공통
    this.all.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === "lantern") { this.lanterns[m.slot] = m.data; this._emit("lanterns"); }
      if (m.type === "stat") { this._apply(m.path); this._emit("stats"); }
      if (m.type === "who") this.all.postMessage({ type: "here", uid: this.uid, room: this.room, visit: this.myVisit });
      if (m.type === "here") { this._here?.set(m.uid, m.room); if (m.visit) this.visits.set(m.uid, m.visit); }
      if (m.type === "visit") { if (m.data) this.visits.set(m.uid, m.data); else this.visits.delete(m.uid); }
    };
    addEventListener("pagehide", () => this.leave());
    return this.uid;
  }
  listen() { this._emit("status", true); }
  _census() {
    this._here = new Map();
    this.all.postMessage({ type: "who" });
    return new Promise((res) => setTimeout(() => { const h = this._here; this._here = null; res(h); }, 180));
  }
  async roomCounts() {
    const h = await this._census();
    const out = {};
    if (this.room) out[this.room] = 1;
    for (const r of h.values()) if (r) out[r] = (out[r] || 0) + 1;
    return out;
  }
  async join(n) {
    await this.leaveRoom();
    this.room = n;
    this.ch = new BroadcastChannel(`rebroni-temple-local-r${n}`);
    this.ch.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === "me" && m.uid !== this.uid) { this.players.set(m.uid, m.data); this._emit("players", m.uid, m.data); }
      if (m.type === "bye") { this.players.delete(m.uid); this._emit("players", m.uid, null); }
      if (m.type === "hello" && this.last) this.ch.postMessage({ type: "me", uid: this.uid, data: this.last });
    };
    this.ch.postMessage({ type: "hello" });
  }
  async leaveRoom() {
    if (this.ch) { this.ch.postMessage({ type: "bye", uid: this.uid }); this.ch.close(); this.ch = null; }
    this.players.clear();
    this.room = 0;
    this.last = null;
  }
  send(me) {
    if (!this.ch) return Promise.resolve();
    this.last = { ...me, t: Date.now() };
    this.ch.postMessage({ type: "me", uid: this.uid, data: this.last });
    return Promise.resolve();
  }
  async hangLantern(slot, color) {
    const cur = this.lanterns[slot];
    if (cur && Date.now() - cur.t < LANTERN_TTL && cur.u !== this.uid) throw new Error("taken");
    const data = { u: this.uid, c: color, t: Date.now() };
    this.lanterns[slot] = data;
    this.all.postMessage({ type: "lantern", slot, data });
    this._emit("lanterns");
  }
  _apply(path) {
    const [a, b] = path.split("/");
    if (a === "offer") this.stats.offer = { ...this.stats.offer, [b]: (this.stats.offer[b] || 0) + 1 };
    else this.stats[a] = (this.stats[a] || 0) + 1;
  }
  _inc(path) {
    this._apply(path);
    this.all.postMessage({ type: "stat", path });
    this._emit("stats");
    return Promise.resolve();
  }
  addBow() { return this._inc("bows"); }
  addShare() { return this._inc("shares"); }
  addOffer(kind) { return this._inc(`offer/${kind}`); }
  markVisit(n, c) {
    this.myVisit = { n, c, t: Date.now() };
    this.all.postMessage({ type: "visit", uid: this.uid, data: this.myVisit });
    return Promise.resolve();
  }
  unmarkVisit() {
    this.myVisit = null;
    this.all.postMessage({ type: "visit", uid: this.uid, data: null });
    return Promise.resolve();
  }
  async visitors() {
    await this._census();
    const out = [...this.visits].map(([uid, v]) => ({ uid, ...v }));
    if (this.myVisit) out.push({ uid: this.uid, ...this.myVisit });
    return out;
  }
  leave() { if (this.ch) this.ch.postMessage({ type: "bye", uid: this.uid }); }
  mute() { this.on = {}; }
}

function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout:${what}`)), ms))]);
}
