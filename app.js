/* Discography site with improved layout & 2-line track structure */

function updateStickyBarHeight(){
  const bar = document.getElementById("stickybar");
  if (!bar) return;
  const h = Math.ceil(bar.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--stickybar-h", h + "px");
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

function getStickyOffset(){
  const bar = document.getElementById("stickybar");
  if (!bar) return 10;
  return Math.ceil(bar.getBoundingClientRect().height) + 10;
}

function scrollToId(id){
  const el = document.getElementById(id);
  if (!el) return;
  const y = el.getBoundingClientRect().top + window.pageYOffset - getStickyOffset();
  window.scrollTo({top: Math.max(0, y), behavior:"smooth"});
}

function getYouTubeId(url){
  if (!url) return null;
  try{
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")){
      const id = u.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/\/embed\/([^\/\?]+)/);
    if (m) return m[1];
    return null;
  }catch(e){
    const m = String(url).match(/[?&]v=([^&]+)/);
    return m ? m[1] : null;
  }
}

function getYouTubePlaylistId(url){
  if (!url) return null;
  try{
    const u = new URL(url);
    const list = u.searchParams.get("list");
    return list || null;
  }catch(e){
    const m = String(url).match(/[?&]list=([^&]+)/);
    return m ? m[1] : null;
  }
}

function closeAllPlayers(){
  document.querySelectorAll(".track-player, .album-player").forEach(p => p.remove());
  document.querySelectorAll(".yt-play").forEach(b => {
    b.setAttribute("aria-expanded","false");
    b.textContent = "Play";
  });
  document.querySelectorAll(".yt-album-play").forEach(b => {
    b.setAttribute("aria-expanded","false");
    b.textContent = "Play Album";
  });
  document.querySelectorAll(".track.playing").forEach(t => t.classList.remove("playing"));
  document.querySelectorAll(".album.playing").forEach(a => a.classList.remove("playing"));
}

// 트랙 제목을 메인/서브로 분리하는 헬퍼 (괄호 기준)
function splitTrackTitle(title){
  const m = title.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (m) return { main: m[1].trim(), sub: m[2].trim() };
  return { main: title.trim(), sub: "" };
}

async function main(){
  const res = await fetch("albums.json", {cache:"no-store"});
  if (!res.ok) throw new Error("Failed to load albums.json");
  const albums = await res.json();

  updateStickyBarHeight();
  window.addEventListener('resize', () => {
    updateStickyBarHeight();
  });

  const nav = document.getElementById("album-nav");
  const albumsEl = document.getElementById("albums");
  const search = document.getElementById("search");
  const quickBtn = document.getElementById("quick-menu-btn");
  const quickMenu = document.getElementById("quick-menu");
  const quickClose = document.getElementById("quick-menu-close");
  const quickLinks = document.getElementById("quick-menu-links");
  const quickBackdrop = document.getElementById("quick-menu-backdrop");

  function renderNav(){
    if (!nav) return;
    nav.innerHTML = albums.map(a => {
      const label = (a.ordinal || "").replace(" Album","");
      return `<a href="#${a.id}" data-album="${a.id}">${escapeHtml(label)}</a>`;
    }).join("");
  }

  function renderAlbums(){
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
        ? `<img src="${escapeHtml(a.cover)}" alt="${escapeHtml(a.title)} cover" class="cover">`
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

      // 앨범 콘셉트 한 줄 (예시: 각 앨범의 concept 필드를 albums.json에 추가하거나, 하드코딩)
      // 여기서는 각 앨범별 간단 설명을 하드코딩 예시
      const conceptMap = {
        "a7": "AI(AGI/ASI)와 인간의 공존, 존재의 사유, 우주, 화성개척, 공감하는 의식을 테마로 한 일렉트로닉·앰비언트 서사 앨범",
        "a6": "따뜻하고 평화로운 연말 분위기의 재즈·로파이 크리스마스 앨범",
        "a5": "City&Human 컨셉의 K-POP·로파이·힙합 비트 앨범",
        "a4": "불교 철학과 자기 성찰을 다룬 Offline Dharma 명상·앰비언트 앨범",
        "a3": "우주·평화·공존의 메시지를 담은 데뷔 앨범 Space·Earth·Existence",
        "a2": "바다·숲·기후와 같은 지구 환경 위기에 행동하고 보호하자는 메시지를 담은 신스·팝 앨범 SAVE the EARTH",
        "a1": "나와 너, 도시와 자연의 대비를 담은 City&Nature 시리즈"
      };
      const concept = conceptMap[a.id] || "";
      const conceptHtml = concept ? `<p class="album-concept">${escapeHtml(concept)}</p>` : "";

      const tracksHtml = (a.tracks || []).map(t => {
        const { main, sub } = splitTrackTitle(t.title);
        const tLinks = t.links || {};
        const ytId = getYouTubeId(tLinks.youtube);
        const playBtn = ytId
          ? `<button class="tbtn tbtn-secondary yt-play" data-track="${a.id}-${t.no}" data-ytid="${escapeHtml(ytId)}" aria-expanded="false">Play</button>`
          : "";

        return `
          <div class="track" id="${a.id}-${t.no}">
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

  function renderQuickLinks(){
    if (!quickLinks) return;
    quickLinks.innerHTML = albums.map(a => {
      return `<a href="#${a.id}" data-album="${a.id}">${escapeHtml(a.ordinal)}: ${escapeHtml(a.title)}</a>`;
    }).join("");
  }

  function updateActiveAlbum(){
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

  function filterAlbums(){
    const q = (search?.value || "").toLowerCase().trim();
    document.querySelectorAll(".album").forEach(albumEl => {
      const text = albumEl.textContent.toLowerCase();
      albumEl.style.display = text.includes(q) ? "" : "none";
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
  function openQuickMenu(){
    if (quickMenu && quickBackdrop) {
      quickMenu.classList.add("open");
      quickBackdrop.classList.add("open");
      quickMenu.setAttribute("aria-hidden","false");
    }
  }
  function closeQuickMenu(){
    if (quickMenu && quickBackdrop) {
      quickMenu.classList.remove("open");
      quickBackdrop.classList.remove("open");
      quickMenu.setAttribute("aria-hidden","true");
    }
  }
  if (quickBtn) quickBtn.addEventListener("click", openQuickMenu);
  if (quickClose) quickClose.addEventListener("click", closeQuickMenu);
  if (quickBackdrop) quickBackdrop.addEventListener("click", closeQuickMenu);

  // Event: album & track play buttons
  document.addEventListener("click", e => {
    const btn = e.target.closest(".yt-album-play, .yt-play");
    if (!btn) return;

    const isExpanded = btn.getAttribute("aria-expanded") === "true";
    closeAllPlayers();

    if (isExpanded) {
      btn.setAttribute("aria-expanded","false");
      if (btn.classList.contains("yt-album-play")) btn.textContent = "Play Album";
      else btn.textContent = "Play";
      return;
    }

    btn.setAttribute("aria-expanded","true");

    if (btn.classList.contains("yt-album-play")){
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
          <iframe src="https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(plId)}&autoplay=1" 
                  frameborder="0" allow="autoplay; encrypted-media" allowfullscreen 
                  title="Album playlist player"></iframe>
          <div class="player-actions">
            <button class="tbtn close-player">Close Player</button>
          </div>
        </div>
      `;
      btn.closest(".album").querySelector(".tracklist")?.before(playerDiv);
      playerDiv.querySelector(".close-player")?.addEventListener("click", closeAllPlayers);

    } else if (btn.classList.contains("yt-play")){
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
          <iframe src="https://www.youtube.com/embed/${encodeURIComponent(ytId)}?autoplay=1" 
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

  // Hash navigation on load
  if (window.location.hash) {
    setTimeout(() => scrollToId(window.location.hash.slice(1)), 100);
  }
}

main().catch(err => console.error("Error loading discography:", err));
