/* Discography site with improved layout & 2-line track structure */

import { loadAlbums } from "./data-service.js";

/* ===== 테마 스위처 (Cosmic Dark / Nature Green) ===== */
function initThemeSwitcher() {
  const btn = document.getElementById("theme-btn");
  if (!btn) return;

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("theme", theme); } catch (e) { /* ignore */ }
    // 버튼은 "전환될 테마"를 보여줌
    btn.textContent = theme === "dark" ? "🌿" : "🌌";
    btn.title = theme === "dark" ? "Nature Green 테마로 전환" : "Cosmic Dark 테마로 전환";
  }

  let theme = "dark";
  try { theme = localStorage.getItem("theme") || "dark"; } catch (e) { /* ignore */ }
  apply(theme);

  btn.addEventListener("click", () => {
    theme = theme === "dark" ? "nature" : "dark";
    apply(theme);
  });
}
initThemeSwitcher();

function updateStickyBarHeight() {
  const bar = document.getElementById("stickybar");
  if (!bar) return;
  const h = Math.ceil(bar.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--stickybar-h", h + "px");
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getStickyOffset() {
  const bar = document.getElementById("stickybar");
  if (!bar) return 10;
  return Math.ceil(bar.getBoundingClientRect().height) + 10;
}

function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const y = el.getBoundingClientRect().top + window.pageYOffset - getStickyOffset();
  window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
}

function getYouTubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/\/embed\/([^\/\?]+)/);
    if (m) return m[1];
    return null;
  } catch (e) {
    const m = String(url).match(/[?&]v=([^&]+)/);
    return m ? m[1] : null;
  }
}

function getYouTubePlaylistId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const list = u.searchParams.get("list");
    return list || null;
  } catch (e) {
    const m = String(url).match(/[?&]list=([^&]+)/);
    return m ? m[1] : null;
  }
}

function closeAllPlayers() {
  document.querySelectorAll(".track-player, .album-player").forEach(p => p.remove());
  document.querySelectorAll(".yt-play").forEach(b => {
    b.setAttribute("aria-expanded", "false");
    b.textContent = "Play";
  });
  document.querySelectorAll(".yt-album-play").forEach(b => {
    b.setAttribute("aria-expanded", "false");
    b.textContent = "Play Album";
  });
  document.querySelectorAll(".track.playing").forEach(t => t.classList.remove("playing"));
  document.querySelectorAll(".album.playing").forEach(a => a.classList.remove("playing"));
}

// 트랙 제목을 메인/서브로 분리하는 헬퍼 (괄호 기준)
function splitTrackTitle(title) {
  const m = title.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (m) return { main: m[1].trim(), sub: m[2].trim() };
  return { main: title.trim(), sub: "" };
}

