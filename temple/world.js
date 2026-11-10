// 온라인 법당 — 지도(충돌)와 그리기
// 월드 좌표(px)는 화면과 무관하게 고정. 카메라 변환은 temple.js가 건다.
// 배치가 바뀌면 lanternSlots()의 개수도 바뀌므로 database.rules.json의 슬롯 범위(0~99)를 넘지 않게 할 것.
// 월드 크기를 바꾸면 database.rules.json의 x·y 범위(rooms/…/players)도 함께 바꾼다.

export const WORLD = { w: 1640, h: 1720 };
export const SPAWN = { x: 700, y: 1480 };

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export function hash(i, s = 0) {
  let h = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((s | 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
function ellipse(g, x, y, rx, ry, rot = 0) {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
  g.fill();
}
function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h);
}

// ---------- 배치 ----------
export const HALL = { x: 360, y: 220, w: 680, h: 480, wall: 18, door: [630, 770] };
export const ALTAR = { x: 540, y: 238, w: 320, h: 104 };
export const BUDDHA = { x: 700, y: 300 };
export const MOKTAK = { x: 470, y: 400 };
export const BELL = { x: 310, y: 900, half: 78 };
export const POND = { x: 1080, y: 960, rx: 125, ry: 82 };
export const PAGODA = { x: 700, y: 1020 };
const PRECINCT = { x: 90, y: 150, w: 1460, h: 1470, t: 14, gate: [640, 760] };
const STONE_LAMPS = [[610, 860], [790, 860], [610, 1300], [790, 1300], [1255, 652], [1375, 652]];
// 공양간 (대웅전 동쪽): 위쪽은 부엌과 배식대, 아래쪽은 낮은 상과 방석
export const REF = { x: 1130, y: 260, w: 370, h: 340, wall: 14, door: [1280, 1350] };
export const COUNTER = { x: REF.x + REF.wall, y: 326, w: REF.w - REF.wall * 2, h: 22 };
const TABLES = [[1230, 425], [1400, 425], [1230, 530], [1400, 530]].map(([x, y]) => ({ x, y, w: 110, h: 26 }));
// 불단 앞 공양상
export const OFFER_TABLE = { x: 600, y: 346, w: 200, h: 20 };
// 장독대
const JARS = [[1424, 690, 15], [1460, 682, 19], [1498, 692, 14], [1442, 722, 13], [1482, 726, 17]];
// 공양간에서 대웅전으로 이어지는 디딤돌
const STEPS = [];
{
  const pts = [[1315, 632], [1302, 742], [1100, 772], [800, 774]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], n = Math.round(Math.hypot(bx - ax, by - ay) / 36);
    for (let k = 0; k < n; k++) STEPS.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
  }
}
export const LANTERN_LINES = [1180, 1300, 1420];
const LINE_X = [260, 1140];

export const CUSHIONS = [];
for (const y of [455, 535, 615]) for (let k = 0; k < 7; k++) CUSHIONS.push({ x: 470 + k * 77, y });
// 앉을 수 있는 자리 전체: 앞쪽은 대웅전 좌복(CUSHIONS와 같은 순서), 뒤쪽은 공양간 방석. d는 앉았을 때 바라보는 방향
export const SEATS = CUSHIONS.map((c) => ({ x: c.x, y: c.y, d: 3, kind: "cushion" }));
for (const tb of TABLES) for (const sx of [-28, 28]) {
  SEATS.push({ x: tb.x + sx, y: tb.y - 34, d: 0, kind: "table" });
  SEATS.push({ x: tb.x + sx, y: tb.y + 30, d: 3, kind: "table" });
}

// 공양간 음식 (번호 0은 '없음' — 규칙의 i 범위 0~4와 맞춤)
export const FOODS = [
  null,
  { ko: "밥", obj: "밥을", en: "rice", emoji: "🍚" },
  { ko: "차", obj: "차를", en: "tea", emoji: "🍵" },
  { ko: "떡", obj: "떡을", en: "rice cake", emoji: "🍡" },
  { ko: "과일", obj: "과일을", en: "fruit", emoji: "🍊" }
];
// 불전 공양물 (id는 규칙 stats/…/offer의 허용 값과 맞춤)
export const OFFERINGS = [
  { id: "rice", ko: "공양미", en: "Rice" },
  { id: "candle", ko: "초", en: "Candle" },
  { id: "incense", ko: "향", en: "Incense" },
  { id: "flower", ko: "꽃", en: "Flowers" }
];

// 연등 자리: 줄마다 40px 간격 (가운데 길 위는 비움)
export function lanternSlots() {
  const out = [];
  LANTERN_LINES.forEach((y) => {
    for (let x = LINE_X[0] + 30; x <= LINE_X[1] - 30; x += 40) {
      if (Math.abs(x - 700) < 30) continue;
      out.push({ x, y });
    }
  });
  return out;
}
export const SLOTS = lanternSlots();

// 충돌: 사각형 [x, y, w, h], 원 [x, y, r]
const RECTS = [];
const CIRCLES = [];
{
  const P = PRECINCT;
  RECTS.push([P.x, P.y, P.w, P.t], [P.x, P.y, P.t, P.h], [P.x + P.w - P.t, P.y, P.t, P.h]);
  RECTS.push([P.x, P.y + P.h - P.t, P.gate[0] - P.x, P.t], [P.gate[1], P.y + P.h - P.t, P.x + P.w - P.gate[1], P.t]);
  const H = HALL;
  RECTS.push([H.x, H.y, H.w, H.wall], [H.x, H.y, H.wall, H.h], [H.x + H.w - H.wall, H.y, H.wall, H.h]);
  RECTS.push([H.x, H.y + H.h - H.wall, H.door[0] - H.x, H.wall], [H.door[1], H.y + H.h - H.wall, H.x + H.w - H.door[1], H.wall]);
  RECTS.push([ALTAR.x, ALTAR.y, ALTAR.w, ALTAR.h]);
  CIRCLES.push([PAGODA.x, PAGODA.y - 8, 36]);
  for (const [x, y] of STONE_LAMPS) RECTS.push([x - 10, y - 10, 20, 16]);
  const B = BELL;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) RECTS.push([B.x + sx * B.half - 7, B.y + sy * B.half - 7, 14, 14]);
  CIRCLES.push([B.x, B.y, 26]);
  CIRCLES.push([MOKTAK.x, MOKTAK.y, 12]);
  for (const x of LINE_X) for (const ly of LANTERN_LINES) CIRCLES.push([x, ly, 7]);
  for (const x of [400, 1000]) CIRCLES.push([x, 790, 7]);
  const R = REF;
  RECTS.push([R.x, R.y, R.w, R.wall], [R.x, R.y, R.wall, R.h], [R.x + R.w - R.wall, R.y, R.wall, R.h]);
  RECTS.push([R.x, R.y + R.h - R.wall, R.door[0] - R.x, R.wall], [R.door[1], R.y + R.h - R.wall, R.x + R.w - R.door[1], R.wall]);
  RECTS.push([COUNTER.x, COUNTER.y, COUNTER.w, COUNTER.h]);
  for (const tb of TABLES) RECTS.push([tb.x - tb.w / 2, tb.y - tb.h / 2, tb.w, tb.h]);
  RECTS.push([OFFER_TABLE.x, OFFER_TABLE.y, OFFER_TABLE.w, OFFER_TABLE.h]);
  for (const [x, y, r] of JARS) CIRCLES.push([x, y, r - 3]);
}
export const TREES = [];
{
  // 담장 밖 숲 + 마당 가장자리
  let k = 0;
  for (let x = 20; x < WORLD.w; x += 62) {
    for (const y of [60, 110]) TREES.push({ x: x + (hash(k, 1) - 0.5) * 30, y: y + (hash(k, 2) - 0.5) * 24, r: 26 + hash(k++, 3) * 14 });
  }
  for (let y = 180; y < 1640; y += 64) {
    for (const x of [40]) TREES.push({ x: x + (hash(k, 1) - 0.5) * 20, y: y + (hash(k, 2) - 0.5) * 30, r: 24 + hash(k++, 3) * 12 });
    for (const x of [WORLD.w - 40]) TREES.push({ x: x + (hash(k, 1) - 0.5) * 20, y: y + (hash(k, 2) - 0.5) * 30, r: 24 + hash(k++, 3) * 12 });
  }
  for (const [x, y] of [[170, 1500], [230, 1560], [1180, 1520], [1240, 1440], [170, 600], [170, 300], [930, 1500], [470, 1520], [1490, 830], [1480, 1120], [1470, 1500], [1340, 1560], [1270, 1250]]) {
    TREES.push({ x, y, r: 30 + hash(k++, 3) * 10, inner: true });
    CIRCLES.push([x, y, 12]);
  }
}

