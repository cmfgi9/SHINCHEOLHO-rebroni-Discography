// 커뮤니티 기능: 뉴스레터 구독(subscribers) + 방명록(guestbook)
// Firebase 미설정 시 커뮤니티 섹션 전체를 숨김
import { firebaseConfig } from "./firebase-config.js";
import { firebaseConfigReady } from "./data-service.js";

const VER = "10.12.2";

async function init() {
  const section = document.getElementById("community");
  if (!section) return;
  if (!firebaseConfigReady()) return; // 섹션 숨김 유지

  const { initializeApp, getApps } = await import(`https://www.gstatic.com/firebasejs/${VER}/firebase-app.js`);
  const { getFirestore, collection, doc, addDoc, setDoc, updateDoc, getDocs, query, orderBy, limit } =
    await import(`https://www.gstatic.com/firebasejs/${VER}/firebase-firestore.js`);

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const db = getFirestore(app);

  section.classList.remove("hidden");

  const $ = id => document.getElementById(id);
  function setStatus(id, msg, cls = "") {
    const el = $(id);
    el.textContent = msg;
    el.className = "community-status " + cls;
  }
  function esc(s) {
    return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }
  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  /* ===== 뉴스레터 구독 ===== */
  $("subscribe-form").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("subscribe-email").value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setStatus("subscribe-status", "올바른 이메일 주소를 입력해주세요.", "err");
      return;
    }
    try {
      // 문서 ID = 이메일 → 중복 구독 시 update가 되어 규칙에서 거부됨
      await setDoc(doc(db, "subscribers", email), {
        email,
        createdAt: new Date().toISOString()
      });
      setStatus("subscribe-status", "구독 완료! 새 앨범 소식을 보내드릴게요. 🚀", "ok");
      $("subscribe-email").value = "";
    } catch (err) {
      if (String(err.code || err.message).includes("permission")) {
        setStatus("subscribe-status", "이미 구독 중인 이메일입니다.", "ok");
      } else {
        setStatus("subscribe-status", "오류가 발생했습니다. 잠시 후 다시 시도해주세요.", "err");
      }
    }
  });

  /* ===== 방명록 ===== */
  async function loadGuestbook() {
    const listEl = $("gb-list");
    try {
      const q = query(collection(db, "guestbook"), orderBy("createdAt", "desc"), limit(100));
      const snap = await getDocs(q);
      const items = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(x => !x.deleted);

      if (!items.length) {
        listEl.innerHTML = '<p class="community-sub">아직 메시지가 없습니다. 첫 응원을 남겨주세요!</p>';
        return;
      }
      listEl.innerHTML = items.map(x => {
        const date = (x.createdAt || "").slice(0, 10);
        return `
          <div class="gb-item" data-id="${esc(x.id)}">
            <div class="gb-head">
              <span class="gb-nick">${esc(x.name)}</span>
              <span class="gb-date">${esc(date)}</span>
              <button class="gb-del" data-id="${esc(x.id)}">삭제</button>
            </div>
            <p class="gb-msg">${esc(x.message)}</p>
          </div>
        `;
      }).join("");
    } catch (err) {
      console.warn("guestbook load failed:", err);
      listEl.innerHTML = "";
    }
  }

  $("gb-form").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("gb-name").value.trim();
    const pw = $("gb-pw").value;
    const message = $("gb-message").value.trim();

    if (!name || !pw || !message) {
      setStatus("gb-status", "닉네임, 비밀번호, 메시지를 모두 입력해주세요.", "err");
      return;
    }
    if (pw.length < 4) {
      setStatus("gb-status", "비밀번호는 4자 이상으로 해주세요.", "err");
      return;
    }
    try {
      await addDoc(collection(db, "guestbook"), {
        name,
        message,
        pwHash: await sha256(pw),
        createdAt: new Date().toISOString(),
        deleted: false
      });
      setStatus("gb-status", "메시지가 등록되었습니다. 감사합니다! 💫", "ok");
      $("gb-message").value = "";
      $("gb-pw").value = "";
      await loadGuestbook();
    } catch (err) {
      setStatus("gb-status", "등록 실패. 잠시 후 다시 시도해주세요.", "err");
      console.warn(err);
    }
  });

  // 방문자 셀프 삭제: 작성 시 입력한 비밀번호 확인 (해시 일치 시에만 규칙이 허용)
  $("gb-list").addEventListener("click", async e => {
    const btn = e.target.closest(".gb-del");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const pw = prompt("작성할 때 입력한 비밀번호를 입력하세요:");
    if (pw === null) return;
    try {
      await updateDoc(doc(db, "guestbook", id), {
        deleted: true,
        pwHash: await sha256(pw)
      });
      setStatus("gb-status", "메시지가 삭제되었습니다.", "ok");
      await loadGuestbook();
    } catch (err) {
      setStatus("gb-status", "비밀번호가 일치하지 않습니다.", "err");
    }
  });

  await loadGuestbook();
}

init().catch(err => console.warn("community init failed:", err));
