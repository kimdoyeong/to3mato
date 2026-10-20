# To3mato 자동 업데이트 설계

작성일: 2026-10-20
상태: 2026-10-20 사용자 승인. 앱 모듈·IPC·설정 카드·배포 스크립트 구현. 서명·공증 빌드 간 실제 설치·재실행 통합 테스트 통과. 정식 0.3.0 빌드·공증과 R2 배포 완료.

## 목표

- 설치된 To3mato가 새 버전을 스스로 확인하고 내려받아 설치한다.
- 사용자가 다운로드 페이지에서 DMG를 다시 받을 필요가 없다.
- 집중 타이머가 실행 중인 동안 앱을 임의로 재시작하지 않는다.
- 현재 배포 체계(Developer ID 서명, Apple 공증, R2 + Cloudflare Pages)를 그대로 쓴다.

범위는 macOS Apple Silicon이다. Windows·Linux·Intel 빌드는 현재 배포하지 않으므로 제외한다.

## 현재 상태

| 항목            | 현재                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------- |
| 앱              | Electron 44.9.0, electron-builder 26.15.3, `mac.target: ["dmg"]`                                |
| 서명            | Developer ID Application, hardened runtime (`electron-builder.release.cjs`)                     |
| 공증            | DMG 생성 후 `scripts/notarize-mac.mjs`가 DMG를 제출하고 스테이플                                |
| 배포            | `release/distribution/` → R2 버킷 `to3mato-downloads` (`https://downloads.to3mato.doyeong.dev`) |
| 메타데이터      | `release.json`, `SHA256SUMS.txt` (수동 복사)                                                    |
| 앱 내 버전 표시 | 없음                                                                                            |
| 저장소          | 프로젝트 루트가 git 저장소가 아님 → GitHub Releases 연동 불가                                   |

## 방식 비교

| 방식                                                           | 장점                                                                                                                           | 단점                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| A. `electron-updater` + generic 프로바이더(R2)                 | electron-builder가 `latest-mac.yml`·zip·blockmap을 생성. sha512 검증, 차등 다운로드, 진행률 이벤트 제공. 기존 R2를 그대로 사용 | macOS 업데이트에 zip 타깃 필요. 의존성 1개 추가                      |
| B. Electron 내장 `autoUpdater` (Squirrel.Mac) + 정적 JSON 피드 | 의존성 없음                                                                                                                    | sha 검증 없음(서명 검증만), 진행률 없음, 피드 JSON과 zip을 직접 관리 |
| C. 버전 확인만 하고 다운로드 페이지로 안내                     | 구현 단순, 공증 절차 변경 없음                                                                                                 | 자동 설치가 아님. 사용자가 DMG를 다시 설치해야 함                    |

**추천: A.** B도 결국 zip과 서명 요건은 같다. A는 무결성 검증과 중단 복구가 포함되어 있고 빌드 설정만으로 메타데이터가 생성된다. C는 A의 실패 시 안내 경로로만 쓴다.

## 아키텍처

```
[빌드 머신]                                   [R2: downloads.to3mato.doyeong.dev]
dist:mac ─ 서명 ─ 앱 공증·스테이플 ─ dmg + zip ──▶  To3mato-x.y.z-arm64-mac.zip
                                   latest-mac.yml ─▶  To3mato-x.y.z-arm64-mac.zip.blockmap
                                                      latest-mac.yml   ← 마지막에 업로드
                                                      To3mato-x.y.z-arm64.dmg (첫 설치용)
                                                      release.json, SHA256SUMS.txt

[설치된 앱]
electron/updater.mjs ─ 실행 10초 후 + 4시간마다 latest-mac.yml 조회
   ├─ 새 버전 → 백그라운드 다운로드 (sha512 검증)
   ├─ 완료 → 렌더러에 상태 전송 → 설정 화면에 표시
   ├─ 사용자가 "다시 시작"을 누르면 quitAndInstall
   └─ 누르지 않으면 다음 종료 시 자동 설치
```

### 배포 채널

- 피드 URL: `https://downloads.to3mato.doyeong.dev/` (코드에 고정, 렌더러에서 변경 불가)
- 채널 파일: `latest-mac.yml`. 캐시 헤더 `Cache-Control: no-cache`로 업로드한다. zip과 dmg는 파일명에 버전이 있으므로 길게 캐시해도 된다.
- 업로드 순서: zip → blockmap → dmg → release.json·SHA256SUMS → **latest-mac.yml 마지막**. yml이 올라가는 순간 배포가 시작되므로 그 전에 모든 파일이 있어야 한다.
- 이전 버전 zip은 삭제하지 않는다. yml이 가리키는 파일만 다운로드되므로 남겨도 무방하고 되돌리기에 쓴다.

