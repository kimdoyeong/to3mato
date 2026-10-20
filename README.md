# To3mato

Electron + Vite + Svelte 기반 로컬 데스크톱 앱입니다. `demo/`의 최신 디자인을 Svelte 화면으로 옮겼습니다.

## 실행

Node.js 22.13 이상과 npm이 필요합니다.

```sh
npm ci
npm run dev
```

Vite 개발 서버와 Electron 창을 함께 실행합니다. 같은 화면을 브라우저에서 확인할 주소는 `http://127.0.0.1:4173`입니다. 포트가 사용 중이면 기존 서버를 먼저 종료합니다.

```sh
npm run dev:web  # 브라우저에서만 실행
npm run build   # 화면 빌드
npm start       # 빌드된 화면으로 Electron 실행
npm run package # 현재 운영체제용 앱 폴더 생성
npm run dist    # 설치 파일 생성
```

`npm start` 전에 `npm run build`를 실행해야 합니다. 앱 결과물은 `release/`에 생성됩니다. macOS 정식 배포는 아래의 `dist:mac`과 `notarize:mac` 절차를 사용합니다.

## 구현 범위

- 왼쪽 세로 내비게이션: 할 일 / 프로젝트 / 캘린더 / 집중 로그 / 설정
- 오른쪽 공통 실행 영역: 타이머 / 실행 버튼 / 오늘 할 일
- 시스템 트레이: 남은 시간 / 시작·일시정지·재개 / 집중·휴식 종료. 앱과 동일한 타이머 사용
- 날짜별 할 일: 미지정 → 오늘 → 내일 → 이후 날짜. 이전 날짜에 남은 작업도 별도 섹션으로 표시
- 할 일 추가와 수정 및 삭제. 날짜 이동과 완료 처리. 프로젝트 생성과 작업 연결
- 주간 캘린더에서 날짜별 작업 조회와 이동
- 포모도로 시작과 일시정지 및 종료. 집중 시간 만료 후 자동으로 휴식 시작
- 작업 전환 시 이전 기록을 저장하고 새 작업을 전체 집중 시간으로 시작
- 실제 집중 시간과 반올림한 0 / 0.5 / 1포모도로를 함께 저장
- 설정에서 최근 집중 기록 확인과 JSON 가져오기 / 내보내기

예상량을 채워도 작업은 자동 완료되지 않습니다. 설정 시간 변경은 다음 타이머부터 적용합니다. 앱 종료와 컴퓨터 절전 시 실행 중인 타이머를 일시정지합니다. 트레이의 집중 시작은 오늘의 첫 미완료 작업을 시작합니다. 작업 선택은 앱에서 합니다. 창을 닫으면 앱과 트레이가 함께 종료됩니다.

현재 작업에는 예정일 하나와 예상 포모도로 하나를 지정합니다. 여러 날짜로 분량을 나누는 계획과 처음 예상량의 변경 이력 및 자동 추천은 아직 구현하지 않았습니다. 처음 실행하면 예시 작업과 프로젝트를 제공합니다.

## 데이터 저장

### 3초 집중 로그

집중 타이머가 자연스럽게 완료되면 하단에 **인증샷을 남길까요?** 토스트가 나타납니다. **네, 남길게요**를 누른 경우에만 카메라를 요청합니다. 3초 준비 카운트다운 뒤 3초 동안 촬영하고 자동 저장합니다. 휴식 종료와 만료 전 수동 종료에는 제안하지 않습니다. 촬영 취소·오류·창 숨김 시 카메라를 끕니다.

영상은 720×960 세로 프레임에 은은한 색감과 날짜·시간·할 일 이름을 담습니다. 마이크는 사용하지 않습니다. **매주 월요일 오전 9시(기기 현지 시간)**부터 지난 월요일~일요일의 클립을 촬영 순서로 자동 연결합니다. 완성되면 하단에 **배달왔어요 🍅** 알림이 나타납니다. **영상 편지 열기 → 영상 편지 보기 / 다운로드**로 확인할 수 있습니다. 직접 내보내기를 시작할 필요가 없습니다.

