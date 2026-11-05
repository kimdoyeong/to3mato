# To3mato 도메인 전환 계획

작성일: 2026-11-05
상태: 계획. `to3mato.com` 구입 완료(Cloudflare 네임서버 `amy`, `gordon`). 하위 도메인 이름과 단계별 시점은 "결정할 것"에 답을 받은 뒤 정한다.

## 목표

- 제품 주소를 개인 도메인 `doyeong.dev`에서 `to3mato.com`으로 옮긴다.
- 사용자가 쓴 글을 공개하는 페이지(마이크로블로그 링크 공유)를 제품 사이트와 다른 호스트에 둔다.
- 이미 설치된 앱의 업데이트와 이미 퍼진 링크를 깨뜨리지 않는다.

범위 밖: 다운로드 주소 교체, 마이크로블로그 기능 설계. 마이크로블로그는 별도 기획서에서 다루고 이 문서는 주소만 정한다.

## 옮기는 이유

| 이유 | 내용 |
| --- | --- |
| 평판 분리 | 공유 페이지에 올라온 스팸이나 피싱 때문에 주소가 Safe Browsing이나 메일 필터에 걸리면 같은 도메인의 사이트, 업데이트 피드, 로그인 메일이 함께 영향을 받을 수 있다 |
| 앱 링크 분리 | 로그인 Universal Link와 공유 링크가 같은 호스트에 있으면 공유 링크가 앱으로 열릴 수 있다 |
| 링크 고정 | 한 번 퍼진 공유 링크는 옮길 수 없다. 공유 기능을 출시하기 전에 주소를 정해야 한다 |
| 개인 도메인 분리 | 링크를 받는 사람에게 개인 이름이 보인다. 앱을 넘기거나 함께 운영할 때 떼어 내기 어렵다 |

## 현재 주소

| 주소 | 용도 | 연결된 곳 |
| --- | --- | --- |
| `to3mato.doyeong.dev` | 소개·다운로드·약관·개인정보처리방침 사이트 | Pages 프로젝트 `to3mato` |
| `downloads.to3mato.doyeong.dev` | 설치 파일, `latest-mac.yml`, `release.json` | R2 |
| `noreply@to3mato.doyeong.dev` | 로그인 메일 발신 (계획) | Resend, `docs/sync-design.md` |
| `hello@doyeong.dev` | 약관·개인정보처리방침의 문의 주소 | `website/dist/privacy.html`, `website/dist/terms.html` |

로그인 콜백은 도메인을 쓰지 않는다.

- Mac: `http://127.0.0.1:43117/auth/callback` (`electron/auth-callback.mjs`)
- iOS: `to3mato://auth/callback` (`ios/To3matoKit/Sources/To3matoCloud/Cloud.swift`)

## 목표 주소 구성

| 주소 | 용도 |
| --- | --- |
| `to3mato.com` | 소개·다운로드·약관·개인정보처리방침 사이트. Supabase Site URL. 이후 iOS Universal Link |
| `www.to3mato.com` | `to3mato.com`으로 301 |
| 공유 하위 도메인 (이름 미정) | 마이크로블로그 공개 페이지. 별도 Pages 프로젝트 또는 Worker |
| 메일 하위 도메인 (이름 미정) | Resend 발신 도메인 |
| `to3mato.doyeong.dev` | 경로와 쿼리를 유지한 채 `to3mato.com`으로 301 |
| `downloads.to3mato.doyeong.dev` | 그대로 유지 |

### 바꾸지 않는 것

- `downloads.to3mato.doyeong.dev`. 설치된 앱의 업데이트 피드 주소가 빌드에 들어 있다(`electron/updater.mjs`, `electron-builder.release.cjs`). 이 주소를 내리면 옛 버전은 업데이트를 받지 못한다.
- 릴리스 기록(`docs/release-ci-cd.md`의 지난 릴리스 결과)에 남은 옛 링크. 당시 기록이므로 고치지 않는다. 301로 계속 열린다.
- Mac과 iOS의 로그인 콜백 주소.

## 단계

각 단계는 독립적이다. 1단계와 2단계는 동기화 릴리스 전에 끝낸다.

### 1단계: 사이트

사용자 작업 (Cloudflare 대시보드):

1. Pages 프로젝트 `to3mato`의 Custom domains에 `to3mato.com`과 `www.to3mato.com`을 추가한다.
2. `to3mato.com` 존에 `www` → 루트 301 규칙을 둔다.
3. `doyeong.dev` 존에 `to3mato.doyeong.dev/*` → `https://to3mato.com/${path}` 301 규칙을 둔다. 쿼리 문자열을 유지한다.

Pages 프로젝트는 그대로이므로 사이트를 다시 배포할 필요가 없다. 사이트 HTML에는 절대 주소가 없다(`canonical`, `og:url` 없음).

