# Firebase 설정 가이드 (Phase 1)

이 가이드를 순서대로 따라하면 사이트가 Firestore 기반 동적 구조로 전환됩니다.
Firebase 미설정 상태에서도 사이트는 기존 `albums.json`으로 정상 동작합니다(자동 폴백).

## 1. Firebase 프로젝트 생성

1. https://console.firebase.google.com 접속 → **프로젝트 추가**
2. 프로젝트 이름: `rebroni-music` (원하는 이름 가능)
3. Google Analytics: **사용 안 함** (나중에 추가 가능)

## 2. 웹 앱 등록 및 설정값 입력

1. 프로젝트 개요 화면에서 **웹 아이콘( </> )** 클릭
2. 앱 닉네임: `rebroni-discography` → 앱 등록 (Hosting 체크 불필요 — Cloudflare 유지)
3. 화면에 표시되는 `firebaseConfig` 객체를 복사
4. 이 저장소의 **`firebase-config.js`** 파일을 열어 값 교체

> 웹용 firebaseConfig는 비밀키가 아니므로 GitHub 공개 저장소에 커밋해도 안전합니다.
> 실제 보안은 3단계의 Security Rules가 담당합니다.

## 3. Firestore 데이터베이스 생성

1. 왼쪽 메뉴 **빌드 → Firestore Database → 데이터베이스 만들기**
2. 위치: `asia-northeast3 (서울)` 권장
3. **프로덕션 모드**로 시작
4. **규칙(Rules) 탭** → 이 저장소의 `firestore.rules` 파일 내용을 전체 붙여넣기 → **게시**

## 4. Google 로그인 활성화

1. **빌드 → Authentication → 시작하기**
2. **Sign-in method 탭 → Google → 사용 설정** (지원 이메일 선택) → 저장
3. **Settings 탭 → 승인된 도메인**에 `music.rebroni.com` 추가
   (`localhost`는 기본 포함되어 있어 로컬 테스트 가능)

## 5. 로컬 테스트

ES 모듈을 사용하므로 반드시 로컬 웹서버로 실행해야 합니다 (파일 더블클릭 X).

```
cd E:\Claude-Cowork\SHINCHEOLHO-rebroni-Discography
python -m http.server 8000
```

- 공개 페이지: http://localhost:8000
- 관리자 페이지: http://localhost:8000/admin.html

## 6. 관리자 등록 (최초 1회)

1. `admin.html` 접속 → **Google로 로그인**
2. "관리자 권한이 없습니다" 화면에 표시되는 **내 UID** 복사
3. Firebase Console → Firestore Database → **컬렉션 시작**
   - 컬렉션 ID: `admins`
   - 문서 ID: 복사한 UID 붙여넣기
   - 필드: `role` (string) = `admin` (내용은 자유, 문서 존재 여부만 검사함)
4. admin.html 새로고침 → 앨범 목록 화면이 보이면 성공

## 7. 기존 데이터 마이그레이션 (최초 1회)

1. admin.html → **albums.json 가져오기** 버튼 클릭
2. 앨범 10장이 Firestore `albums` 컬렉션에 등록됨
3. http://localhost:8000 새로고침 → 개발자도구 콘솔에 폴백 경고가 없으면 Firestore에서 로드된 것

## 8. 배포

로컬 검증 완료 후:

```
git add .
git commit -m "Phase1: Firestore 기반 동적 구조 + 관리자 페이지"
git push
```

Cloudflare Pages가 자동 배포합니다. 배포 후 확인:
- https://music.rebroni.com — 앨범 정상 표시
- https://music.rebroni.com/admin.html — 로그인 및 편집 동작

## 9. 커버 이미지 업로드 설정 (Firebase Storage)

admin 페이지에서 커버 이미지를 직접 업로드하려면 Storage 설정이 필요합니다.

1. **Blaze 플랜 전환** (신규 프로젝트는 Storage 사용에 필수)
   - Firebase Console 왼쪽 하단 **요금제 업그레이드 → Blaze (종량제)** → 결제 계정 연결
   - 무료 한도: 저장 5GB, 다운로드 1GB/일 — 이 사이트 규모에서는 사실상 0원
   - 안심하려면 Google Cloud Console에서 예산 알림($1 등)을 설정해 두세요
2. **빌드 → Storage → 시작하기**
   - 위치: `asia-northeast3 (서울)` 권장 (최초 선택 후 변경 불가)
