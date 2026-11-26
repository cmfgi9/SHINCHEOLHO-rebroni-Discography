// 마음 처방전 (Wisdom Cards) — 오늘의 카드 · 고민별 처방 · AI 마음 문답 · 마음 기록
// 소리는 Meditate의 합성 엔진(싱잉볼·틴샤·목탁)을 재사용한다 — 파일·외부 요청 없음.
import { Engine } from "../meditate/audio-engine.js?v=3";
import { CHAPTERS, CARDS, CARD_BY_ID, CHAPTER_BY_NO, MOODS, MOOD_CHAPTERS, TOTAL_VERSES } from "./verses.js?v=1";

const $ = (id) => document.getElementById(id);
const MOOD_BY_ID = new Map(MOODS.map((m) => [m.id, m]));
const K = { settings: "rebroni-wisdom-settings", today: "rebroni-wisdom-today", journal: "rebroni-wisdom-journal" };
const JOURNAL_MAX = 365;

// ---------- 저장소 (실패해도 동작) ----------
function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 불가 — 무시 */ } }

const settings = Object.assign({ sound: true, consent: false }, load(K.settings, {}));
const saveSettings = () => save(K.settings, settings);

// ---------- 날짜 (KST) ----------
function kstDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function prettyDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = "일월화수목금토"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}년 ${m}월 ${d}일 (${wd})`;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------- 소리 ----------
const engine = new Engine();
let soundStarted = false;
function unlockSound() {
  if (!settings.sound || soundStarted) return;
  try {
    engine.ensure();
    engine.setMasterVolume(0.8);
    engine.play();
    soundStarted = true;
  } catch (e) { console.warn("[wisdom] sound", e); }
}
function ring(type, vol = 0.7, delay = 0.02) {
  if (!settings.sound) return;
  unlockSound();
  if (soundStarted && engine.ctx) engine.bell(type, engine.now + delay, 1, vol);
}
function syncSoundBtn() {
  $("sound-btn").textContent = settings.sound ? "🔔" : "🔕";
  $("sound-btn").setAttribute("aria-pressed", String(settings.sound));
}
$("sound-btn").addEventListener("click", () => {
  settings.sound = !settings.sound;
  saveSettings();
  syncSoundBtn();
  if (settings.sound) ring("chime", 0.5);
  else if (soundStarted) engine.pause();
  if (settings.sound && soundStarted) engine.play();
});

// ---------- 알림 ----------
let toastT = 0;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove("show"), 2600);
}

// ---------- 카드 그리기 ----------
function chapterLabel(ch) {
  const c = CHAPTER_BY_NO.get(ch);
  return `제${c.no}품 ${c.ko}`;
}
function cardFace(card) {
  const c = CHAPTER_BY_NO.get(card.ch);
  return `
    <div class="wc-top"><span class="wc-ch">${esc(chapterLabel(card.ch))}</span><span class="wc-no">${esc(card.n)}게송</span></div>
    <p class="wc-text">${esc(card.t)}</p>
    <div class="wc-foot"><span>${esc(c.sub)}</span><span class="wc-seal" aria-hidden="true">法句</span></div>`;
}
function cardDetail(card, source) {
  const tags = card.m.map((id) => MOOD_BY_ID.get(id)).filter(Boolean)
    .map((m) => `<span class="tag">${m.icon} ${esc(m.ko)}</span>`).join("");
  return `
    <div class="detail">
      <div class="d-block"><h4>마음 풀이 <span class="en-sub">Reflection</span></h4><p>${esc(card.e)}</p></div>
      <div class="d-block practice"><h4>오늘의 작은 실천 <span class="en-sub">Today's practice</span></h4><p>${esc(card.a)}</p></div>
      <div class="tags">${tags}</div>
      <div class="actions">
        <button class="btn primary" data-act="write" data-id="${card.id}" data-src="${source}">✍️ 마음 기록 남기기 <span class="en-sub">Write</span></button>
        <button class="btn ghost" data-act="share" data-id="${card.id}">🔗 나누기 <span class="en-sub">Share</span></button>
      </div>
    </div>`;
}
function cardBlock(card, source, { flip = false } = {}) {
  return `
    <div class="result">
      <div class="flip ${flip ? "" : "open"}"><div class="flip-in">
        <div class="wcard back" aria-hidden="true"><span class="back-mark">心</span></div>
        <article class="wcard front">${cardFace(card)}</article>
      </div></div>
      ${cardDetail(card, source)}
    </div>`;
}

// 결과 영역의 버튼(기록·나누기)
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  if (b.dataset.act === "write") openWrite({ cardId: b.dataset.id, source: b.dataset.src });
  else if (b.dataset.act === "share") shareCard(b.dataset.id);
});

async function shareCard(id) {
  const card = CARD_BY_ID.get(id);
  const url = `${location.origin}${location.pathname}#card=${encodeURIComponent(id)}`;
  const text = `「${card.t}」 — 《법구경》 ${chapterLabel(card.ch)} ${card.n}게송 · 마음 처방전`;
  try {
    if (navigator.share) { await navigator.share({ title: "마음 처방전", text, url }); return; }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast("링크를 복사했어요 · Link copied");
  } catch (e) {
    if (e && e.name === "AbortError") return;
    prompt("아래 주소를 복사해 나누세요", url);
  }
}