// 원(플레이어 발) 충돌 처리 → 밀어낸 위치
export function collide(x, y, r = 10) {
  x = clamp(x, r, WORLD.w - r);
  y = clamp(y, PRECINCT.y + 20, WORLD.h - r);
  for (const [rx, ry, rw, rh] of RECTS) {
    const cx = clamp(x, rx, rx + rw), cy = clamp(y, ry, ry + rh);
    const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
    if (d2 < r * r) {
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r; y = cy + (dy / d) * r;
      } else { // 중심이 사각형 안: 가장 가까운 변으로
        const l = x - rx, rr = rx + rw - x, t = y - ry, b = ry + rh - y;
        const m = Math.min(l, rr, t, b);
        if (m === l) x = rx - r; else if (m === rr) x = rx + rw + r; else if (m === t) y = ry - r; else y = ry + rh + r;
      }
    }
  }
  for (const [cx, cy, cr] of CIRCLES) {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy), R = cr + r;
    if (d < R) {
      if (d < 1e-6) { y = cy + R; continue; }
      x = cx + (dx / d) * R; y = cy + (dy / d) * R;
    }
  }
  // 연못 (타원)
  const ex = (x - POND.x) / (POND.rx + r), ey = (y - POND.y) / (POND.ry + r), e = Math.hypot(ex, ey);
  if (e < 1) {
    const k = 1 / Math.max(e, 1e-6);
    x = POND.x + (x - POND.x) * k; y = POND.y + (y - POND.y) * k;
  }
  return [x, y];
}

export const inHall = (x, y) => x > HALL.x && x < HALL.x + HALL.w && y > HALL.y && y < HALL.y + HALL.h;
export const inRef = (x, y) => x > REF.x && x < REF.x + REF.w && y > REF.y && y < REF.y + REF.h;
export const inBell = (x, y) => Math.abs(x - BELL.x) < BELL.half + 4 && Math.abs(y - BELL.y) < BELL.half + 4;
export const inCourtyard = (x, y) => y > LANTERN_LINES[0] - 70 && y < LANTERN_LINES[2] + 60 && x > LINE_X[0] - 20 && x < LINE_X[1] + 20;

// ---------- 캐릭터 ----------
export const CHARS = [
  { ko: "스님", en: "Monk", robe: [128, 128, 132], sash: [176, 112, 52], skin: [236, 200, 170], hair: null, s: 1 },
  { ko: "보살", en: "Laywoman", robe: [238, 214, 228], sash: [150, 186, 226], skin: [244, 210, 182], hair: [44, 34, 30], bun: true, s: 0.96 },
  { ko: "동자승", en: "Little monk", robe: [210, 176, 120], sash: [150, 110, 70], skin: [244, 212, 182], hair: null, s: 0.8 },
  { ko: "청년", en: "Youth", robe: [84, 124, 196], sash: [52, 70, 110], skin: [236, 198, 164], hair: [52, 40, 34], s: 1 },
  { ko: "어르신", en: "Elder", robe: [148, 116, 84], sash: [100, 76, 54], skin: [230, 192, 160], hair: [226, 226, 222], s: 0.96 },
  { ko: "아이", en: "Child", robe: [250, 204, 84], sash: [230, 120, 90], skin: [248, 214, 186], hair: [66, 48, 34], s: 0.78 },
  // 아래는 컴퓨터가 움직이는 스님(NPC) 전용 — 입장 화면에서 고를 수 없고, 규칙상 접속자 캐릭터 번호(c)는 0~5만 허용
  { ko: "안내 스님", en: "Guide monk", robe: [146, 146, 152], sash: [184, 84, 48], skin: [234, 198, 168], hair: null, s: 1.04, npc: true },
  { ko: "법사 스님", en: "Dharma teacher", robe: [116, 114, 118], sash: [164, 52, 38], skin: [230, 194, 164], hair: null, s: 1.06, npc: true },
  { ko: "공양주 보살", en: "Temple cook", robe: [238, 228, 210], sash: [112, 150, 120], skin: [242, 206, 178], hair: [52, 42, 38], bun: true, s: 0.98, npc: true }
];
export const PLAYABLE = 6;

// dir: 0 아래 · 1 왼쪽 · 2 오른쪽 · 3 위 / act: idle | walk | hap(합장) | bow(절) | sit
export function drawChar(g, x, y, ci, dir, phase, act, actP) {
  const C = CHARS[ci] || CHARS[0];
  const s = C.s;
  g.save();
  g.translate(x, y);
  g.fillStyle = "rgba(0,0,0,0.22)";
  ellipse(g, 0, 0, 12 * s, 4.5 * s);
  const sit = act === "sit" || (act === "bow" && actP.sit);
  if (sit) {
    g.fillStyle = "#7a2e2e";
    ellipse(g, 0, -2, 16 * s, 7 * s);
    g.fillStyle = "#94403a";
    ellipse(g, 0, -3, 13 * s, 5 * s);
  }
  const bend = act === "bow" ? Math.sin(Math.PI * Math.min(1, actP.p)) : 0;
  g.scale(s, s * (1 - 0.42 * bend));
  const sx = dir === 1 ? -1 : 1;
  const bob = act === "walk" ? Math.abs(Math.sin(phase)) * 1.5 : 0;
  g.translate(0, -bob - (sit ? -8 : 0));

  // 다리
  if (!sit) {
    const sw = act === "walk" ? Math.sin(phase) * 3 : 0;
    g.fillStyle = rgb([60, 56, 54]);
    if (dir === 1 || dir === 2) {
      g.fillRect(-3 + sw * sx, -9, 5, 9);
      g.fillRect(-2 - sw * sx, -9, 5, 9);
    } else {
      g.fillRect(-6, -9 + Math.max(0, sw), 5, 9 - Math.max(0, sw));
      g.fillRect(1, -9 + Math.max(0, -sw), 5, 9 - Math.max(0, -sw));
    }
  }
  // 몸(옷)
  g.fillStyle = rgb(C.robe);
  g.beginPath();
  if (sit) {
    g.ellipse(0, -10, 14, 10, 0, Math.PI, 0);
    g.lineTo(14, -6);
    g.quadraticCurveTo(0, -1, -14, -6);
  } else {
    g.moveTo(-8, -30); g.lineTo(8, -30); g.lineTo(11, -7); g.quadraticCurveTo(0, -4, -11, -7);
  }
  g.closePath();
  g.fill();
  // 가사(띠)
  g.strokeStyle = rgb(C.sash);
  g.lineWidth = 3;
  g.beginPath();
  if (dir === 3) { g.moveTo(-7, -28); g.lineTo(7, -14); }
  else { g.moveTo(7 * sx, -29); g.lineTo(-8 * sx, sit ? -8 : -12); }
  g.stroke();
  // 손
  g.fillStyle = rgb(C.skin);
  if (act === "hap" || act === "bow") {
    if (dir !== 3) { g.beginPath(); g.moveTo(-2, -16); g.lineTo(0, -25); g.lineTo(2, -16); g.closePath(); g.fill(); }
  } else if (sit) {
    ellipse(g, -4, -11, 3, 2); ellipse(g, 4, -11, 3, 2);
  } else {
    const sw = act === "walk" ? Math.sin(phase) * 2.5 : 0;
    if (dir === 1 || dir === 2) ellipse(g, sw * sx, -16, 2.6, 2.6);
    else { ellipse(g, -10, -15 + sw * 0.4, 2.6, 2.6); ellipse(g, 10, -15 - sw * 0.4, 2.6, 2.6); }
  }
  // 머리
  const hy = sit ? -28 : -38;
  const hx = dir === 1 ? -1 : dir === 2 ? 1 : 0;
  g.fillStyle = rgb(C.skin);
  ellipse(g, hx, hy, 9.5, 9.5);
  if (C.hair) {
    g.fillStyle = rgb(C.hair);
    g.beginPath();
    if (dir === 3) g.arc(hx, hy, 9.8, 0, TAU);
    else if (dir === 0) { g.arc(hx, hy, 9.8, Math.PI * 1.02, Math.PI * 1.98); g.quadraticCurveTo(hx, hy - 3, hx - 9.6, hy - 1); }
    else { g.arc(hx, hy, 9.8, Math.PI * (sx > 0 ? 0.9 : 1.1), Math.PI * (sx > 0 ? 1.95 : 0.05) + (sx > 0 ? 0 : TAU), sx < 0); }
    g.fill();
    if (C.bun) { ellipse(g, hx - (dir === 1 ? -6 : dir === 2 ? 6 : 0), hy - 9, 4.5, 4); }
  } else {
    g.fillStyle = "rgba(90,70,60,0.12)"; // 삭발한 머리 그림자
    ellipse(g, hx, hy - 3, 8, 5.5);
  }
  // 얼굴
  if (dir !== 3) {
    g.fillStyle = "rgba(40,30,30,0.85)";
    const closed = act === "hap" || act === "bow" || act === "sit";
    const eye = (ex) => closed ? g.fillRect(ex - 1.6, hy + 1, 3.2, 1) : ellipse(g, ex, hy + 1, 1.2, 1.5);
    if (dir === 0) { eye(hx - 3.4); eye(hx + 3.4); }
    else eye(hx + 4 * sx);
    g.fillStyle = "rgba(240,140,130,0.35)";
    if (dir === 0) { ellipse(g, hx - 5, hy + 4, 2, 1.2); ellipse(g, hx + 5, hy + 4, 2, 1.2); }
  }
  g.restore();
}