3. **Rules 탭** → 이 저장소의 `storage.rules` 파일 내용을 전체 붙여넣기 → **게시**
4. admin.html에서 앨범 편집 → **이미지 파일 업로드** 버튼으로 테스트
   - 업로드 시 자동으로 최대 1600px JPEG로 최적화됩니다
   - 업로드 완료 후 반드시 **[저장]** 버튼을 눌러야 앨범에 반영됩니다

> 기존 앨범 커버(저장소 내 jpg 파일)는 그대로 두어도 됩니다.
> 교체하고 싶은 앨범만 새로 업로드하면 URL이 Storage 주소로 바뀝니다.

## 10. Phase2 적용 (가사/세계관/방명록/뉴스레터/테마)

Phase2 기능은 코드 배포 외에 **Firestore 규칙 재게시 1가지만** 추가로 필요합니다.

1. **Firestore 규칙 재게시 (필수)**
   - Firebase Console → Firestore Database → 규칙 탭
   - 이 저장소의 `firestore.rules` 최신 내용을 전체 붙여넣기 → 게시
   - 추가된 규칙: `guestbook` (방명록), `subscribers` (뉴스레터 구독자)
2. 로컬 테스트 후 git push로 배포

### 기능별 사용법

- **가사 (Lyrics)**: admin → 앨범 편집 → 각 트랙의 "가사" 입력란에 한국어/영어 가사 입력 → 저장.
  가사가 있는 곡에만 사이트에 [Lyrics] 버튼이 나타나고, 클릭하면 한/영 나란히 모달로 표시됩니다.
- **세계관 (Behind the Tracks)**: admin → 앨범 편집 → "Behind the Tracks" 입력란 작성 → 저장.
  앨범 소개 아래 접이식 패널로 표시됩니다.
- **방명록 (Fan Wall)**: 사이트 하단에서 닉네임+비밀번호로 작성. 작성자는 비밀번호로 삭제 가능,
  관리자는 admin 페이지 "방명록 관리"에서 영구 삭제 가능.
- **뉴스레터**: 사이트 하단 구독 폼 → 이메일이 `subscribers` 컬렉션에 저장 (중복 자동 차단).
  admin "뉴스레터 구독자"에서 목록 확인 및 이메일 일괄 복사 → STIBEE/Mailchimp 등에서 발송.
- **테마**: 상단 🌿/🌌 버튼으로 Cosmic Dark ↔ Nature Green 전환. 선택은 브라우저에 저장됩니다.

## 10-1. 개인정보 처리방침 + 뉴스레터 구독 해지

사이트 하단에 개인정보 처리방침(`privacy.html`) 링크와 구독 영역의 **구독 해지** 기능이 추가되었습니다.
구독 해지가 동작하려면 **Firestore 규칙 재게시**가 필요합니다.

1. Firebase Console → Firestore Database → 규칙 탭
2. 이 저장소의 `firestore.rules` 최신 내용을 전체 붙여넣기 → 게시
   - 변경된 규칙: `subscribers` 문서 삭제를 관리자 전용 → 누구나(해당 이메일 문서만) 허용
3. 규칙을 게시하기 전에는 해지 버튼이 "해지 처리에 실패했습니다 … 이메일로 요청해 주세요"로 안내합니다.

## 11. Phase3 적용 (음원 파일 저장 + URL 제공)

admin에서 곡별 음원(mp3/wav/opus/m4a·aac) 업로드 → 공개 다운로드 URL 발급 기능입니다.
적용에 필요한 작업은 **규칙 재게시 + CORS 설정** 2가지입니다.

1. **Storage 규칙 재게시 (필수)**
   - Firebase Console → Storage → Rules 탭
   - 이 저장소의 `storage.rules` 최신 내용 전체 붙여넣기 → 게시
   - 추가된 규칙: `tracks/` 경로 (읽기 공개, 관리자만 업로드/삭제, 20MB 이하 오디오)
2. **버킷 CORS 설정 (필수 — Web Audio 분석/외부 도메인 재생 대비)**
   - Google Cloud Console의 **Cloud Shell**을 열거나, gsutil이 설치된 로컬 터미널에서:

   ```
   gsutil cors set cors.json gs://rebroni-music-web.firebasestorage.app
   ```

   - `cors.json`은 이 저장소 루트에 보관되어 있습니다 (origin `*`, GET/HEAD).
   - 확인: `gsutil cors get gs://rebroni-music-web.firebasestorage.app`
3. git push로 배포 (Cloudflare Pages가 `functions/api/tracks.js`도 자동 배포)

### 기능별 사용법