// ---------- 오늘의 카드 ----------
function todayState() {
  const s = load(K.today, null);
  return s && s.date === kstDate() && CARD_BY_ID.has(s.id) ? s : null;
}
function renderToday() {
  $("today-date").textContent = prettyDate(kstDate());
  const st = todayState();
  const deck = $("deck");
  if (st) {
    deck.innerHTML = "";
    deck.hidden = true;
    $("deck-hint").hidden = true;
    $("today-result").innerHTML = `<p class="drawn-note">오늘 뽑은 카드예요. 내일 새 카드를 뽑을 수 있어요. <span class="en-sub">Your card for today — come back tomorrow.</span></p>` +
      cardBlock(CARD_BY_ID.get(st.id), "today");
    return;
  }
  deck.hidden = false;
  $("deck-hint").hidden = false;
  $("today-result").innerHTML = "";
  deck.innerHTML = Array.from({ length: 5 }, (_, i) =>
    `<button class="deck-card" style="--i:${i - 2}" aria-label="${i + 1}번째 카드 고르기"><span class="back-mark">心</span></button>`).join("");
  deck.querySelectorAll(".deck-card").forEach((b) => b.addEventListener("click", () => drawToday(b), { once: true }));
}
function drawToday(btn) {
  if (todayState()) return;
  ring("moktak", 0.45);
  const prev = load(K.today, null);
  const pool = CARDS.filter((c) => !prev || c.id !== prev.id);
  const card = pick(pool);
  save(K.today, { date: kstDate(), id: card.id });
  const deck = $("deck");
  deck.classList.add("chosen");
  btn.classList.add("picked");
  setTimeout(() => {
    deck.hidden = true;
    $("deck-hint").hidden = true;
    deck.classList.remove("chosen");
    $("today-result").innerHTML = cardBlock(card, "today", { flip: true });
    const f = $("today-result").querySelector(".flip");
    requestAnimationFrame(() => requestAnimationFrame(() => f.classList.add("open")));
    ring("bowl", 0.75, 0.25);
    setTimeout(() => ring("chime", 0.35), 1300);
  }, 650);
}

// ---------- 공유 링크로 열기 (#card=ID) ----------
function renderShared(id) {
  const card = CARD_BY_ID.get(id);
  if (!card) return false;
  $("today-date").textContent = "나눔 받은 카드 · Shared card";
  $("deck").hidden = true;
  $("deck-hint").hidden = true;
  $("today-result").innerHTML = cardBlock(card, "shared") +
    `<p class="center"><a class="btn" href="#today">🎴 나의 오늘 카드 뽑으러 가기 <span class="en-sub">Draw my own</span></a></p>`;
  return true;
}