완성된 영상 편지와 읽음 상태를 기기에 보관해 재시작 후에도 다운로드할 수 있습니다. 같은 주의 영상은 중복 배달하지 않으며 기록이 없는 주에는 편지를 만들지 않습니다. 앱을 꺼두어 놓친 편지는 다음에 앱을 열면 준비합니다. 영상 제작에는 클립 길이만큼 시간이 걸리며 창을 숨겼다면 다시 열 때 준비합니다. 영상은 기본 WebM이며 WebM을 지원하지 않는 환경에서는 가능한 경우 MP4를 사용합니다.

**집중 로그**에서 주별 원본 클립도 재생·삭제할 수 있습니다. 원본 삭제는 이미 배달된 영상 편지를 변경하지 않습니다.
촬영본과 썸네일은 해당 앱/브라우저의 IndexedDB에 저장합니다. 서버 업로드나 기기 간 동기화는 없으며 주가 바뀌어도 자동 삭제하지 않습니다. **설정의 JSON 백업에는 영상이 포함되지 않습니다.** 앱 데이터나 브라우저 사이트 데이터를 지우기 전 영상을 별도로 내보내세요. 개발 서버와 패키징된 앱은 저장소가 다릅니다.

macOS 패키지에는 카메라 사용 설명과 권한 entitlement를 포함합니다. 첫 촬영 때 카메라 접근을 허용해야 하며 거절했다면 시스템 설정에서 다시 허용할 수 있습니다. `tests/focus-log.spec.ts`는 실제 카메라 대신 가상 장치로 촬영, 권한 거부, 취소, 저장 지속성, 주별 필터, 월요일 9시 경계, 중복 배달 방지와 재생 가능한 영상 편지 다운로드를 검증합니다. `tests/focus-log-desktop.spec.ts`는 앱을 꺼두어 놓친 배달과 재시작 후 편지 보존, 파일 저장 창을 검증합니다.

### 할 일과 타이머

데스크톱 데이터는 Electron의 `userData` 폴더 아래 `to3mato.sqlite3`에 저장합니다. macOS 기본 위치는 `~/Library/Application Support/To3mato/to3mato.sqlite3`입니다. Electron에 내장된 `node:sqlite`를 메인 프로세스에서 사용하며 별도 서버나 네이티브 npm 모듈은 필요하지 않습니다.

`projects`·`tasks`·`focus_records`·`settings`·`timer` 테이블로 나누고 변경된 행만 저장합니다. 여러 할 일 추가와 타이머 전환은 하나의 트랜잭션으로 처리합니다. 할 일을 삭제해도 집중 기록은 남습니다. UI에는 기존과 같은 상태 객체를 전달하며 시작 시 전체 상태를 읽습니다.

첫 실행에서 기존 `state.json`이 있으면 검증 후 자동으로 이전합니다. ID와 목록 순서 및 기록과 설정과 타이머 상태를 유지합니다. 원본 JSON은 수정하지 않으며 `state.pre-sqlite.json`도 보관합니다. 스키마와 초기 데이터는 한 트랜잭션으로 생성하고 `PRAGMA user_version`으로 이전 완료를 기록합니다. 이후에는 SQLite를 읽으므로 오래된 JSON을 다시 가져오지 않습니다. 손상된 JSON이나 DB 및 지원하지 않는 DB 버전은 덮어쓰지 않고 실행을 중단합니다.

JSON 가져오기 전에는 현재 DB를 `to3mato.pre-import.sqlite3`로 백업합니다. 백업에는 WAL에 커밋된 변경 내용도 포함됩니다. DB는 WAL 모드와 `synchronous=FULL`로 저장하며 실행 중 `-wal`·`-shm` 파일이 생길 수 있습니다. 실행 중 데이터를 다른 환경으로 옮길 때는 설정의 JSON 내보내기를 사용합니다. 매번 저장할 때 별도의 전체 파일 백업을 생성하지는 않습니다.