- **음원 업로드**: admin → 앨범 편집 → 각 트랙의 **음원 파일 업로드**
  (mp3 · wav · opus · ogg · m4a · aac, 곡당 최대 20MB).
  파일명이 자동으로 영문 슬러그화되어 `tracks/{슬러그}.{확장자}` 경로에 저장되고,
  다운로드 URL이 트랙의 `audioUrl` 필드에 기록됩니다. 업로드 후 반드시 **[저장]**.
  **URL 복사** 버튼으로 발급된 URL을 복사할 수 있습니다.
  이미 음원이 있는 곡에 다른 포맷(예: mp3 → opus)을 올리면, **[저장]이 끝난 뒤** 기존 파일은 Storage에서 자동 삭제됩니다.
  (저장하지 않고 나가면 기존 파일과 URL은 그대로 유지됩니다.)
  ※ 음질을 높이려면 mp3가 아닌 **마스터링 WAV 원본**에서 opus로 변환하세요.
  예: `ffmpeg -i master.wav -c:a libopus -b:a 192k track.opus`
- **비발매 음원**: 트랙의 "비발매 (게임/비공개용)" 체크 → `unlisted: true`.
  사이트 공개 목록에는 노출되지 않고, admin 화면과 URL로만 접근됩니다.
- **삭제**: 트랙 삭제/앨범 삭제 시 Storage의 음원 파일도 함께 삭제됩니다.
  음원만 삭제하려면 트랙의 **음원 삭제** 버튼 사용.
- **공개 트랙 목록 API**: `GET https://music.rebroni.com/api/tracks`
  → audioUrl이 있는 곡을 `[{ url, titleKo, titleEn, released, unlisted }]` JSON으로 반환.
  `Access-Control-Allow-Origin: *` 헤더가 포함되어 외부 도메인(게임 등)에서 fetch 가능합니다.

### 완료 확인 체크리스트

- admin에서 mp3 업로드 → 발급 URL을 새 탭에서 열면 재생됨
- 다른 도메인의 테스트 HTML에서 `<audio src="audioUrl">` 재생 성공 (CORS 적용 확인)
- `fetch("https://music.rebroni.com/api/tracks")` 가 외부 도메인에서 JSON 반환
- 기존 등록/삭제·스트리밍 링크 기능 정상 동작

## 12. 창작 노트 (Creator's Journal)

창작자의 아이디어·작업 과정을 날짜순으로 기록하는 블로그식 기능입니다.
동작하려면 **Firestore 규칙 재게시**가 필요합니다 (색인 추가는 필요 없음).

1. Firebase Console → Firestore Database → 규칙 탭
2. 이 저장소의 `firestore.rules` 최신 내용을 전체 붙여넣기 → 게시
   - 추가된 규칙: `notes` 컬렉션 (관리자만 작성, 공개 노트만 누구나 읽기, 비공개 노트는 관리자만 읽기)
3. git push로 배포

### 사용법

- **기록**: admin → **창작 노트** → **+ 새 노트** → 제목 · 기록일 · 본문 입력 → 저장.
  기록일은 오늘로 자동 입력되며, 지난 아이디어를 옮겨 적을 때는 날짜를 바꾸면 그 위치에 정렬됩니다.
  관련 앨범과 태그(쉼표 구분)는 선택 사항입니다.
- **공개/비공개**: 새 노트는 기본 **비공개**(관리자만 열람). **공개**에 체크하고 저장하면
  사이트의 `journal.html`(상단 메뉴 **Journal**)에 타임라인으로 표시됩니다.
- **공개 페이지**: 최신순 / 처음부터(작성 순서) 정렬, 태그 클릭 시 해당 태그만 보기,
  관련 앨범 칩을 누르면 디스코그래피의 해당 앨범으로 이동, 날짜를 누르면 노트별 공유 링크(`journal.html#note-…`).
  본문의 줄바꿈은 그대로 유지되고, `https://…` 주소는 자동으로 링크가 됩니다.

### 12-1. 서식 · 사진 · 음원 스케치

노트 본문에 굵게/기울임/밑줄/취소선, 글자색, 소제목, 인용, 목록, 링크, 사진, 음원 스케치를 넣을 수 있습니다.
동작하려면 **규칙 2개를 모두 재게시**해야 합니다.

1. Firestore Database → 규칙 탭 → `firestore.rules` 최신본 게시 (`notes`에 `html`, `media` 필드 허용)
2. Storage → Rules 탭 → `storage.rules` 최신본 게시 (`journal/` 경로: 관리자만 업로드, 이미지·오디오 20MB 이하)

