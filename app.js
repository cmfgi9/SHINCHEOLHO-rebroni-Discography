/* Discography (albums.json split) + per-track links + album playlist player + icon buttons
   - Track buttons: Spotify / Apple (external), YouTube (embedded player)
   - Album "Play Album" uses youtube_album playlist link (embed videoseries)
   - UX: playing track highlight, single open player at a time
*/

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function scrollToIdWithOffset(id){
  const el = document.getElementById(id);
  if (!el) return;
  const topNav = document.getElementById("top-nav");
  const offset = (topNav ? topNav.getBoundingClientRect().height : 0) + 12;
  const y = el.getBoundingClientRect().top + window.pageYOffset - offset;
  window.scrollTo({top:y, behavior:"smooth"});
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
    b.classList.remove("is-playing");
  });

  document.querySelectorAll(".yt-album-play").forEach(b => {
    b.setAttribute("aria-expanded","false");
    b.classList.remove("is-playing");
  });

  document.querySelectorAll(".track.playing").forEach(t => t.classList.remove("playing"));
  document.querySelectorAll(".album.playing").forEach(a => a.classList.remove("playing"));
}

function iconSvg(name){
  // Minimal, clean inline SVG icons (no external assets)
  if (name === "spotify"){
    return `<svg viewBox="0 0 24 24" aria-hidden="true" class="ico"><path d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2Zm4.58 14.45a.8.8 0 0 1-1.1.26c-3.02-1.85-6.82-2.26-11.3-1.21a.8.8 0 0 1-.37-1.55c4.9-1.15 9.12-.67 12.5 1.4.38.23.5.72.27 1.1Zm1.22-2.71a1 1 0 0 1-1.38.33c-3.46-2.13-8.73-2.75-12.82-1.5a1 1 0 0 1-.56-1.92c4.68-1.37 10.5-.68 14.45 1.73.47.29.62.91.33 1.36Zm.11-2.9C14.21 8.61 8.2 8.4 4.73 9.44a1.2 1.2 0 1 1-.7-2.29c3.98-1.21 10.59-.98 14.94 1.6a1.2 1.2 0 0 1-1.06 2.08Z"/></svg>`;
  }
  if (name === "apple"){
    return `<svg viewBox="0 0 24 24" aria-hidden="true" class="ico"><path d="M16.7 13.3c0-2 1.7-3 1.8-3-1-1.5-2.6-1.7-3.2-1.7-1.3-.1-2.6.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.4 0-2.8.8-3.5 2-1.5 2.5-.4 6.1 1 8.1.7 1 1.5 2 2.6 2 .9 0 1.3-.3 2.4-.8 1.1-.5 1.4-.8 2.6-.8 1.2 0 1.5.8 3 .8 1.1 0 1.8-1 2.4-2 .7-1 .9-2 1-2.1-.1 0-2-.8-2-3.5ZM14.9 6.8c.5-.6.8-1.4.7-2.2-.7.1-1.6.5-2.1 1.1-.5.6-.9 1.4-.7 2.2.8.1 1.6-.4 2.1-1.1Z"/></svg>`;
  }
  if (name === "youtube"){
    return `<svg viewBox="0 0 24 24" aria-hidden="true" class="ico"><path d="M21.6 7.2a2.7 2.7 0 0 0-1.9-1.9C18 5 12 5 12 5s-6 0-7.7.3A2.7 2.7 0 0 0 2.4 7.2 28.3 28.3 0 0 0 2 12c0 1.3.1 3 .4 4.8a2.7 2.7 0 0 0 1.9 1.9C6 19 12 19 12 19s6 0 7.7-.3a2.7 2.7 0 0 0 1.9-1.9c.3-1.8.4-3.5.4-4.8 0-1.3-.1-3-.4-4.8ZM10 15.5v-7l6 3.5-6 3.5Z"/></svg>`;
  }
  if (name === "play"){
    return `<svg viewBox="0 0 24 24" aria-hidden="true" class="ico"><path d="M8 5v14l11-7-11-7Z"/></svg>`;
  }
  return "";
}