### 빌드 설정 변경 (`electron-builder.release.cjs`)

```js
mac: {
  ...build.mac,
  target: ['dmg', 'zip'],          // zip은 업데이트용, dmg는 첫 설치용
  notarize: true,                  // 앱 번들을 공증하고 스테이플한 뒤 dmg·zip 생성
  ...
},
publish: {
  provider: 'generic',
  url: 'https://downloads.to3mato.doyeong.dev',
  channel: 'latest',
},
```

- 빌드 명령에 `--publish never`를 붙인다. `publish` 설정은 `latest-mac.yml` 생성에만 쓰고 업로드는 별도 스크립트가 한다.
- `notarize: true`는 환경 변수 `APPLE_KEYCHAIN_PROFILE=to3mato-notary`로 기존 키체인 프로필을 사용한다. 자격 증명은 소스에 넣지 않는다.
- 공증 순서가 바뀐다. 지금은 DMG를 만든 뒤 DMG를 공증한다. 변경 후에는 **앱 번들을 먼저 공증·스테이플하고** 그 앱으로 dmg와 zip을 만든다. zip 안의 앱에 공증 티켓이 들어가야 업데이트로 설치된 앱이 오프라인에서도 Gatekeeper를 통과한다. zip 자체는 스테이플할 수 없다.
- `latest-mac.yml`의 sha512는 zip 생성 직후 값이다. 생성 뒤 zip을 건드리면 업데이트가 검증 실패로 중단된다. **zip 생성 후에는 어떤 후처리도 하지 않는다.**

### 기존 `notarize:mac` 스크립트

역할이 줄어든다. 앱 공증은 빌드 단계로 옮기고 이 스크립트는 다음만 한다.

1. DMG 안의 앱에 티켓이 붙어 있는지 확인 (`stapler validate`, `spctl --assess`)
2. DMG 자체를 추가로 공증·스테이플 (선택. DMG도 스테이플하면 다운로드 직후 오프라인 검증이 된다)
3. `release.json`·`SHA256SUMS.txt` 생성
4. `latest-mac.yml`의 zip 항목 sha512와 실제 zip 파일이 일치하는지 검증

DMG를 2에서 스테이플하면 DMG 해시가 바뀌어 `latest-mac.yml`의 dmg 항목과 어긋난다. 업데이트는 zip 항목만 사용하므로 동작에는 영향이 없다. 혼동을 막기 위해 스크립트가 yml의 dmg 항목 sha512·size를 최종 DMG 값으로 다시 쓴다.

### 업로드 스크립트 (`scripts/upload-release.mjs`, 신규)

- `wrangler r2 object put`으로 위 순서대로 업로드한다.
- 업로드 전 로컬 파일 해시와 `release.json`·`latest-mac.yml`의 값을 대조한다.
- 업로드 후 R2 공개 주소에서 `latest-mac.yml`과 zip을 다시 받아 해시를 대조한다.
- 현재 R2 업로드는 수동이다. 이 스크립트가 그 절차를 대체한다.

### 앱 측 모듈 (`electron/updater.mjs`, 신규)

```js
export function createUpdater({ getState, getWindow, onStatus, log })
// 반환: { check(), install(), status(), destroy() }
```

- `electron-updater`의 `autoUpdater`를 감싼다. `autoDownload: true`, `autoInstallOnAppQuit: true`, `allowDowngrade: false`, `allowPrerelease: false`.
- `app.isPackaged`가 아니거나 `TO3MATO_DEV_URL`이 있으면 아무것도 하지 않는다.
- 시작 10초 후 첫 확인, 이후 4시간 간격. 사용자가 설정 화면에서 수동 확인할 수 있다.
- 상태 모델:

| status        | 의미                                                 |
| ------------- | ---------------------------------------------------- |
| `idle`        | 확인 전 또는 최신 버전                               |
| `checking`    | 확인 중                                              |
| `downloading` | 다운로드 중. `percent` 포함                          |
| `ready`       | 다운로드 완료. `version` 포함                        |
| `error`       | 마지막 확인 실패. `message` 포함. 다음 주기에 재시도 |

- `install()`은 `status === 'ready'`일 때만 동작한다. 타이머가 실행 중이면 기존 `before-quit` 처리로 일시정지하고 저장한 뒤 설치한다. 자동으로는 호출하지 않는다.
- 테스트용 피드 재정의: 환경 변수 `TO3MATO_UPDATE_URL`을 허용하되 origin이 `http://127.0.0.1`일 때만 받는다. `TO3MATO_DEV_URL`과 같은 검증 방식이다. 그 외 값은 오류로 중단한다.

### IPC와 preload

