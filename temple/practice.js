// 온라인 법당 — 수행 기능 (1단계)
// 예불 순서 따라 하기 · 1분 명상 · 오늘의 법구 · 발원 노트 · 오늘의 수행 · 소리 설정 · 처음 오신 분 안내
// - 서버를 쓰지 않는다. 발원 노트·오늘의 수행은 이 기기(localStorage)에만 저장한다.
// - 소리 내어 읽기는 브라우저 음성 합성(speechSynthesis)을 쓴다. 읽는 글은 사이트가 정한 글뿐이다.
// - temple.js가 넘겨주는 api로 캐릭터 동작(절·합장·앉기)·소리·NPC를 움직인다.
import { YEBUL, TALKS, BEOPGU, VOW_PRESETS, TASKS, GUIDE } from "./content.js?v=2";

const VOWS_KEY = "rebroni-temple-vows";
const TASKS_KEY = "rebroni-temple-tasks";
const MAX_VOWS = 50;

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 무시 */ } };
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k != null) n.append(k);
  return n;
};
const enSub = (t) => el("span", { className: "en-sub", textContent: t });
const dayIndex = (day) => Math.floor(Date.parse(day + "T00:00:00Z") / 86400000);

export function initPractice(api) {
  const today = () => api.today();

  // ---------- 소리 내어 읽기 ----------
  const tts = {
    supported: "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function",
    voice: null,
    token: 0,
    pick() {
      if (!this.supported) return;
      const vs = speechSynthesis.getVoices().filter((v) => /^ko/i.test(v.lang));
      this.voice = vs.find((v) => v.localService) || vs[0] || null;
    },
    // 읽기를 끈 경우에도 같은 시간만큼 기다려 순서의 흐름이 유지되게 한다
    speak(text) {
      const my = ++this.token;
      const fallback = Math.max(1600, text.length * 120);
      if (!this.supported || api.profile.tts === false || !api.soundOn()) return wait(fallback);
      return new Promise((res) => {
        let done = false;
        const finish = () => { if (done) return; done = true; if (my === this.token) api.duck(false); res(); };
        try {
          const u = new SpeechSynthesisUtterance(text);
          u.lang = "ko-KR";
          if (this.voice) u.voice = this.voice;
          u.rate = 0.92;
          u.onend = finish;
          u.onerror = finish;
          api.duck(true);
          speechSynthesis.speak(u);
          setTimeout(finish, text.length * 260 + 4000); // 일부 브라우저가 onend를 빠뜨리는 경우 대비
        } catch (e) { setTimeout(finish, fallback); }
      });
    },
    cancel() {
      this.token++;
      if (this.supported) try { speechSynthesis.cancel(); } catch (e) { /* 무시 */ }
      api.duck(false);
    }
  };
  if (tts.supported) { tts.pick(); speechSynthesis.addEventListener?.("voiceschanged", () => tts.pick()); }

  // ---------- 창(시트) ----------
  const backdrop = $("sheet-backdrop");
  function openSheet(id) {
    closeSheets();
    api.closePops();
    $(id).hidden = false;
    backdrop.hidden = false;
    $(id).querySelector("button, input, textarea")?.focus({ preventScroll: true });
  }
  function closeSheets() {
    document.querySelectorAll(".sheet").forEach((s) => {
      if (!s.hidden) s.dispatchEvent(new Event("sheetclose"));
      s.hidden = true;
    });
    backdrop.hidden = true;
  }
  backdrop.addEventListener("click", closeSheets);
  document.querySelectorAll(".sheet [data-close]").forEach((b) => b.addEventListener("click", closeSheets));
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheets(); });

  // ---------- 오늘의 수행 ----------
  let tasks = load(TASKS_KEY, null);
  if (!tasks || tasks.day !== today()) tasks = { day: today(), done: {} };
  function taskDone(id) {
    if (tasks.day !== today()) tasks = { day: today(), done: {} };
    if (tasks.done[id] || !TASKS.some((t) => t.id === id)) return;
    tasks.done[id] = true;
    store(TASKS_KEY, tasks);
    renderTasks();
    const n = Object.keys(tasks.done).length;
    if (n === TASKS.length) {
      api.bell("bowl", 0.7);
      api.toast("🌟 오늘의 수행을 모두 마쳤어요. 평안한 하루 되세요. · All of today's practice is done.");
    } else {
      const name = TASKS.find((t) => t.id === id).ko.replace(/^\S+\s/, "");
      api.toast(`✅ ${name} (오늘의 수행 ${n}/${TASKS.length}) · Today's practice ${n}/${TASKS.length}`);
    }
  }
  function renderTasks() {
    const n = Object.keys(tasks.done).length;
    $("tasks-pill").textContent = `✅ 오늘의 수행 ${n}/${TASKS.length}`;
    $("menu-tasks-count").textContent = `${n}/${TASKS.length}`;
    const ul = $("tasks-list");
    ul.innerHTML = "";
    for (const t of TASKS) {
      const ok = !!tasks.done[t.id];
      ul.append(el("li", { className: ok ? "done" : "" },
        el("span", { className: "tick", textContent: ok ? "✓" : "○", ariaHidden: "true" }),
        el("span", {}, t.ko, enSub(t.en))));
    }
    $("tasks-msg").textContent = n === TASKS.length
      ? "오늘의 수행을 모두 마쳤어요 🙏 내일 새로 시작돼요."
      : "하나씩 하다 보면 마음이 차분해져요. 매일 자정(한국 시간)에 새로 시작돼요.";
  }
  $("tasks-pill").addEventListener("click", () => openSheet("tasks-sheet"));

  // ---------- 발원 노트 (이 기기에만) ----------
  let vows = load(VOWS_KEY, []);
  if (!Array.isArray(vows)) vows = [];
  function addVow(text) {
    vows.push({ text: text.slice(0, 140), date: Date.now() });
    if (vows.length > MAX_VOWS) vows.splice(0, vows.length - MAX_VOWS);
    store(VOWS_KEY, vows);
    renderVows();
  }
  function renderVows() {
    const ul = $("vow-list");
    ul.innerHTML = "";
    if (!vows.length) { ul.append(el("li", { className: "muted" }, "아직 적은 발원이 없어요.", enSub("No vows yet."))); }
    vows.slice().reverse().forEach((v, ri) => {
      const i = vows.length - 1 - ri;
      const d = new Date(v.date);
      const del = el("button", { type: "button", className: "x", textContent: "×", title: "지우기 · Delete" });
      del.setAttribute("aria-label", "이 발원 지우기 · Delete");
      del.addEventListener("click", () => { vows.splice(i, 1); store(VOWS_KEY, vows); renderVows(); });
      ul.append(el("li", {}, el("span", { textContent: v.text }), el("small", { textContent: isNaN(d) ? "" : d.toLocaleDateString("ko-KR") }), del));
    });
    $("vow-clear").hidden = !vows.length;
  }
  $("vow-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("vow-text").value.trim();
    if (!text) { $("vow-text").focus(); return; }
    addVow(text);
    $("vow-text").value = "";
    api.bell("chime", 0.5);
    api.toast("발원을 노트에 간직했어요. · Saved on this device.");
  });
  $("vow-clear").addEventListener("click", () => {
    if (!confirm("이 기기에 간직한 발원을 모두 지울까요?\nDelete all vows on this device?")) return;
    vows = [];
    try { localStorage.removeItem(VOWS_KEY); } catch (e) { /* 무시 */ }
    renderVows();
  });

  // ---------- 오늘의 법구 ----------
  let bIdx = dayIndex(today()) % BEOPGU.length;
  function renderBeopgu() {
    const b = BEOPGU[bIdx];
    $("bg-ref").textContent = b.ref + "을 바탕으로";
    $("bg-text").textContent = b.text;
    $("bg-reflect").textContent = b.reflect;
  }
  $("bg-next").addEventListener("click", () => { tts.cancel(); bIdx = (bIdx + 1 + Math.floor(Math.random() * (BEOPGU.length - 1))) % BEOPGU.length; renderBeopgu(); });
  $("bg-read").addEventListener("click", async () => {
    api.unlock();
    const b = BEOPGU[bIdx];
    await tts.speak(b.text);
    await tts.speak(b.reflect);
  });
  $("beopgu-sheet").addEventListener("sheetclose", () => tts.cancel());

  // ---------- 1분 명상 ----------
  const med = { on: false, start: 0, timer: 0 };
  function medStop(done) {
    clearInterval(med.timer);
    if (!med.on) return;
    med.on = false;
    $("med-start").textContent = "▶ 시작";
    $("med-circle").classList.remove("in", "out");
    $("med-phase").textContent = done ? "마쳤어요 🙏" : "준비";
    api.setMeditating(false);
    if (done) {
      api.bell("bowl", 0.75);
      setTimeout(() => api.bell("bowl", 0.6), 1600);
      taskDone("practice");
    }
  }
  function medTick() {
    const el2 = (performance.now() - med.start) / 1000;
    const left = Math.max(0, 60 - el2);
    $("med-time").textContent = `00:${String(Math.ceil(left)).padStart(2, "0")}`;
    const ph = el2 % 10;
    const inhale = ph < 4;
    $("med-phase").textContent = inhale ? "들이쉬고 · in" : "내쉬고 · out";
    $("med-circle").classList.toggle("in", inhale);
    $("med-circle").classList.toggle("out", !inhale);
    if (left <= 0) medStop(true);
  }
  $("med-start").addEventListener("click", () => {
    api.unlock();
    if (med.on) { medStop(false); return; }
    med.on = true;
    med.start = performance.now();
    $("med-start").textContent = "■ 멈추기";
    api.bell("bowl", 0.7);
    api.setMeditating(true);
    medTick();
    med.timer = setInterval(medTick, 250);
  });
  $("med-sheet").addEventListener("sheetclose", () => medStop(false));

  // ---------- 처음 오신 분 안내 ----------
  const gl = $("guide-list");
  for (const [h, ko, en] of GUIDE) gl.append(el("li", {}, el("strong", { textContent: h }), el("span", { textContent: ko }), enSub(en)));
  $("guide-yebul").addEventListener("click", () => { closeSheets(); openYebul(); });

  // ---------- 소리 설정 ----------
  const P = api.profile;
  const bindRange = (id, key, def, apply) => {
    const r = $(id);
    r.value = String(P[key] ?? def);
    r.addEventListener("input", () => { P[key] = Number(r.value); apply(P[key]); });
    r.addEventListener("change", () => api.saveProfile());
  };
  bindRange("set-amb", "amb", 0.8, (v) => api.setBus("natureBus", v));
  bindRange("set-fx", "fx", 0.9, (v) => { api.setBus("bellBus", v); api.setBus("cueBus", v * 0.8); });
  bindRange("set-mus", "mus", 0.55, (v) => api.setBus("musicBus", v));
  const musBtn = $("set-music");
  const ttsBtn = $("set-tts");
  function syncSettings() {
    musBtn.setAttribute("aria-pressed", String(P.music !== false));
    musBtn.textContent = P.music !== false ? "켜짐" : "꺼짐";
    ttsBtn.setAttribute("aria-pressed", String(P.tts !== false));
    ttsBtn.textContent = P.tts !== false ? "켜짐" : "꺼짐";
    $("set-tts-note").textContent = tts.supported ? "" : "이 브라우저는 소리 내어 읽기를 지원하지 않아요. 글로 읽어 주세요.";
    const now = api.music.current();
    $("set-now").textContent = now ? `🎵 ${now.title} · ${now.albumTitle}` : api.music.message();
    $("set-next").hidden = !now;
    $("set-sound").textContent = api.soundOn() ? "🔊 켜짐" : "🔇 꺼짐";
  }
  musBtn.addEventListener("click", () => { P.music = P.music === false; api.saveProfile(); api.music.setOn(P.music !== false); syncSettings(); });
  ttsBtn.addEventListener("click", () => { P.tts = P.tts === false; if (P.tts === false) tts.cancel(); api.saveProfile(); syncSettings(); });
  $("set-next").addEventListener("click", () => api.music.next());
  $("set-sound").addEventListener("click", () => { api.toggleSound(); syncSettings(); });
  $("settings-btn").addEventListener("click", () => { syncSettings(); openSheet("settings-sheet"); });
  $("music-pill").addEventListener("click", () => { syncSettings(); openSheet("settings-sheet"); });

  // ---------- 수행 메뉴 ----------
  const MENU = {
    yebul: () => { closeSheets(); openYebul(); },
    med: () => openSheet("med-sheet"),
    beopgu: () => { renderBeopgu(); openSheet("beopgu-sheet"); },
    vow: () => { renderVows(); openSheet("vow-sheet"); },
    tasks: () => openSheet("tasks-sheet"),
    guide: () => openSheet("guide-sheet"),
    settings: () => { syncSettings(); openSheet("settings-sheet"); },
    traces: () => api.openTraces(),
    rooms: () => api.openRooms(),
    install: () => api.install()
  };
  document.querySelectorAll("#practice-sheet [data-menu]").forEach((b) => b.addEventListener("click", () => MENU[b.dataset.menu]()));
  $("practice-btn").addEventListener("click", () => openSheet("practice-sheet"));

  // ---------- 예불 순서 따라 하기 ----------
  const Y = { open: false, step: 0, busy: false, token: 0, done: {}, vowPick: -1 };
  const panel = $("yebul");
  function openYebul() {
    api.unlock();
    Y.open = true;
    Y.step = 0;
    Y.done = {};
    Y.vowPick = -1;
    panel.hidden = false;
    document.body.classList.add("yebul-open");
    api.npc("idle");
    if (!api.inHall()) api.toast("대웅전 좌복에서 함께 예불을 드려요. · The service is held in the main hall.");
    renderYebul();
  }
  function closeYebul(finished) {
    Y.token++;
    Y.busy = false;
    tts.cancel();
    Y.open = false;
    panel.hidden = true;
    document.body.classList.remove("yebul-open");
    api.npc("idle");
    api.setMeditating(false);
    if (!finished) api.toast("예불 안내를 닫았어요. 📿 수행 메뉴에서 다시 시작할 수 있어요. · Closed.");
  }
  function go(step) {
    Y.token++;
    Y.busy = false;
    tts.cancel();
    api.setMeditating(false);
    Y.step = Math.max(0, Math.min(YEBUL.length - 1, step));
    api.npc("idle");
    renderYebul();
    if (YEBUL[Y.step].kind === "end") runEnd();
  }
  const btn = (label, en, cls, fn) => {
    const b = el("button", { type: "button", className: "btn " + (cls || "") }, label, en ? enSub(en) : null);
    b.addEventListener("click", fn);
    return b;
  };
  function renderYebul() {
    const s = YEBUL[Y.step];
    $("y-step").textContent = `${Y.step + 1} / ${YEBUL.length}`;
    $("y-dots").innerHTML = "";
    YEBUL.forEach((_, i) => $("y-dots").append(el("span", { className: i < Y.step ? "past" : i === Y.step ? "now" : "" })));
    $("y-title").innerHTML = "";
    $("y-title").append(el("span", {}, s.ko, s.hanja ? el("span", { className: "hanja", textContent: " " + s.hanja }) : null), enSub(s.en));
    $("y-body").innerHTML = "";
    $("y-body").append(el("p", { className: "y-desc" }, s.body, enSub(s.bodyEn)));
    const act = $("y-actions");
    act.innerHTML = "";

    if (s.kind === "seat") {
      if (api.isSitting()) {
        $("y-body").append(el("p", { className: "y-ok", textContent: "✓ 좌복에 앉았어요. 다음으로 넘어가요." }));
      } else {
        act.append(btn("🧘 좌복으로 가기", "Go to a cushion", "primary", async () => {
          const ok = await api.sitNearest();
          if (Y.open && Y.step === 0) renderYebul();
          if (!ok) api.toast("가는 길을 멈췄어요. 다시 누르면 좌복으로 안내해요. · Stopped.");
        }));
      }
    } else if (s.kind === "chant") {
      const ol = el("ol", { className: "y-lines" });
      s.lines.forEach((ln, i) => {
        ol.append(el("li", { id: `y-line-${i}` },
          el("span", { className: "chant" }, ln.chant, el("span", { className: "hanja", textContent: " " + ln.hanja })),
          el("span", { className: "mean", textContent: ln.mean }),
          enSub(ln.en)));
      });
      $("y-body").append(ol);
      if (Y.done[Y.step]) $("y-body").append(el("p", { className: "y-ok", textContent: "✓ 마쳤어요" }));
      else act.append(btn(Y.busy ? "함께 하는 중…" : "▶ 함께 하기", Y.busy ? "" : "Begin", "primary", () => runChant()));
    } else if (s.kind === "sit") {
      $("y-body").append(el("p", { className: "y-timer", id: "y-timer", textContent: Y.done[Y.step] ? "✓ 마쳤어요" : "01:00" }));
      if (!Y.done[Y.step]) act.append(btn(Y.busy ? "■ 멈추기" : "▶ 입정 시작", Y.busy ? "Stop" : "Begin", Y.busy ? "" : "primary", () => (Y.busy ? go(Y.step) : runSit(s.secs))));
    } else if (s.kind === "talk") {
      const t = TALKS[dayIndex(today()) % TALKS.length];
      $("y-body").append(el("h4", { className: "y-talk-title" }, `「${t.title}」`, enSub(t.en)));
      const box = el("div", { className: "y-talk" });
      t.text.forEach((p, i) => box.append(el("p", { id: `y-talk-${i}`, textContent: p })));
      $("y-body").append(box, el("p", { className: "fine", textContent: "레브로니 법당에서 직접 쓴 짧은 법문이에요. 날마다 바뀌어요." }));
      act.append(btn(Y.busy ? "■ 멈추기" : "🔊 들려주세요", Y.busy ? "Stop" : "Listen", "", () => (Y.busy ? go(Y.step) : runTalk(t))));
    } else if (s.kind === "vow") {
      const chips = el("div", { className: "y-chips" });
      VOW_PRESETS.forEach((v, i) => {
        const c = el("button", { type: "button", className: "chip", textContent: v });
        c.setAttribute("aria-pressed", String(Y.vowPick === i));
        c.addEventListener("click", () => { Y.vowPick = i; $("y-vow-text").value = ""; renderYebul(); });
        chips.append(c);
      });
      const ta = el("textarea", { id: "y-vow-text", maxLength: 140, rows: 2, placeholder: "또는 나의 발원을 직접 적어 보세요 (이 기기에만 간직돼요) · Or write your own" });
      ta.value = Y.vowText || "";
      ta.addEventListener("input", () => { Y.vowText = ta.value; if (ta.value.trim() && Y.vowPick >= 0) { Y.vowPick = -1; chips.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", "false")); } });
      $("y-body").append(chips, ta);
      if (Y.done[Y.step]) $("y-body").append(el("p", { className: "y-ok", textContent: "✓ 발원을 올렸어요" }));
      else act.append(btn("🙏 발원 올리기", "Offer", "primary", () => runVow()));
    } else if (s.kind === "end") {
      act.append(btn("🙏 예불 마치기", "Finish", "primary", () => { closeYebul(true); api.toast("📋 예불을 마쳤어요. 평안히 가세요. · The service is complete."); }));
    }

    const nav = $("y-nav");
    nav.innerHTML = "";
    if (Y.step > 0 && s.kind !== "end") nav.append(btn("← 이전", "", "ghost small", () => go(Y.step - 1)));
    if (s.kind !== "end") {
      // 어느 단계든 건너뛸 수 있다 (따라 하기 쉬움이 우선)
      const ready = s.kind === "seat" ? api.isSitting() : !!Y.done[Y.step] || s.kind === "talk";
      nav.append(btn(ready ? "다음 →" : "건너뛰기 →", "", ready ? "small primary-soft" : "ghost small", () => go(Y.step + 1)));
    }
  }

  async function runChant() {
    const s = YEBUL[Y.step], my = ++Y.token;
    Y.busy = true;
    renderYebul();
    api.npc("hap");
    for (let i = 0; i < s.lines.length; i++) {
      if (my !== Y.token) return;
      document.querySelectorAll(".y-lines li").forEach((li, k) => li.classList.toggle("now", k === i));
      api.bell("moktak", 0.55);
      api.setHap(true);
      await wait(500);
      if (my !== Y.token) return;
      await tts.speak(s.lines[i].mean);
      if (my !== Y.token) return;
      if (s.bowEach || (s.bowEnd && i === s.lines.length - 1)) {
        api.doBow();
        api.npc("bow");
        await wait(2000);
      } else await wait(700);
    }
    if (my !== Y.token) return;
    Y.busy = false;
    Y.done[Y.step] = true;
    api.npc("hap");
    renderYebul();
  }

  async function runSit(secs) {
    const my = ++Y.token;
    Y.busy = true;
    renderYebul();
    api.setMeditating(true);
    api.npc("sit");
    for (let k = 0; k < 3; k++) { api.bell("moktak", 0.6); await wait(700); }
    const start = performance.now();
    while (my === Y.token) {
      const left = Math.max(0, secs - (performance.now() - start) / 1000);
      const t = $("y-timer");
      const sec = Math.ceil(left);
      if (t) t.textContent = `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
      if (left <= 0) break;
      await wait(250);
    }
    if (my !== Y.token) return;
    api.bell("moktak", 0.6);
    Y.busy = false;
    Y.done[Y.step] = true;
    api.npc("idle");
    renderYebul();
  }

  async function runTalk(t) {
    const my = ++Y.token;
    Y.busy = true;
    api.unlock();
    renderYebul();
    for (let i = 0; i < t.text.length; i++) {
      if (my !== Y.token) return;
      document.querySelectorAll(".y-talk p").forEach((p, k) => p.classList.toggle("now", k === i));
      await tts.speak(t.text[i]);
      await wait(350);
    }
    if (my !== Y.token) return;
    Y.busy = false;
    Y.done[Y.step] = true;
    renderYebul();
  }

  function runVow() {
    const typed = ($("y-vow-text")?.value || "").trim();
    const text = typed || (Y.vowPick >= 0 ? VOW_PRESETS[Y.vowPick] : "");
    if (!text) { api.toast("발원을 하나 고르거나 적어 주세요. · Pick or write a vow."); return; }
    if (typed) addVow(typed);
    api.bell("bowl", 0.7);
    api.setHap(true);
    api.npc("hap");
    Y.done[Y.step] = true;
    Y.vowText = "";
    api.toast(typed ? "발원을 올리고 발원 노트에 간직했어요. · Offered and kept on this device." : "발원을 올렸어요. · Your vow is offered.");
    renderYebul();
  }

  async function runEnd() {
    const my = Y.token;
    api.npc("hap");
    taskDone("practice");
    for (let k = 0; k < 3; k++) {
      if (my !== Y.token) return;
      api.bell("bowl", 0.65);
      await wait(2600);
    }
  }

  $("y-close").addEventListener("click", () => closeYebul(false));

  // 처음 그리기
  renderTasks();
  renderVows();
  renderBeopgu();

  return {
    taskDone,
    openGuide: () => openSheet("guide-sheet"),
    openYebul,
    get yebulOpen() { return Y.open; },
    setInstallable(on) { document.querySelectorAll("[data-menu='install']").forEach((b) => { b.hidden = !on; }); },
    refreshSettings: () => { if (!$("settings-sheet").hidden) syncSettings(); },
    openSheet,
    closeSheets
  };
}