브라우저 미리보기는 해당 브라우저의 localStorage에 저장합니다. 같은 주소에 남아 있는 기존 데모의 `to3mato-demo-v1` 데이터는 새 저장 형식이 없을 때 읽어옵니다. 브라우저와 Electron 데이터는 각각 저장되며 자동 동기화하지 않습니다. 설정에서 JSON으로 내보낸 뒤 다른 환경에서 가져올 수 있습니다. 가져오기는 현재 데이터를 교체합니다.

폰트와 이미지가 앱에 포함되어 있어 빌드된 데스크톱 앱은 네트워크 연결 없이 실행할 수 있습니다.

## 구조

- `src/components/`: 작업 영역과 공통 실행 영역의 Svelte 컴포넌트
- `src/lib/domain.mjs`: 타이머 계산과 작업 변경 및 데이터 검증
- `src/lib/client.ts`: UI 상태와 데스크톱 / 브라우저 저장 연결
- `electron/main.mjs`: 창 생성과 타이머 관리 및 파일 저장 요청 처리
- `electron/preload.cjs`: 필요한 기능만 노출하는 연결 인터페이스
- `electron/storage.mjs`: SQLite 저장과 JSON 자동 이전 및 가져오기 전 백업
- `src/styles/`: 기존 디자인과 컴포넌트 보완 스타일
- `demo/`: 이전 웹 데모 원본

데스크톱 타이머와 파일 저장은 메인 프로세스가 담당합니다. 렌더러의 Node.js 접근은 비활성화되어 있으며 context isolation과 sandbox를 사용합니다.

## 검증

```sh
npm run check
npm test
npm run build
npm run test:ui
```

UI 테스트는 빌드된 Electron 앱을 임시 데이터 폴더로 실행합니다. 실제 사용자 데이터는 변경하지 않습니다. 작업과 프로젝트 생성 및 타이머 전환과 집중 완료 그리고 재시작 후 복구를 확인합니다. 저장소 테스트는 JSON 이전과 롤백 및 변경 행 저장과 비정상 종료 복구를 검증합니다.

현재 실행 검증 대상은 macOS입니다. Windows와 Linux용 패키지 설정은 포함되어 있지만 해당 환경에서 검증하지 않았습니다.

## 아이콘

트레이와 앱 아이콘은 `src/components/Mascot.svelte`의 캐릭터를 사용합니다. `npm run icons`로 PNG와 ICO를 다시 생성합니다. macOS에서는 ICNS도 생성합니다. 아이콘 생성에는 Google Chrome이 필요합니다.

각 크기는 SVG를 캔버스에 직접 그려 PNG로 인코딩합니다. 브라우저 창 크기를 바꾸며 스크린샷을 찍으면 일부 ICNS 이미지에 이전 화면 조각이 섞일 수 있으므로 사용하지 않습니다. 아이콘 변경 후에는 설치 파일도 다시 빌드해야 합니다.

## 프로젝트에서 여러 할 일 추가

프로젝트를 연 뒤 **할 일 추가 → 여러 개 추가**를 선택합니다. 이름 규칙에서 `%n%`은 1부터 시작하는 번호로 바뀌고 `%date%`는 각 항목의 예정일을 `YYYY-MM-DD`로 표시합니다. 입력 즉시 템플릿을 색으로 구분하며 지원하지 않는 템플릿은 오류로 표시합니다.

생성 개수와 공통 포모도로 및 시작 날짜를 지정합니다. 선택한 요일에 하루 기본 개수만큼 배치하며 요일별 예외를 입력할 수 있습니다. 해당 요일에 이미 등록된 작업 수는 새 목록의 배치 개수에 포함하지 않습니다. 한 번에 최대 500개를 생성할 수 있습니다.