// ---------- 지도 그리기 ----------
const LANTERN_COLORS = [[232, 70, 70], [244, 140, 180], [250, 206, 80], [110, 190, 110], [100, 150, 230], [246, 240, 228]];
export const LANTERN_NAMES = [["빨강", "Red"], ["분홍", "Pink"], ["노랑", "Yellow"], ["초록", "Green"], ["파랑", "Blue"], ["하양", "White"]];
export { LANTERN_COLORS };

export function drawGround(g, view, t, night) {
  const { x0, y0, x1, y1 } = view;
  g.fillStyle = night ? "#3d5236" : "#7d9a5c";
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  // 풀 무늬
  g.fillStyle = night ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.06)";
  for (let i = Math.floor(x0 / 40); i <= x1 / 40; i++) {
    for (let j = Math.floor(y0 / 40); j <= y1 / 40; j++) {
      if (hash(i * 131 + j, 9) > 0.35) continue;
      ellipse(g, i * 40 + hash(i, j) * 30, j * 40 + hash(j, i) * 30, 6, 2);
    }
  }
  // 마당 (흙·자갈)
  const P = PRECINCT;
  g.fillStyle = "#d6ccb2";
  g.fillRect(P.x + P.t, P.y + P.t, P.w - P.t * 2, P.h - P.t * 2);
  g.fillStyle = "rgba(120,100,70,0.08)";
  for (let k = 0; k < 500; k++) {
    const x = P.x + hash(k, 21) * P.w, y = P.y + hash(k, 22) * P.h;
    if (x < x0 - 4 || x > x1 + 4 || y < y0 - 4 || y > y1 + 4) continue;
    ellipse(g, x, y, 1.6 + hash(k, 23) * 2, 1.2 + hash(k, 24) * 1.4);
  }
  // 돌길 (일주문 → 대웅전 계단)
  g.fillStyle = "#b9b2a2";
  g.fillRect(650, HALL.y + HALL.h, 100, WORLD.h - HALL.y - HALL.h);
  g.strokeStyle = "rgba(90,80,70,0.25)";
  g.lineWidth = 1.2;
  g.beginPath();
  for (let y = HALL.y + HALL.h + 60; y < WORLD.h; y += 34) {
    g.moveTo(650, y); g.lineTo(750, y);
    const off = (Math.floor(y / 34) % 2) * 25;
    for (let x = 650 + 25 + off; x < 750; x += 50) { g.moveTo(x, y); g.lineTo(x, y + 34); }
  }
  g.stroke();
  // 계단
  for (let k = 0; k < 4; k++) {
    g.fillStyle = k % 2 ? "#a69e8c" : "#bdb5a3";
    g.fillRect(HALL.door[0] - 10, HALL.y + HALL.h + k * 15, HALL.door[1] - HALL.door[0] + 20, 15);
  }
  // 범종각 바닥
  const B = BELL;
  g.fillStyle = "#b0a690";
  g.fillRect(B.x - B.half - 14, B.y - B.half - 14, (B.half + 14) * 2, (B.half + 14) * 2);
  g.fillStyle = "#c4bba6";
  g.fillRect(B.x - B.half - 6, B.y - B.half - 6, (B.half + 6) * 2, (B.half + 6) * 2);
  // 연못
  g.fillStyle = "#8a8070";
  ellipse(g, POND.x, POND.y, POND.rx + 8, POND.ry + 7);
  const wg = g.createRadialGradient(POND.x - 30, POND.y - 20, 10, POND.x, POND.y, POND.rx);
  wg.addColorStop(0, night ? "#3a6670" : "#6fb3b8");
  wg.addColorStop(1, night ? "#1d3c48" : "#3f7f8c");
  g.fillStyle = wg;
  ellipse(g, POND.x, POND.y, POND.rx, POND.ry);
  // 잉어
  for (let k = 0; k < 4; k++) {
    const a = t * (0.25 + k * 0.05) * (k % 2 ? 1 : -1) + k * 1.7;
    const fx = POND.x + Math.cos(a) * POND.rx * (0.35 + k * 0.12), fy = POND.y + Math.sin(a) * POND.ry * (0.35 + k * 0.12);
    g.fillStyle = k % 2 ? "rgba(255,150,60,0.9)" : "rgba(250,245,235,0.9)";
    ellipse(g, fx, fy, 7, 3, a + (k % 2 ? Math.PI / 2 : -Math.PI / 2));
  }
  // 연잎·연꽃
  for (let k = 0; k < 9; k++) {
    const a = hash(k, 31) * TAU, rr = Math.sqrt(hash(k, 32)) * 0.8;
    const lx = POND.x + Math.cos(a) * POND.rx * rr, ly = POND.y + Math.sin(a) * POND.ry * rr;
    g.fillStyle = "#4f8c4a";
    g.beginPath();
    g.arc(lx, ly, 11 + hash(k, 33) * 6, 0.3, TAU - 0.1);
    g.lineTo(lx, ly);
    g.fill();
    if (hash(k, 34) < 0.5) {
      g.fillStyle = "#f2a6c0";
      for (let p = 0; p < 5; p++) ellipse(g, lx + Math.cos(p * 1.26) * 4, ly - 2 + Math.sin(p * 1.26) * 3, 4, 2.6, p * 1.26);
      g.fillStyle = "#ffe08a";
      ellipse(g, lx, ly - 2, 2, 2);
    }
  }
  // 디딤돌 (공양간 → 대웅전)
  STEPS.forEach(([sx, sy], i) => {
    g.fillStyle = i % 2 ? "#b3ac9c" : "#bdb6a6";
    ellipse(g, sx + (hash(i, 61) - 0.5) * 6, sy + (hash(i, 62) - 0.5) * 6, 13 + hash(i, 63) * 4, 8 + hash(i, 64) * 3, hash(i, 65) - 0.5);
  });
  // 장독대 바닥
  g.fillStyle = "#b0a690";
  rrect(g, 1400, 664, 122, 82, 8); g.fill();
  g.fillStyle = "#c2b9a4";
  rrect(g, 1405, 668, 112, 72, 6); g.fill();
  // 공양간 바닥 (부엌은 조금 어둡게)
  const R = REF;
  g.fillStyle = "#cfa970";
  g.fillRect(R.x, R.y, R.w, R.h);
  g.fillStyle = "#b08c5a";
  g.fillRect(R.x, R.y, R.w, COUNTER.y - R.y);
  g.strokeStyle = "rgba(90,56,26,0.28)";
  g.lineWidth = 1;
  g.beginPath();
  for (let y = COUNTER.y + COUNTER.h + 22; y < R.y + R.h; y += 22) { g.moveTo(R.x, y); g.lineTo(R.x + R.w, y); }
  g.stroke();
  for (const st of SEATS) {
    if (st.kind !== "table") continue;
    g.fillStyle = "#4d5a6e";
    rrect(g, st.x - 15, st.y - 10, 30, 22, 6); g.fill();
    g.fillStyle = "#62708a";
    rrect(g, st.x - 11, st.y - 7, 22, 16, 5); g.fill();
  }
  // 대웅전 바닥 (마루)
  const H = HALL;
  g.fillStyle = "#b8874f";
  g.fillRect(H.x, H.y, H.w, H.h);
  g.strokeStyle = "rgba(90,56,26,0.35)";
  g.lineWidth = 1;
  g.beginPath();
  for (let x = H.x + 24; x < H.x + H.w; x += 24) { g.moveTo(x, H.y); g.lineTo(x, H.y + H.h); }
  g.stroke();
  // 좌복
  for (const c of CUSHIONS) {
    g.fillStyle = "#7a2e2e";
    rrect(g, c.x - 17, c.y - 12, 34, 24, 6); g.fill();
    g.fillStyle = "#94403a";
    rrect(g, c.x - 13, c.y - 9, 26, 18, 5); g.fill();
  }
}