function btnLabel(text){
  return `<span class="lbl">${escapeHtml(text)}</span>`;
}

function makeLinkBtn({href, kind, label}){
  if (!href) return "";
  const cls = `tbtn tbtn-${kind}`;
  const aria = escapeHtml(label);
  return `<a class="${cls}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="${aria}">
    ${iconSvg(kind)}${btnLabel(label)}
  </a>`;
}

function makeActionBtn({kind, label, dataAttr, dataVal, extraClass}){
  const cls = `tbtn tbtn-${kind} ${extraClass || ""}`.trim();
  return `<button class="${cls}" type="button" ${dataAttr}="${escapeHtml(dataVal)}" aria-label="${escapeHtml(label)}" aria-expanded="false">
    ${iconSvg(kind)}${btnLabel(label)}
  </button>`;
}

async function main(){
  const res = await fetch("albums.json", {cache:"no-store"});
  if (!res.ok) throw new Error("Failed to load albums.json");
  const albums = await res.json();

  const nav = document.getElementById("album-nav");
  const albumsEl = document.getElementById("albums");
  const search = document.getElementById("search");

  const quickBtn = document.getElementById("quick-menu-btn");
  const quickMenu = document.getElementById("quick-menu");
  const quickClose = document.getElementById("quick-menu-close");
  const quickLinks = document.getElementById("quick-menu-links");
  const quickBackdrop = document.getElementById("quick-menu-backdrop");

  // Fixed top nav: ensure body padding matches its height
  function syncTopNavHeight(){
    const topNav = document.getElementById("top-nav");
    if (!topNav) return;
    const h = Math.ceil(topNav.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--topnav-h", h + "px");
  }
  window.addEventListener("resize", syncTopNavHeight);
  window.addEventListener("load", syncTopNavHeight);

  function renderNav(){
    if (!nav) return;
    nav.innerHTML = albums.map(a => {
      const label = (a.ordinal || "").replace(" Album","");
      return `<button class="navlink" type="button" data-target="${escapeHtml(a.id)}" aria-label="Go to ${escapeHtml(a.ordinal)}">${escapeHtml(label)}</button>`;
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

      const linksHtml = `<div class="links">
        ${makeLinkBtn({href: links.spotify_album, kind:"spotify", label:"Spotify"})}
        ${makeLinkBtn({href: links.apple_album, kind:"apple", label:"Apple Music"})}
        ${makeLinkBtn({href: links.youtube_album, kind:"youtube", label:"YouTube"})}
        ${plId ? makeActionBtn({kind:"play", label:"Play Album", dataAttr:'data-plid', dataVal:plId, extraClass:"yt-album-play"}) : ""}
      </div>`;

      const tracks = (a.tracks || []).map(t => {
        const title = t.title || "";
        const isrc = t.isrc || "";
        const tlinks = (t.links || {});
        const ytId = getYouTubeId(tlinks.youtube);

        const spotifyBtn = makeLinkBtn({href:tlinks.spotify, kind:"spotify", label:"Spotify"});
        const appleBtn = makeLinkBtn({href:tlinks.apple, kind:"apple", label:"Apple"});
        const ytBtn = ytId
          ? makeActionBtn({kind:"play", label:"Play", dataAttr:'data-ytid', dataVal:ytId, extraClass:"yt-play"})
          : (tlinks.youtube ? makeLinkBtn({href:tlinks.youtube, kind:"youtube", label:"YouTube"}) : "");

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

  function bindNavClicks(){
    if (!nav) return;
    nav.addEventListener("click", (e) => {
      const b = e.target.closest("button.navlink");
      if (!b) return;
      const id = b.dataset.target;
      scrollToIdWithOffset(id);
      history.replaceState(null, "", `#${id}`);
    });
  }

  function setupScrollSpy(){
    const links = Array.from(document.querySelectorAll(".navlink"));
    const byId = new Map(links.map(b => [b.dataset.target, b]));
    if (!links.length) return;

    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter(e => e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
      if (!visible) return;
      links.forEach(l => l.classList.remove("active"));
      const link = byId.get(visible.target.id);
      if (link) link.classList.add("active");
    }, {threshold:[0.3,0.45,0.6]});

    document.querySelectorAll(".album").forEach(sec => observer.observe(sec));
  }

  // Quick menu (drawer)
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
      scrollToIdWithOffset(id);
      history.replaceState(null, "", `#${id}`);
    });
  }

  function bindAlbumPlayers(){
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("button.yt-album-play");
      if (!btn) return;

      const album = btn.closest(".album");
      const plId = btn.getAttribute("data-plid");
      if (!album || !plId) return;

      const existing = album.querySelector(".album-player");
      if (existing){
        existing.remove();
        btn.setAttribute("aria-expanded","false");
        btn.classList.remove("is-playing");
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
            <a class="tbtn tbtn-youtube" target="_blank" rel="noopener noreferrer" href="https://www.youtube.com/playlist?list=${escapeHtml(plId)}" aria-label="Open playlist on YouTube">
              ${iconSvg("youtube")}${btnLabel("Open")}
            </a>
            <button class="tbtn tbtn-ghost" type="button" data-close="1" aria-label="Close player">Close</button>
          </div>
        </div>
      `;

      if (linksEl && linksEl.parentElement){
        linksEl.insertAdjacentElement("afterend", player);
      }else{
        album.appendChild(player);
      }

      btn.setAttribute("aria-expanded","true");
      btn.classList.add("is-playing");
      album.classList.add("playing");

      player.addEventListener("click", (ev)=>{
        const c = ev.target.closest("button[data-close]");
        if (!c) return;
        player.remove();
        btn.setAttribute("aria-expanded","false");
        btn.classList.remove("is-playing");
        album.classList.remove("playing");
      });
    });
  }

  function bindTrackPlayers(){
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("button.yt-play");
      if (!btn) return;

      const track = btn.closest(".track");
      const ytId = btn.getAttribute("data-ytid");
      if (!track || !ytId) return;

      const already = track.nextElementSibling && track.nextElementSibling.classList.contains("track-player");
      if (already){
        track.nextElementSibling.remove();
        btn.setAttribute("aria-expanded","false");
        btn.classList.remove("is-playing");
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
            <a class="tbtn tbtn-youtube" target="_blank" rel="noopener noreferrer" href="https://www.youtube.com/watch?v=${escapeHtml(ytId)}" aria-label="Open on YouTube">
              ${iconSvg("youtube")}${btnLabel("Open")}
            </a>
            <button class="tbtn tbtn-ghost" type="button" data-close="1" aria-label="Close player">Close</button>
          </div>
        </div>
      `;

      track.insertAdjacentElement("afterend", player);
      btn.setAttribute("aria-expanded","true");
      btn.classList.add("is-playing");
      track.classList.add("playing");

      player.addEventListener("click", (ev)=>{
        const c = ev.target.closest("button[data-close]");
        if (!c) return;
        player.remove();
        btn.setAttribute("aria-expanded","false");
        btn.classList.remove("is-playing");
        track.classList.remove("playing");
      });
    });
  }

  renderNav();
  renderAlbums();
  bindNavClicks();
  setupScrollSpy();
  bindQuick();
  renderQuickLinks();
  bindAlbumPlayers();
  bindTrackPlayers();

  syncTopNavHeight();
  if (search) search.addEventListener("input", ()=>applySearch(search.value));
  applySearch("");
}

main().catch(err => {
  console.error(err);
  const el = document.getElementById("albums");
  if (el) el.innerHTML = `<div style="max-width:900px;margin:24px auto;padding:16px;border:1px solid #444;border-radius:12px;">
    <b>Failed to load albums.json</b><br/>
    If you opened this via <code>file://</code>, run a local server (e.g. <code>python -m http.server</code>) and open <code>http://localhost:8000</code>.
  </div>`;
});
