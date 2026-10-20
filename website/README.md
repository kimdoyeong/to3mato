# To3mato 정적 사이트

실제 Electron 앱을 촬영한 화면을 사용하는 랜딩·소개·다운로드 페이지입니다. HTML과 CSS만 사용합니다. 서버 기능과 JavaScript 런타임 및 외부 CDN 없이 동작합니다.

## 미리보기

프로젝트 루트에서 실행합니다.

```sh
python3 -m http.server 4175 --bind 127.0.0.1 --directory website/dist
```

- 홈: http://127.0.0.1:4175/
- 소개: http://127.0.0.1:4175/about.html
- 다운로드: http://127.0.0.1:4175/download.html

`dist/index.html`을 브라우저로 직접 열어도 볼 수 있습니다. 다운로드 확인은 HTTP 미리보기를 권장합니다.

## 파일

- `dist/index.html`: 랜딩 페이지
- `dist/about.html`: 계획 철학, 타이머, 3초 집중 로그·월요일 영상 배달과 현재 기능 소개
- `dist/download.html`: 설치 파일과 설치 방법 및 지원 환경
- `dist/assets/site.css`: 반응형 공통 스타일
- `dist/assets/*.png`: 예시 데이터로 촬영한 실제 앱 화면과 기존 앱 아이콘
- `dist/assets/mascot.svg`: 앱에서 사용하는 토마토 캐릭터 원본
- `dist/downloads/`: 실제 macOS 설치 파일과 SHA-256 및 릴리스 정보
- `capture.json`: 화면 촬영 환경
- `qa/`: 화면 검토용 캡처와 자동 검사 결과. 사이트 배포에는 필요하지 않습니다.

`dist/` 전체를 정적 호스팅에 올리면 동작하도록 상대 경로로 연결했습니다. Cloudflare 배포 시 아래 절차로 별도 업로드 폴더를 생성합니다. 앱의 빌드 폴더인 프로젝트 루트 `dist/`와 구분합니다.

## 실제 앱 화면 다시 촬영

프로젝트 루트에서 실행합니다. Google Chrome과 Electron을 실행할 수 있는 macOS 환경을 사용합니다.

```sh
npm run build
node scripts/capture-site-screenshots.mjs
```

임시 앱 데이터 폴더에 예시 데이터만 생성합니다. 실제 사용자 데이터는 읽거나 변경하지 않습니다. 앱 창을 직접 조작하여 할 일·프로젝트·캘린더·일괄 추가·검토·집중 로그·인증샷 제안 화면을 촬영하고 임시 데이터를 삭제합니다. 스크린샷은 원본 PNG이며 화면을 눌러 새 탭에서 확대할 수 있습니다.

## 설치 파일

현재 파일은 `To3mato-0.3.0-arm64.dmg`입니다. Apple Silicon과 macOS 13 이상용입니다. v0.3.0은 Developer ID Application 서명과 Apple 공증, 인증 정보 부착 및 검증을 완료했습니다. 2026-10-20 공증된 설치 파일을 R2에 업로드하고 다운로드 사이트의 링크·버전·용량과 릴리스 메타데이터를 갱신해 Cloudflare Pages에 배포했습니다. 기존 버전 파일은 보존했습니다. Intel·Windows·Linux 파일은 제공하지 않습니다.

앱 변경 시 `npm run dist:mac`으로 새 설치 파일을 만들고 `npm run notarize:mac`으로 공증을 제출합니다. 처리 중이라면 같은 명령으로 기존 제출 상태를 확인합니다. 승인 후 최종 검증이 완료된 `release/distribution/`의 DMG와 체크섬 및 릴리스 정보를 `website/dist/downloads/`에 복사합니다. 버전·용량·지원 환경을 `download.html`에 갱신하고 `downloads/release.json`과 `downloads/SHA256SUMS.txt`도 새 파일에 맞춰 갱신해야 합니다. 옛 설치 파일 링크를 남기지 않습니다.

## 검증

로컬 미리보기 서버를 실행한 상태에서 다음을 실행합니다.

```sh
node scripts/check-website.mjs
```

