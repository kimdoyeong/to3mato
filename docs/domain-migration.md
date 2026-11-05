# To3mato 도메인 전환 계획

작성일: 2026-11-05
상태: 진행 중. `to3mato.com` 구입 완료(Cloudflare 네임서버 `amy`, `gordon`). 1단계 사이트 전환과 2단계 메일 발송 전환 완료. 하위 도메인 이름과 단계별 시점은 "결정할 것"에 답을 받은 뒤 정한다.

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
| `doyeong.dev` (메일) | 로그인 메일 발신 도메인. Resend 리전 `ap-northeast-1`. `resend._domainkey` TXT, `send` MX·TXT 있음. DMARC 없음(2026-11-05 확인). Supabase의 실제 발신 주소는 대시보드에서 확인 | Resend, Supabase SMTP |
| `hello@doyeong.dev` | 약관·개인정보처리방침의 문의 주소 | `website/dist/privacy.html`, `website/dist/terms.html` |

로그인 콜백은 도메인을 쓰지 않는다.

- Mac: `http://127.0.0.1:43117/auth/callback` (`electron/auth-callback.mjs`)
- iOS: `to3mato://auth/callback` (`ios/To3matoKit/Sources/To3matoCloud/Cloud.swift`)

## 목표 주소 구성

| 주소 | 용도 |
| --- | --- |
| `to3mato.com` | 소개·다운로드·약관·개인정보처리방침 사이트. Supabase Site URL. 이후 iOS Universal Link |
| 공유 하위 도메인 (이름 미정) | 마이크로블로그 공개 페이지. 별도 Pages 프로젝트 또는 Worker |
| `noreply@to3mato.com` | 로그인 메일 발신. 발신 도메인은 루트 `to3mato.com` |
| `to3mato.doyeong.dev` | 경로와 쿼리를 유지한 채 `to3mato.com`으로 301 |
| `downloads.to3mato.doyeong.dev` | 그대로 유지 |

### 바꾸지 않는 것

- `downloads.to3mato.doyeong.dev`. 설치된 앱의 업데이트 피드 주소가 빌드에 들어 있다(`electron/updater.mjs`, `electron-builder.release.cjs`). 이 주소를 내리면 옛 버전은 업데이트를 받지 못한다.
- 릴리스 기록(`docs/release-ci-cd.md`의 지난 릴리스 결과)에 남은 옛 링크. 당시 기록이므로 고치지 않는다. 301로 계속 열린다.
- Mac과 iOS의 로그인 콜백 주소.

## 단계

각 단계는 독립적이다. 2단계를 먼저 진행한다.

### 1단계: 사이트

사용자 작업 (Cloudflare 대시보드):

1. Pages 프로젝트 `to3mato`의 Custom domains에 `to3mato.com`을 추가한다. `www`는 쓰지 않으므로 레코드를 만들지 않는다.
2. `doyeong.dev` 존에 `to3mato.doyeong.dev/*` → `https://to3mato.com/${path}` 301 규칙을 둔다. 쿼리 문자열을 유지한다.

Pages 프로젝트는 그대로이므로 사이트를 다시 배포할 필요가 없다. 사이트 HTML에는 절대 주소가 없다(`canonical`, `og:url` 없음).

`to3mato.doyeong.dev`에는 프록시를 켠 DNS 레코드가 있어야 규칙이 동작한다. URI 레코드는 브라우저가 읽지 않으므로 리다이렉트에 쓸 수 없다. 2026-11-05 적용: 프록시 레코드 + Single Redirect(`concat("https://to3mato.com", http.request.uri.path)`, 301, 쿼리 유지).

진행 상태 (2026-11-05): `to3mato.com/download`가 200, `to3mato.doyeong.dev`의 `/`, `/about`, `/download?x=1`, `/downloads/release.json`이 같은 경로의 `to3mato.com`으로 301. R2의 0.6.0 `release.json`·`SHA256SUMS.txt`를 `SITE_RELEASE_DIR`로 지정해 `verify-site-release.mjs`가 새 주소에서 통과했다.

저장소 변경 (`release/*`가 아닌 브랜치에서 작업하고 main에 합친다):

| 파일 | 변경 |
| --- | --- |
| `scripts/release-files.mjs`, `scripts/verify-site-release.mjs` | 공개 검증 주소를 `SITE_URL`(`https://to3mato.com/`) 상수로 |
| `website/README.md` | 웹사이트 주소 |
| `docs/portfolio.md` | 앱 사이트 주소 |

이 변경은 대시보드 작업으로 `to3mato.com`이 열린 뒤에 main에 합친다. 먼저 합치면 다음 릴리스의 공개 페이지 검증이 실패한다. 합치기 전에 `SITE_RELEASE_DIR`로 현재 공개 버전의 릴리스 폴더를 지정해 `node scripts/verify-site-release.mjs`를 실행해 새 주소에서 통과하는지 확인한다.

검증:

