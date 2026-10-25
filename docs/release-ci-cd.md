# 릴리스 CI/CD

`.github/workflows/release.yml`이 macOS Apple Silicon 앱을 검증하고 서명·공증한 뒤 기존 Cloudflare R2에 배포하고 다운로드 웹사이트를 Cloudflare Pages에 자동 갱신한다.

## 실행 조건

| 이벤트                                                        | 동작                                                                          |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `release/<버전>` 푸시                                         | 검증 → macOS UI 테스트·패키징 → 서명·공증 → R2 배포 → 웹사이트 갱신·공개 검증 |
| `release/*`에서 `main`으로 보내는 PR 또는 `release/*` 대상 PR | 검증과 테스트만 실행. Secrets를 사용하지 않음                                 |
| Actions 수동 실행, `deploy=false`                             | 선택한 브랜치의 검증과 테스트만 실행                                          |
| Actions 수동 실행, `deploy=true`                              | `release/<버전>` 브랜치에서만 배포                                            |
| `main` 푸시                                                   | 자동 실행 없음                                                                |

브랜치명은 `package.json`과 `package-lock.json`의 버전과 일치해야 한다. 예를 들어 버전이 `0.3.2`이면 `release/0.3.2`를 사용한다. 사전 공개 버전은 배포하지 않는다. 현재 정식 배포는 `0.3.5`이므로 다음 배포에는 새 버전이 필요하다.

## 작업 구성

1. **Validate**: Node.js 24에서 `npm ci`, 브랜치·버전 일치 검사, `npm run check`, `npm test`, `npm run build`.
2. **macOS tests and package**: `macos-15` Apple Silicon 러너에서 Chrome/Electron UI 테스트, 서명 없는 테스트 패키지 생성, 패키징 앱 테스트. 실패 시 `test-results`를 7일간 보관한다. 두 버전의 서명 앱 사이에서 실제 설치하는 별도 테스트는 이 단계에 포함하지 않는다.
3. **Sign and notarize**: 자격 증명 확인, 원격 피드보다 새 버전인지 확인, 현재 브랜치 끝 커밋 확인, 임시 키체인 생성, Developer ID 서명과 앱 공증, DMG 공증, 모든 산출물 해시 검증. DMG 공증은 최대 45분 기다린다. 검증된 산출물은 `signed-release-<실행 ID>`에 30일간 보관한다. 임시 공증 키체인은 성공·실패 모두 삭제한다.
4. **Publish app and website**: 같은 실행의 검증된 산출물을 다운로드하고 브랜치 끝 커밋을 다시 확인한 뒤 R2에 올린다. 버전 파일의 공개 URL 해시를 확인한 다음 `latest-mac.yml`을 마지막으로 게시한다. 같은 산출물의 버전·설치 파일 링크·용량·체크섬을 웹사이트에 반영한 뒤 Pages 운영 브랜치 `main`에 배포하고 공개 페이지와 메타데이터를 검증한다.

서명 없는 테스트 패키지는 배포하지 않는다. 여러 릴리스 브랜치의 R2·Pages 배포는 같은 작업과 동시 실행 제한 안에서 직렬화한다. 이전 버전의 느린 작업이 더 최신 피드를 덮어쓰지 못하도록 업로드 직전에도 원격 버전을 확인한다. 같은 버전의 파일은 정확히 같은 바이트일 때만 재전송할 수 있다.

사이트 생성은 `SITE_RELEASE_DIR=release/distribution npm run site:prepare`를 사용한다. 저장소의 HTML은 템플릿으로 유지하고 출력 폴더의 다운로드 정보만 갱신한다. 기존 소개·변경 내역 문구는 유지한다. Pages에는 설치 파일을 넣지 않고 검증된 R2 주소를 연결한다. 독립적인 사이트 배포는 `site:deploy`를 사용할 수 있다.

## GitHub Secrets