목록 생성 후 이름과 포모도로 및 예정일을 각각 수정합니다. 예정일을 바꾸면 자동 생성된 이름의 `%date%`도 갱신합니다. 직접 수정한 이름은 유지합니다. 설정을 수정한 뒤 목록을 다시 생성하면 개별 수정은 초기화됩니다. 최종 추가 전에는 저장하지 않습니다.

추가된 항목은 각각 고유 ID를 가진 일반 할 일입니다. 템플릿이나 반복 일정과 연결되지 않으며 한 항목의 수정·완료·삭제가 다른 항목에 영향을 주지 않습니다. 전체 목록을 검증한 뒤 한 번에 저장하므로 잘못된 항목이 있으면 일부만 저장하지 않습니다.

## 소개 및 다운로드 사이트

`website/dist/`에 랜딩·소개·다운로드 정적 HTML 페이지가 있습니다. 실제 앱의 예시 데이터 화면과 macOS 설치 파일을 포함합니다. 로컬 미리보기와 화면 촬영 및 검증 방법은 [website/README.md](website/README.md)를 참조하세요.

## 입력과 화면 이동

할 일·프로젝트 추가 및 수정 창은 이름 입력란에 초점을 둡니다. 일괄 추가는 이름 규칙 입력란에서 시작하고 목록 생성 후 첫 번째 이름으로 이동합니다. 저장 오류는 대화상자 안에 표시하며 입력 내용은 유지합니다. 저장 중에는 닫기와 입력 변경 및 중복 저장을 막습니다.

앱을 사용하는 동안 탭을 이동해도 선택한 프로젝트와 캘린더의 주·날짜를 유지합니다. 앱을 다시 실행하면 기본 화면으로 시작합니다.

## macOS 타이머 알림

집중 시작·재개·작업 전환 시 **집중 시작** 알림과 작업 이름을 표시합니다. 일시정지한 휴식을 재개하면 **휴식 시작** 알림을 표시합니다. 이미 실행 중인 같은 작업의 시작 버튼을 다시 눌러도 중복 알림을 보내지 않습니다.

집중 시간이 끝나면 작업 이름과 함께 **집중 타이머 끝** 알림을 보내고 휴식 타이머를 자동으로 시작합니다. 휴식 시간이 끝나면 **휴식 끝** 알림을 보내고 대기합니다. 다음 집중은 직접 시작합니다. 앱 창이 뒤에 있거나 최소화되어 있어도 메인 프로세스에서 처리합니다. 알림을 클릭하면 앱 창을 표시합니다. 알림 클릭은 타이머 상태를 바꾸지 않습니다.

알림은 상태 저장 후 한 번 보냅니다. 수동 종료·작업 전환·일시정지는 시간이 만료되기 전이라면 종료 알림을 보내지 않습니다. 새로 앱을 실행할 때 과거에 만료된 타이머의 알림을 다시 보내지 않습니다. 앱을 종료하면 타이머가 일시정지되므로 종료된 앱의 예약 알림은 없습니다.

Electron 44의 macOS 알림은 서명된 앱과 macOS 알림 허용이 필요합니다. 시스템 설정 → 알림에서 To3mato의 알림을 허용하세요. 개발 실행 시 Electron으로 표시될 수 있습니다. 집중 모드와 배너·소리 설정은 macOS 설정을 따릅니다. 알림 표시 실패는 앱 안에 안내하며 타이머 기록 저장에는 영향을 주지 않습니다.

로컬 검증용으로 기존 Apple Development 인증서를 사용하는 경우 다음처럼 별도 폴더에 빌드할 수 있습니다. `서명 인증서 식별자`를 해당 Mac의 인증서 검색어로 바꾸고 `인증서 SHA-1`에는 `security find-identity -v -p codesigning`에 표시된 해당 인증서의 값을 사용합니다. 이름이 같은 인증서가 여러 개 있어도 지정한 인증서 하나로 서명합니다. 이 개발 서명 빌드는 외부 배포용 설치 파일과 구분합니다.