3개 페이지를 1440·768·390·320px 너비에서 검사합니다. 가로 넘침·이미지 로드·링크·내부 이동·FAQ 펼치기·키보드 본문 이동을 확인합니다. 다운로드 버튼으로 실제 DMG를 받아 SHA-256을 비교합니다. 결과는 `qa/report.json`에 기록합니다. 정적 HTML 파일을 직접 여는 동작도 확인합니다.

실제 다운로드 파일은 `hdiutil verify`로 디스크 이미지 무결성을 확인했습니다. 앱 전체의 기존 검증은 프로젝트 README를 참조하세요.

## 이미지와 폰트

앱의 기존 캐릭터와 예시 데이터 화면을 사용합니다. 워드마크용 Gamja Flower 폰트도 로컬에 포함했습니다. 폰트 라이선스는 `dist/assets/FONT-LICENSE.txt`에 있습니다. 그 외 본문은 시스템 글꼴을 사용합니다.

## Cloudflare 배포

- 웹사이트: `https://to3mato.doyeong.dev`
- Pages 기본 주소: `https://to3mato.pages.dev`
- Pages 프로젝트: `to3mato` (production branch: `main`)
- R2 버킷: `to3mato-downloads`
- 다운로드 도메인: `https://downloads.to3mato.doyeong.dev`

Cloudflare 계정에 `wrangler login`으로 로그인한 뒤 실행합니다. 인증 토큰은 저장소에 넣지 않습니다.

```sh
npm run site:deploy
```

`site:prepare`는 공증된 DMG의 해시를 확인하고 `website/cloudflare-dist/`를 다시 만듭니다. DMG와 blockmap은 Pages 업로드에서 제외하며 다운로드 링크를 R2의 공개 주소로 연결합니다. 원본 `website/dist/`는 로컬 미리보기용 상대 링크를 유지합니다. `--force`는 Wrangler 4.151.2에서 Workers로 자동 전환하지 않고 Pages 배포 경로를 사용하기 위한 옵션입니다.

새 앱 버전을 배포할 때는 서명과 공증을 완료한 DMG 및 `SHA256SUMS.txt`와 `release.json`을 먼저 R2 버킷에 업로드합니다. DMG에는 `application/x-apple-diskimage`와 `Content-Disposition: attachment`를 지정합니다. R2의 실제 다운로드 체크섬을 확인한 뒤 사이트를 배포합니다.

Pages 커스텀 도메인은 프로젝트에 등록하며 DNS에는 `to3mato` → `to3mato.pages.dev` CNAME을 사용합니다. R2 다운로드 도메인은 버킷의 Custom Domains로 연결했고 해당 DNS 레코드는 R2가 관리합니다. 두 도메인의 인증서가 활성화되고 HTTPS 응답이 정상인지 확인해야 합니다.

## v0.2.0 사이트 업데이트

홈에 주간 영상 편지 소개를 추가하고, 소개 페이지의 `#focus-log`에는 3초 영상으로 집중한 순간을 남기고 매주 돌아보는 짧은 소개와 실제 앱 화면을 담았습니다. 검토 의견에 따라 이미지 캡션, 단계별 설명, 부가 안내와 기능 목록은 제거했습니다. 다운로드 페이지에는 변경 내용, 카메라 접근 시점, 앱이 꺼져 있을 때의 배달 처리와 영상이 JSON 백업에 포함되지 않는 점을 안내합니다.

## v0.3.0 사이트 업데이트

다운로드 버튼과 버전 표시·검색 메타데이터를 0.3.0으로 변경하고 최종 DMG 용량을 137.5 MB로 반영했습니다. 체크섬과 릴리스 정보도 정식 R2 배포 파일과 맞췄습니다. 기존 v0.2.0 변경 내역과 사용자 문구는 유지했습니다. 운영 도메인의 페이지·메타데이터가 배포 소스와 일치하고 설치 파일 경로가 R2의 0.3.0 DMG로 연결되는 것을 확인했습니다. Pages 배포 주소는 `https://c547faa4.to3mato.pages.dev`입니다.

운영 사이트의 3개 페이지를 1440·768·390·320px에서 검사했고 이미지·링크·화면 이동·FAQ와 실제 다운로드 체크섬 검증을 통과했습니다. 결과는 `qa/report.json`과 `qa/deployment.json`에 기록했습니다.
