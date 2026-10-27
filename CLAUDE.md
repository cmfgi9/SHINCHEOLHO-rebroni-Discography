# CLAUDE.md

SHINCHEOLHO-rebroni(Rebroni Music)의 공식 디스코그래피 사이트. 운영 주소: https://music.rebroni.com

## 스택

- 빌드 도구 없는 정적 사이트: HTML + CSS + 바닐라 JS. `package.json`/번들러 없음.
- 호스팅: **Cloudflare Pages** (프로젝트 `shincheolho-rebroni-discography`, 기본 주소 `shincheolho-rebroni-discography.pages.dev`)
  — `main`에 push하면 자동 배포. `functions/`는 Pages Functions로 함께 배포됨.
  저장소 루트 전체가 그대로 배포되므로 `CLAUDE.md`·`*.rules` 등 모든 파일이 공개 URL로 열린다.
  Workers 배포는 쓰지 않는다 (예전에 자동 생성됐던 Worker와 `wrangler.jsonc`는 삭제함 — 다시 추가하지 말 것).
- 음원 파일: **Cloudflare R2** 버킷(Pages 바인딩 이름 `MEDIA`)이 연결돼 있으면 R2, 아니면 Firebase Storage (admin이 자동 판별).
  R2 파일은 Pages Function이 같은 도메인 `/media/…`로 제공(Range 지원). 바인딩은 Pages 프로젝트 설정이며 Workers 배포와 무관.
- 데이터/인증/파일: **Firebase** 프로젝트 `rebroni-music-web` (Firestore, Google 로그인, Storage).
  SDK는 `gstatic.com` CDN에서 동적 import하며 버전은 `10.12.2`로 고정.
- 영상/플레이어: YouTube IFrame API.
- 비주얼라이저·마스터링은 서버 없이 **브라우저 안에서만** 처리 (업로드 없음).

## 페이지와 기능

| 경로 | 기능 | 주요 파일 |
|---|---|---|
| `/` | 디스코그래피(앨범·트랙·가사·검색·테마), 뉴스레터 구독/해지, 방명록(Fan Wall) | `index.html`, `app.js`, `community.js` |
| `/` 하단 플레이어 | **전체 앨범 통합 Playlist** — 곡/앨범 선택, 이름 붙여 저장, 연속재생·셔플·반복·볼륨 | `playlist.js` |
| `/videos.html` | **Videos** — 유튜브 영상 갤러리(앨범곡/미발매곡/기타/Shorts 필터, 앨범·검색, 공유 링크 `#v=ID`, `?album=ID`) | `videos.html`, `videos.js` |
| `/journal.html` | **Journal(창작 노트)** — 공개 노트 타임라인, 태그 필터, 정렬, 노트별 링크 `#note-…` | `journal.html`, `journal.js` |
| `/privacy.html` | **개인정보 처리방침** (시행일·변경 이력 포함) | `privacy.html` |
| `/visualizer/` | **쇼츠 영상 제작 Visualizer** — 음원 + 9:16 배경(이미지/영상 슬라이드쇼) + 스펙트럼 → MP4 추출(1080p~4K). PWA | `visualizer/` |
| `/lofi/` | **Lofi Visualizer** — 음원 플레이리스트 + 16:9 배경(이미지/반복 영상) + Lofi 효과 → 1~3시간 유튜브용 MP4 **오프라인 렌더링**, 유튜브 챕터 생성 | `lofi/` |
| `/meditate/` | **Meditate(명상)** — 자연의 소리 믹서(브라우저 합성), 생성형 앰비언트·스템 재조합·앨범 음원, 명상/슬립 타이머·벨, 가이드 명상, 호흡 가이드, 야간 모드, 프리셋·공유 링크, 캘린더 알림. PWA | `meditate/` |
| `/mastering/` | **음원 Mastering** — 라우드니스(BS.1770/EBU R128)·트루피크 분석, 무드/레퍼런스 기반 자동 마스터링, A/B 비교, WAV·리포트 저장 | `mastering/` |
| `/admin.html` | 관리자: 앨범·트랙·가사·음원·커버, 창작 노트 편집기, 영상 관리, 방명록·구독자 관리 | `admin.html`, `admin.js` |
| `/api/tracks` | `audioUrl` 있는 곡 목록 JSON (CORS `*`, 외부 게임 등에서 사용) | `functions/api/tracks.js` |
| `/api/media` | R2 음원 업로드·삭제 (관리자 전용: Firebase ID 토큰 → Firestore `admins/{uid}` 읽기로 확인), `GET`은 R2 연결 여부 | `functions/api/media.js` |
| `/media/*` | R2 음원 제공 (`tracks/`, `meditate/`만, Range·CORS `*`) | `functions/media/[[path]].js` |