[저장소의 Actions Secrets 설정](https://github.com/kimdoyeong/to3mato/settings/secrets/actions)에 다음 7개를 등록한다. 값은 채팅이나 저장소 파일에 넣지 않는다.

| 이름                          | 값                                                                                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CSC_LINK`                    | Developer ID Application 인증서와 개인 키를 포함한 암호화된 `.p12` 파일의 Base64 문자열                                                                                                  |
| `CSC_KEY_PASSWORD`            | 위 `.p12`의 내보내기 암호                                                                                                                                                                |
| `APPLE_ID`                    | 공증에 사용할 Apple 계정                                                                                                                                                                 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 위 계정의 앱 전용 암호                                                                                                                                                                   |
| `APPLE_TEAM_ID`               | Developer ID 팀 ID. 기존 배포 팀은 `H2RM6XYB9D`                                                                                                                                          |
| `CLOUDFLARE_API_TOKEN`        | 해당 계정의 `Workers R2 Storage: Edit` 및 `Cloudflare Pages: Edit` 권한을 가진 Cloudflare API 토큰. Wrangler는 REST API를 사용하므로 S3 전용 `Object Read & Write` 토큰은 사용할 수 없음 |
| `CLOUDFLARE_ACCOUNT_ID`       | 위 R2 버킷이 속한 Cloudflare 계정 ID                                                                                                                                                     |

개인 키가 없는 인증서만으로는 서명할 수 없다. 기존 macOS 키체인 프로필과 로컬 Wrangler 로그인은 GitHub 러너로 자동 전달되지 않는다. Secrets가 없으면 서명 작업이 누락된 이름을 출력하고 중단한다. 로컬 개인 키와 로그인 토큰을 자동으로 추출하거나 업로드하지 않는다.

로컬 파일을 Secrets로 등록할 때는 `gh secret set CSC_LINK`에 Base64 인코딩한 파일을 표준 입력으로 전달할 수 있다. 나머지는 `gh secret set <이름>`의 비공개 입력을 사용한다. `.p12`와 암호 파일을 Git에 추가하지 않는다.

Apple 계정과 앱 전용 암호는 Mac의 터미널에서 `python3 scripts/register-apple-ci-secrets.py`로 등록할 수 있다. 두 입력은 화면에 표시하거나 파일에 저장하지 않으며, Apple 공증 서비스 인증을 확인한 뒤 해당 저장소의 Secrets에 등록한다. iCloud 키체인 항목이 화면 공유 제한으로 열리지 않으면 반복해서 인증을 요구하지 않고 이 입력 절차를 사용한다.

## 릴리스 절차

1. 검증할 변경을 포함하고 `npm version 0.3.2 --no-git-tag-version`처럼 새 버전을 지정한다. 버전은 예시이며 실제 다음 버전을 사용한다.
2. `release/0.3.2` 브랜치에 해당 변경과 버전 파일을 커밋한다.
3. `git push -u origin release/0.3.2`로 자동화를 시작한다. 검증을 통과하면 R2의 정식 업데이트 피드가 바뀐다.
4. Actions에서 네 작업의 성공과 공개 업데이트 피드·다운로드 웹페이지의 버전, 링크, 체크섬을 확인한다.
5. 릴리스 변경을 `main`에 반영한다. 배포된 버전의 파일을 수정해 재빌드하지 않는다.

서명 작업 전이나 업로드 직전에 브랜치가 다른 커밋으로 이동했다면 이전 실행은 게시하지 않는다. 가장 최근 커밋의 실행을 사용한다.

## 실패와 재시도

- 테스트 실패: 원인을 수정하고 검증을 다시 실행한다. 실패한 실행은 배포 단계로 진행하지 않는다.
- 서명·공증 실패: Secrets와 Apple 응답을 확인한다. 공증되지 않은 파일은 게시하지 않는다.
- R2 업로드 실패: 같은 실행의 **Re-run failed jobs**로 Publish 작업만 다시 실행한다. 성공한 서명 작업을 재빌드하지 않고 저장된 동일 산출물을 사용한다. 아티팩트가 만료되었으면 새 버전으로 릴리스한다.
- 웹사이트 배포·검증 실패: 같은 실행의 **Re-run failed jobs**로 Publish 작업만 재실행한다. 같은 산출물의 R2 재검증 후 Pages를 재배포한다. Pages 편집 권한과 공개 페이지 전파 상태를 확인한다. 앱 파일을 재빌드하지 않는다.
- 이미 같은 버전이 배포됨: 새 커밋이나 새 빌드는 버전을 올린다. 같은 버전의 다른 파일을 강제로 덮어쓰지 않는다.
- 더 최신 버전이 배포됨: 오래된 실행을 다시 게시하지 않는다. 필요하면 더 높은 버전으로 수정 릴리스를 만든다.

## 검증과 참고

로컬에서 `npm run check`, `npm test`, `npm run build`, `actionlint`를 실행한다. `tests/ci-release.test.mjs`는 브랜치·버전 일치와 다운그레이드·잘못된 원격 피드 거부를 검증한다. `tests/release.test.mjs`는 실제 업로드 없이 해시·게시 순서·버전 파일 불변성을 검증한다.

워크플로 변경을 GitHub에 올린 뒤 `main`에서 `deploy=false`로 수동 실행하면 Secrets 없이 원격 CI를 검증할 수 있다. 서명·공증·실제 R2 배포 검증은 Secrets 등록 후 새 릴리스 버전에서 수행한다.

- [GitHub macOS 러너 사양](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [GitHub Actions Secrets 등록](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)

## 최초 설정 검증 (2026-10-20)

- [GitHub Actions 검증 실행](https://github.com/kimdoyeong/to3mato/actions/runs/39359511757): 기본 검증, macOS UI 테스트, 서명 없는 패키징과 패키징 앱 테스트 성공. `main`, `deploy=false`로 실행했으므로 서명·공증과 R2 게시는 실행하지 않았다.
- 로컬 `actionlint`, 타입 검사와 빌드 통과. 게시 도중 최신 피드가 바뀌는 경우와 동일 산출물 재시도까지 포함해 단위 테스트 76개 통과.
- 사용자의 요청으로 `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_TEAM_ID`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`을 등록했다. 인증서는 해당 앱의 Developer ID Application 인증서와 개인 키만 선택해 암호화했고 임시 파일은 삭제했다.
- `to3mato-github-release` Cloudflare 토큰을 해당 계정의 R2 편집 권한으로 발급했다. 토큰 활성 상태와 `to3mato-downloads` 버킷 접근을 확인했다.
- 사용자가 비공개 입력 도구로 `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`를 등록했고 필수 Secrets 7개가 모두 존재함을 확인했다. 실제 서명·공증·R2 자동 배포 결과는 아래 릴리스 기록에 남긴다.

## 0.3.1 릴리스 (2026-10-20)

- 브랜치 `release/0.3.1`, 커밋 `8e2377555d7b9b6ea6f9d798400c16d24b371817`, 태그 `v0.3.1`.
- [릴리스 실행](https://github.com/kimdoyeong/to3mato/actions/runs/39367667966)의 Validate, macOS tests and package, Sign and notarize, Publish to R2가 모두 성공했다. 단위 테스트 76개, 브라우저·Electron 테스트, 패키징 앱 검사, 앱·DMG 서명과 공증을 통과했다.
- 공개 `latest-mac.yml`과 `release.json`이 `0.3.1`임을 확인했다. CI는 게시 파일의 공개 다운로드 해시를 검증했다.
- 공개 주소에서 DMG를 다시 내려받아 SHA-256·크기를 대조했고, `codesign --verify`, `stapler validate`, Gatekeeper 검사에서 `Notarized Developer ID` 승인을 확인했다.
- [macOS Apple Silicon 설치 파일](https://downloads.to3mato.doyeong.dev/To3mato-0.3.1-arm64.dmg). 앱과 업데이트 피드의 배포이며 다운로드 웹사이트는 이번에 재배포하지 않았다.

## 로컬 설치본 업데이트 오류 복구 (2026-10-20)

- `/Applications`의 기존 0.3.0 설치본은 `Contents/Resources/app-update.yml`이 없었다. 피드 조회는 성공했지만 다운로드 초기화에서 `ENOENT`가 발생했고 UI에는 일반 네트워크 오류가 표시됐다.
- 공식 0.3.1 DMG에서 추출한 앱에는 해당 설정이 포함되어 있었다. 서명·공증을 검증한 공식 앱으로 교체하고 실제 설정 화면에서 업데이트 확인 성공을 확인했다.
- 교체 전 앱과 데이터베이스를 로컬 `release/install-backup-20261020-031/`에 백업했다. 데이터베이스 마이그레이션 이후 기존 프로젝트·할 일·집중 기록 내용·설정·일시정지 타이머 값을 대조했고 보존됨을 확인했다. 기존 집중 기록 ID는 마이그레이션 규칙에 따라 변환됐다.
- 사용자의 승인으로 집중 타이머를 일시정지하고 교체 후 남은 11분 37초부터 재개했다. 이 복구는 로컬 앱 교체이며 이미 게시된 0.3.1 파일은 변경하지 않았다.

## 0.3.2 릴리스 및 웹사이트 자동 갱신 (2026-10-20)

- 브랜치 `release/0.3.2`, 커밋 `7f42223967da0bb994e0eb4289625e00fb7f4954`, 태그 `v0.3.2`.
- [릴리스 실행](https://github.com/kimdoyeong/to3mato/actions/runs/39370703850)의 Validate, macOS tests and package, Sign and notarize, Publish app and website가 모두 성공했다. 단위 테스트 79개와 UI·패키징 앱 검증을 통과했다.
- 집중 시간 만료 후 휴식을 자동 시작하고 휴식 완료 시 알림을 보낸다. 다음 집중은 직접 시작한다. 집중 완료와 자동 휴식 시작 알림이 중복되지 않도록 처리했다.
- 최초 실행에서 발견한 패키징 앱 종료 검사 경합을 수정했다. 창을 닫아 Electron 연결이 먼저 종료되는 경우를 처리하면서 프로세스의 정상 종료 코드까지 확인한다.
- 사용자의 승인으로 기존 `to3mato-github-release` 토큰에 같은 계정의 Cloudflare Pages 편집 권한을 추가했다. 기존 GitHub Secret을 그대로 사용해 Pages 자동 배포가 성공했다.
- R2 파일과 피드 게시 이후 동일 산출물로 웹사이트를 생성·배포했다. 공개 다운로드 페이지, 사이트 `release.json`·체크섬, R2 릴리스 정보와 자동 업데이트 피드가 모두 0.3.2임을 캐시 우회 없는 요청으로 확인했다.
- [다운로드 페이지](https://to3mato.doyeong.dev/download)의 설치 파일은 `To3mato-0.3.2-arm64.dmg`, 크기는 145,371,873바이트(표시 138.6 MB)다. 사용자 소개 문구와 기존 변경 내역은 유지했다.
- 설치된 사용자 앱을 이번 작업에서 종료하거나 교체하지 않았다. 앱 기능 변경은 0.3.2 업데이트 적용 후 사용할 수 있다.

## 0.3.3 릴리스 (2026-10-20)

- 브랜치 `release/0.3.3`, 커밋 `d3d21a264425e0f8d5f0621d3699334d432cece3`, 태그 `v0.3.3`.
- 프로젝트 상세에 삭제 버튼과 확인 창을 추가했다. 삭제 시 할 일은 프로젝트 연결만 해제하고 집중 기록과 실행 중인 타이머는 유지한다.
- 할 일의 예상 포모도로를 최대 6개로 제한했다. 개별 추가·수정과 일괄 추가에 적용하며 기존 6개 초과 값은 읽기와 다른 항목 수정 시 보존한다.
- [릴리스 실행](https://github.com/kimdoyeong/to3mato/actions/runs/39384040545)의 Validate, macOS tests and package, Sign and notarize, Publish app and website가 모두 성공했다. 단위 테스트 81개, 브라우저·Electron 테스트 17개, 패키징 앱 테스트 5개를 통과했다.
- 일반 UI 실행에서 제외된 3개 중 1개는 패키징 앱 전용 검사이며 후속 패키징 단계에서 통과했다. 나머지 2개는 별도 서명 앱을 요구하는 0.3.0 → 0.3.1 실제 설치 테스트로 이번 CI에서 실행하지 않았다.
- 앱·DMG 서명과 공증, `release:verify`, R2 공개 파일 해시 검증을 통과했다. 다운로드 웹사이트도 동일 산출물로 생성·배포하고 공개 버전·링크·체크섬 검증을 통과했다.
- 캐시 우회 없는 요청으로 공개 업데이트 피드, R2·사이트의 `release.json`과 체크섬, [다운로드 페이지](https://to3mato.doyeong.dev/download)가 모두 0.3.3 산출물과 일치함을 확인했다.
- 설치 파일은 `To3mato-0.3.3-arm64.dmg`, 크기는 145,364,532바이트(표시 138.6 MB), SHA-256은 `aadeb818cac0750cf6f8af95170f7905089c999ade2bb37d3870f7ba56b7d384`다.
- 설치된 사용자 앱은 종료하거나 교체하지 않았다. 이번 변경은 0.3.3 업데이트 적용 후 사용할 수 있다.

## 0.3.4 릴리스 (2026-10-21)

- 브랜치 `release/0.3.4`, 커밋 `74d094cc7ded6632da6da8855ea231e04d4c612e`, 태그 `v0.3.4`.
- 트레이 아이콘이 집중 대기·일시정지·휴식 중·휴식 대기를 구분해 표시한다. 대기와 일시정지는 마스코트를 흑백으로 바꾸고, 일시정지와 휴식은 단계 색 배지를 붙인다. 네 가지 표시 방식에 모두 적용된다.
- [첫 실행](https://github.com/kimdoyeong/to3mato/actions/runs/39525884259)은 커밋 `243c9b5`에서 Validate와 macOS tests and package를 통과했지만 Sign and notarize의 최종 검증에서 ZIP에서 추출한 앱의 `stapler validate`가 실패했다. 앱·DMG 공증 자체는 성공했고, 스크립트가 stapler의 stdout을 출력하지 않아 사유가 남지 않았다. 게시 단계는 실행되지 않았다.
- `scripts/notarize-mac.mjs`가 실패한 명령의 stdout·stderr를 함께 출력하고 온라인 티켓 조회인 `stapler validate`만 최대 3회 재시도하도록 수정했다. 티켓이 없는 번들은 여전히 실패한다.
- [릴리스 실행](https://github.com/kimdoyeong/to3mato/actions/runs/39526857154)의 Validate, macOS tests and package, Sign and notarize가 성공했다. 재시도 경고 없이 첫 검증에서 통과했다. 단위 테스트 82개를 통과했다.
- 첫 시도의 Publish app and website는 DMG를 R2에 올리는 도중 Cloudflare API가 502를 반환해 실패했다. 같은 실행의 Re-run failed jobs로 Publish 작업만 재실행했고, 서명 작업의 동일 산출물 `signed-release-39526857154`를 내려받아 두 번째 시도에서 성공했다.
- 캐시 우회 없는 요청으로 공개 업데이트 피드, R2·사이트의 `release.json`과 `SHA256SUMS.txt`, [다운로드 페이지](https://to3mato.doyeong.dev/download)의 버전·링크·용량이 모두 0.3.4 산출물과 일치함을 확인했다.
- 설치 파일은 `To3mato-0.3.4-arm64.dmg`, 크기는 145,362,806바이트(표시 138.6 MB), SHA-256은 `1fb5a4e580adb1b81f361041e514b1e7069e1e0cf8430ec29f41187a4518b06d`다.
- 설치된 사용자 앱은 종료하거나 교체하지 않았다. 이번 변경은 0.3.4 업데이트 적용 후 사용할 수 있다.

## 0.3.5 릴리스 (2026-10-25)

- 브랜치 `release/0.3.5`, 커밋 `0bc4d3b38bef89334e9f0b4d6bd30e18fc5111e1`, 태그 `v0.3.5`.
- 메인 창의 닫기 버튼은 창만 숨긴다. 앱과 트레이, 실행 중인 타이머는 유지하고 트레이 메뉴·Dock·앱 재실행으로 창을 다시 연다. 명시적인 종료와 업데이트 설치 시에는 기존 종료 절차를 따른다.
- [첫 실행](https://github.com/kimdoyeong/to3mato/actions/runs/40192877087)은 브라우저 테스트에서 일요일의 다음 날을 이번 주 화면에서 찾다가 제한 시간을 초과했다. 창 닫기·트레이 테스트는 통과했으며 서명·공증과 게시 단계는 실행하지 않았다. 다음 날이 월요일이면 다음 주로 이동하도록 테스트를 수정했다.
- [릴리스 실행](https://github.com/kimdoyeong/to3mato/actions/runs/40193233830)의 Validate, macOS tests and package, Sign and notarize, Publish app and website가 모두 성공했다. 단위 테스트 82개, 브라우저·Electron 테스트 17개, 패키징 앱 테스트 5개를 통과했다.
- 일반 UI 실행에서 제외된 3개 중 패키징 앱 전용 검사는 후속 패키징 단계에서 통과했다. 별도 서명 앱을 요구하는 0.3.0 → 0.3.1 실제 설치 테스트 2개는 이번 CI에서 실행하지 않았다.
- 앱·DMG 서명과 공증, `release:verify`, R2 공개 파일 해시 검증을 통과했다. 동일 산출물로 다운로드 웹사이트를 생성·배포하고 공개 버전·링크·체크섬 검증을 통과했다.
- 캐시 우회 없는 요청으로 공개 업데이트 피드, R2·사이트의 `release.json`과 `SHA256SUMS.txt`, [다운로드 페이지](https://to3mato.doyeong.dev/download)의 버전·링크·용량이 모두 0.3.5 산출물과 일치함을 확인했다. 공개 DMG를 스트리밍으로 읽어 크기와 SHA-256도 독립적으로 대조했다.
- 설치 파일은 `To3mato-0.3.5-arm64.dmg`, 크기는 145,356,253바이트(표시 138.6 MB), SHA-256은 `6282dcb041499ea2c09ff001eb5c7af1c8139c00eb90b2168322f711376aaac6`다.
- 설치된 사용자 앱은 종료하거나 교체하지 않았다. 창 닫기 동작은 0.3.5 업데이트 적용 후 사용할 수 있다. 사용자 화면의 새 문구는 추가하지 않았으며 사이트는 다운로드 정보만 갱신했다.
