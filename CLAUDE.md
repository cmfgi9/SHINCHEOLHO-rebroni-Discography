# CLAUDE.md

SHINCHEOLHO-rebroni(Rebroni Music)의 공식 디스코그래피 사이트. 운영 주소: https://music.rebroni.com

## 스택

- 빌드 도구 없는 정적 사이트: HTML + CSS + 바닐라 JS(ES 모듈). `package.json`/번들러 없음.
- 호스팅: **Cloudflare Pages** — `main`에 push하면 자동 배포. `functions/`는 Pages Functions로 함께 배포됨.
- 데이터/인증/파일: **Firebase** 프로젝트 `rebroni-music-web` (Firestore, Google 로그인, Storage).
  SDK는 `gstatic.com` CDN에서 동적 import하며 버전은 `10.12.2`로 고정.
- 플레이어: YouTube IFrame API.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 공개 페이지 뼈대. 모달·드로어·하단 플레이어 마크업 포함 |
| `app.js` | 앨범/트랙 렌더링, 검색, 앨범 내비, 테마 전환, 가사 모달 |
| `playlist.js` | 전체 앨범 통합 플레이리스트 (선택·저장·연속재생·셔플·반복·볼륨). localStorage 키 `rebroni:playlist:v1`, `rebroni:playlists:v1` |
| `community.js` | 뉴스레터 구독(`subscribers`) + 방명록(`guestbook`). Firebase 미설정 시 섹션 숨김 |
| `data-service.js` | 앨범 로딩 계층: Firestore 우선 → 실패/빈 컬렉션이면 `albums.json` 폴백 |
| `firebase-config.js` | 웹용 Firebase 설정(공개 키, 비밀 아님) |
| `admin.html` / `admin.js` | 관리자 페이지: Google 로그인, 앨범·트랙·링크·가사 CRUD, 커버/음원 업로드, 방명록·구독자 관리, `albums.json` 가져오기 |
| `functions/api/tracks.js` | `GET /api/tracks` — Firestore REST로 `audioUrl` 있는 곡 목록 반환 (CORS `*`) |
| `albums.json` | 비상용 폴백 데이터 (앨범 10장). **삭제 금지** |
| `firestore.rules`, `storage.rules`, `cors.json` | Firebase 보안 규칙 / Storage 버킷 CORS 설정 원본 |
| `styles.css` | 전체 스타일. `data-theme="dark"`(Cosmic Dark) / `"nature"`(Nature Green) 두 테마 |
| `FIREBASE-SETUP.md` | Firebase 설정·Phase별 적용 절차·데이터 구조 상세 문서 |
| `*.jpg` (루트) | 앨범 커버(`album{N}-{slug}.jpg`, `ep{N}-{slug}.jpg`), QR 코드 이미지 |

## 로컬 실행

ES 모듈이라 `file://`로 열면 동작하지 않음. 반드시 로컬 서버로:

```
python -m http.server 8000
```

- 공개 페이지: http://localhost:8000
- 관리자: http://localhost:8000/admin.html (`localhost`는 Firebase 승인 도메인에 기본 포함)

로컬에서도 **운영 Firestore에 연결**된다. 관리자 페이지에서 저장/삭제하면 실서비스 데이터가 바뀌므로 주의.

## 데이터 모델 (요약)

`albums/{albumId}`: `ordinal, title, artist, label, upload, release(YYYY-MM-DD), upc, cover, links{...}, concept{ko,en}, story{ko,en}, order?, tracks[]`
`tracks[]`: `no, title, isrc, links{spotify, apple, youtube}, lyrics{ko,en}, audioUrl, audioPath, unlisted`

- 앨범 ID 규칙: 정규 `a1`…`a9`, EP `ep1`.
- 정렬: `order`(숫자)가 있으면 우선, 없으면 `release` 내림차순(최신이 위).
- 트랙 제목 형식 (한 문자열에 한/영 병기):
  - **2집 이후 기본: `"English (한국어)"`** — 예: `Warm Breath (따스한숨결)`
  - 1집만: `"한국어 (English)"` — 예: `비가 내리면(When the Rain Falls)`, 일부는 `-Original` 같은 꼬리 표기 포함
  - 예외: `"English (English)"`(괄호가 번역이 아닌 부제, 예: 7집 대부분) 또는 `"English"` 단일 제목
  - 화면(`app.js`, `playlist.js`)은 저장된 순서대로 "주제목 (부제)"로 표시만 한다.
  - `functions/api/tracks.js`의 `splitTitle`은 **한글이 있는 쪽을 `titleKo`로** 판정하고,
    한쪽에만 한글이 있는 경우가 아니면 `titleKo`/`titleEn` 모두 원제목을 그대로 쓴다.
- `unlisted: true` 곡은 공개 목록에 노출하지 않음.
- 전체 구조와 기타 컬렉션(`admins`, `guestbook`, `subscribers`)은 `FIREBASE-SETUP.md` 참고.

새 앨범 발매는 보통 **코드 수정 없이 admin 페이지에서** 처리한다. 코드 작업은 기능 추가·UI 변경 위주.

## 작업 규칙

- **캐시 버스팅**: `styles.css`, `app.js`, `playlist.js`, `community.js`를 수정하면 `index.html`의 해당 `?v=` 숫자를 올린다.
  (주의: `data-service.js`, `firebase-config.js`는 다른 모듈에서 `?v=` 없이 import됨)
- **Firebase SDK 버전**은 `data-service.js`, `community.js`, `admin.js`에서 같은 값(`10.12.2`)을 유지한다.
- **보안 규칙 변경은 git push만으로 반영되지 않는다.** `firestore.rules` / `storage.rules`를 고치면
  Firebase Console에서 직접 재게시해야 하고, `cors.json`은 `gsutil cors set`으로 적용해야 한다.
  변경 시 사용자에게 이 수동 단계를 반드시 안내할 것.
- UI 문구는 **한국어 + 영어 병기**가 기본 (`<span class="en-sub">` 패턴 참고).
- 두 테마(dark / nature)와 모바일 화면 모두에서 확인한다.
- Firestore 데이터 구조를 바꾸면 `albums.json` 폴백, `admin.js`, `functions/api/tracks.js`, `FIREBASE-SETUP.md`도 함께 맞춘다.
- 커버 이미지는 저장소 루트에 기존 명명 규칙으로 두거나 admin에서 Storage로 업로드(자동 1600px JPEG 최적화).
- 커밋 메시지는 한국어로 변경 내용을 간결하게 (기존 로그 스타일).

## 주의 사항

- **공개 저장소**다. Firebase 웹 설정(`apiKey` 등)은 공개돼도 되지만, 그 외 토큰·비밀번호·서비스 계정 키는 절대 커밋하지 않는다.
- `main`으로 push = 즉시 운영 배포. push 전에 로컬에서 동작을 확인한다.
- `albums.json`과 Firestore 데이터는 자동 동기화되지 않는다. 폴백 데이터가 오래될 수 있음.

## 관련 도구

- **VectorCraft MCP** (`vectorcraft`): 앨범 커버·아이콘·OG 이미지 등 벡터 그래픽 제작/내보내기에 사용 가능.
  읽기·쓰기 허용 경로는 `E:\Claude-Cowork` 이하이므로 이 저장소에 바로 저장할 수 있다.