// ---------- 고민별 처방 ----------
let moodShown = { mood: null, seen: new Set() };
function renderMoodGrid() {
  $("mood-grid").innerHTML = MOODS.map((m) =>
    `<button class="mood" data-mood="${m.id}"><span class="mi">${m.icon}</span><b>${esc(m.ko)}</b><span class="en-sub">${esc(m.en)}</span><small>${esc(m.hint)}</small></button>`).join("");
  $("mood-grid").querySelectorAll(".mood").forEach((b) => b.addEventListener("click", () => prescribe(b.dataset.mood, true)));
}
function poolFor(mood) {
  const order = MOOD_CHAPTERS[mood] || [];
  const rank = (c) => { const i = order.indexOf(c.ch); return i < 0 ? 99 : i; };
  return CARDS.filter((c) => c.m.includes(mood) || order[0] === c.ch).sort((a, b) => rank(a) - rank(b));
}
function prescribe(mood, fresh) {
  ring(fresh ? "bowl" : "chime", fresh ? 0.6 : 0.4);
  if (fresh || moodShown.mood !== mood) moodShown = { mood, seen: new Set() };
  const pool = poolFor(mood);
  const main = MOOD_CHAPTERS[mood][0];
  // 처음엔 대표 품(예: 분노 → 제17품)에서, 다시 누르면 나머지 품까지 넓혀서
  let cand = pool.filter((c) => !moodShown.seen.has(c.id) && (moodShown.seen.size > 0 || c.ch === main));
  if (!cand.length) cand = pool.filter((c) => !moodShown.seen.has(c.id));
  if (!cand.length) { moodShown.seen.clear(); cand = pool; }
  const card = pick(cand);
  moodShown.seen.add(card.id);
  const m = MOOD_BY_ID.get(mood);
  const c = CHAPTER_BY_NO.get(card.ch);
  $("mood-grid").querySelectorAll(".mood").forEach((b) => b.classList.toggle("on", b.dataset.mood === mood));
  $("mood-result").innerHTML = `
    <div class="rx-head">
      <p class="eyebrow">${m.icon} ${esc(m.ko)}의 마음에 · For ${esc(m.en.toLowerCase())}</p>
      <h3>제${c.no}품 ${esc(c.ko)} <span class="muted">— ${esc(c.sub)} · ${esc(c.pali)} · ${c.range[0]}~${c.range[1]}게송</span></h3>
    </div>
    ${cardBlock(card, "mood:" + mood, { flip: true })}
    <p class="center"><button class="btn" id="mood-more">🔄 다른 구절 보기 <span class="en-sub">Another verse</span></button></p>`;
  const f = $("mood-result").querySelector(".flip");
  requestAnimationFrame(() => requestAnimationFrame(() => f.classList.add("open")));
  $("mood-more").addEventListener("click", () => prescribe(mood, false));
  if (fresh) $("mood-result").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- AI 마음 문답 ----------
let aiReady = null; // null=확인 중, true/false
let askMood = null;
const CRISIS = /죽고\s*싶|자살|극단적\s*선택|사라지고\s*싶|자해|살기\s*싫|목숨을\s*끊|suicid|kill myself/i;
const KEYWORDS = {
  anger: /화가|화나|분노|짜증|열받|억울|미워|미운|싸웠|다퉜|욕을|빡치|성질/,
  anxiety: /불안|걱정|초조|두려|무서|긴장|시험|면접|잠이\s*안|미래|떨려|막막/,
  desire: /갖고\s*싶|욕심|돈|집착|사고\s*싶|중독|끊고\s*싶|탐|더\s*많이|소유/,
  loss: /잃|이별|헤어|돌아가|세상을\s*떠|떠나|그리워|보고\s*싶|슬프|슬퍼|상실|반려|장례/,
  self: /자책|못난|부족|실수|자존감|한심|나\s*때문|실패|쓸모|미워져|싫어져/,
  lethargy: /무기력|귀찮|의욕|지쳤|지쳐|피곤|번아웃|하기\s*싫|게으|우울|기운/,
  envy: /비교|부럽|부러워|질투|남들은|뒤처|인스타|sns|잘나가/i,
  relation: /친구|가족|동료|팀장|상사|부모|엄마|아빠|연인|남편|아내|남자친구|여자친구|관계|사람들|서운|외로/
};
const LOCAL_EMPATHY = {
  relation: "사람 사이의 일은 가까울수록 더 깊이 남지요. 그 마음이 서운하고 지치는 것은 그만큼 관계를 소중히 여겨 왔기 때문일 거예요.",
  anger: "화가 가라앉지 않는 건 당신이 이상해서가 아니라, 무언가 소중한 것이 다쳤다는 마음의 신호예요. 그 불길을 먼저 알아봐 주는 것부터 시작해 봐요.",
  anxiety: "걱정이 꼬리를 물 때는 마음이 아직 오지 않은 내일에 먼저 가 있곤 해요. 지금 여기로 천천히 데려와도 괜찮아요.",
  desire: "더 갖고 싶은 마음은 누구에게나 있어요. 그 마음이 나를 끌고 다니는 것 같다면, 잠시 멈춰서 그 마음이 진짜 원하는 것을 들여다볼 때예요.",
  loss: "잃는다는 것은 그만큼 사랑했다는 뜻이기도 해요. 슬픔은 서둘러 끝내야 할 숙제가 아니라, 천천히 지나가는 계절이에요.",
  self: "스스로를 몰아세우는 목소리가 크게 들리는 날이네요. 친한 친구에게 하듯, 나에게도 조금 더 다정해져도 괜찮아요.",
  lethargy: "아무것도 하기 싫은 날은 마음이 쉬어 가자고 보내는 신호일 수 있어요. 큰 걸음 대신 아주 작은 한 걸음이면 충분해요.",
  envy: "남과 나를 견주게 되는 건 자연스러운 마음이에요. 다만 그 저울 위에서 잠시 내려와, 나만의 속도를 떠올려 봐요."
};
const LOCAL_VIEW = "모든 일은 여러 원인과 조건이 모여 생기고, 조건이 바뀌면 달라진다는 것이 연기(緣起)의 지혜예요. 지금의 마음도 영원히 머물지 않아요. 생각과 감정을 밀어내지도 붙잡지도 말고, ‘지금 이런 마음이 일어나는구나’ 하고 한 걸음 떨어져 바라보세요. 그리고 스스로에게 물어보세요 — ‘이 상황에서 내가 바꿀 수 있는 아주 작은 조건 하나는 무엇일까?’";

function renderAskMoods() {
  $("ask-moods").innerHTML = MOODS.map((m) => `<button type="button" class="chip" data-mood="${m.id}">${m.icon} ${esc(m.ko)}</button>`).join("");
  $("ask-moods").querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    askMood = askMood === b.dataset.mood ? null : b.dataset.mood;
    $("ask-moods").querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x.dataset.mood === askMood));
  }));
}
async function checkAi() {
  try {
    const r = await fetch("/api/counsel", { headers: { Accept: "application/json" } });
    aiReady = r.ok && (await r.json()).ai === true;
  } catch { aiReady = false; }
  syncConsent();
}
function syncConsent() {
  const label = $("ask-consent").closest(".consent");
  label.hidden = aiReady === false;
  $("ask-consent").checked = settings.consent;
  if (aiReady === false && !$("ask-offline")) {
    label.insertAdjacentHTML("afterend", `<p id="ask-offline" class="small muted">지금은 AI 연결 전이라, 적은 글의 낱말로 어울리는 구절을 골라 드려요. 글은 이 기기 밖으로 나가지 않아요.
      <span class="en-sub">AI is not connected yet — a verse is matched from your words on this device.</span></p>`);
  }
}
$("ask-consent").addEventListener("change", () => { settings.consent = $("ask-consent").checked; saveSettings(); });
$("ask-text").addEventListener("input", () => { $("ask-count").textContent = `${$("ask-text").value.length} / 600`; });