- `https://to3mato.com/download`와 `https://to3mato.doyeong.dev/download?x=1`이 각각 200, 301(`https://to3mato.com/download?x=1`)을 돌려준다.
- 다운로드 페이지의 DMG 링크가 여전히 `downloads.to3mato.doyeong.dev`를 가리키고 200을 돌려준다.

### 2단계: 메일

발신 주소는 `noreply@to3mato.com`이다. 발신 도메인은 루트 `to3mato.com`으로 정했다. 메일 평판은 사이트와 같은 도메인에 쌓인다.

사용자 작업 (Resend, Cloudflare, Supabase 대시보드):

1. Resend Domains에 `to3mato.com`을 추가한다. 리전은 기존 `doyeong.dev`와 같은 `ap-northeast-1`(도쿄)로 한다.
2. Resend가 알려주는 레코드를 `to3mato.com` 존에 추가한다. 값은 Resend 화면의 것을 그대로 쓴다. Cloudflare 프록시는 끈다(DNS only). 2026-11-05에 넣은 레코드:
   - DKIM: `resend._domainkey` TXT
   - 반송 경로: `send` CNAME → `send.forge.rmta.net`, `rsend` CNAME → `rsend-apne1.forge.rmta.net`. 실제 Return-Path는 `rsend.to3mato.com`이고 그 아래에서 Amazon SES(`ap-northeast-1`)의 MX와 SPF로 이어진다. `doyeong.dev`의 `send` MX·TXT 방식과 형식이 다르다.
3. `_dmarc` TXT를 `v=DMARC1; p=none;`으로 추가한다. 수신 결과를 본 뒤 `quarantine`으로 올린다.
4. Resend에서 도메인이 Verified가 되면 `to3mato.com` 전송 전용 API 키를 만든다. 키는 채팅이나 저장소에 남기지 않는다.
5. 새 발신 주소로 메일이 정상 발송되는 것을 확인한 뒤 Resend의 `doyeong.dev` 도메인과 그 도메인 전용 API 키를 정리한다. 다른 곳에서 쓰지 않으면 도메인과 `resend._domainkey`, `send` 레코드를 지운다. `doyeong.dev`의 Cloudflare Email Routing(`hello@doyeong.dev` 수신)은 건드리지 않는다.
6. Supabase Authentication → SMTP Settings에서 사용자 지정 SMTP를 켠다.
   - Host `smtp.resend.com`, Port `465`, Username `resend`, Password는 4번의 API 키
   - Sender email `noreply@to3mato.com`, Sender name `To3mato`
7. 문의 주소(`hello@doyeong.dev`)를 바꿀지는 "결정할 것" 2번에 따른다. 바꾸면 Cloudflare Email Routing으로 받는 주소를 먼저 만든다.

진행 상태 (2026-11-05): 1~4번과 6번 완료. 첫 시도는 Resend가 `550 This API key is not authorized to send emails from to3mato.com`으로 거부했다. `to3mato.com` 권한이 있는 키로 바꾼 뒤 iCloud로 받은 로그인 메일이 `dkim=pass header.d=to3mato.com`, `spf=pass`(`rsend.to3mato.com`), `dmarc=pass`로 받은편지함에 들어왔고 링크로 Mac 앱(0.6.0) 로그인까지 확인했다. 5번(`doyeong.dev` 정리)은 남았다.

SMTP 연결 뒤 에이전트 작업:

- 원격 Auth의 메일 템플릿을 적용한다. 원격 설정은 선언한 항목만 별도 작업 폴더에서 push하고 `n`으로 미리 보기를 먼저 한다.
- 앱은 로그인 링크(PKCE)로 로그인한다. `supabase/templates/code.html`은 인증 코드만 보여주고 링크가 없다. 그대로 로그인 링크 템플릿에 적용하면 링크로 로그인할 수 없다. 적용 전에 템플릿 내용을 다시 정한다.
- 원격 OTP 유효 시간은 3600초(2026-10-27 기준)이고 `code.html`의 안내는 10분 기준이다. 둘 중 하나를 맞춘다.

검증:

- `dig TXT resend._domainkey.to3mato.com`, `dig MX send.to3mato.com`, `dig TXT _dmarc.to3mato.com`에 레코드가 보인다.
- 팀원이 아닌 주소로 Mac과 iPhone에서 로그인 링크를 받아 로그인한다. 받은 메일 헤더의 `dkim=pass`, `spf=pass`, `dmarc=pass`를 확인한다.

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
2. 약관·개인정보처리방침의 문의 주소를 `to3mato.com` 쪽으로 바꾸는가. 바꾸면 페이지 수정은 사이트 재배포가 필요하고 `SITE_RELEASE_DIR`로 현재 공개 버전의 릴리스 폴더를 지정한다.
3. iOS 로그인을 Universal Link로 바꾸는가, `to3mato://` 스킴을 유지하는가.
4. 1단계(사이트)를 2단계 뒤 언제 진행하는가.