```sh
npm run build
TO3MATO_LOCAL_SIGN_IDENTITY='인증서 SHA-1' npx electron-builder --dir --mac --config.mac.type=development --config.mac.identity='서명 인증서 식별자' --config.mac.sign=scripts/sign-local.mjs --config.mac.notarize=false --config.mac.entitlements=electron/entitlements.mac.plist --config.mac.entitlementsInherit=electron/entitlements.mac.plist --config.directories.output=release/local
```

`tests/notifications.test.mjs`는 종료 판정과 알림 실패 처리를 검증합니다. `tests/notifications.spec.ts`는 임시 데이터의 실제 Electron 타이머로 백그라운드 종료·휴식 종료·알림 클릭과 중복 방지를 검증하며 OS 권한과 독립적으로 native API 호출을 관찰합니다. 실제 배너 표시 여부는 서명된 빌드에서 별도로 확인해야 합니다.

## macOS 정식 배포

`electron-builder.release.cjs`는 기본 테스트 패키지 설정과 별도로 Developer ID Application 인증서를 사용합니다. 서명 실패 시 빌드를 중단하며 hardened runtime과 카메라/JIT entitlement를 포함합니다. 기본 팀은 `H2RM6XYB9D`이며 다른 인증서를 사용하려면 `CSC_NAME`으로 지정합니다.

최초 한 번 Apple 계정에서 공증용 앱 암호를 만들고 Mac 터미널에서 다음을 실행합니다. `본인 Apple 계정`을 실제 계정으로 바꿉니다. 앱 암호는 이어지는 비공개 입력란에 입력하며 소스 코드나 명령줄 인자에 저장하지 않습니다.

```sh
xcrun notarytool store-credentials to3mato-notary --apple-id '본인 Apple 계정' --team-id H2RM6XYB9D
```

```sh
npm run check
npm test
npm run dist:mac
npm run notarize:mac
```

`dist:mac`은 Apple Silicon용 앱을 서명하고 공증·스테이플한 다음 DMG와 업데이트용 ZIP을 `release/distribution/`에 생성합니다. 키체인 프로필은 기본 `to3mato-notary`이며 `APPLE_KEYCHAIN_PROFILE`로 바꿀 수 있습니다. 빌드의 `--publish never`는 파일 업로드를 막고 업데이트 메타데이터만 생성합니다. 생성된 ZIP은 이후 변경하지 않습니다.

`notarize:mac`은 DMG와 ZIP 안의 앱 버전·Developer ID 서명·공증 티켓·Gatekeeper 검증을 확인한 뒤 DMG 자체도 공증합니다. 제출 ID와 파일 해시는 `notarization.json`에 보관합니다. `In Progress`라면 잠시 후 같은 명령을 다시 실행합니다. 동일 파일을 중복 제출하지 않습니다.

`Accepted` 이후 DMG를 스테이플하고 최종 해시로 `latest-mac.yml`의 DMG 항목을 갱신합니다. ZIP의 sha512는 생성 시 값과 대조하며 ZIP을 다시 압축하거나 수정하지 않습니다. ZIP·ZIP blockmap·최종 DMG의 해시와 크기를 `release.json`에 기록하고 피드까지 포함한 `SHA256SUMS.txt`를 생성합니다. DMG blockmap은 스테이플 이전 파일의 정보이므로 배포에 사용하지 않습니다.

```sh
npm run release:verify  # 로컬 산출물과 메타데이터 검증. 업로드 없음
npm run release:upload  # R2 업로드 및 공개 URL의 파일 검증
```