공용 모듈:
- `data-service.js` — 앨범 로딩: Firestore 우선 → 실패/빈 컬렉션이면 `albums.json` 폴백. `firebaseConfigReady()` 제공.
- `youtube.js` — 유튜브 주소 파싱(watch/youtu.be/shorts/live/embed), 썸네일·재생 URL, 라이트 플레이어. admin·videos·journal 공용.
- `journal-format.js` — 창작 노트 HTML **허용 목록 기반 정화(sanitize)** + 렌더링. admin 편집기와 공개 Journal 공용.
- `firebase-config.js` — 웹용 Firebase 설정(공개 키, 비밀 아님).

### Visualizer (`visualizer/`)
- 비모듈 IIFE 스크립트(`viz.js`). Web Audio `AnalyserNode` → 캔버스 합성 → `MediaRecorder` 녹화 →
  `vendor/mediabunny.min.mjs`로 MP4 길이 헤더 보정/재다중화. 2K/4K는 `VideoEncoder` 지원 여부를 확인.
- 설정은 localStorage `rebroni-visualizer-settings`.
- PWA: `sw.js`가 앱 셸을 캐시. **`viz.js`/`viz.css`를 고치면 `index.html`의 `?v=`, `sw.js`의 `SHELL` 목록 `?v=`, `VERSION`을 모두 올린다.**

### Lofi Visualizer (`lofi/`)
- 비모듈 IIFE 스크립트(`lofi.js`). 스타일은 `../visualizer/viz.css`를 공유하고 `lofi.css`로 덧붙임.
- **실시간 녹화가 아닌 오프라인 렌더링**: 곡마다 `OfflineAudioContext`로 48kHz 디코딩 → 직접 FFT(AnalyserNode와 같은 방식)로 스펙트럼 →
  프레임을 한 장씩 그려 `../visualizer/vendor/mediabunny.min.mjs`의 `CanvasSource`/`AudioBufferSource`로 인코딩.
  결과는 File System Access API(`showSaveFilePicker`) + `StreamTarget`으로 디스크에 바로 기록(메모리 사용 일정, 1~3시간 가능).
  `showSaveFilePicker`가 없는 브라우저(모바일·Safari·Firefox)는 메모리 버퍼로 **20분 이하만** 허용.
- 장면 요소(입자·LP 회전 등)는 시간 `t`만으로 결정되게 그린다(미리보기 = 결과). 상태를 프레임 간에 쌓는 효과를 넣지 말 것.
- 렌더링 속도: 매 프레임 화면 전체에 덧칠하는 작업이 가장 비싸다. 정지 배경은 색감·어둡게·비네팅·그레인(무늬 4종)을
  미리 합친 캐시를 프레임마다 돌려 쓰고, 글자 블록(그림자 포함)도 캐시한다. 새 효과를 넣을 때 전체 화면 패스를 늘리지 말 것.