async function main() {
  const nav = document.getElementById("album-nav");
  const albumsEl = document.getElementById("albums");
  const search = document.getElementById("search");
  const quickBtn = document.getElementById("quick-menu-btn");
  const quickMenu = document.getElementById("quick-menu");
  const quickClose = document.getElementById("quick-menu-close");
  const quickLinks = document.getElementById("quick-menu-links");
  const quickBackdrop = document.getElementById("quick-menu-backdrop");

  if (albumsEl) {
    // Skeleton Loading
    albumsEl.innerHTML = Array(3).fill(0).map(() => `
      <div class="album skeleton-pulse" style="padding:32px 16px; border-bottom:1px solid rgba(255,255,255,.1);">
        <div class="album-grid">
          <div class="cover-col">
            <div style="width:100%; aspect-ratio:1; background:rgba(255,255,255,.05); border-radius:14px;"></div>
          </div>
          <div class="info-col" style="flex:1;">
            <div style="height:32px; width:60%; background:rgba(255,255,255,.05); margin-bottom:16px; border-radius:4px;"></div>
            <div style="height:16px; width:40%; background:rgba(255,255,255,.05); margin-bottom:8px; border-radius:4px;"></div>
            <div style="height:16px; width:30%; background:rgba(255,255,255,.05); border-radius:4px;"></div>
          </div>
        </div>
      </div>
    `).join("");
  }

  // Firestore 우선, 실패 시 albums.json 폴백 (data-service.js)
  const albums = await loadAlbums();

  updateStickyBarHeight();
  window.addEventListener("resize", updateStickyBarHeight);


  function renderNav() {
    if (!nav) return;
    nav.innerHTML = albums.map(a => {
      const label = (a.ordinal || "").replace(" Album", "");
      return `<a href="#${a.id}" data-album="${a.id}">${escapeHtml(label)}</a>`;
    }).join("");
  }

  function renderAlbums() {
    if (!albumsEl) return;
    albumsEl.innerHTML = albums.map(a => {
      // 메타 정보 두 줄로 분리
      const line1Parts = [];
      if (a.upload) line1Parts.push(`Upload: ${escapeHtml(a.upload)}`);
      if (a.preorder) line1Parts.push(`Preorder: ${escapeHtml(a.preorder)}`);
      const line1 = line1Parts.join(" · ");

      const line2Parts = [];
      if (a.release) line2Parts.push(`Release: ${escapeHtml(a.release)}`);
      if (a.label) line2Parts.push(`Label: ${escapeHtml(a.label)}`);
      if (a.upc) line2Parts.push(`UPC: ${escapeHtml(a.upc)}`);
      const line2 = line2Parts.join(" · ");

      const coverHtml = a.cover
        ? `<img src="${escapeHtml(a.cover)}"
                 alt="${escapeHtml(a.title)} cover"
                 class="cover"
                 loading="lazy">`
        : "";

      const links = a.links || {};
      const plId = getYouTubePlaylistId(links.youtube_album);
      const albumPlayBtn = plId
        ? `<button class="tbtn yt-album-play" data-album="${a.id}" data-ytpl="${escapeHtml(plId)}" aria-expanded="false">Play Album</button>`
        : "";

      const linksHtml = `
        <div class="links">
          ${links.spotify_album ? `<a href="${escapeHtml(links.spotify_album)}" target="_blank" rel="noopener" class="tbtn">Spotify</a>` : ""}
          ${links.apple_album ? `<a href="${escapeHtml(links.apple_album)}" target="_blank" rel="noopener" class="tbtn">Apple Music</a>` : ""}
          ${links.youtube_album ? `<a href="${escapeHtml(links.youtube_album)}" target="_blank" rel="noopener" class="tbtn">YouTube</a>` : ""}
          ${albumPlayBtn}
        </div>
      `;

      // 앨범 콘셉트: 한국어(ko) + 영어(en)
      const c = a.concept;
      const conceptHtml = c
        ? `<div class="album-concept">
             <p class="ko">${escapeHtml(c.ko)}</p>
             <p class="en">${escapeHtml(c.en)}</p>
           </div>`
        : "";

      // Behind the Tracks: 세계관/스토리 (접이식)
      const s = a.story;
      const storyHtml = (s && (s.ko || s.en))
        ? `<details class="album-story">
             <summary>Behind the Tracks</summary>
             <div class="story-body">
               ${s.ko ? `<p class="ko">${escapeHtml(s.ko)}</p>` : ""}
               ${s.en ? `<p class="en">${escapeHtml(s.en)}</p>` : ""}
             </div>
           </details>`
        : "";

      const tracksHtml = (a.tracks || []).map(t => {
        const { main, sub } = splitTrackTitle(t.title);
        const tLinks = t.links || {};
        const ytId = getYouTubeId(tLinks.youtube);
        const playBtn = ytId
          ? `<button class="tbtn tbtn-secondary yt-play" data-track="${a.id}-${t.no}" data-ytid="${escapeHtml(ytId)}" aria-expanded="false">Play</button>`
          : "";

        // 가사 버튼 (가사가 있는 곡만)
        const lyricsBtn = (t.lyrics && (t.lyrics.ko || t.lyrics.en))
          ? `<button class="tbtn tbtn-secondary lyrics-btn" data-album="${a.id}" data-no="${t.no}">Lyrics</button>`
          : "";

        // 🔽 검색용 데이터 준비 (앨범명 + 곡명 + ISRC)
        const trackText = `${a.title} ${a.ordinal} ${t.title} ${t.isrc}`.toLowerCase();

        return `
          <div class="track" id="${a.id}-${t.no}" data-album="${a.id}" data-searchtext="${escapeHtml(trackText)}">
            <div class="track-main">
              <span class="no">${t.no}.</span>
              <span class="title">${escapeHtml(main)}</span>
              ${sub ? `<span class="subtitle">(${escapeHtml(sub)})</span>` : ""}
            </div>
            <div class="track-sub">
              <span class="isrc">ISRC: ${escapeHtml(t.isrc)}</span>
              <div class="track-links">
                ${tLinks.spotify ? `<a href="${escapeHtml(tLinks.spotify)}" target="_blank" rel="noopener" class="tbtn tbtn-secondary">Spotify</a>` : ""}
                ${tLinks.apple ? `<a href="${escapeHtml(tLinks.apple)}" target="_blank" rel="noopener" class="tbtn tbtn-secondary">Apple Music</a>` : ""}
                ${tLinks.youtube ? `<a href="${escapeHtml(tLinks.youtube)}" target="_blank" rel="noopener" class="tbtn tbtn-secondary">YouTube</a>` : ""}
                ${playBtn}
                ${lyricsBtn}
              </div>
            </div>
          </div>
        `;
      }).join("");

      return `
        <section id="${a.id}" class="album">
          <div class="album-grid">
            <div class="cover-col">
              ${coverHtml}
            </div>
            <div class="info-col">
              <h2>${escapeHtml(a.ordinal)} · ${escapeHtml(a.title)}</h2>
              <div class="meta">
                ${line1 ? `<div>${line1}</div>` : ""}
                ${line2 ? `<div>${line2}</div>` : ""}
              </div>
              ${conceptHtml}
              ${storyHtml}
              ${linksHtml}
            </div>
          </div>
          <div class="tracklist">
            ${tracksHtml}
          </div>
          <p class="back-top"><a href="#top">↑ Back to top</a></p>
        </section>
      `;
    }).join("");
  }

  function renderQuickLinks() {
    if (!quickLinks) return;
    quickLinks.innerHTML = albums.map(a => {
      return `<a href="#${a.id}" data-album="${a.id}">${escapeHtml(a.ordinal)}: ${escapeHtml(a.title)}</a>`;
    }).join("");
  }

  function updateActiveAlbum() {
    const scrollY = window.pageYOffset + getStickyOffset() + 40;
    let currentId = "";
    albums.forEach(a => {
      const el = document.getElementById(a.id);
      if (el && el.offsetTop <= scrollY) currentId = a.id;
    });

    document.querySelectorAll(".album-nav a, .drawer-links a").forEach(link => {
      const id = link.getAttribute("data-album");
      if (id === currentId) link.classList.add("active");
      else link.classList.remove("active");
    });
  }

  function filterAlbums() {
    const q = (search?.value || "").toLowerCase().trim();

    function highlightSearchTerm(text, query) {
      if (!query) return escapeHtml(text);
      // 단순 텍스트 매칭 하이라이트 (대소문자 무시)
      const escapedText = escapeHtml(text);
      const escapedQuery = escapeHtml(query);
      const regex = new RegExp(`(${escapedQuery})`, 'gi');
      return escapedText.replace(regex, '<mark>$1</mark>');
    }
    // 검색어 없으면 모두 표시
    if (!q) {
      document.querySelectorAll(".album").forEach(albumEl => {
        albumEl.style.display = "";
        albumEl.querySelectorAll(".track").forEach(trackEl => {
          trackEl.style.display = "";
        });
      });
      return;
    }

    // 각 앨범을 순회하며 곡 단위 필터링 및 하이라이트 적용
    document.querySelectorAll(".album").forEach(albumEl => {
      let hasVisibleTrack = false;
      const albumId = albumEl.id;
      const albumData = albums.find(a => a.id === albumId);

      // 앨범 제목/아티스트도 검색 대상에 포함되어 있다면 하이라이트 가능
      // 여기서는 트랙 리스트 필터링 시각화에 집중

      albumEl.querySelectorAll(".track").forEach(trackEl => {
        const searchText = trackEl.getAttribute("data-searchtext") || "";
        const trackNo = trackEl.getAttribute("id").split("-")[1]; // e.g. a7-1 -> 1
        const trackData = albumData?.tracks.find(t => String(t.no) === trackNo);

        if (searchText.includes(q)) {
          trackEl.style.display = "";  // 매칭된 곡 보이기
          hasVisibleTrack = true;

          // 하이라이트 적용 (DOM 업데이트)
          if (trackData) {
            const { main, sub } = splitTrackTitle(trackData.title);
            const mainEl = trackEl.querySelector(".track-main .title");
            const subEl = trackEl.querySelector(".track-main .subtitle");

            if (mainEl) mainEl.innerHTML = highlightSearchTerm(main, q);
            if (subEl && sub) subEl.innerHTML = `(${highlightSearchTerm(sub, q)})`;
          }

        } else {
          trackEl.style.display = "none";  // 매칭 안 된 곡 숨기기
        }
      });

      // 앨범은 최소 하나라도 매칭된 곡이 있으면 표시
      albumEl.style.display = hasVisibleTrack ? "" : "none";
    });
  }

  renderNav();
  renderAlbums();
  renderQuickLinks();
  updateActiveAlbum();

  // Event: scroll spy
  window.addEventListener("scroll", updateActiveAlbum, { passive: true });

  // Event: nav links
  document.querySelectorAll(".album-nav a, .drawer-links a").forEach(link => {
    link.addEventListener("click", e => {
      const id = link.getAttribute("data-album");
      if (id) {
        e.preventDefault();
        scrollToId(id);
        if (quickMenu) closeQuickMenu();
      }
    });
  });

  // Event: search
  if (search) {
    search.addEventListener("input", filterAlbums);
  }

  // Event: quick menu
  function openQuickMenu() {
    if (quickMenu && quickBackdrop) {
      quickMenu.classList.add("open");
      quickBackdrop.classList.add("open");
      quickMenu.setAttribute("aria-hidden", "false");
    }
  }
  function closeQuickMenu() {
    if (quickMenu && quickBackdrop) {
      quickMenu.classList.remove("open");
      quickBackdrop.classList.remove("open");
      quickMenu.setAttribute("aria-hidden", "true");
    }
  }
  if (quickBtn) quickBtn.addEventListener("click", openQuickMenu);
  if (quickClose) quickClose.addEventListener("click", closeQuickMenu);
  if (quickBackdrop) quickBackdrop.addEventListener("click", closeQuickMenu);

  // Event: QR Modal
  const qrBtn = document.getElementById("qr-btn");
  const qrModal = document.getElementById("qr-modal");

  if (qrBtn && qrModal) {
    qrBtn.addEventListener("click", () => {
      qrModal.classList.add("open");
    });
    qrModal.addEventListener("click", (e) => {
      // 배경 클릭 시 닫기 (이미지 클릭 시 닫히지 않게 하려면 e.target check 필요하지만, 
      // 요청사항이 "다른 영역(배경)을 누르면 사라지게" 이므로 이미지 제외 처리가 정석.
      // 그러나 간단한 UX를 위해 전체 닫기도 허용하거나, 이미지 클릭 제외 로직 추가.
      if (e.target === qrModal) {
        qrModal.classList.remove("open");
      }
    });
  }

  // Event: album & track play buttons
  document.addEventListener("click", e => {
    const btn = e.target.closest(".yt-album-play, .yt-play");
    if (!btn) return;

    const isExpanded = btn.getAttribute("aria-expanded") === "true";
    closeAllPlayers();

    if (isExpanded) {
      btn.setAttribute("aria-expanded", "false");
      if (btn.classList.contains("yt-album-play")) btn.textContent = "Play Album";
      else btn.textContent = "Play";
      return;
    }

    btn.setAttribute("aria-expanded", "true");

    if (btn.classList.contains("yt-album-play")) {
      const albumId = btn.getAttribute("data-album");
      const plId = btn.getAttribute("data-ytpl");
      if (!plId) return;

      btn.textContent = "Playing";
      const albumEl = document.getElementById(albumId);
      if (albumEl) albumEl.classList.add("playing");

      const playerDiv = document.createElement("div");
      playerDiv.className = "album-player";
      playerDiv.innerHTML = `
        <div class="player-inner">
          <iframe src="https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(plId)}&autoplay=0" 
                  frameborder="0" allow="autoplay; encrypted-media" allowfullscreen 
                  title="Album playlist player"></iframe>
          <div class="player-actions">
            <button class="tbtn close-player">Close Player</button>
          </div>
        </div>
      `;
      btn.closest(".album").querySelector(".tracklist")?.before(playerDiv);
      playerDiv.querySelector(".close-player")?.addEventListener("click", closeAllPlayers);

    } else if (btn.classList.contains("yt-play")) {
      const trackId = btn.getAttribute("data-track");
      const ytId = btn.getAttribute("data-ytid");
      if (!ytId) return;

      btn.textContent = "Playing";
      const trackEl = document.getElementById(trackId);
      if (trackEl) trackEl.classList.add("playing");

      const playerDiv = document.createElement("div");
      playerDiv.className = "track-player";
      playerDiv.innerHTML = `
        <div class="player-inner">
          <iframe src="https://www.youtube.com/embed/${encodeURIComponent(ytId)}?autoplay=0" 
                  frameborder="0" allow="autoplay; encrypted-media" allowfullscreen 
                  title="Track player"></iframe>
          <div class="player-actions">
            <button class="tbtn close-player">Close Player</button>
          </div>
        </div>
      `;
      trackEl.after(playerDiv);
      playerDiv.querySelector(".close-player")?.addEventListener("click", closeAllPlayers);
    }
  });

  // Event: lyrics modal
  const lyricsModal = document.getElementById("lyrics-modal");
  const lyricsTitle = document.getElementById("lyrics-title");
  const lyricsBody = document.getElementById("lyrics-body");
  const lyricsClose = document.getElementById("lyrics-close");

  function openLyrics(albumId, trackNo) {
    const album = albums.find(x => x.id === albumId);
    const track = album?.tracks?.find(t => String(t.no) === String(trackNo));
    if (!track || !track.lyrics) return;

    const { main, sub } = splitTrackTitle(track.title);
    lyricsTitle.textContent = `${track.no}. ${main}${sub ? ` (${sub})` : ""}`;

    const ko = (track.lyrics.ko || "").trim();
    const en = (track.lyrics.en || "").trim();
    const cols = [];
    if (ko) cols.push(`<div class="lyrics-col"><h4>한국어</h4><pre>${escapeHtml(ko)}</pre></div>`);
    if (en) cols.push(`<div class="lyrics-col"><h4>English</h4><pre>${escapeHtml(en)}</pre></div>`);
    lyricsBody.innerHTML = cols.join("");
    lyricsBody.classList.toggle("single", cols.length === 1);
    lyricsBody.scrollTop = 0;

    lyricsModal.classList.add("open");
  }

  function closeLyrics() {
    lyricsModal?.classList.remove("open");
  }

  document.addEventListener("click", e => {
    const btn = e.target.closest(".lyrics-btn");
    if (btn) {
      openLyrics(btn.getAttribute("data-album"), btn.getAttribute("data-no"));
    }
  });
  if (lyricsClose) lyricsClose.addEventListener("click", closeLyrics);
  if (lyricsModal) {
    lyricsModal.addEventListener("click", e => {
      if (e.target === lyricsModal) closeLyrics();
    });
  }

  // ESC 키로 플레이어/가사 닫기
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closeAllPlayers();
      closeLyrics();
    }
  });

  // Floating Top Button Logic
  const topBtn = document.getElementById("btn-back-to-top");
  if (topBtn) {
    window.addEventListener("scroll", () => {
      if (window.pageYOffset > 500) {
        topBtn.classList.add("show");
      } else {
        topBtn.classList.remove("show");
      }
    }, { passive: true });

    topBtn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // Hash navigation on load
  if (window.location.hash) {
    setTimeout(() => scrollToId(window.location.hash.slice(1)), 500); // 딜레이 약간 늘림 (데이터 로딩 고려)
  }
}

main().catch(err => console.error("Error loading discography:", err));