저장소 변경 (`release/*`가 아닌 브랜치에서 작업하고 main에 합친다):

| 파일 | 변경 |
| --- | --- |
| `scripts/verify-site-release.mjs` | 공개 검증 주소를 `https://to3mato.com`으로 |
| `website/README.md` | 웹사이트 주소 |
| `docs/portfolio.md` | 앱 사이트 주소 |

`verify-site-release.mjs`는 301 이후 Pages 전파 대기 로직과 함께 동작해야 한다. 바꾼 뒤 다음 릴리스 전에 `deploy=false` 수동 실행으로 확인한다.

검증:

- `https://to3mato.com/download`와 `https://to3mato.doyeong.dev/download?x=1`이 각각 200, 301(`https://to3mato.com/download?x=1`)을 돌려준다.
- 다운로드 페이지의 DMG 링크가 여전히 `downloads.to3mato.doyeong.dev`를 가리키고 200을 돌려준다.

### 2단계: 메일

1. Resend에 메일 하위 도메인을 발신 도메인으로 등록하고 SPF·DKIM 레코드를 `to3mato.com` 존에 추가한다. 사용자가 한다.
2. 발신 주소를 `noreply@<메일 하위 도메인>`으로 정한다. `docs/sync-design.md`의 Auth 설정 표를 고친다.
3. Supabase 원격 Auth의 SMTP 발신 주소를 바꾼다. 원격 설정은 선언한 항목만 별도 작업 폴더에서 push한다.
4. 문의 주소(`hello@doyeong.dev`)를 바꿀지는 "결정할 것" 3번에 따른다. 바꾸면 Cloudflare Email Routing으로 받는 주소를 먼저 만든다.

발신 도메인을 `to3mato.doyeong.dev`로 이미 등록했다면 새 도메인으로 다시 인증한다. 메일 평판은 도메인별로 쌓이므로 실사용자에게 보내기 전에 옮긴다.

### 3단계: Auth 주소

- Supabase 원격 Site URL을 `https://to3mato.com`으로 바꾼다. Redirect URL이 허용 목록에 없을 때 쓰이는 주소다.
- Redirect URLs의 `http://127.0.0.1:43117/auth/callback**`와 `to3mato://auth/callback`은 유지한다.

### 4단계: iOS Universal Link (선택)

iOS는 지금 `to3mato://` 스킴으로 로그인 링크를 받는다. Universal Link로 바꾸려면:

- `https://to3mato.com/.well-known/apple-app-site-association`을 사이트에 둔다. `applinks`에는 로그인 경로만 넣는다.
- 앱의 Associated Domains에 `applinks:to3mato.com`을 추가한다.
- Redirect URLs에 해당 경로를 추가한다.

공유 페이지는 다른 호스트이므로 AASA에서 따로 제외할 필요가 없다.

### 5단계: 공유 페이지

마이크로블로그 기획이 정해진 뒤 진행한다. 주소 관련 원칙만 먼저 정한다.

- 공유 하위 도메인은 제품 사이트와 다른 Pages 프로젝트 또는 Worker로 운영한다. 쿠키를 두지 않는다.
- 링크 미리보기를 위해 서버에서 HTML 메타 태그를 만든다.
- 기본 `noindex`. 링크를 끄면 404를 돌려주고 캐시를 비운다.
- 악용 신고를 받을 연락처를 페이지에 둔다.
- 공개 페이지가 생기기 전에 개인정보처리방침에 해당 내용을 넣는다.

### 6단계: 다운로드 도메인 추가 (선택)

R2 버킷에 `to3mato.com` 쪽 다운로드 하위 도메인을 하나 더 연결하면 새 다운로드 링크와 새 빌드의 업데이트 피드를 새 주소로 옮길 수 있다. 옛 주소는 계속 같은 버킷을 가리키게 둔다. 업데이트 피드 주소를 바꾸면 `tests/updater.test.mjs`와 릴리스 검증 스크립트를 함께 고친다. 필요해질 때 따로 설계한다.

## 결정할 것

1. 공유 페이지 하위 도메인 이름.
2. 메일 하위 도메인 이름. Resend에 `to3mato.doyeong.dev`를 이미 등록했는가.
3. 약관·개인정보처리방침의 문의 주소를 `to3mato.com` 쪽으로 바꾸는가. 바꾸면 페이지 수정은 사이트 재배포가 필요하고 `SITE_RELEASE_DIR`로 현재 공개 버전의 릴리스 폴더를 지정한다.
4. iOS 로그인을 Universal Link로 바꾸는가, `to3mato://` 스킴을 유지하는가.
5. 1단계를 동기화 릴리스와 별도로 먼저 진행하는가.