- **서식**: 글자를 선택한 뒤 툴바 버튼을 누릅니다. 색 동그라미는 자주 쓰는 색, 그 옆 색상 칸은 원하는 색을 직접 고르는 곳입니다.
  **서식 지우기**는 선택한 글자의 굵게·색 등을 없앱니다.
- **사진**: 📷 버튼, 또는 본문에 붙여넣기(Ctrl+V)·끌어다 놓기. 긴 변 1600px JPEG로 자동 축소됩니다 (GIF는 원본 유지).
  사진 아래 칸에 설명을 적을 수 있습니다.
- **음원 스케치**: 🎵 버튼 (mp3 · wav · opus · ogg · m4a · aac, 20MB 이하). 공개 페이지에서 바로 재생됩니다.
- **첨부 빼기**: 사진/음원 블록의 **✕ 빼기** → 저장하면 Storage 파일도 자동 삭제됩니다.
  저장하지 않고 [목록으로] 나가면 그동안 올린 파일은 정리되고, 노트를 삭제하면 첨부 파일도 함께 삭제됩니다.
- 공개 페이지에는 허용된 서식만 남겨 표시하므로, 다른 사이트에서 붙여넣은 글의 스크립트·잡다한 스타일은 자동으로 제거됩니다.
- 글자색은 다크/네이처 두 테마에서 모두 읽히는 중간 밝기의 색을 권장합니다.

## 13. 영상 (YouTube Videos)

유튜브에 올린 앨범곡 · 미발매곡 · Shorts 영상을 사이트의 `videos.html`(상단 메뉴 **Videos**)에 모아 보여줍니다.
동작하려면 **Firestore 규칙 재게시**가 필요합니다 (Storage 규칙은 변경 없음).

1. Firebase Console → Firestore Database → 규칙 탭 → `firestore.rules` 최신본 게시
   - 추가된 규칙: `videos` 컬렉션 (관리자만 작성, 공개 영상만 누구나 읽기)
2. git push로 배포

### 사용법

- **여러 개 한 번에**: admin → **영상 (YouTube)** → "여러 개 한 번에 추가"에 유튜브 주소를 한 줄에 하나씩 붙여넣고
  구분(앨범곡/미발매곡/기타)·관련 앨범을 고른 뒤 **가져오기**. 제목은 유튜브에서 자동으로 가져오며,
  이미 등록된 영상은 건너뜁니다. `/shorts/` 주소는 자동으로 세로 영상(Shorts)으로 표시됩니다.
- **1개씩 / 편집**: **+ 영상 1개 추가** 또는 목록의 **편집** → 제목, 구분, 관련 앨범, 곡 이름(수록곡 추천), 게시일,
  설명, Shorts 여부, 공개 여부를 입력. 게시일 순(최신이 위)으로 정렬됩니다.
- **삭제**: 사이트 목록에서만 빠지며 유튜브의 영상은 그대로 남습니다.
- **공개 페이지**: 썸네일 갤러리 → 누르면 재생 창에 유튜브 플레이어가 뜨고, 플레이어의 재생 버튼을 눌러 시청.
  디스코그래피의 곡별 Play와 같은 방식(일반 youtube.com 플레이어, 자동 재생 없음)이라 **유튜브 조회수로 집계**됩니다.
  전체/앨범곡/미발매곡/기타/Shorts 필터, 앨범 선택, 검색. 영상별 공유 링크 `videos.html#v=영상ID`,
  앨범별 링크 `videos.html?album=앨범ID`.
- **창작 노트에 영상 넣기**: 노트 편집기의 **▶ 유튜브** 버튼 → 주소 붙여넣기. 공개 Journal에서 눌러서 재생됩니다.
- 앨범 수록곡의 YouTube 링크가 Shorts(`/shorts/…`) 주소여도 곡별 **Play** 버튼과 플레이리스트에서 재생됩니다.

## 14. 명상 (Meditate)

`/meditate/`(상단 메뉴 **Meditate**) — 자연의 소리 믹서, 생성형 앰비언트, 스템 재조합, 앨범 음원, 명상·슬립 타이머,
가이드 명상, 호흡 가이드. 자연의 소리·벨·생성형 음악은 브라우저에서 합성하므로 **콘텐츠 없이도 바로 동작**합니다.
가이드 명상과 스템은 admin에서 올린 콘텐츠가 있어야 나타납니다.