| 채널             | 방향            | 내용                                        |
| ---------------- | --------------- | ------------------------------------------- |
| `update:status`  | main → renderer | 상태 객체 전송                              |
| `update:check`   | renderer → main | 수동 확인. `trusted(event)` 통과 필요       |
| `update:install` | renderer → main | 재시작하고 설치. `trusted(event)` 통과 필요 |
| `app:version`    | renderer → main | 현재 버전 문자열                            |

preload에 `update: { check, install, subscribe }`와 `version()`을 추가한다. 렌더러는 URL이나 파일 경로를 전달하지 않는다.

### 설정 화면

`SettingsView.svelte`의 "로컬 데이터" 카드 아래에 "업데이트" 카드를 추가한다. 기존 카드와 같은 구조(`h2` + `p` + 버튼 행)를 따른다.

- 현재 버전
- 상태 한 줄 (위 status에 대응)
- 버튼: 확인 / 다시 시작 (ready일 때만)

브라우저 미리보기(`isDesktop === false`)에서는 카드를 표시하지 않는다.

문구는 아래 "승인 필요 문구"에 모아 두었다. 승인 전에는 넣지 않는다.

## 업데이트 정책

| 상황                       | 동작                                                       |
| -------------------------- | ---------------------------------------------------------- |
| 새 버전 발견               | 묻지 않고 백그라운드 다운로드                              |
| 다운로드 완료              | 설정 화면 상태만 바뀐다. 대화상자나 토스트를 띄우지 않는다 |
| 타이머 실행 중             | 자동 재시작 없음. 사용자가 "다시 시작"을 눌러야 설치       |
| 사용자가 누르지 않음       | 다음 앱 종료 시 설치 (`autoInstallOnAppQuit`)              |
| 오프라인·서버 오류         | 조용히 실패. 상태만 `error`. 다음 주기 재시도              |
| 다운로드 중 종료           | 다음 실행 때 blockmap 기반으로 이어받기                    |
| 더 낮은 버전이 피드에 있음 | 무시 (`allowDowngrade: false`)                             |

설정에 업데이트 끄기 옵션은 두지 않는다. 필요해지면 `settings` 테이블에 열을 추가한다.

## 보안

- 피드와 파일은 HTTPS만 사용한다. 피드 URL은 메인 프로세스 코드에 고정한다.
- `electron-updater`가 zip의 sha512를 `latest-mac.yml`과 대조한다. 불일치 시 설치하지 않는다.
- Squirrel.Mac이 새 앱의 코드 서명이 실행 중인 앱과 같은 팀의 Developer ID인지 검증한다. 서명 인증서가 바뀌면 업데이트가 거부되므로 인증서 교체 시 수동 재설치가 필요하다.
- 렌더러는 상태를 받고 확인·설치를 요청할 수만 있다. 기존 `trusted(event)` 검사를 그대로 적용한다.
- R2 버킷 쓰기 권한은 wrangler 로그인 계정에만 있다. 토큰은 저장소에 넣지 않는다.
- 공증 자격 증명은 키체인 프로필(`to3mato-notary`)만 사용한다.

## 실패 처리와 되돌리기

- 잘못된 버전을 배포한 경우: 더 높은 버전 번호로 수정판을 올린다. 다운그레이드는 지원하지 않는다.
- 긴급 중단: R2의 `latest-mac.yml`을 직전 버전 파일로 교체한다. 이미 받은 사용자는 되돌아가지 않지만 추가 배포는 멈춘다.
- 업데이트 모듈 자체 오류: `try/catch`로 감싸 앱 시작을 막지 않는다. 로그는 `console.error`만 남긴다.
- 첫 적용 버전(예: 0.3.0)은 이전 사용자에게 자동으로 가지 않는다. 0.2.0 사용자는 한 번 수동 설치해야 한다. 다운로드 페이지에 이 점을 안내할지는 사용자가 결정한다.

## 테스트 계획

| 단계 | 내용                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 단위 | `tests/updater.test.mjs`: 상태 전이, 타이머 실행 중 `install()` 처리, `TO3MATO_UPDATE_URL` origin 검증                                                                                     |
| 통합 | Developer ID로 서명한 두 빌드(0.3.0, 0.3.1)를 만든다. 0.3.1 산출물을 `127.0.0.1`의 정적 서버에 두고 0.3.0을 `TO3MATO_UPDATE_URL`로 실행해 `ready`까지 도달하는지, 재시작 후 0.3.1인지 확인 |
| UI   | `tests/desktop.spec.ts`에 설정 화면의 버전 표시와 브라우저 모드에서 카드 미표시 확인 추가                                                                                                  |
| 배포 | 업로드 스크립트의 사후 검증(R2에서 받은 yml·zip 해시 대조)                                                                                                                                 |