function guessMood(text) {
  let best = null, score = 0;
  for (const [id, re] of Object.entries(KEYWORDS)) {
    const n = (text.match(new RegExp(re.source, "g" + re.flags.replace("g", ""))) || []).length;
    if (n > score) { score = n; best = id; }
  }
  return best;
}
function localCounsel(text, mood) {
  const m = mood || guessMood(text) || pick(MOODS).id;
  const pool = poolFor(m);
  const card = pick(pool.slice(0, Math.min(pool.length, 8)));
  return { empathy: LOCAL_EMPATHY[m], insight: LOCAL_VIEW, practice: card.a, cardIds: [card.id], mood: m, crisis: CRISIS.test(text), ai: false };
}
const CRISIS_BOX = `
  <div class="crisis" role="alert">
    <b>지금 많이 힘드시다면, 혼자 견디지 마세요.</b>
    <p>24시간 언제든 이야기를 들어 주는 곳이 있어요. <span class="en-sub">Help is available 24/7.</span></p>
    <p><a href="tel:109">📞 자살예방상담 109</a> · <a href="tel:15770199">📞 정신건강위기상담 1577-0199</a> · 긴급 <a href="tel:112">112</a>·<a href="tel:119">119</a></p>
  </div>`;

$("ask-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const text = $("ask-text").value.trim();
  if (text.length < 4) { toast("조금만 더 적어 주세요 · Please write a little more"); return; }
  if (aiReady && !settings.consent) { toast("전송 안내를 확인하고 체크해 주세요 · Please check the notice"); $("ask-consent").focus(); return; }
  ring("moktak", 0.4);
  const btn = $("ask-send");
  btn.disabled = true;
  $("ask-result").innerHTML = `<div class="loading"><span class="dot"></span><span class="dot"></span><span class="dot"></span> 마음을 살피는 중… <span class="en-sub">Listening…</span></div>`;
  let out = null, note = "";
  if (aiReady) {
    try {
      const r = await fetch("/api/counsel", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, mood: askMood })
      });
      if (r.ok) out = await r.json();
      else {
        const e = await r.json().catch(() => ({}));
        note = e.error === "rate_limited" ? "잠시 많은 질문이 이어져, 이번에는 낱말로 구절을 골랐어요. 10분 뒤 다시 AI에게 물을 수 있어요."
          : "AI 연결이 잠시 원활하지 않아, 이번에는 낱말로 구절을 골랐어요.";
      }
    } catch { note = "네트워크가 불안정해, 이번에는 낱말로 구절을 골랐어요."; }
  }
  if (!out || !out.cardIds?.length) out = { ...localCounsel(text, askMood), ...(out && out.empathy ? { empathy: out.empathy, insight: out.insight, practice: out.practice, crisis: out.crisis } : {}) };
  if (CRISIS.test(text)) out.crisis = true;
  btn.disabled = false;
  renderCounsel(out, text, note);
});