업로드에는 기존 wrangler 로그인과 `to3mato-downloads` 쓰기 권한이 필요합니다. ZIP → ZIP blockmap → DMG → `release.json`·`SHA256SUMS.txt` → `latest-mac.yml` 순서로 올립니다. 버전이 붙은 파일은 장기 캐시하고 피드와 공용 메타데이터는 `no-cache`를 설정합니다. 공개 주소에서 파일을 다시 받아 크기와 해시를 검증한 뒤 피드를 마지막에 올립니다. 피드 게시 후에도 피드와 ZIP을 다시 검증합니다. 같은 버전의 원격 파일과 로컬 파일이 다르면 덮어쓰지 않고 중단합니다. 이전 버전 ZIP은 삭제하지 않습니다.

`release/*` CI는 R2 게시 성공 후 같은 산출물로 다운로드 사이트의 링크·버전·용량·체크섬을 자동 갱신하고 Pages에 배포합니다. 공개 페이지까지 검증해야 배포가 성공합니다. 별도 사이트 배포에는 검증된 릴리스 폴더를 지정해 `SITE_RELEASE_DIR=release/distribution npm run site:deploy`를 사용합니다. 자동 업데이트 안내 문구는 추가하지 않습니다.

## 자동 업데이트

0.3.0부터 macOS Apple Silicon 정식 앱이 시작 10초 후와 4시간마다 새 버전을 확인하고 자동으로 내려받습니다. 설정의 로컬 데이터 카드 아래에서 현재 버전과 상태를 확인할 수 있습니다. 다운로드와 macOS 서명 검증이 끝나면 **다시 시작** 버튼이 나타납니다. 자동으로 재시작하지 않으며 다음 앱 종료 시에도 업데이트가 적용됩니다. 재시작 버튼은 실행 중인 타이머를 일시정지하고 저장한 뒤 설치를 요청합니다. 저장 실패 시 재시작하지 않습니다.

개발 실행, 브라우저 미리보기, Windows·Linux·Intel에서는 업데이트를 확인하지 않습니다. 브라우저에서는 카드도 표시하지 않습니다. 네트워크 오류는 상태만 바꾸고 다음 주기에 재시도합니다. 체크섬·서명 검증 오류는 승인된 오류 토스트를 사용합니다. 이전 버전과 사전 공개 버전은 설치하지 않습니다.

피드는 `https://downloads.to3mato.doyeong.dev/latest-mac.yml`입니다. 렌더러는 URL이나 파일 경로를 지정할 수 없으며 상태 조회·구독과 확인·설치 요청만 합니다. 모든 업데이트 IPC는 기존 발신자 검증을 통과해야 합니다. 테스트용 `TO3MATO_UPDATE_URL`은 `http://127.0.0.1` 호스트의 포트·하위 경로만 허용하며 인증 정보·쿼리·fragment를 거부합니다. 잘못된 값은 업데이트 모듈만 중단하고 앱은 실행합니다.

### 검증 기록

2026-10-20 검증 결과: `npm run check` 오류·경고 0개, `npm test` 45개 통과, 데스크톱·브라우저 UI 3개와 패키징 앱의 로컬 피드 확인 테스트 1개 통과. 서명·공증을 끈 별도 검증 빌드에서 ZIP·DMG·blockmap·`latest-mac.yml` 생성과 ZIP·DMG의 실제 SHA-512·크기 일치도 확인했습니다.

단위 테스트는 상태 전이, 예약 확인, 개발 모드 제외, 중복 요청, 네트워크 재시도, 서명 검증 후 준비 상태, 실행 중 타이머 저장, 체크섬 실패, 배포 해시 검증과 업로드 순서를 확인합니다. UI 테스트는 현재 버전, 브라우저 카드 미표시, 진행률·설치 준비·오류 상태와 타이머 유지 여부를 확인합니다.