1. Firebase Console → Firestore Database → 규칙 탭 → `firestore.rules` 최신본 **게시**
   - 추가된 규칙: `meditate` 컬렉션 (관리자만 작성, 공개 항목만 누구나 읽기)
2. Firebase Console → Storage → 규칙 탭 → `storage.rules` 최신본 **게시**
   - 추가된 규칙: `meditate/` 경로 (R2를 연결하지 않았을 때 쓰는 대비용, 50MB 이하 오디오)
3. git push로 배포

### 사용법

- **앨범 음원**: 트랙에 음원(`audioUrl`)이 있는 곡이 명상 페이지의 [앨범 음원]에 나타납니다(비발매 곡 제외).
  음원이 있는 앨범에는 디스코그래피에 **🧘 Meditate** 버튼이 생기고 `meditate/?album=앨범ID`로 연결됩니다.
- **명상 콘텐츠 추가**: admin → **명상 콘텐츠 (Meditate)** → **+ 콘텐츠 추가**
  - **가이드 명상**: 음성 파일 업로드 → 제목(한/영)·설명 → 공개. 재생 중 배경음은 자동으로 작아지고, 음성이 끝나면 25초에 걸쳐 줄어들며 종료 벨.
  - **스템**: 역할(바탕·패드·멜로디·질감)과 **세트 이름**을 지정. 바탕·패드·질감은 45~120초씩 반복하며 크로스페이드,
    멜로디는 한 번 재생 후 8~33초 쉽니다. 같은 키·템포끼리 세트 이름을 맞추면 어울리게 섞입니다.
    스템은 **끝과 시작이 자연스럽게 이어지는 루프**(30초~3분, 무음 꼬리 없이)로 만들어 올리면 좋습니다.
  - 길이(초)는 파일에서 자동으로 채워집니다. 순서는 작을수록 위.
- **공유 링크**: 명상 페이지의 [🔗 지금 믹스 공유 링크 복사] → `meditate/#src=gen&mood=calm&seed=…&n=rain:60,…` 형태.

### 제약 (Android Chrome 기준으로 구현)

- 화면을 끄거나 다른 앱을 써도 재생되며 잠금 화면에 재생 컨트롤이 표시됩니다(Media Session).
- iPhone·iPad(Safari)는 화면 잠금·앱 전환 시 소리가 멈출 수 있고, 무음 스위치가 켜져 있으면 소리가 나지 않으며, 진동을 지원하지 않습니다 (구현하지 않음, 페이지에 안내 표시).
- 오프라인: 페이지 셸이 캐시되므로 자연의 소리·생성형 음악·타이머·호흡 가이드는 오프라인에서도 동작합니다.
  앨범 음원·가이드 명상·스템의 **오프라인 다운로드는 2단계**에서 추가 예정.

## 15. 음원 저장소를 Cloudflare R2로 (비용 절감)

R2는 **다운로드 트래픽 요금이 없는** Cloudflare의 파일 저장소입니다(무료 범위: 저장 10GB/월, 쓰기 100만 회·읽기 1,000만 회/월).
명상 음원처럼 길게·반복해서 재생되는 파일을 Firebase Storage 대신 R2에 두면 트래픽 비용이 들지 않습니다.
파일은 **사이트와 같은 주소** `https://music.rebroni.com/media/…`로 제공되므로(Pages Function `functions/media/[[path]].js`)
R2 버킷 공개 설정·별도 도메인·CORS 설정이 필요 없습니다.

### 운영자 설정 (최초 1회)

1. Cloudflare 대시보드 → **R2 Object Storage** → (처음이면 R2 사용 신청 — 무료 범위라도 결제 수단 등록을 요구할 수 있음)
   → **Create bucket** → 이름 예: `rebroni-media` (위치 Automatic) → 생성
2. **Workers & Pages** → `shincheolho-rebroni-discography` → **Settings** → **Bindings**(또는 Functions → R2 bucket bindings)
   → **Add** → **R2 bucket** → 변수 이름 **`MEDIA`**(정확히 이 이름), 버킷 `rebroni-media` 선택 → 저장
   - Production 환경에 추가 (미리보기 배포에서도 쓰려면 Preview에도 추가)
3. 바인딩은 **다음 배포부터** 적용됩니다 → Deployments에서 최신 배포 **Retry deployment** 또는 아무 커밋이나 push
4. 확인: 브라우저에서 `https://music.rebroni.com/api/media` → `{"r2":true}` 이면 연결 완료
   (admin의 명상 콘텐츠 목록에도 "현재 업로드 저장소: Cloudflare R2"로 표시)