// 높이가 있는 물체: 발 위치(y) 순서로 캐릭터와 섞어 그린다
export function staticSprites(view) {
  const out = [];
  const vis = (x, y, m = 120) => x > view.x0 - m && x < view.x1 + m && y > view.y0 - m && y < view.y1 + m * 2;
  for (const tr of TREES) if (vis(tr.x, tr.y)) out.push({ y: tr.y, draw: (g, t, n) => drawTree(g, tr, t, n) });
  if (vis(PAGODA.x, PAGODA.y)) out.push({ y: PAGODA.y + 10, draw: (g) => drawPagoda(g) });
  for (const [x, y] of STONE_LAMPS) if (vis(x, y)) out.push({ y: y + 6, draw: (g, t, n) => drawStoneLamp(g, x, y, t, n) });
  if (vis(BUDDHA.x, BUDDHA.y, 300)) {
    out.push({ y: ALTAR.y + ALTAR.h, draw: (g, t, n) => drawAltar(g, t, n) });
    out.push({ y: OFFER_TABLE.y + OFFER_TABLE.h, draw: (g, t, n, st) => drawOfferTable(g, t, n, st) });
  }
  if (vis(REF.x + REF.w / 2, REF.y + REF.h / 2, 420)) {
    out.push({ y: REF.y + 10, draw: (g) => drawRefWallBack(g) });
    out.push({ y: REF.y + 44, draw: (g, t) => drawKitchen(g, t) });
    out.push({ y: COUNTER.y + COUNTER.h, draw: (g) => drawCounter(g) });
    for (const tb of TABLES) out.push({ y: tb.y + tb.h / 2, draw: (g) => drawTable(g, tb) });
    out.push({ y: REF.y + REF.h, draw: (g) => drawRefWallFront(g) });
  }
  for (const j of JARS) if (vis(j[0], j[1])) out.push({ y: j[1] + 4, draw: (g) => drawJar(g, j) });
  if (vis(MOKTAK.x, MOKTAK.y)) out.push({ y: MOKTAK.y + 6, draw: (g) => drawMoktak(g) });
  if (vis(BELL.x, BELL.y, 200)) out.push({ y: BELL.y + 30, draw: (g, t, n, st) => drawBell(g, t, st) });
  // 담장 (아래쪽 담은 앞에 오도록)
  out.push({ y: PRECINCT.y + PRECINCT.h, draw: (g) => drawWallFront(g) });
  out.push({ y: HALL.y + HALL.h, draw: (g) => drawHallWallFront(g) });
  out.push({ y: HALL.y + 10, draw: (g) => drawHallWallBack(g) });
  for (const x of [400, 1000]) if (vis(x, DECO_Y)) out.push({ y: DECO_Y, draw: (g) => { g.fillStyle = "#5a3d24"; g.fillRect(x - 4, DECO_Y - 54, 8, 56); } });
  for (const x of LINE_X) for (const y of LANTERN_LINES) if (vis(x, y)) out.push({ y: y + 4, draw: (g) => { g.fillStyle = "#5a3d24"; g.fillRect(x - 4, y - 60, 8, 64); } });
  return out;
}

function drawTree(g, tr, t, night) {
  const { x, y, r } = tr;
  const sway = Math.sin(t * 0.6 + x * 0.01) * 1.5;
  g.fillStyle = "rgba(0,0,0,0.2)";
  ellipse(g, x + 6, y + 2, r * 0.9, r * 0.35);
  g.fillStyle = "#5b4030";
  g.fillRect(x - 4, y - r * 0.6, 8, r * 0.6);
  const c1 = night ? [34, 66, 42] : [54, 104, 62], c2 = night ? [44, 82, 52] : [72, 128, 74];
  g.fillStyle = rgb(c1);
  ellipse(g, x + sway, y - r * 0.95, r, r * 0.8);
  g.fillStyle = rgb(c2);
  ellipse(g, x - r * 0.25 + sway, y - r * 1.15, r * 0.6, r * 0.48);
  ellipse(g, x + r * 0.3 + sway, y - r * 1.05, r * 0.5, r * 0.4);
}

function drawPagoda(g) {
  const { x, y } = PAGODA;
  g.fillStyle = "rgba(0,0,0,0.2)";
  ellipse(g, x + 8, y + 8, 46, 12);
  const stone = ["#a7a399", "#bab6ac", "#8f8b82"];
  g.fillStyle = stone[2];
  g.fillRect(x - 40, y - 14, 80, 22);
  g.fillStyle = stone[1];
  g.fillRect(x - 36, y - 30, 72, 18);
  let yy = y - 30;
  for (let k = 0; k < 3; k++) {
    const bw = 30 - k * 7, bh = 20 - k * 3, rw = 46 - k * 9;
    g.fillStyle = stone[0];
    g.fillRect(x - bw, yy - bh, bw * 2, bh);
    yy -= bh;
    g.fillStyle = stone[2];
    g.beginPath();
    g.moveTo(x - rw, yy); g.lineTo(x + rw, yy); g.lineTo(x + rw - 6, yy - 7); g.lineTo(x - rw + 6, yy - 7);
    g.closePath(); g.fill();
    yy -= 7;
  }
  g.fillStyle = stone[2];
  g.fillRect(x - 3, yy - 26, 6, 26);
  ellipse(g, x, yy - 14, 6, 3);
  ellipse(g, x, yy - 22, 5, 2.5);
}

