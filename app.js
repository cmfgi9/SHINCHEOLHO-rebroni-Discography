/* Discography (albums.json split) + per-track links + album playlist player
   - Sticky top nav with active album highlight
   - Quick menu drawer (Albums button) for full album list
*/


function updateStickyBarHeight(){
  const bar = document.getElementById("stickybar");
  if (!bar) return;
  // Set a CSS variable used for body padding-top so fixed nav doesn't cover content
  const h = Math.ceil(bar.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--stickybar-h", h + "px");
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
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
      return `<a class="navlink" href="#${escapeHtml(a.id)}" data-target="${escapeHtml(a.id)}">${escapeHtml(label)}</a>`;
    }).join("");
  }

  function renderAlbums(){
    if (!albumsEl) return;
    albumsEl.innerHTML = albums.map(a => {
      const metaParts = [];
      if (a.upload) metaParts.push(`Upload: ${escapeHtml(a.upload)}`);
      if (a.preorder) metaParts.push(`Preorder: ${escapeHtml(a.preorder)}`);
      if (a.label) metaParts.push(`Label: ${escapeHtml(a.label)}`);
      if (a.release) metaParts.push(`Release: ${escapeHtml(a.release)}`);
      if (a.upc) metaParts.push(`UPC: ${escapeHtml(a.upc)}`);

      const coverHtml = a.cover ? `<img class="cover" src="${escapeHtml(a.cover)}" alt="${escapeHtml(a.title)} album cover" loading="lazy">` : "";

      const links = a.links || {};
      const plId = getYouTubePlaylistId(links.youtube_album);
      const albumPlayBtn = plId
        ? `<button class="tbtn yt-album-play" type="button" data-plid="${escapeHtml(plId)}" aria-expanded="false">Play Album</button>`
        : "";

      const linksHtml = `<div class="links">
        ${links.spotify_album ? `<a class="tbtn" href="${escapeHtml(links.spotify_album)}" target="_blank" rel="noopener noreferrer">Spotify</a>` : ""}
        ${links.apple_album ? `<a class="tbtn" href="${escapeHtml(links.apple_album)}" target="_blank" rel="noopener noreferrer">Apple Music</a>` : ""}
        ${links.youtube_album ? `<a class="tbtn" href="${escapeHtml(links.youtube_album)}" target="_blank" rel="noopener noreferrer">YouTube</a>` : ""}
        ${albumPlayBtn}
      </div>`;

      const tracks = (a.tracks || []).map(t => {
        const title = t.title || "";
        const isrc = t.isrc || "";
        const tlinks = (t.links || {});
        const ytId = getYouTubeId(tlinks.youtube);

        const spotifyBtn = tlinks.spotify ? `<a class="tbtn" href="${escapeHtml(tlinks.spotify)}" target="_blank" rel="noopener noreferrer">Spotify</a>` : "";
        const appleBtn = tlinks.apple ? `<a class="tbtn" href="${escapeHtml(tlinks.apple)}" target="_blank" rel="noopener noreferrer">Apple</a>` : "";
        const ytBtn = ytId
          ? `<button class="tbtn yt-play" type="button" data-ytid="${escapeHtml(ytId)}" aria-expanded="false">Play</button>`
          : (tlinks.youtube ? `<a class="tbtn" href="${escapeHtml(tlinks.youtube)}" target="_blank" rel="noopener noreferrer">YouTube</a>` : "");

        return `<div class="track" data-title="${escapeHtml(title)}" data-isrc="${escapeHtml(isrc)}">
          <div class="no">${escapeHtml(t.no ?? "")}</div>
          <div class="title">${escapeHtml(title)}</div>
          <div class="isrc">${escapeHtml(isrc)}</div>
          <div class="track-links">${spotifyBtn}${appleBtn}${ytBtn}</div>
        </div>`;
      }).join("");

      return `<section class="album" id="${escapeHtml(a.id)}">
        <div class="album-grid">
          <div>${coverHtml}</div>
          <div>
            <h2>${escapeHtml(a.title)}</h2>
            <div class="meta">${metaParts.join(" · ")}</div>
            ${linksHtml}
            <div class="tracks">${tracks}</div>
          </div>
        </div>
      </section>`;
    }).join("");
  }

  function applySearch(qRaw){
    const q = (qRaw || "").trim().toLowerCase();
    const trackEls = Array.from(document.querySelectorAll(".track"));
    const albumEls = Array.from(document.querySelectorAll(".album"));

    closeAllPlayers();

    if (!q){
      trackEls.forEach(el => el.style.display = "");
      albumEls.forEach(el => el.style.display = "");
      return;
    }

    trackEls.forEach(el => {
      const hay = ((el.dataset.title||"") + " " + (el.dataset.isrc||"")).toLowerCase();
      el.style.display = hay.includes(q) ? "" : "none";
    });

    albumEls.forEach(album => {
      const visible = album.querySelectorAll(".track:not([style*='display: none'])").length > 0;
      album.style.display = visible ? "" : "none";
    });
  }

  function setActiveAlbum(id){
    document.querySelectorAll(".navlink").forEach(l => l.classList.toggle("active", l.dataset.target === id));
    if (quickLinks){
      quickLinks.querySelectorAll("a[data-target]").forEach(l => l.classList.toggle("active", l.dataset.target === id));
    }

  function scrollNavToLink(link){
    if (!link || !nav) return;
    // Horizontal-only scrolling to avoid snapping the whole page back to top (sticky nav on GitHub Pages)
    const left = link.offsetLeft - (nav.clientWidth / 2) + (link.offsetWidth / 2);
    nav.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }
  }

  function bindNavClicks(){
    if (!nav) return;
    nav.addEventListener("click", (e) => {
      const a = e.target.closest("a.navlink");
      if (!a) return;
      e.preventDefault();
      const id = a.dataset.target;
      scrollToId(id);
            scrollNavToLink(a);
      history.replaceState(null, "", `#${id}`);
      setActiveAlbum(id);
    });
  }

  function setupScrollSpy(){
    const links = Array.from(document.querySelectorAll(".navlink"));
    const byId = new Map(links.map(a => [a.dataset.target, a]));
    if (!links.length) return;

    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter(e => e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
      if (!visible) return;
      setActiveAlbum(visible.target.id);
      const link = byId.get(visible.target.id);
            if (link) scrollNavToLink(link);
    }, {threshold:[0.25,0.4,0.55]});

    document.querySelectorAll(".album").forEach(sec => observer.observe(sec));
  }

  // Quick menu
  function openQuick(){
    if (!quickMenu || !quickBackdrop) return;
    quickMenu.classList.add("open");
    quickBackdrop.classList.add("open");
    quickMenu.setAttribute("aria-hidden","false");
    quickBackdrop.setAttribute("aria-hidden","false");
  }
  function closeQuick(){
    if (!quickMenu || !quickBackdrop) return;
    quickMenu.classList.remove("open");
    quickBackdrop.classList.remove("open");
    quickMenu.setAttribute("aria-hidden","true");
    quickBackdrop.setAttribute("aria-hidden","true");
  }

  function renderQuickLinks(){
    if (!quickLinks) return;
    quickLinks.innerHTML = albums.map(a => {
      return `<a href="#${escapeHtml(a.id)}" data-target="${escapeHtml(a.id)}">${escapeHtml(a.ordinal)} · ${escapeHtml(a.title)}</a>`;
    }).join("");
  }

  function bindQuick(){
    if (!quickBtn || !quickClose || !quickBackdrop || !quickLinks) return;
    quickBtn.addEventListener("click", openQuick);
    quickClose.addEventListener("click", closeQuick);
    quickBackdrop.addEventListener("click", closeQuick);
    document.addEventListener("keydown", (e)=>{ if(e.key==="Escape") closeQuick(); });

    quickLinks.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-target]");
      if (!a) return;
      e.preventDefault();
      const id = a.dataset.target;
      closeQuick();
      scrollToId(id);
      history.replaceState(null, "", `#${id}`);
      setActiveAlbum(id);
    });
  }

  // Album playlist player
  function bindAlbumPlayers(){
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("button.yt-album-play");
      if (!btn) return;

      const album = btn.closest(".album");
      const plId = btn.dataset.plid;
      if (!album || !plId) return;

      const existing = album.querySelector(".album-player");
      if (existing){
        existing.remove();
        btn.setAttribute("aria-expanded","false");
        btn.textContent = "Play Album";
        album.classList.remove("playing");
        return;
      }

      closeAllPlayers();

      const linksEl = album.querySelector(".links");
      const player = document.createElement("div");
      player.className = "album-player";
      player.innerHTML = `
        <div class="player-inner">
          <iframe
            src="https://www.youtube.com/embed/videoseries?list=${escapeHtml(plId)}&autoplay=1&rel=0"
            title="YouTube album playlist"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen></iframe>
          <div class="player-actions">
            <a class="tbtn" target="_blank" rel="noopener noreferrer" href="https://www.youtube.com/playlist?list=${escapeHtml(plId)}">Open playlist on YouTube</a>
            <button class="tbtn tbtn-secondary" type="button" data-close="1">Close</button>
          </div>
        </div>
      `;

      if (linksEl && linksEl.parentElement){
        linksEl.insertAdjacentElement("afterend", player);
      }else{
        album.appendChild(player);
      }

      btn.setAttribute("aria-expanded","true");
      btn.textContent = "Playing Album";
      album.classList.add("playing");

      player.addEventListener("click", (ev)=>{
        const c = ev.target.closest("button[data-close]");
        if (!c) return;
        player.remove();
        btn.setAttribute("aria-expanded","false");
        btn.textContent = "Play Album";
        album.classList.remove("playing");
      });
    });
  }

  // Track YouTube player
  function bindTrackPlayers(){
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("button.yt-play");
      if (!btn) return;

      const track = btn.closest(".track");
      const ytId = btn.dataset.ytid;
      if (!track || !ytId) return;

      const already = track.nextElementSibling && track.nextElementSibling.classList.contains("track-player");
      if (already){
        track.nextElementSibling.remove();
        btn.setAttribute("aria-expanded","false");
        btn.textContent = "Play";
        track.classList.remove("playing");
        return;
      }

      closeAllPlayers();

      const player = document.createElement("div");
      player.className = "track-player";
      player.innerHTML = `
        <div class="player-inner">
          <iframe
            src="https://www.youtube.com/embed/${escapeHtml(ytId)}?autoplay=1&rel=0"
            title="YouTube player"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen></iframe>
          <div class="player-actions">
            <a class="tbtn" target="_blank" rel="noopener noreferrer" href="https://www.youtube.com/watch?v=${escapeHtml(ytId)}">Open on YouTube</a>
            <button class="tbtn tbtn-secondary" type="button" data-close="1">Close</button>
          </div>
        </div>
      `;

      track.insertAdjacentElement("afterend", player);
      btn.setAttribute("aria-expanded","true");
      btn.textContent = "Playing";
      track.classList.add("playing");

      player.addEventListener("click", (ev)=>{
        const c = ev.target.closest("button[data-close]");
        if (!c) return;
        player.remove();
        btn.setAttribute("aria-expanded","false");
        btn.textContent = "Play";
        track.classList.remove("playing");
      });
    });
  }

  renderNav();
  renderAlbums();
  // In case fonts wrap on load
  updateStickyBarHeight();
  renderQuickLinks();

  bindNavClicks();
  setupScrollSpy();
  bindQuick();

  bindAlbumPlayers();
  bindTrackPlayers();

  if (search) search.addEventListener("input", ()=>applySearch(search.value));
  applySearch("");

  // If opened with a hash, align correctly with sticky offset
  const hash = (location.hash || "").replace("#","");
  if (hash){
    setTimeout(()=>scrollToId(hash), 50);
    setActiveAlbum(hash);
  }else if (albums[0]?.id){
    setActiveAlbum(albums[0].id);
  }
}

main().catch(err => {
  console.error(err);
  const el = document.getElementById("albums");
  if (el) el.innerHTML = `<div style="max-width:900px;margin:24px auto;padding:16px;border:1px solid #444;border-radius:12px;">
    <b>Failed to load albums.json</b><br/>
    If you opened this via <code>file://</code>, run a local server (e.g. <code>python -m http.server</code>) and open <code>http://localhost:8000</code>.
  </div>`;
});