- 배경 영상은 `CanvasSink.canvases()`로 순서대로 읽고 끝나면 다시 처음부터(반복). 디코딩 불가 코덱이면 첫 장면을 정지 배경으로 사용.
- 글꼴(Nanum Pen Script, IBM Plex Mono)은 `lofi/fonts/`에 **자체 호스팅**(OFL) — 외부 글꼴 서비스로 요청을 보내지 않기 위함.
- 설정은 localStorage `rebroni-lofi-settings`. 캐시 버스팅: `lofi/index.html`의 `lofi.js?v=`, `lofi.css?v=`, `fonts/fonts.css?v=`.

### Meditate (`meditate/`)
- ES 모듈 3개: `audio-engine.js`(AudioContext·버스·자연의 소리/벨/신호음 합성·페이드), `music.js`(GenerativeMusic·StemMusic·AlbumPlayer·VoicePlayer),
  `meditate.js`(UI·세션·호흡·프리셋·공유·Media Session). 스타일은 자체 `meditate.css`(dark/nature + `data-night` 야간 모드).
- 오디오 그래프: 소스 → musicBus/natureBus → duck(가이드 음성 중 낮춤) → transport(일시정지 페이드) → session(세션 페이드) → master → 리미터.
  벨(`bellBus`)은 session을 거치지 않아 페이드 아웃 뒤에도 종료 벨이 들린다.
- **시간 이벤트(벨·페이드·호흡 신호음)는 `ctx.currentTime` 기준으로 예약**한다 — 화면이 꺼져 JS 타이머가 느려져도 정확.
  일시정지는 `ctx.suspend()`라 세션 시계도 함께 멈춘다. 반복 예약은 `engine.tickers`(3초 앞서 예약)에 등록.
- 자연의 소리·벨·생성형 음악은 **파일 없이 합성**(외부 요청 없음). 새 소리를 추가할 때도 가능하면 합성으로.
- 백그라운드 재생은 **Android Chrome 기준**(무음 `<audio>` 반복으로 미디어 세션 유지). iOS 전용 대응은 넣지 않고 제약으로 안내.
- 콘텐츠: 앨범 음원은 `loadAlbums()`의 `audioUrl`(비발매 제외), 가이드 명상·스템은 Firestore `meditate`(`published == true`로 조회).
- 설정 localStorage `rebroni-meditate-settings`, 내 프리셋 `rebroni-meditate-presets`. 공유 링크는 `#src=…&n=rain:60,…`.
- 캐시 버스팅: `index.html`의 `meditate.css?v=`·`meditate.js?v=`, 모듈 import의 `audio-engine.js?v=`·`music.js?v=`,
  **`sw.js`의 `SHELL` 목록과 `VERSION`도 함께** 올린다.

### Mastering (`mastering/`)
- `dsp.js`(순수 JS 신호처리, `window.RDSP`)를 메인 스레드와 `worker.js`(`importScripts("dsp.js?v=1")`)가 함께 사용.
  무거운 분석·처리는 Worker에서 실행.
- 처리 체인: EQ → 컴프레서 → 새츄레이션 → M/S 스테레오 → 트루피크 리미터 → 목표 라우드니스.
- 스타일은 `../visualizer/viz.css`를 공유하고 `master.css`로 덧붙임.
- **Mastering → Visualizer 전달**: IndexedDB `rebroni-handoff` DB에 음원을 넣고 `../visualizer/?from=mastering`으로 이동.
  한쪽의 저장 형식을 바꾸면 다른 쪽(`viz.js`의 handoff 읽기)도 함께 맞춘다.
- 설정은 localStorage `rebroni-mastering-settings` (무드·실링·비트·모니터만 저장).

## 로컬 실행

ES 모듈·Service Worker를 쓰므로 `file://`로 열면 동작하지 않음. 반드시 로컬 서버로:

```
python -m http.server 8000
```

- 공개 페이지: http://localhost:8000 (`/videos.html`, `/journal.html`, `/visualizer/`, `/mastering/` 등)
- 관리자: http://localhost:8000/admin.html (`localhost`는 Firebase 승인 도메인에 기본 포함)

