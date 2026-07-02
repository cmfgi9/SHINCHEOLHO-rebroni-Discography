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

## 이후 운영 방법 (새 앨범 발매 시)

1. admin.html 접속 → **+ 새 앨범** → 폼 입력
2. **이미지 파일 업로드** 버튼으로 커버 업로드 → 저장
3. 끝. 소스 수정/재배포 없이 사이트에 바로 반영됩니다.

## 데이터 구조 (참고)

```
albums (컬렉션)
 └─ {albumId} 문서: ordinal, title, artist, label, upload, release, upc,
                    cover, links{spotify_album, apple_album, youtube_album},
                    concept{ko, en}, tracks[{no, title, isrc, links{...}}]
                    (향후: productId — 실물 상품 연동용 예약)
admins (컬렉션)
 └─ {uid} 문서: 존재하면 관리자

향후 확장 (Phase2+): products, orders, users 컬렉션을 같은 층위에 추가
```

## 폴백 동작

- `firebase-config.js`가 placeholder 상태 → 자동으로 `albums.json` 사용
- Firestore 장애/빈 컬렉션 → 자동으로 `albums.json` 사용
- 따라서 `albums.json`은 삭제하지 말고 비상용으로 유지 권장
  (admin에서 데이터 변경 후 가끔 JSON도 백업 갱신하면 안전)