패키징 앱 확인 테스트는 업데이트 모듈의 실제 로드, 동일 버전·낮은 버전·사전 공개 버전 제외, 서버 오류와 재시도를 검사했습니다. 서명 없는 빌드에서 설치는 수행하지 않았습니다. Developer ID 서명·공증 빌드 사이의 실제 설치·재실행은 아래의 전용 통합 테스트로 검증했습니다. 2026-10-20 정식 0.3.0 빌드와 R2 배포도 완료했습니다.

패키징 앱의 피드 확인 테스트는 `TO3MATO_EXECUTABLE='/절대/경로/To3mato.app/Contents/MacOS/To3mato' npx playwright test tests/updater-desktop.spec.ts --grep 'packaged updater'`로 실행합니다.

2026-10-20 서명 앱 통합 검증은 동일한 Developer ID 팀 `H2RM6XYB9D`로 서명하고 Apple 공증·스테이플한 0.3.0과 0.3.1을 사용했습니다. 두 앱은 Gatekeeper의 `Notarized Developer ID` 검증을 통과했습니다.

| 항목                                   | 결과                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| 로컬 피드에서 ZIP 다운로드와 서명 검증 | 통과. 설치 준비 상태 진입                                                                 |
| 설치 준비 중 집중 타이머               | 실행 유지. 자동 종료·재시작 없음                                                          |
| **다시 시작** 버튼                     | 0.3.1로 실제 교체하고 자동 재실행. 재실행된 화면과 API에서 버전 확인                      |
| 일반 앱 종료                           | 종료 후 0.3.1로 실제 교체. 자동 재실행 없이 다음 수동 실행에서 확인                       |
| 데이터 보존                            | 추가한 할 일, 기존 프로젝트, 1개 이상의 집중 기록, 변경한 집중·휴식 설정이 설치 전후 동일 |
| 실행 중 타이머                         | 기존 작업·집중 시간이 유지되고 일시정지 상태로 저장·복원                                  |
| 서버 오류 → 재시도                     | 503 실패 후 정상 피드로 재시도 성공                                                       |
| 변조 ZIP → 재시도                      | 체크섬 오류로 설치 차단 및 승인된 오류 표시. 정상 ZIP으로 재시도 성공                     |
| 설치 후 서명·공증 티켓                 | 두 설치 경로 모두 `codesign --verify`와 `stapler validate` 통과                           |

설치 경로 2개가 모두 통과했습니다. 최초 실행에서도 두 경로가 통과했으며, 집중 기록과 변경 설정을 추가한 조건으로 다시 실행해 데이터 보존도 확인했습니다. 제품 소스의 기능 수정은 필요하지 않았습니다. 0.2.0 사용자는 0.3.0을 한 번 수동 설치해야 합니다.

### 0.3.0 정식 배포 기록 (2026-10-20)

프로덕션 식별자 `app.to3mato.desktop`과 Developer ID 팀 `H2RM6XYB9D`로 Apple Silicon 앱을 빌드했습니다. 앱과 DMG 모두 Apple 공증·스테이플을 완료했으며 ZIP·DMG 내부 앱의 서명, 버전, 공증 티켓과 Gatekeeper 검증을 통과했습니다. DMG 공증 ID는 `57870f7e-15d2-4ab5-8449-ad831f2e5e01`입니다. 타임스탬프 서비스 오류는 동일 서명 명령 재시도로 해결했고, 배포 검증 스크립트의 서명 조건 인자 형식을 `-R=...`로 수정했습니다.

`release:verify` 통과 후 ZIP·ZIP blockmap·DMG와 배포 메타데이터를 R2에 올리고 `latest-mac.yml`을 마지막에 게시했습니다. 공개 다운로드의 크기·해시, 메타데이터의 로컬 파일 일치와 캐시 정책(`no-cache` / 버전 파일 `immutable`)을 확인했습니다. 기존 0.2.0 DMG는 유지했습니다. 다운로드 사이트도 0.3.0 링크·버전·용량과 메타데이터를 반영해 Cloudflare Pages에 배포했습니다.

