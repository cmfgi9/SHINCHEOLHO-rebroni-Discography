// 온라인 법당 앱 셸 캐시 — 파일 수정 배포 시 VERSION과 SHELL의 ?v= 를 함께 올려주세요
// 캐시 저장소는 사이트 전체가 공유하므로 자기 접두어(temple-) 캐시만 지운다.
// 실시간 접속(Firebase)·음원(/media/)·Range 요청은 건드리지 않는다. 오프라인이면 혼자 모드로 동작한다.
const VERSION = "temple-v1";
const SHELL = [
  "./", "index.html", "temple.css?v=2", "temple.js?v=3", "world.js?v=2", "net.js?v=1", "practice.js?v=1", "content.js?v=1",
  "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png",
  "../meditate/audio-engine.js?v=3", "../meditate/music.js?v=3", "../data-service.js", "../firebase-config.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("temple-") && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 네트워크 우선, 오프라인이면 캐시
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || e.request.headers.has("range") || url.pathname.startsWith("/media/") || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});