로컬에서도 **운영 Firestore/Storage에 연결**된다. 관리자 페이지에서 저장/삭제하면 실서비스 데이터가 바뀌므로 주의.

## 데이터 모델 (요약)

| 컬렉션/경로 | 내용 | 읽기 / 쓰기 |
|---|---|---|
| `albums/{albumId}` | 앨범 + `tracks[]` | 공개 / 관리자 |
| `notes/{autoId}` | 창작 노트: `title, body, html, media[], date, tags[], albumId, published, createdAt, updatedAt` | `published`만 공개 / 관리자 |
| `videos/{유튜브ID 11자}` | `youtubeId, title, kind(album\|unreleased\|etc), albumId, track, date, description, isShort, published, …` | `published`만 공개 / 관리자 |
| `guestbook/{id}` | 방명록 (비밀번호 해시로 셀프 soft delete) | 공개 / 누구나 작성 |
| `subscribers/{email}` | 뉴스레터 구독자 (문서 ID = 이메일) | 관리자 / 누구나 등록·해지 |
| `admins/{uid}` | 존재하면 관리자 (콘솔에서만 추가) | 본인 / 불가 |
| `meditate/{autoId}` | 명상 콘텐츠: `kind(guided\|stem), title, titleEn, description, url, path, role, set, duration, order, published, …` | `published`만 공개 / 관리자 |
| Storage `tracks/`, `journal/`, `meditate/`, 커버 | 음원, 노트 첨부(사진·음원 스케치), 명상 콘텐츠(R2 미연결 시), 커버 이미지 | 공개 / 관리자 |
| R2 `tracks/`, `meditate/` | R2 연결 시 음원 저장소. `audioPath`/`path`가 `r2:`로 시작 | 공개(`/media/`) / 관리자(`/api/media`) |

- `notes`, `videos`, `meditate`는 공개 페이지에서 **반드시 `where('published', '==', true)`로 조회**해야 보안 규칙을 통과한다.
- 앨범 ID 규칙: 정규 `a1`…`a9`, EP `ep1`. 정렬은 `order`(숫자) 우선, 없으면 `release` 내림차순.
- `tracks[]`: `no, title, isrc, links{spotify, apple, youtube}, lyrics{ko,en}, audioUrl, audioPath, unlisted`.
  `unlisted: true` 곡은 공개 목록에 노출하지 않음. 음원 포맷: mp3·wav·opus·ogg·m4a·aac (20MB 이하).
- 트랙 제목 형식 (한 문자열에 한/영 병기):
  - **2집 이후 기본: `"English (한국어)"`** — 예: `Warm Breath (따스한숨결)`
  - 1집만: `"한국어 (English)"` — 예: `비가 내리면(When the Rain Falls)`, 일부는 `-Original` 같은 꼬리 표기 포함
  - 예외: `"English (English)"`(괄호가 번역이 아닌 부제, 예: 7집 대부분) 또는 `"English"` 단일 제목
  - 화면(`app.js`, `playlist.js`)은 저장된 순서대로 "주제목 (부제)"로 표시만 한다.
  - `functions/api/tracks.js`의 `splitTitle`은 **한글이 있는 쪽을 `titleKo`로** 판정하고,
    한쪽에만 한글이 있는 경우가 아니면 `titleKo`/`titleEn` 모두 원제목을 그대로 쓴다.
- 상세 필드·설정 절차는 `FIREBASE-SETUP.md` 참고 (Phase1~3, 10-1 개인정보, 12 Journal, 13 Videos, 14 Meditate, 15 Cloudflare R2).

새 앨범·영상·노트 등록은 보통 **코드 수정 없이 admin 페이지에서** 처리한다. 코드 작업은 기능 추가·UI 변경 위주.

## 작업 규칙

- **작업 시작 전 `git pull`** — 다른 환경(클라우드 세션·PR)에서 `main`이 자주 갱신된다.
  기존 기능 작업은 `claude/…` 브랜치 → PR → `main` 병합 흐름으로 진행돼 왔다.