function drawStoneLamp(g, x, y, t, night) {
  g.fillStyle = "rgba(0,0,0,0.2)";
  ellipse(g, x + 4, y + 4, 14, 5);
  g.fillStyle = "#9c978c";
  g.fillRect(x - 12, y - 6, 24, 10);
  g.fillRect(x - 4, y - 26, 8, 20);
  g.fillStyle = "#b0aba0";
  g.fillRect(x - 10, y - 42, 20, 16);
  g.fillStyle = night ? "#ffd48a" : "#5c574e";
  g.fillRect(x - 5, y - 38, 10, 8);
  g.fillStyle = "#88837a";
  g.beginPath();
  g.moveTo(x - 16, y - 42); g.lineTo(x + 16, y - 42); g.lineTo(x + 6, y - 52); g.lineTo(x - 6, y - 52);
  g.closePath(); g.fill();
  ellipse(g, x, y - 54, 3, 3);
}

function drawMoktak(g) {
  const { x, y } = MOKTAK;
  g.fillStyle = "#7a2e2e";
  rrect(g, x - 14, y - 4, 28, 12, 3); g.fill();
  g.fillStyle = "#a0662e";
  ellipse(g, x, y - 6, 11, 9);
  g.fillStyle = "#5a3416";
  g.fillRect(x - 8, y - 6, 16, 2);
}

function drawAltar(g, t, night) {
  const A = ALTAR;
  // 불단
  g.fillStyle = "#7a2a22";
  g.fillRect(A.x, A.y + 20, A.w, A.h - 20);
  g.fillStyle = "#c79a3a";
  g.fillRect(A.x, A.y + 20, A.w, 5);
  g.fillRect(A.x, A.y + A.h - 6, A.w, 6);
  g.fillStyle = "rgba(255,210,120,0.3)";
  for (let k = 0; k < 6; k++) g.fillRect(A.x + 16 + k * 52, A.y + 38, 36, 40);
  // 광배
  const { x, y } = BUDDHA;
  const halo = g.createRadialGradient(x, y - 30, 4, x, y - 30, 70);
  halo.addColorStop(0, "rgba(255,230,150,0.9)");
  halo.addColorStop(0.55, "rgba(240,190,90,0.45)");
  halo.addColorStop(1, "rgba(240,190,90,0)");
  g.fillStyle = halo;
  ellipse(g, x, y - 30, 70, 70);
  g.strokeStyle = "rgba(210,160,60,0.9)";
  g.lineWidth = 3;
  g.beginPath(); g.arc(x, y - 44, 26, 0, TAU); g.stroke();
  // 연꽃 대좌
  for (let p = 0; p < 7; p++) {
    g.fillStyle = p % 2 ? "#e9a3b6" : "#f2c0cc";
    ellipse(g, x - 36 + p * 12, y + 10, 9, 7);
  }
  // 좌상 (단순한 실루엣)
  const gold = g.createLinearGradient(x - 30, 0, x + 30, 0);
  gold.addColorStop(0, "#b8862c");
  gold.addColorStop(0.45, "#f0c860");
  gold.addColorStop(1, "#a87824");
  g.fillStyle = gold;
  ellipse(g, x, y + 2, 34, 12);              // 무릎
  g.beginPath();                              // 몸
  g.moveTo(x - 22, y + 2); g.quadraticCurveTo(x - 24, y - 26, x - 10, y - 30);
  g.lineTo(x + 10, y - 30); g.quadraticCurveTo(x + 24, y - 26, x + 22, y + 2);
  g.closePath(); g.fill();
  ellipse(g, x, y - 42, 12, 13);              // 머리
  ellipse(g, x, y - 55, 6, 5);                // 육계
  g.fillStyle = "rgba(120,80,20,0.5)";
  ellipse(g, x, y - 6, 9, 4);                 // 선정인
  // 촛대·향로
  for (const cx of [A.x + 40, A.x + A.w - 40]) {
    g.fillStyle = "#d8c8a8";
    g.fillRect(cx - 4, A.y + 6, 8, 22);
    const f = 0.85 + 0.15 * Math.sin(t * 9 + cx);
    g.fillStyle = `rgba(255,${200 * f | 0},90,0.95)`;
    ellipse(g, cx, A.y + 2, 3, 6 * f);
    if (night) { g.fillStyle = "rgba(255,190,90,0.18)"; ellipse(g, cx, A.y, 30, 30); }
  }
  g.fillStyle = "#6d5a3c";
  ellipse(g, x, A.y + A.h - 12, 14, 6);
  g.strokeStyle = "rgba(220,220,220,0.35)";
  g.lineWidth = 1.5;
  g.beginPath();
  for (let k = 0; k < 3; k++) {
    const bx = x - 4 + k * 4;
    g.moveTo(bx, A.y + A.h - 16);
    for (let s = 1; s < 8; s++) g.lineTo(bx + Math.sin(t * 1.5 + s * 0.8 + k) * 3, A.y + A.h - 16 - s * 6);
  }
  g.stroke();
}

// 불단 앞 공양상: 오늘 모두가 올린 공양이 쌓여 보인다 (st.offer = { rice, candle, incense, flower })
function drawOfferTable(g, t, night, st) {
  const T = OFFER_TABLE;
  g.fillStyle = "rgba(0,0,0,0.18)";
  g.fillRect(T.x + 4, T.y + T.h + 2, T.w, 5);
  g.fillStyle = "#6a2019";
  g.fillRect(T.x, T.y + 10, T.w, T.h - 4);          // 앞면
  g.fillStyle = "#8a2c22";
  g.fillRect(T.x, T.y - 4, T.w, 16);                 // 윗면
  g.fillStyle = "#c79a3a";
  g.fillRect(T.x, T.y + 10, T.w, 2);
  const o = (st && st.offer) || {};
  OFFERINGS.forEach((of, z) => {
    const n = Math.min(3, o[of.id] | 0);
    for (let i = 0; i < n; i++) drawOffering(g, of.id, T.x + 13 + z * 49 + i * 14, T.y + 8, 1.1, t + i);
  });
  // 누군가 공양을 올리면 잠시 금빛이 피어오른다
  const age = st && st.offerAt ? t - st.offerAt : 99;
  if (age >= 0 && age < 2.6) {
    for (let k = 0; k < 12; k++) {
      const p = Math.min(1, age / 2.6 + hash(k, 91) * 0.25);
      const x = T.x + 10 + hash(k, 92) * (T.w - 20) + Math.sin(age * 3 + k) * 4;
      const y = T.y - 4 - p * 46;
      g.fillStyle = `rgba(255,226,140,${0.9 * (1 - p)})`;
      ellipse(g, x, y, 2.2, 2.2);
    }
  }
}