function renderCounsel(out, text, note) {
  const cards = out.cardIds.map((id) => CARD_BY_ID.get(id)).filter(Boolean);
  const m = MOOD_BY_ID.get(out.mood);
  $("ask-result").innerHTML = `
    <div class="rx">
      <div class="rx-paper">
        <p class="eyebrow">마음 처방전 · ${esc(prettyDate(kstDate()))}${m ? ` · ${m.icon} ${esc(m.ko)}` : ""}</p>
        ${out.crisis ? CRISIS_BOX : ""}
        <div class="d-block"><h4>공감 <span class="en-sub">Empathy</span></h4><p>${esc(out.empathy)}</p></div>
        <div class="d-block"><h4>마음 바라보기 <span class="en-sub">A mindful view</span></h4><p>${esc(out.insight)}</p></div>
        <div class="d-block practice"><h4>오늘의 처방 <span class="en-sub">Today's practice</span></h4><p>${esc(out.practice)}</p></div>
        ${note ? `<p class="small muted">${esc(note)}</p>` : ""}
        ${out.ai ? `<p class="small muted">AI(Claude)가 쓴 답이에요. 구절은 이 사이트가 직접 풀어 쓴 카드에서 골랐어요.</p>` : ""}
      </div>
      <h4 class="center">함께 건네는 구절 <span class="en-sub">Verse for you</span></h4>
      ${cards.map((c) => cardBlock(c, "ask", { flip: true })).join("")}
      <p class="center"><button class="btn" id="ask-save">✍️ 이 문답을 마음 기록에 남기기 <span class="en-sub">Save to journal</span></button></p>
    </div>`;
  $("ask-result").querySelectorAll(".flip").forEach((f) => requestAnimationFrame(() => requestAnimationFrame(() => f.classList.add("open"))));
  ring("bowl", 0.6, 0.2);
  $("ask-save").addEventListener("click", () => openWrite({ cardId: cards[0]?.id, source: "ask", mood: out.mood, question: text, answer: out }));
  $("ask-result").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- 마음 기록 ----------
let journal = load(K.journal, []);
if (!Array.isArray(journal)) journal = [];
let draft = null;
let draftMood = null;

function renderJournalMoods() {
  $("j-moods").innerHTML = MOODS.map((m) => `<button type="button" class="chip" data-mood="${m.id}">${m.icon} ${esc(m.ko)}</button>`).join("");
  $("j-moods").querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    draftMood = draftMood === b.dataset.mood ? null : b.dataset.mood;
    $("j-moods").querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x.dataset.mood === draftMood));
  }));
  $("j-filter").innerHTML = `<option value="">전체 마음 · All</option>` + MOODS.map((m) => `<option value="${m.id}">${m.icon} ${esc(m.ko)}</option>`).join("");
}
function openWrite({ cardId = null, source = "free", mood = null, question = null, answer = null } = {}) {
  const st = todayState();
  if (!cardId && st) cardId = st.id;
  if (!mood && source.startsWith("mood:")) mood = source.slice(5);
  draft = { cardId, source: source.split(":")[0], question, answer: answer ? { empathy: answer.empathy, insight: answer.insight, practice: answer.practice } : null };
  draftMood = mood;
  const card = cardId && CARD_BY_ID.get(cardId);
  $("j-card-preview").innerHTML = card
    ? `<blockquote>${esc(card.t)}<cite>${esc(chapterLabel(card.ch))} ${esc(card.n)}게송</cite></blockquote>${question ? `<p class="small muted">나의 고민: ${esc(question)}</p>` : ""}`
    : `<p class="small muted">카드 없이 자유롭게 적는 기록이에요.</p>`;
  ["j-note", "j-g1", "j-g2", "j-g3"].forEach((id) => { $(id).value = ""; });
  $("j-done").checked = false;
  $("j-moods").querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x.dataset.mood === draftMood));
  const dlg = $("j-dialog");
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
}
$("j-form").addEventListener("submit", (ev) => {
  const submitter = ev.submitter;
  if (!submitter || submitter.value !== "save") return;
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: kstDate(), at: Date.now(), ...draft, mood: draftMood,
    note: $("j-note").value.trim(),
    gratitude: ["j-g1", "j-g2", "j-g3"].map((id) => $(id).value.trim()).filter(Boolean),
    done: $("j-done").checked
  };
  if (!entry.note && !entry.gratitude.length && !entry.cardId) { ev.preventDefault(); toast("한 줄이라도 적어 주세요 · Write at least one line"); return; }
  journal.unshift(entry);
  if (journal.length > JOURNAL_MAX) journal.length = JOURNAL_MAX;
  save(K.journal, journal);
  ring("chime", 0.45);
  toast("마음 기록을 남겼어요 · Saved");
  renderJournal();
});
$("j-new").addEventListener("click", () => openWrite({ source: "free" }));
$("j-filter").addEventListener("change", renderJournal);

