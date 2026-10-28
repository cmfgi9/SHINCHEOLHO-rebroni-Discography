// 앱 셸 캐시 — 파일 수정 배포 시 VERSION과 SHELL의 ?v= 를 함께 올려주세요
// 자연의 소리·벨·생성형 음악은 브라우저에서 합성하므로 셸만 캐시되면 오프라인에서도 동작한다.
// (앨범 음원·스템·가이드 음성 오프라인 저장은 2단계에서 추가 예정)
const VERSION = "meditate-v5";
const SHELL = [
  "./", "index.html", "meditate.css?v=3", "meditate.js?v=3", "audio-engine.js?v=3", "music.js?v=3",
  "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png",
  "../data-service.js", "../firebase-config.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("meditate-") && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 네트워크 우선, 오프라인이면 캐시. 음원(/media/)·Range 요청은 건드리지 않음
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || e.request.headers.has("range") || url.pathname.startsWith("/media/")) return;
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