// 공양물 하나 (공양상과 버튼에서 함께 쓴다) — (x, y)는 바닥 가운데
export function drawOffering(g, kind, x, y, k = 1, t = 0) {
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  if (kind === "rice") {
    g.fillStyle = "#fbf7ea";
    g.beginPath(); g.ellipse(0, -5, 5.6, 5, 0, Math.PI, 0); g.fill();
    g.fillStyle = "#b8923e";
    g.beginPath(); g.moveTo(-6.5, -5); g.lineTo(6.5, -5); g.lineTo(4, 0); g.lineTo(-4, 0); g.closePath(); g.fill();
  } else if (kind === "candle") {
    g.fillStyle = "#b8923e";
    g.fillRect(-4, -2, 8, 2);
    g.fillStyle = "#f4ead2";
    g.fillRect(-2, -12, 4, 10);
    const f = 0.85 + 0.15 * Math.sin(t * 9);
    g.fillStyle = `rgba(255,${190 * f | 0},80,0.95)`;
    ellipse(g, 0, -15, 2, 3.6 * f);
  } else if (kind === "flower") {
    g.fillStyle = "#5d7f9a";
    g.beginPath(); g.moveTo(-3, 0); g.lineTo(3, 0); g.lineTo(4.5, -6); g.lineTo(-4.5, -6); g.closePath(); g.fill();
    g.strokeStyle = "#4f8c4a";
    g.lineWidth = 1.3;
    g.beginPath(); g.moveTo(0, -6); g.lineTo(0, -11); g.stroke();
    for (let p = 0; p < 5; p++) {
      g.fillStyle = p % 2 ? "#f2a6c0" : "#f8ccd8";
      ellipse(g, Math.cos(p * 1.257) * 3.2, -13 + Math.sin(p * 1.257) * 3.2, 2.7, 2.7);
    }
    g.fillStyle = "#ffe08a";
    ellipse(g, 0, -13, 1.7, 1.7);
  } else { // incense
    g.fillStyle = "#7a6542";
    g.beginPath(); g.ellipse(0, -2.5, 6, 3, 0, 0, TAU); g.fill();
    g.strokeStyle = "#8a5a3a";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-1.5, -3); g.lineTo(-2.5, -13);
    g.moveTo(1.5, -3); g.lineTo(2.5, -13);
    g.stroke();
    g.fillStyle = "#ff7a4a";
    ellipse(g, -2.5, -13.5, 1, 1); ellipse(g, 2.5, -13.5, 1, 1);
    g.strokeStyle = "rgba(225,225,225,0.45)";
    g.beginPath();
    g.moveTo(0, -14);
    for (let q = 1; q < 6; q++) g.lineTo(Math.sin(t * 1.6 + q * 0.9) * 2.4, -14 - q * 3);
    g.stroke();
  }
  g.restore();
}

// 음식 (그림 글자) — 배식대 위, 손에 든 음식, 건네는 음식
export function drawFood(g, kind, x, y, size = 14) {
  const f = FOODS[kind];
  if (!f) return;
  g.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#000";
  g.fillText(f.emoji, x, y);
}

// ---------- 공양간 ----------
function drawRefWallBack(g) {
  const R = REF;
  g.fillStyle = "#e6dcc4";
  g.fillRect(R.x, R.y - 26, R.w, 26 + R.wall);
  g.fillStyle = "#6b4a2e";
  for (let x = R.x; x <= R.x + R.w; x += 74) g.fillRect(Math.min(x, R.x + R.w - 8), R.y - 26, 8, 26 + R.wall);
  // 선반과 그릇
  g.fillStyle = "#8a6238";
  g.fillRect(R.x + 150, R.y - 8, 150, 4);
  for (let k = 0; k < 8; k++) {
    g.fillStyle = k % 3 ? "#c9b48a" : "#b8923e";
    g.beginPath(); g.ellipse(R.x + 162 + k * 18, R.y - 9, 6, 4, 0, 0, Math.PI); g.fill();
  }
  g.fillStyle = "#e6dcc4";
  g.fillRect(R.x, R.y, R.wall, R.h);
  g.fillRect(R.x + R.w - R.wall, R.y, R.wall, R.h);
}

function drawKitchen(g, t) {
  const R = REF;
  const steam = (x, y, n) => {
    g.strokeStyle = "rgba(245,245,245,0.5)";
    g.lineWidth = 2;
    g.beginPath();
    for (let k = 0; k < n; k++) {
      const bx = x - (n - 1) * 4 + k * 8;
      g.moveTo(bx, y);
      for (let s = 1; s < 7; s++) g.lineTo(bx + Math.sin(t * 1.8 + s * 0.9 + k * 2) * 3.5, y - s * 6);
    }
    g.stroke();
  };
  // 아궁이와 가마솥
  const kx = R.x + 62, ky = R.y + 44;
  g.fillStyle = "#9a8468";
  rrect(g, kx - 30, ky - 20, 60, 24, 5); g.fill();
  g.fillStyle = "#3a2a22";
  rrect(g, kx - 9, ky - 6, 18, 10, 3); g.fill();
  g.fillStyle = `rgba(255,${140 + 40 * Math.sin(t * 7) | 0},60,0.9)`;
  ellipse(g, kx, ky, 5, 3);
  g.fillStyle = "#2c2c30";
  ellipse(g, kx, ky - 22, 24, 9);
  g.fillStyle = "#3d3d42";
  ellipse(g, kx, ky - 25, 18, 6);
  g.fillStyle = "#1e1e22";
  ellipse(g, kx, ky - 28, 4, 2.5);
  steam(kx, ky - 30, 3);
  // 찻주전자
  const tx = R.x + R.w - 60, ty = R.y + 44;
  g.fillStyle = "#8f8a80";
  rrect(g, tx - 16, ty - 8, 32, 12, 4); g.fill();
  g.fillStyle = "#5d4a3a";
  ellipse(g, tx, ty - 14, 12, 9);
  g.fillRect(tx + 10, ty - 17, 9, 3);
  g.strokeStyle = "#5d4a3a";
  g.lineWidth = 2;
  g.beginPath(); g.arc(tx, ty - 21, 7, Math.PI, 0); g.stroke();
  steam(tx + 20, ty - 18, 1);
}

const FOOD_SPOTS = [0.2, 0.4, 0.6, 0.8];
function drawCounter(g) {
  const C = COUNTER;
  g.fillStyle = "#6f4e2c";
  g.fillRect(C.x, C.y + C.h - 6, C.w, 12);   // 앞면
  g.fillStyle = "#946a3c";
  g.fillRect(C.x, C.y - 6, C.w, C.h);         // 윗면
  g.fillStyle = "#a97d48";
  g.fillRect(C.x, C.y - 6, C.w, 3);
  FOOD_SPOTS.forEach((u, i) => {
    const x = C.x + C.w * u;
    g.fillStyle = "#5a3d24";
    rrect(g, x - 26, C.y - 3, 52, 15, 4); g.fill();
    for (let k = -1; k <= 1; k++) drawFood(g, i + 1, x + k * 15, C.y + 3, 13);
  });
}

function drawTable(g, tb) {
  g.fillStyle = "rgba(0,0,0,0.2)";
  rrect(g, tb.x - tb.w / 2 + 4, tb.y - tb.h / 2 + 8, tb.w, tb.h, 5); g.fill();
  g.fillStyle = "#6f4e2c";
  rrect(g, tb.x - tb.w / 2, tb.y - tb.h / 2 + 4, tb.w, tb.h, 5); g.fill();
  g.fillStyle = "#a97d48";
  rrect(g, tb.x - tb.w / 2, tb.y - tb.h / 2 - 4, tb.w, tb.h, 5); g.fill();
  g.strokeStyle = "rgba(90,56,26,0.3)";
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(tb.x - tb.w / 2 + 6, tb.y - 4); g.lineTo(tb.x + tb.w / 2 - 6, tb.y - 4); g.stroke();
}

function drawRefWallFront(g) {
  const R = REF;
  const y = R.y + R.h - R.wall;
  const seg = (x0, x1) => {
    g.fillStyle = "#e6dcc4";
    g.fillRect(x0, y - 22, x1 - x0, 22 + R.wall);
    g.strokeStyle = "rgba(107,74,46,0.6)";
    g.lineWidth = 1;
    g.beginPath();
    for (let x = x0 + 12; x < x1 - 4; x += 12) { g.moveTo(x, y - 18); g.lineTo(x, y + R.wall - 3); }
    g.moveTo(x0 + 8, y - 6); g.lineTo(x1 - 8, y - 6);
    g.stroke();
  };
  seg(R.x, R.door[0]);
  seg(R.door[1], R.x + R.w);
  g.fillStyle = "#6b4a2e";
  for (const x of [R.x, R.door[0] - 8, R.door[1], R.x + R.w - 8]) g.fillRect(x, y - 22, 8, 22 + R.wall);
}