function streak() {
  const days = new Set(journal.map((e) => e.date));
  let n = 0;
  const d = new Date();
  if (!days.has(kstDate(d))) d.setTime(d.getTime() - 86400000); // 오늘 아직 안 썼으면 어제부터
  while (days.has(kstDate(d))) { n++; d.setTime(d.getTime() - 86400000); }
  return n;
}
function renderJournal() {
  const f = $("j-filter").value;
  const list = journal.filter((e) => !f || e.mood === f);
  const counts = {};
  journal.forEach((e) => { if (e.mood) counts[e.mood] = (counts[e.mood] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const grat = journal.reduce((s, e) => s + (e.gratitude?.length || 0), 0);
  $("j-stats").innerHTML = journal.length ? `
    <div><b>${journal.length}</b><span>기록 · entries</span></div>
    <div><b>${streak()}</b><span>연속 기록일 · day streak</span></div>
    <div><b>${grat}</b><span>감사한 일 · gratitudes</span></div>
    <div><b>${top ? MOOD_BY_ID.get(top[0]).icon : "—"}</b><span>${top ? esc(MOOD_BY_ID.get(top[0]).ko) + "의 마음이 가장 많았어요" : "마음을 골라 보세요"}</span></div>` : "";
  if (!list.length) {
    $("j-list").innerHTML = `<p class="empty">${journal.length ? "이 마음으로 남긴 기록이 아직 없어요." : "아직 기록이 없어요. 오늘의 카드를 뽑고 첫 기록을 남겨 보세요."}<span class="en-sub">No entries yet.</span></p>`;
    return;
  }
  $("j-list").innerHTML = list.map((e) => {
    const card = e.cardId && CARD_BY_ID.get(e.cardId);
    const m = e.mood && MOOD_BY_ID.get(e.mood);
    const src = { today: "🎴 오늘의 카드", mood: "🌿 마음 처방", ask: "💬 마음 문답", shared: "🔗 나눔 카드", free: "✍️ 자유 기록" }[e.source] || "";
    return `
      <article class="j-item">
        <header><time>${esc(prettyDate(e.date))}</time><span class="muted">${src}</span>${m ? `<span class="tag">${m.icon} ${esc(m.ko)}</span>` : ""}${e.done ? `<span class="tag ok">✓ 실천</span>` : ""}
          <button class="x" data-del="${e.id}" aria-label="기록 지우기" title="지우기">✕</button></header>
        ${card ? `<blockquote>${esc(card.t)}<cite>${esc(chapterLabel(card.ch))} ${esc(card.n)}게송</cite></blockquote>` : ""}
        ${e.question ? `<p class="q">💬 ${esc(e.question)}</p>` : ""}
        ${e.note ? `<p class="note">${esc(e.note).replace(/\n/g, "<br>")}</p>` : ""}
        ${e.gratitude?.length ? `<ul class="grat">${e.gratitude.map((g) => `<li>🙏 ${esc(g)}</li>`).join("")}</ul>` : ""}
      </article>`;
  }).join("");
  $("j-list").querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("이 기록을 지울까요? · Delete this entry?")) return;
    journal = journal.filter((e) => e.id !== b.dataset.del);
    save(K.journal, journal);
    renderJournal();
  }));
}
$("j-export").addEventListener("click", () => {
  if (!journal.length) { toast("내보낼 기록이 없어요 · Nothing to export"); return; }
  const lines = journal.map((e) => {
    const card = e.cardId && CARD_BY_ID.get(e.cardId);
    const m = e.mood && MOOD_BY_ID.get(e.mood);
    return [
      `■ ${prettyDate(e.date)}${m ? ` · ${m.ko}` : ""}${e.done ? " · 실천함" : ""}`,
      card ? `「${card.t}」 — ${chapterLabel(card.ch)} ${card.n}게송` : null,
      e.question ? `고민: ${e.question}` : null,
      e.answer ? `처방: ${e.answer.practice}` : null,
      e.note ? `생각: ${e.note}` : null,
      e.gratitude?.length ? `감사: ${e.gratitude.join(" / ")}` : null
    ].filter(Boolean).join("\n");
  }).join("\n\n");
  const blob = new Blob([`마음 처방전 · 마음 기록 (${kstDate()})\n\n${lines}\n`], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `마음기록-${kstDate()}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

// ---------- 탭 라우팅 ----------
const TABS = ["today", "mood", "ask", "journal"];
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  let tab = TABS.includes(h) ? h : "today";
  if (h.startsWith("card=")) {
    tab = "today";
    if (!renderShared(h.slice(5))) renderToday();
  } else if (tab === "today") renderToday();
  if (tab === "journal") renderJournal();
  document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  document.querySelectorAll("[data-tab]").forEach((a) => {
    const on = a.dataset.tab === tab;
    a.classList.toggle("on", on);
    a.setAttribute("aria-selected", String(on));
  });
}
window.addEventListener("hashchange", () => { route(); window.scrollTo({ top: 0, behavior: "smooth" }); });

// ---------- 테마 ----------
const currentTheme = () => document.documentElement.getAttribute("data-theme") === "nature" ? "nature" : "dark";
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("theme", t); } catch { /* 무시 */ }
  $("theme-btn").textContent = t === "dark" ? "🌿" : "🌙";
  $("theme-btn").title = t === "dark" ? "한지(밝은) 테마로 전환" : "먹빛(어두운) 테마로 전환";
  document.querySelector('meta[name="theme-color"]').content = t === "nature" ? "#f3ede1" : "#17171a";
}
$("theme-btn").addEventListener("click", () => applyTheme(currentTheme() === "dark" ? "nature" : "dark"));

// ---------- 시작 ----------
applyTheme(currentTheme());
syncSoundBtn();
$("foot-count").textContent = `${CHAPTERS.length}품 · ${CARDS.length}장 (전체 ${TOTAL_VERSES}게송 중)`;
renderMoodGrid();
renderAskMoods();
renderJournalMoods();
route();
checkAi();

// 자동 확인용 (localhost에서만)
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  window.__wisdom = { CARDS, localCounsel, guessMood, poolFor };
}