### 업로드 방법 (연결 후)

- **admin에서 그대로 업로드** (권장): 트랙 음원·명상 콘텐츠 업로드가 **자동으로 R2에 저장**됩니다. 작업 방식은 지금과 같습니다.
  - 업로드는 `/api/media`가 처리하며, admin에 로그인한 **관리자(admins 컬렉션)만** 가능합니다(Firebase 로그인 토큰을 Firestore로 확인).
  - R2에 저장된 항목은 `audioPath`가 `r2:tracks/…` 형태로 기록되고, 삭제·교체 시 R2에서도 지워집니다.
- **R2 대시보드에서 직접 업로드** (대량 업로드 시): 버킷에 `tracks/파일명.mp3`(또는 `meditate/…`) 경로로 올린 뒤,
  admin의 트랙 음원 주소 칸에 `https://music.rebroni.com/media/tracks/파일명.mp3`를 붙여넣고 [저장].
  파일명은 영문·숫자·`-`·`_`·`.`만 사용하세요.
- **기존 Firebase 음원 옮기기** (3집 등): admin → 앨범 편집 → 트랙 목록 아래 **[Firebase 음원 → Cloudflare R2로 옮기기]**
  → 완료 후 **[저장]** → 이때 Firebase Storage의 기존 파일이 삭제됩니다. (Firebase Storage의 `cors.json`이 적용되어 있어야 함)
- R2를 연결하지 않으면 지금처럼 Firebase Storage에 저장됩니다(자동 전환).

### 참고

- `/media/…` 요청은 Pages Functions 요청 수에 포함됩니다(무료: 하루 10만 건, 곡 1회 재생에 보통 2~5건).
  넘으면 Workers Paid($5/월)로 올리거나 R2 버킷에 사용자 지정 도메인을 연결하는 방식으로 바꿀 수 있습니다.
- `/api/tracks`(외부 게임용)는 저장소와 상관없이 `audioUrl`을 그대로 돌려주며, `/media/…`도 CORS `*`로 열려 있어 그대로 재생됩니다.

## 이후 운영 방법 (새 앨범 발매 시)

1. admin.html 접속 → **+ 새 앨범** → 폼 입력
2. **이미지 파일 업로드** 버튼으로 커버 업로드 → 저장
3. 끝. 소스 수정/재배포 없이 사이트에 바로 반영됩니다.

## 데이터 구조 (참고)

```
albums (컬렉션)
 └─ {albumId} 문서: ordinal, title, artist, label, upload, release, upc,
                    cover, links{spotify_album, apple_album, youtube_album},
                    concept{ko, en}, story{ko, en},
                    tracks[{no, title, isrc, links{...}, lyrics{ko, en},
                            audioUrl, audioPath, unlisted}]
                    (향후: productId — 실물 상품 연동용 예약)
admins (컬렉션)
 └─ {uid} 문서: 존재하면 관리자
notes (컬렉션) — 창작 노트
 └─ {autoId} 문서: title, body(일반 텍스트 사본), html(서식 본문), media[](첨부 Storage 경로),
                   date(YYYY-MM-DD), tags[], albumId, published(공개 여부), createdAt, updatedAt
Storage journal/ — 창작 노트 첨부 사진·음원
videos (컬렉션) — 유튜브 영상
 └─ {유튜브 영상 ID} 문서: youtubeId, title, kind(album|unreleased|etc), albumId, track,
                         date(YYYY-MM-DD), description, isShort, published, createdAt, updatedAt
meditate (컬렉션) — 명상 콘텐츠
 └─ {autoId} 문서: kind(guided|stem), title, titleEn, description, url, path("r2:…" 또는 Storage 경로),
                   role(drone|pad|melody|texture — 스템), set(스템 세트 이름), duration(초), order,
                   published, createdAt, updatedAt
Cloudflare R2 버킷(바인딩 MEDIA) tracks/ · meditate/ — 연결 시 음원 저장소 (/media/… 로 제공)

향후 확장 (Phase2+): products, orders, users 컬렉션을 같은 층위에 추가
```

## 폴백 동작

- `firebase-config.js`가 placeholder 상태 → 자동으로 `albums.json` 사용
- Firestore 장애/빈 컬렉션 → 자동으로 `albums.json` 사용
- 따라서 `albums.json`은 삭제하지 말고 비상용으로 유지 권장
  (admin에서 데이터 변경 후 가끔 JSON도 백업 갱신하면 안전)