function drawJar(g, [x, y, r]) {
  g.fillStyle = "rgba(0,0,0,0.2)";
  ellipse(g, x + 4, y + 2, r, r * 0.4);
  const jg = g.createLinearGradient(x - r, 0, x + r, 0);
  jg.addColorStop(0, "#4a2f20"); jg.addColorStop(0.4, "#7a5238"); jg.addColorStop(1, "#3c2619");
  g.fillStyle = jg;
  ellipse(g, x, y - r * 0.9, r, r * 1.05);
  g.fillStyle = "#33211a";
  ellipse(g, x, y - r * 1.85, r * 0.72, r * 0.3);
  g.fillStyle = "#4a2f20";
  ellipse(g, x, y - r * 2.0, r * 0.25, r * 0.14);
}

function drawBell(g, t, st) {
  const B = BELL;
  // 기둥
  g.fillStyle = "#8e2f24";
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.fillRect(B.x + sx * B.half - 6, B.y + sy * B.half - 40, 12, 46);
  // 종 (흔들림)
  const age = st && st.bellAt ? t - st.bellAt : 99;
  const swing = age < 3 ? Math.sin(age * 9) * Math.exp(-age * 1.4) * 0.12 : 0;
  g.save();
  g.translate(B.x, B.y - 66);
  g.rotate(swing);
  g.strokeStyle = "#4a3a2a";
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, -10); g.lineTo(0, 6); g.stroke();
  const bg = g.createLinearGradient(-26, 0, 26, 0);
  bg.addColorStop(0, "#3e5a52"); bg.addColorStop(0.45, "#6f8f7f"); bg.addColorStop(1, "#33483f");
  g.fillStyle = bg;
  g.beginPath();
  g.moveTo(-14, 6); g.quadraticCurveTo(-24, 20, -26, 58); g.lineTo(26, 58); g.quadraticCurveTo(24, 20, 14, 6);
  g.closePath(); g.fill();
  g.fillStyle = "rgba(255,255,255,0.15)";
  g.fillRect(-20, 26, 40, 3);
  g.fillRect(-23, 46, 46, 3);
  g.restore();
  if (age < 4) { // 울림 고리
    g.strokeStyle = `rgba(255,240,200,${0.5 * (1 - age / 4)})`;
    g.lineWidth = 2;
    for (let k = 0; k < 2; k++) {
      const rr = 30 + (age * 120 + k * 60) % 240;
      g.beginPath(); g.arc(B.x, B.y - 36, rr, 0, TAU); g.stroke();
    }
  }
}

function drawWallFront(g) {
  const P = PRECINCT;
  const wall = (x, y, w) => {
    g.fillStyle = "#c9bea6";
    g.fillRect(x, y - 16, w, 16 + P.t);
    g.fillStyle = "#4a4f58";
    g.fillRect(x - 3, y - 22, w + 6, 8);
  };
  wall(P.x, P.y + P.h - P.t, P.gate[0] - P.x);
  wall(P.gate[1], P.y + P.h - P.t, P.x + P.w - P.gate[1]);
  // 일주문
  const gy = P.y + P.h;
  g.fillStyle = "#8e2f24";
  g.fillRect(P.gate[0] - 6, gy - 70, 12, 72);
  g.fillRect(P.gate[1] - 6, gy - 70, 12, 72);
  g.fillStyle = "#3f4650";
  g.beginPath();
  g.moveTo(P.gate[0] - 40, gy - 66); g.quadraticCurveTo(700, gy - 76, P.gate[1] + 40, gy - 66);
  g.lineTo(P.gate[1] + 26, gy - 88); g.lineTo(P.gate[0] - 26, gy - 88);
  g.closePath(); g.fill();
  g.fillStyle = "#2d6b52";
  g.fillRect(P.gate[0] - 20, gy - 68, P.gate[1] - P.gate[0] + 40, 5);
  g.fillStyle = "#23262c";
  g.fillRect(670, gy - 64, 60, 14);
  g.fillStyle = "#e8c66a";
  g.font = "bold 10px serif";
  g.textAlign = "center";
  g.fillText("一柱門", 700, gy - 53);
}

function drawHallWallBack(g) {
  const H = HALL;
  g.fillStyle = "#e8dcc0";
  g.fillRect(H.x, H.y - 30, H.w, 30 + H.wall);
  g.fillStyle = "#8e2f24";
  for (let x = H.x; x <= H.x + H.w; x += 85) g.fillRect(Math.min(x, H.x + H.w - 10), H.y - 30, 10, 30 + H.wall);
  g.fillStyle = "#e8dcc0";
  g.fillRect(H.x, H.y, H.wall, H.h);
  g.fillRect(H.x + H.w - H.wall, H.y, H.wall, H.h);
}

function drawHallWallFront(g) {
  const H = HALL;
  const y = H.y + H.h - H.wall;
  const seg = (x0, x1) => {
    g.fillStyle = "#e8dcc0";
    g.fillRect(x0, y - 24, x1 - x0, 24 + H.wall);
    // 꽃살문
    g.strokeStyle = "rgba(142,47,36,0.7)";
    g.lineWidth = 1;
    g.beginPath();
    for (let x = x0 + 12; x < x1 - 4; x += 10) { g.moveTo(x, y - 20); g.lineTo(x, y + H.wall - 3); }
    g.stroke();
  };
  seg(H.x, H.door[0]);
  seg(H.door[1], H.x + H.w);
  g.fillStyle = "#8e2f24";
  for (const x of [H.x, H.door[0] - 10, H.door[1], H.x + H.w - 10]) g.fillRect(x, y - 24, 10, 24 + H.wall);
}

