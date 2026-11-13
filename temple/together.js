// 온라인 법당 — 함께하는 기능의 창 (2단계): 법당 고르기 · 오늘의 흔적
// - 법당별 인원과 오늘 다녀간 이웃은 창을 열거나 새로고침할 때만 한 번 읽는다 (계속 듣지 않아 전송량을 아낀다).
// - 다녀간 이웃의 이름은 정해진 낱말 조합(번호)이라 자유 입력이 없다. [내 이름도 남기기]를 끄면 내 기록을 지운다.
import { ROOM_CAP, ROOM_MAX } from "./net.js?v=2";
import { OFFERINGS } from "./world.js?v=3";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k != null) n.append(k);
  return n;
};
const enSub = (t) => el("span", { className: "en-sub", textContent: t });

export function initTogether(api) {
  // ---------- 법당 고르기 ----------
  let counts = {};
  async function loadRooms() {
    const net = api.net();
    if (!api.ready() || !api.online()) {
      $("rooms-list").innerHTML = "";
      $("rooms-note").textContent = api.ready()
        ? "지금은 혼자 모드라 법당을 옮길 수 없어요. 다시 접속하면 자동으로 법당에 들어가요."
        : "아직 연결 중이에요. 잠시 뒤에 다시 열어 주세요.";
      return;
    }
    $("rooms-note").textContent = "인원을 불러오는 중…";
    try {
      counts = await net.roomCounts();
      $("rooms-note").textContent = `한 법당에는 ${ROOM_CAP}명쯤 함께 머물러요. 표시된 인원은 지금 접속해 있는 사람 수예요.`;
    } catch (e) {
      console.warn("[temple] rooms", e);
      $("rooms-note").textContent = "인원을 불러오지 못했어요. 새로고침을 눌러 주세요.";
    }
    renderRooms();
  }
  function renderRooms() {
    const cur = api.net().room;
    const list = $("rooms-list");
    list.innerHTML = "";
    let top = 3;
    for (const k of Object.keys(counts)) if (counts[k] > 0) top = Math.max(top, Number(k) + 1);
    top = Math.min(ROOM_MAX, Math.max(top, cur));
    for (let n = 1; n <= top; n++) {
      const c = Math.max(counts[n] || 0, n === cur ? 1 : 0);
      const full = c >= ROOM_CAP && n !== cur;
      const b = el("button", { type: "button", className: "room" + (n === cur ? " here" : ""), disabled: full },
        el("strong", { textContent: `법당 ${n}` }),
        el("span", { textContent: `${c} / ${ROOM_CAP}명` + (n === cur ? " · 지금 여기" : full ? " · 가득 참" : "") }));
      const bar = el("i", { className: "fill" });
      bar.style.width = `${Math.min(100, (c / ROOM_CAP) * 100)}%`;
      b.append(bar);
      b.setAttribute("aria-label", `법당 ${n}, ${c}명${n === cur ? ", 지금 여기" : ""}`);
      b.addEventListener("click", async () => {
        if (n === cur) return;
        api.closeSheets();
        await api.switchRoom(n);
      });
      list.append(el("li", {}, b));
    }
  }
  $("rooms-refresh").addEventListener("click", loadRooms);
  $("rooms-copy").addEventListener("click", async () => {
    const net = api.net();
    if (!net?.room || !api.online()) { api.toast("법당에 연결된 뒤에 복사할 수 있어요. · Not connected yet."); return; }
    const url = `${location.origin}${location.pathname}?room=${net.room}`;
    try {
      await navigator.clipboard.writeText(url);
      api.toast(`법당 ${net.room} 주소를 복사했어요. 함께할 분께 보내 주세요. · Link copied.`);
    } catch (e) { prompt("이 주소를 복사해 주세요 · Copy this link", url); }
  });

  // ---------- 오늘의 흔적 ----------
  let visitors = null;
  function renderStats() {
    const net = api.net();
    const st = net?.stats || { bows: 0, shares: 0, offer: {} };
    const o = st.offer || {};
    const ul = $("traces-stats");
    ul.innerHTML = "";
    const row = (icon, label, en, value) => ul.append(el("li", {},
      el("span", { className: "ic", textContent: icon }),
      el("span", { className: "lb" }, label, enSub(en)),
      el("strong", { textContent: value })));
    row("🙇", "오늘 모두가 올린 절", `Bows today (mine: ${api.myBows()})`, `${(st.bows || 0).toLocaleString()}번`);
    row("🪷", "오늘 올린 공양", "Offerings today", OFFERINGS.map((of) => `${of.ko} ${o[of.id] | 0}`).join(" · "));
    row("🤲", "오늘 이웃과 나눈 음식", "Food shared today", `${(st.shares || 0).toLocaleString()}번`);
    row("🏮", "지금 밝혀진 연등", "Lanterns glowing now", `${api.lanternCount()}개`);
  }
  async function loadVisitors() {
    const box = $("traces-names");
    if (!api.ready()) { box.textContent = "아직 연결 중이에요. 잠시 뒤에 새로고침해 주세요."; $("traces-count").textContent = ""; return; }
    box.textContent = "불러오는 중…";
    try { visitors = await api.net().visitors(); } catch (e) { console.warn("[temple] visitors", e); visitors = null; }
    renderVisitors();
  }
  function renderVisitors() {
    const box = $("traces-names");
    box.innerHTML = "";
    if (!visitors) { box.textContent = "다녀간 이웃을 불러오지 못했어요. 새로고침을 눌러 주세요."; $("traces-count").textContent = ""; return; }
    const uid = api.net().uid;
    const list = visitors.slice().sort((a, b) => (b.t || 0) - (a.t || 0));
    $("traces-count").textContent = `${list.length}명`;
    if (!list.length) { box.append(el("span", { className: "muted", textContent: "오늘 첫 발걸음을 남겨 주세요." })); return; }
    for (const v of list.slice(0, 80)) {
      box.append(el("span", { className: "name-chip" + (v.uid === uid ? " me" : ""), textContent: api.nameOf(v.n | 0) }));
    }
    if (list.length > 80) box.append(el("span", { className: "muted", textContent: `외 ${list.length - 80}명` }));
  }
  const chk = $("traces-me");
  chk.checked = api.profile.trace !== false;
  chk.addEventListener("change", async () => {
    api.profile.trace = chk.checked;
    api.saveProfile();
    if (!api.ready()) return;
    const net = api.net();
    if (chk.checked) await net.markVisit(api.profile.n, api.profile.c);
    else await net.unmarkVisit();
    loadVisitors();
  });
  $("traces-refresh").addEventListener("click", () => { renderStats(); loadVisitors(); });

  return {
    openRooms() { api.openSheet("rooms-sheet"); loadRooms(); },
    openTraces() { api.openSheet("traces-sheet"); renderStats(); loadVisitors(); },
    // 합계가 바뀌면 열려 있는 창의 숫자만 고친다
    refresh() { if (!$("traces-sheet").hidden) renderStats(); }
  };
}
