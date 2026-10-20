# 릴리스 CI/CD

`.github/workflows/release.yml`이 macOS Apple Silicon 앱을 검증하고 서명·공증한 뒤 기존 Cloudflare R2에 배포한다.

## 실행 조건

| 이벤트 | 동작 |
| --- | --- |
| `release/<버전>` 푸시 | 검증 → macOS UI 테스트·패키징 → 서명·공증 → R2 배포 |
| `release/*`에서 `main`으로 보내는 PR 또는 `release/*` 대상 PR | 검증과 테스트만 실행. Secrets를 사용하지 않음 |
| Actions 수동 실행, `deploy=false` | 선택한 브랜치의 검증과 테스트만 실행 |
| Actions 수동 실행, `deploy=true` | `release/<버전>` 브랜치에서만 배포 |
| `main` 푸시 | 자동 실행 없음 |

브랜치명은 `package.json`과 `package-lock.json`의 버전과 일치해야 한다. 예를 들어 버전이 `0.3.1`이면 `release/0.3.1`을 사용한다. 사전 공개 버전은 배포하지 않는다. 현재 정식 배포는 `0.3.0`이므로 다음 배포에는 새 버전이 필요하다.

## 작업 구성

1. **Validate**: Node.js 24에서 `npm ci`, 브랜치·버전 일치 검사, `npm run check`, `npm test`, `npm run build`.
2. **macOS tests and package**: `macos-15` Apple Silicon 러너에서 Chrome/Electron UI 테스트, 서명 없는 테스트 패키지 생성, 패키징 앱 테스트. 실패 시 `test-results`를 7일간 보관한다. 두 버전의 서명 앱 사이에서 실제 설치하는 별도 테스트는 이 단계에 포함하지 않는다.
3. **Sign and notarize**: 자격 증명 확인, 원격 피드보다 새 버전인지 확인, 현재 브랜치 끝 커밋 확인, 임시 키체인 생성, Developer ID 서명과 앱 공증, DMG 공증, 모든 산출물 해시 검증. DMG 공증은 최대 45분 기다린다. 검증된 산출물은 `signed-release-<실행 ID>`에 30일간 보관한다. 임시 공증 키체인은 성공·실패 모두 삭제한다.
4. **Publish to R2**: 같은 실행의 검증된 산출물을 다운로드하고 브랜치 끝 커밋을 다시 확인한 뒤 R2에 올린다. 버전 파일의 공개 URL 해시를 확인한 다음 `latest-mac.yml`을 마지막으로 게시한다.

서명 없는 테스트 패키지는 배포하지 않는다. 여러 릴리스 브랜치의 R2 배포는 동시에 실행하지 않는다. 이전 버전의 느린 작업이 더 최신 피드를 덮어쓰지 못하도록 업로드 직전에도 원격 버전을 확인한다. 같은 버전의 파일은 정확히 같은 바이트일 때만 재전송할 수 있다.

이 자동화는 앱 설치 파일과 자동 업데이트 피드를 배포한다. 다운로드 웹사이트의 문구·링크 수정과 Cloudflare Pages 배포는 기존 `site:deploy` 절차를 따른다.

## GitHub Secrets

[저장소의 Actions Secrets 설정](https://github.com/kimdoyeong/to3mato/settings/secrets/actions)에 다음 7개를 등록한다. 값은 채팅이나 저장소 파일에 넣지 않는다.

| 이름 | 값 |
| --- | --- |
| `CSC_LINK` | Developer ID Application 인증서와 개인 키를 포함한 암호화된 `.p12` 파일의 Base64 문자열 |
| `CSC_KEY_PASSWORD` | 위 `.p12`의 내보내기 암호 |
| `APPLE_ID` | 공증에 사용할 Apple 계정 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 위 계정의 앱 전용 암호 |
| `APPLE_TEAM_ID` | Developer ID 팀 ID. 기존 배포 팀은 `H2RM6XYB9D` |
| `CLOUDFLARE_API_TOKEN` | `to3mato-downloads` 버킷의 R2 객체 쓰기 권한을 가진 API 토큰 |
| `CLOUDFLARE_ACCOUNT_ID` | 위 R2 버킷이 속한 Cloudflare 계정 ID |

개인 키가 없는 인증서만으로는 서명할 수 없다. 기존 macOS 키체인 프로필과 로컬 Wrangler 로그인은 GitHub 러너로 자동 전달되지 않는다. Secrets가 없으면 서명 작업이 누락된 이름을 출력하고 중단한다. 로컬 개인 키와 로그인 토큰을 자동으로 추출하거나 업로드하지 않는다.

로컬 파일을 Secrets로 등록할 때는 `gh secret set CSC_LINK`에 Base64 인코딩한 파일을 표준 입력으로 전달할 수 있다. 나머지는 `gh secret set <이름>`의 비공개 입력을 사용한다. `.p12`와 암호 파일을 Git에 추가하지 않는다.

## 릴리스 절차

1. 검증할 변경을 포함하고 `npm version 0.3.1 --no-git-tag-version`처럼 새 버전을 지정한다. 버전은 예시이며 실제 다음 버전을 사용한다.
2. `release/0.3.1` 브랜치에 해당 변경과 버전 파일을 커밋한다.
3. `git push -u origin release/0.3.1`로 자동화를 시작한다. 검증을 통과하면 R2의 정식 업데이트 피드가 바뀐다.
4. Actions에서 네 작업의 성공과 공개 업데이트 피드의 버전을 확인한다.
5. 릴리스 변경을 `main`에 반영한다. 배포된 버전의 파일을 수정해 재빌드하지 않는다.

서명 작업 전이나 업로드 직전에 브랜치가 다른 커밋으로 이동했다면 이전 실행은 게시하지 않는다. 가장 최근 커밋의 실행을 사용한다.

## 실패와 재시도

- 테스트 실패: 원인을 수정하고 검증을 다시 실행한다. 실패한 실행은 배포 단계로 진행하지 않는다.
- 서명·공증 실패: Secrets와 Apple 응답을 확인한다. 공증되지 않은 파일은 게시하지 않는다.
- R2 업로드 실패: 같은 실행의 **Re-run failed jobs**로 Publish 작업만 다시 실행한다. 성공한 서명 작업을 재빌드하지 않고 저장된 동일 산출물을 사용한다. 아티팩트가 만료되었으면 새 버전으로 릴리스한다.
- 이미 같은 버전이 배포됨: 새 커밋이나 새 빌드는 버전을 올린다. 같은 버전의 다른 파일을 강제로 덮어쓰지 않는다.
- 더 최신 버전이 배포됨: 오래된 실행을 다시 게시하지 않는다. 필요하면 더 높은 버전으로 수정 릴리스를 만든다.

## 검증과 참고

로컬에서 `npm run check`, `npm test`, `npm run build`, `actionlint`를 실행한다. `tests/ci-release.test.mjs`는 브랜치·버전 일치와 다운그레이드·잘못된 원격 피드 거부를 검증한다. `tests/release.test.mjs`는 실제 업로드 없이 해시·게시 순서·버전 파일 불변성을 검증한다.

워크플로 변경을 GitHub에 올린 뒤 `main`에서 `deploy=false`로 수동 실행하면 Secrets 없이 원격 CI를 검증할 수 있다. 서명·공증·실제 R2 배포 검증은 Secrets 등록 후 새 릴리스 버전에서 수행한다.

- [GitHub macOS 러너 사양](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [GitHub Actions Secrets 등록](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