// 지붕: 안에 들어가면 흐려진다 (fade 0..1)
export function drawRoofs(g, fadeHall, fadeBell, fadeRef = 1, t = 0) {
  const H = HALL;
  if (fadeHall > 0.02) {
    g.globalAlpha = fadeHall;
    const x0 = H.x - 30, y0 = H.y - 70, w = H.w + 60, h = H.h + 62;
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(x0 + 10, y0 + 16, w, h);
    const rg = g.createLinearGradient(0, y0, 0, y0 + h);
    rg.addColorStop(0, "#4e5662"); rg.addColorStop(0.5, "#3f4651"); rg.addColorStop(1, "#5a626e");
    g.fillStyle = rg;
    g.beginPath();
    g.moveTo(x0 - 18, y0 + h); g.quadraticCurveTo(x0 + w / 2, y0 + h - 22, x0 + w + 18, y0 + h);
    g.lineTo(x0 + w, y0 + 10); g.quadraticCurveTo(x0 + w / 2, y0 + 24, x0, y0 + 10);
    g.closePath(); g.fill();
    // 기와 줄
    g.strokeStyle = "rgba(20,24,30,0.35)";
    g.lineWidth = 2;
    g.beginPath();
    for (let x = x0 + 14; x < x0 + w; x += 16) { g.moveTo(x, y0 + 18); g.lineTo(x + (x - (x0 + w / 2)) * 0.04, y0 + h - 14); }
    g.stroke();
    // 용마루
    g.fillStyle = "#2f343c";
    g.fillRect(x0 + 60, y0 + h * 0.42, w - 120, 14);
    // 단청 처마
    g.fillStyle = "#2d6b52";
    g.fillRect(x0 - 6, y0 + h - 12, w + 12, 8);
    g.fillStyle = "#c0473a";
    for (let x = x0; x < x0 + w; x += 22) g.fillRect(x, y0 + h - 12, 8, 8);
    // 현판
    g.fillStyle = "#23262c";
    rrect(g, 700 - 50, y0 + h - 40, 100, 24, 3); g.fill();
    g.fillStyle = "#e8c66a";
    g.font = "bold 15px serif";
    g.textAlign = "center";
    g.fillText("大雄殿", 700, y0 + h - 22);
    g.globalAlpha = 1;
  }
  if (fadeBell > 0.02) {
    const B = BELL, r = B.half + 22;
    g.globalAlpha = fadeBell;
    g.fillStyle = "#454c57";
    g.beginPath();
    g.moveTo(B.x - r - 8, B.y + r - 30); g.quadraticCurveTo(B.x, B.y + r - 44, B.x + r + 8, B.y + r - 30);
    g.lineTo(B.x + r - 6, B.y - r - 50); g.quadraticCurveTo(B.x, B.y - r - 40, B.x - r + 6, B.y - r - 50);
    g.closePath(); g.fill();
    g.fillStyle = "#2d6b52";
    g.fillRect(B.x - r, B.y + r - 40, r * 2, 6);
    g.fillStyle = "#23262c";
    rrect(g, B.x - 30, B.y + r - 62, 60, 18, 3); g.fill();
    g.fillStyle = "#e8c66a";
    g.font = "bold 11px serif";
    g.textAlign = "center";
    g.fillText("梵鐘閣", B.x, B.y + r - 49);
    g.globalAlpha = 1;
  }
  if (fadeRef > 0.02) {
    const R = REF;
    g.globalAlpha = fadeRef;
    const x0 = R.x - 22, y0 = R.y - 58, w = R.w + 44, h = R.h + 50;
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(x0 + 8, y0 + 14, w, h);
    const rg = g.createLinearGradient(0, y0, 0, y0 + h);
    rg.addColorStop(0, "#565c63"); rg.addColorStop(0.5, "#474d55"); rg.addColorStop(1, "#626870");
    g.fillStyle = rg;
    g.beginPath();
    g.moveTo(x0 - 14, y0 + h); g.quadraticCurveTo(x0 + w / 2, y0 + h - 16, x0 + w + 14, y0 + h);
    g.lineTo(x0 + w, y0 + 8); g.quadraticCurveTo(x0 + w / 2, y0 + 18, x0, y0 + 8);
    g.closePath(); g.fill();
    g.strokeStyle = "rgba(20,24,30,0.32)";
    g.lineWidth = 2;
    g.beginPath();
    for (let x = x0 + 12; x < x0 + w; x += 16) { g.moveTo(x, y0 + 14); g.lineTo(x + (x - (x0 + w / 2)) * 0.04, y0 + h - 12); }
    g.stroke();
    g.fillStyle = "#33383f";
    g.fillRect(x0 + 44, y0 + h * 0.42, w - 88, 12);
    g.fillStyle = "#6b4a2e";
    g.fillRect(x0 - 4, y0 + h - 10, w + 8, 7);
    // 굴뚝과 밥 짓는 연기
    const cx = x0 + 70, cy = y0 + 40;
    g.fillStyle = "#8a8378";
    g.fillRect(cx - 9, cy - 16, 18, 22);
    g.fillStyle = "#5f5a52";
    g.fillRect(cx - 11, cy - 20, 22, 6);
    for (let k = 0; k < 5; k++) {
      const p = (t * 0.22 + k / 5) % 1;
      g.fillStyle = `rgba(240,240,240,${0.42 * (1 - p)})`;
      ellipse(g, cx + Math.sin(p * 5 + k) * 8 + p * 16, cy - 22 - p * 60, 6 + p * 10, 5 + p * 8);
    }
    const sx = (R.door[0] + R.door[1]) / 2;
    g.fillStyle = "#23262c";
    rrect(g, sx - 38, y0 + h - 36, 76, 20, 3); g.fill();
    g.fillStyle = "#e8c66a";
    g.font = "bold 13px serif";
    g.textAlign = "center";
    g.fillText("供養間", sx, y0 + h - 21);
    g.globalAlpha = 1;
  }
}

// 연등 줄 (머리 위) — lanterns: slot → { c }
// 대웅전 앞 장식 연등 (누구나 보는 고정 장식 — 자리 저장 없음)
const DECO_Y = 790;
const DECO = [];
for (let x = 420; x <= 980; x += 34) if (Math.abs(x - 700) > 40) DECO.push({ x, c: Math.floor(hash(x, 77) * 6) });

export function drawLanternLines(g, t, lanterns, night) {
  g.strokeStyle = "#4b3a2a";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(400, DECO_Y - 50);
  g.quadraticCurveTo(700, DECO_Y - 36, 1000, DECO_Y - 50);
  g.stroke();
  for (const d of DECO) {
    const u = (d.x - 400) / 600;
    drawLotusLantern(g, d.x + Math.sin(t * 1.1 + d.x) * 1, DECO_Y - 50 + 28 * u * (1 - u) + 18, LANTERN_COLORS[d.c], night, false, t, 1.1);
  }
  for (const y of LANTERN_LINES) {
    g.strokeStyle = "#4b3a2a";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(LINE_X[0], y - 58);
    g.quadraticCurveTo(700, y - 40, LINE_X[1], y - 58);
    g.stroke();
  }
  SLOTS.forEach((s, i) => {
    const L = lanterns[i];
    if (!L) return;
    const u = (s.x - LINE_X[0]) / (LINE_X[1] - LINE_X[0]);
    const sy = s.y - 58 + 4 * 18 * u * (1 - u) * 0.5 + 9; // 줄 처짐 근사
    drawLotusLantern(g, s.x + Math.sin(t * 1.3 + i) * 1.2, sy + 9, LANTERN_COLORS[L.c] || LANTERN_COLORS[0], night, L.mine, t);
  });
}

export function drawLotusLantern(g, x, y, c, night, mine, t, k = 1.35) {
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  g.translate(-x, -y);
  if (night) {
    g.fillStyle = rgb(c, 0.22);
    ellipse(g, x, y, 22, 22);
  }
  g.strokeStyle = "rgba(80,60,40,0.8)";
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(x, y - 18); g.lineTo(x, y - 10); g.stroke();
  g.fillStyle = rgb(c);
  ellipse(g, x, y, 10, 9);
  g.fillStyle = rgb([Math.min(255, c[0] + 30), Math.min(255, c[1] + 30), Math.min(255, c[2] + 30)]);
  for (let p = -2; p <= 2; p++) ellipse(g, x + p * 4, y - 4 + Math.abs(p), 2.6, 4.2, p * 0.35);
  g.strokeStyle = rgb(c, 0.9);
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(x - 2, y + 8); g.lineTo(x - 3, y + 18);
  g.moveTo(x + 2, y + 8); g.lineTo(x + 3, y + 18);
  g.stroke();
  if (mine) {
    g.strokeStyle = `rgba(255,236,170,${0.6 + 0.3 * Math.sin(t * 3)})`;
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(x, y, 13, 0, TAU); g.stroke();
  }
  g.restore();
}

// 밤: 어둡게 덮은 뒤 불빛을 밝힌다
export function drawNight(g, view, t, lanterns) {
  const { x0, y0, x1, y1 } = view;
  g.fillStyle = "rgba(12,16,42,0.52)";
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.globalCompositeOperation = "lighter";
  const light = (x, y, r, c, a) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgb(c, a));
    gr.addColorStop(1, rgb(c, 0));
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (const [x, y] of STONE_LAMPS) light(x, y - 34, 90, [255, 190, 110], 0.28);
  for (const d of DECO) light(d.x, DECO_Y - 30, 30, LANTERN_COLORS[d.c], 0.25);
  light(BUDDHA.x, BUDDHA.y - 20, 220, [255, 200, 120], 0.3);
  light(REF.x + REF.w / 2, REF.y + 70, 200, [255, 196, 120], 0.26);
  light(REF.x + REF.w / 2, REF.y + REF.h - 60, 190, [255, 210, 150], 0.16);
  SLOTS.forEach((s, i) => {
    const L = lanterns[i];
    if (L) light(s.x, s.y - 30, 40, LANTERN_COLORS[L.c] || LANTERN_COLORS[0], 0.32 + 0.05 * Math.sin(t * 2 + i));
  });
  g.globalCompositeOperation = "source-over";
}