정식 앱을 별도 데이터 폴더로 실행해 공개 피드의 0.3.0을 확인했습니다. 상태가 `checking`에서 `idle`로 돌아오고 설정에 `최신 버전입니다.`가 표시됐습니다. 제품 핵심 소스는 서명 앱 통합 테스트에 사용한 소스와 일치하며 테스트 전용 시작 코드는 포함하지 않았습니다. 기록은 `release/distribution/deployment-verification.json`, `production-source-verification.json`, `production-smoke.json`, `production-feed.png`에 보관했습니다.

### 서명 앱 간 설치 테스트 재현

다음 테스트는 실제 Developer ID 서명과 Apple 공증이 필요합니다. `app.to3mato.desktop.update-test` 식별자와 `to3mato-update-integration-updater` 캐시를 사용하며 정식 앱 및 R2 피드를 변경하지 않습니다. 이전 앱은 제품 소스 그대로이며 새 앱에는 자동 재실행 후에도 테스트 데이터·로컬 피드·디버깅 연결을 유지하는 테스트 전용 시작 코드만 추가합니다. 제품의 업데이트 모듈·메인·preload·저장 로직은 그대로 사용합니다. 테스트용 ZIP은 정식 배포에 사용하지 않습니다.

```sh
npm run build
node scripts/prepare-signed-update-test.mjs
npx electron-builder --mac zip --arm64 --config electron-builder.release.cjs --config.appId=app.to3mato.desktop.update-test --config.extraMetadata.name=to3mato-update-integration --config.extraMetadata.version=0.3.0 --config.electronDist=node_modules/electron/dist --config.directories.output=release/update-integration/0.3.0-zip --publish never
npx electron-builder --mac zip --arm64 --config electron-builder.release.cjs --config.appId=app.to3mato.desktop.update-test --config.directories.app=release/update-integration/fixture --config.electronDist=node_modules/electron/dist --config.directories.output=release/update-integration/0.3.1 --publish never
TO3MATO_SIGNED_UPDATE_TEST=1 npx playwright test tests/signed-update.spec.ts
```

`--dir`만으로 빌드하면 macOS 업데이트에 필요한 `app-update.yml`이 포함되지 않으므로 이전 앱도 ZIP 타깃으로 만듭니다. 위 명령은 기본 키체인 프로필 `to3mato-notary`를 사용합니다. 두 빌드가 모두 완료된 뒤 테스트를 실행합니다. 일반 `test:ui`에서는 이 테스트를 건너뜁니다.

테스트는 각 실행에 새 데이터 폴더를 만들고 두 가지 설치 경로를 확인합니다. `restart`는 서버 오류와 변조 ZIP 거부 뒤 정상 업데이트를 받아 **다시 시작**으로 설치하며 실제 자동 재실행된 앱의 버전과 데이터를 읽습니다. `quit`는 설치 준비가 끝난 앱을 일반 종료하고 자동 재실행 없이 교체되는지 확인한 뒤 수동 실행하여 데이터를 읽습니다. 결과·스크린샷·프로세스 로그는 `release/update-integration/run-restart-*/`와 `run-quit-*/`에 저장합니다. 최신 실행 경로는 `release/update-integration/latest-restart.json`과 `latest-quit.json`에 기록합니다. 제품 소스와 두 빌드의 핵심 파일 일치 결과는 `source-verification.json`에 있습니다.

## 릴리스 CI/CD

`release/<버전>` 브랜치에 푸시하면 GitHub Actions가 검증·macOS 테스트·서명·공증을 거쳐 Cloudflare R2에 앱을 배포합니다. 브랜치명과 `package.json`·`package-lock.json`의 버전이 일치해야 합니다. PR과 기본 수동 실행은 검증만 수행합니다.

실행 조건, 필수 Secrets 7개, 배포 순서와 실패 재시도는 [릴리스 CI/CD 문서](docs/release-ci-cd.md)를 따릅니다.