Squirrel.Mac은 서명되지 않은 앱에서 동작하지 않는다. 개발 실행(`npm run dev`)에서는 업데이트 확인 자체를 하지 않으므로 통합 테스트는 서명 빌드로만 가능하다. 일반 Playwright 테스트는 서명 없는 앱을 사용한다. 실제 설치 경로는 별도로 서명·공증한 두 빌드와 `tests/signed-update.spec.ts`로 검증한다. 재현 절차는 README에 기록했다.

## 구현 단계

1. 빌드 설정: zip 타깃, `publish`, `notarize: true`. `notarize:mac` 스크립트 역할 축소. 산출물 해시 검증.
2. 업로드 스크립트와 README의 배포 절차 갱신.
3. `electron/updater.mjs`, preload, IPC 연결. 단위 테스트.
4. 설정 화면 카드. 문구 승인 후 적용.
5. 서명 빌드 두 개로 통합 테스트. 결과를 README에 기록.
6. 0.3.0 배포. 이후 0.3.1부터 자동 업데이트 동작.

1~2와 3은 서로 독립이다. 4는 3 이후, 5는 전부 끝난 뒤다.

## 승인 필요 문구

2026-10-20 사용자가 아래 문구를 승인했다. 구현 시 글자 그대로 넣는다.

설정 화면 카드

- 제목: `업데이트`
- 설명: `새 버전이 있으면 자동으로 내려받습니다. 설치는 앱을 다시 시작할 때 진행됩니다.`
- 현재 버전 줄: `현재 버전 0.3.0`
- 상태 줄
  - idle: `최신 버전입니다.`
  - checking: `확인 중입니다.`
  - downloading: `0.3.1 내려받는 중 42%`
  - ready: `0.3.1 설치 준비가 끝났습니다. 다시 시작하면 적용됩니다.`
  - error: `업데이트를 확인하지 못했습니다. 네트워크 연결을 확인하세요.`
- 버튼: `업데이트 확인` / `다시 시작`

메인 프로세스 오류 (기존 `state:error` 토스트 사용)

- `업데이트 파일을 검증하지 못했습니다. 다운로드 페이지에서 다시 설치하세요.`

## 결정 사항 (2026-10-20 확정)

1. 다운로드는 묻지 않고 자동으로 한다.
2. 확인 주기는 시작 10초 후와 4시간 간격.
3. 앱 공증에 더해 DMG도 공증·스테이플한다.
4. 다운로드 페이지의 자동 업데이트 안내 문구는 넣지 않는다. 필요해지면 사용자가 쓴다.
5. 위 문구 초안을 승인했다.

## 구현 기록 (2026-10-20)

- 1~4단계의 코드와 테스트를 추가했다. 첫 적용 버전은 0.3.0이다.
- `update:status`에 신뢰 검사를 거치는 초기 상태 조회도 추가했다. 설정 화면을 나중에 열거나 다시 불러와도 현재 상태를 받는다.
- `ready`는 ZIP 다운로드 직후가 아니라 Squirrel.Mac의 서명 검증·준비 완료 이벤트 이후에 표시한다.
- 재시작 요청 전에 타이머를 저장하며 저장 실패 시 재시작하지 않는다. 종료 처리는 중복 실행하지 않는다.
- generic 프로바이더에 안정 버전과 같은 origin의 다운로드 주소 검사를 추가했다.
- 업로드 전에 모든 로컬 해시를 검증하고 공개 주소의 산출물 검증 후 피드를 게시한다. 기존 버전과 다른 파일은 덮어쓰지 않는다.
- 적용 문구는 위 승인 목록을 그대로 사용했다. 버전과 진행률만 실제 값으로 표시한다.
- 5단계도 완료했다. 동일 Developer ID로 서명·공증한 격리 앱에서 0.3.0 → 0.3.1의 버튼 재시작과 일반 종료 시 설치를 검증했다. 할 일·프로젝트·집중 기록·설정과 일시정지된 타이머 보존, 서버 오류·변조 ZIP 거부 후 재시도를 확인했다. 결과와 재현 절차는 README에 기록했다.
- 6단계의 프로덕션 식별자 `app.to3mato.desktop` 빌드와 R2 정식 게시를 완료했다. 앱·DMG 공증과 로컬 해시 검증을 마친 뒤 ZIP·DMG를 업로드하고 공개 파일을 검증한 다음 피드를 게시했다. 정식 앱에서 공개 피드의 0.3.0 확인도 통과했다. 테스트 산출물은 정식 배포에 사용하지 않았다. 다운로드 사이트도 0.3.0으로 갱신해 Cloudflare Pages에 게시했다. 배포 기록은 README에 있다.
