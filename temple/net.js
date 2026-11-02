// 온라인 법당 — 접속자 동기화
// - FirebaseNet: Firebase Realtime Database + 익명 로그인 (운영)
//     /temple/players/{uid}   접속 중인 사람 (창을 닫으면 onDisconnect로 자동 삭제)
//     /temple/lanterns/{slot} 연등 (24시간 유지, 지난 것은 누구나 지우거나 덮어쓸 수 있음)
//     /temple/stats/{YYYY-MM-DD}/bows  오늘 모두가 올린 절 수
//   규칙: 저장소 루트의 database.rules.json (Firebase Console에서 직접 게시)
// - LocalNet: 같은 브라우저의 여러 탭끼리 BroadcastChannel로 동기화 (개발 확인용, 주소에 ?net=local)
// - 어느 쪽이든 연결에 실패하면 temple.js가 '혼자 모드'로 동작한다.
//
// 플레이어 데이터 (짧은 키로 전송량 절약)
//   n 닉네임 번호 · c 캐릭터 · x,y 위치 · d 방향 · a 동작 · s 인사말 번호 · sn 인사 횟수 · e 효과음 · en 효과음 횟수 · t 서버 시각
import { firebaseConfig } from "../firebase-config.js";

const VER = "10.12.2";
// Realtime Database 주소: Firebase Console → Realtime Database 화면 맨 위에 표시되는 주소
// (만들 때 고른 위치가 싱가포르가 아니면 이 주소를 바꿔 주세요)
export const DATABASE_URL = firebaseConfig.databaseURL || "https://rebroni-music-web-default-rtdb.asia-southeast1.firebasedatabase.app";
export const LANTERN_TTL = 24 * 3600 * 1000;
const STALE = 90 * 1000; // 이보다 오래 소식이 없는 접속자는 숨김 (비정상 종료 대비)

export function kstDay(ms) {
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

class Base {
  constructor() {
    this.uid = null;
    this.players = new Map(); // uid → data (나 제외)
    this.lanterns = {};       // slot → { u, c, t }
    this.bows = 0;
    this.offset = 0;          // 서버 시각 - 내 시각
    this.on = { players: null, lanterns: null, bows: null, status: null };
  }
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
    D.onValue(D.ref(db, ".info/connected"), (s) => this._emit("status", s.val() === true));
    this.meRef = D.ref(db, `temple/players/${this.uid}`);
    await D.onDisconnect(this.meRef).remove();
    return this.uid;
  }

  listen() {
    const D = this.D, db = this.db;
    const pref = D.ref(db, "temple/players");
    const put = (s) => {
      if (s.key === this.uid) return;
      this.players.set(s.key, s.val());
      this._emit("players", s.key, s.val());
    };
    D.onChildAdded(pref, put);
    D.onChildChanged(pref, put);
    D.onChildRemoved(pref, (s) => { this.players.delete(s.key); this._emit("players", s.key, null); });
    D.onValue(D.ref(db, "temple/lanterns"), (s) => {
      this.lanterns = s.val() || {};
      this._emit("lanterns");
      this._sweepLanterns();
    });
    this._watchBows();
  }

  _watchBows() {
    const D = this.D;
    const day = kstDay(this.now());
    if (day === this._day) return;
    this._bowOff?.();
    this._day = day;
    this._bowOff = D.onValue(D.ref(this.db, `temple/stats/${day}/bows`), (s) => { this.bows = s.val() || 0; this._emit("bows", this.bows); });
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
    const D = this.D;
    return D.set(this.meRef, { ...me, t: D.serverTimestamp() }).catch((e) => console.warn("[temple] send", e.code || e));
  }

  async hangLantern(slot, color) {
    const D = this.D;
    await D.set(D.ref(this.db, `temple/lanterns/${slot}`), { u: this.uid, c: color, t: D.serverTimestamp() });
  }

  addBow() {
    this._watchBows();
    const D = this.D;
    return D.runTransaction(D.ref(this.db, `temple/stats/${this._day}/bows`), (v) => (v || 0) + 1).catch(() => {});
  }

  leave() { if (this.meRef) this.D.remove(this.meRef).catch(() => {}); }
}

// ---------- 같은 브라우저의 탭끼리 (개발 확인용) ----------
export class LocalNet extends Base {
  async connect() {
    this.uid = "local-" + Math.random().toString(36).slice(2, 10);
    this.ch = new BroadcastChannel("rebroni-temple-local");
    this.ch.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === "me" && m.uid !== this.uid) { this.players.set(m.uid, m.data); this._emit("players", m.uid, m.data); }
      if (m.type === "bye") { this.players.delete(m.uid); this._emit("players", m.uid, null); }
      if (m.type === "lantern") { this.lanterns[m.slot] = m.data; this._emit("lanterns"); }
      if (m.type === "bow") { this.bows++; this._emit("bows", this.bows); }
      if (m.type === "hello" && this.last) this.ch.postMessage({ type: "me", uid: this.uid, data: this.last });
    };
    addEventListener("pagehide", () => this.leave());
    return this.uid;
  }
  listen() { this.ch.postMessage({ type: "hello" }); this._emit("status", true); }
  send(me) {
    this.last = { ...me, t: Date.now() };
    this.ch.postMessage({ type: "me", uid: this.uid, data: this.last });
    return Promise.resolve();
  }
  async hangLantern(slot, color) {
    const cur = this.lanterns[slot];
    if (cur && Date.now() - cur.t < LANTERN_TTL && cur.u !== this.uid) throw new Error("taken");
    const data = { u: this.uid, c: color, t: Date.now() };
    this.lanterns[slot] = data;
    this.ch.postMessage({ type: "lantern", slot, data });
    this._emit("lanterns");
  }
  addBow() { this.bows++; this.ch.postMessage({ type: "bow" }); this._emit("bows", this.bows); return Promise.resolve(); }
  leave() { this.ch?.postMessage({ type: "bye", uid: this.uid }); }
}

function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout:${what}`)), ms))]);
}