- **캐시 버스팅**: JS/CSS를 수정하면 그 파일을 불러오는 쪽의 `?v=` 숫자를 올린다.
  - `index.html` → `styles.css`, `app.js`, `playlist.js`, `community.js`
  - `videos.html` → `videos.js` / `journal.html` → `journal.js`
  - 모듈 import에도 `?v=`가 붙은 곳이 있음: `youtube.js?v=`, `journal-format.js?v=` — 고치면 import하는 파일들도 갱신
  - `visualizer/`·`meditate/`는 위 각 항목 참고 (sw.js 포함), `mastering/`은 `index.html`과 `worker.js`의 `dsp.js?v=`
  - 주의: `data-service.js`, `firebase-config.js`는 `?v=` 없이 import됨
- **Firebase SDK 버전**은 Firebase를 쓰는 모든 파일(`data-service.js`, `community.js`, `admin.js`, `videos.js`, `journal.js`, `meditate/meditate.js`)에서 같은 값(`10.12.2`)을 유지한다.
- **보안 규칙 변경은 git push만으로 반영되지 않는다.** `firestore.rules` / `storage.rules`를 고치면
  Firebase Console에서 직접 재게시해야 하고, `cors.json`은 `gsutil cors set`으로 적용해야 한다.
  변경 시 사용자에게 이 수동 단계를 반드시 안내하고, `FIREBASE-SETUP.md`에도 절차를 추가한다.
- **개인정보 처리방침 동기화**: 개인정보를 새로 수집·저장하거나 외부 서비스(제3자/국외 이전)를 추가·변경하는 기능이면
  `privacy.html`의 해당 항목과 **시행일·변경 이력**을 함께 갱신한다. localStorage/IndexedDB에 저장하는 값이 늘면 "이용자 기기에만 저장되는 정보" 항목도 확인.
- **창작 노트 HTML**은 반드시 `journal-format.js`의 허용 목록 정화를 거쳐 표시한다. 허용 태그/속성을 넓힐 때는 XSS 위험을 검토.
- **유튜브 재생**은 일반 youtube.com 플레이어 + 자동 재생 없음 방식을 유지한다 (조회수 집계를 위해 의도된 선택).
- UI 문구는 **한국어 + 영어 병기**가 기본 (`<span class="en-sub">` 패턴 참고).
- 두 테마(dark / nature)와 모바일 화면 모두에서 확인한다. 글자색은 두 테마에서 모두 읽히는 중간 밝기 권장.
- Firestore 데이터 구조를 바꾸면 `albums.json` 폴백, `admin.js`, `functions/api/tracks.js`, `firestore.rules`, `FIREBASE-SETUP.md`도 함께 맞춘다.
- 새 공개 페이지를 추가하면 상단 메뉴(`index.html` stickybar)와 `sitemap.xml`에 등록한다.
- 커밋 메시지는 한국어로 변경 내용을 간결하게 (기존 로그 스타일).

## 주의 사항

- **공개 저장소**다. Firebase 웹 설정(`apiKey` 등)은 공개돼도 되지만, 그 외 토큰·비밀번호·서비스 계정 키는 절대 커밋하지 않는다.
- `main`으로 push = 즉시 운영 배포. push 전에 로컬에서 동작을 확인한다.
- `albums.json`과 Firestore 데이터는 자동 동기화되지 않는다. 폴백 데이터가 오래될 수 있음.
- `visualizer/vendor/mediabunny.min.mjs`는 외부 라이브러리 번들(라이선스 파일 동봉) — 직접 수정하지 않는다. `lofi/`도 이 파일을 import한다.

## 관련 도구

- **VectorCraft MCP** (`vectorcraft`): 앨범 커버·아이콘·OG 이미지·비주얼라이저 배경 등 벡터 그래픽 제작/내보내기에 사용 가능.
  읽기·쓰기 허용 경로는 `E:\Claude-Cowork` 이하이므로 이 저장소에 바로 저장할 수 있다.
