# To3mato 트레이 표시 변경 설계

작성일: 2026-10-20
상태: 구현 완료. 전체 화면 앱 위의 동작과 실제 메뉴 막대의 다크·라이트 전환은 수동 확인 필요.

## 목표

- 메뉴 막대(트레이)에 남은 시간을 시간 외의 형태로도 표시할 수 있게 한다. 선택지는 시간, 막대, 원형, 모래시계 네 가지다.
- 트레이 클릭 시 열리는 네이티브 컨텍스트 메뉴를 Electron 웹 화면(BrowserWindow 팝오버)으로 바꾼다.
- 타이머 상태와 명령은 지금처럼 메인 프로세스의 단일 상태를 공유한다. 팝오버는 별도 상태를 갖지 않는다.

범위는 macOS다. Windows·Linux는 현재 배포하지 않으므로 동작만 깨지지 않게 유지한다.

## 현재 상태

| 항목        | 현재                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------- |
| 모듈        | `electron/tray.mjs`. `createTimerTray({ getState, dispatch, onError })`                        |
| 아이콘      | `electron/assets/mascot-tray.png` 22px, `@2x` 44px 고정 이미지. 템플릿 이미지 아님             |
| 시간 표시   | macOS만 `tray.setTitle('MM:SS', { fontType: 'monospacedDigit' })`. 툴팁에 `MM:SS · 상태`       |
| 메뉴        | `Menu` 4항목: 시간·상태(비활성), 구분선, 주 동작(집중 시작/일시정지/집중 재개/휴식 시작), 종료 |
| 갱신        | `main.mjs`의 250ms 티커와 `commit()`마다 `timerTray.update()`. 상태 서명이 같으면 건너뜀       |
| 설정        | `settings: { focus, rest }` 두 항목. `validateSettings`, `settings:save`                       |
| 렌더러 진입 | `index.html` → `src/main.ts` 하나. Vite 다중 진입점 없음                                       |
| 테스트      | `tests/tray.spec.ts`가 `timerTray.menu.items`와 `tray.getTitle()`을 직접 읽어 검증             |

## 1. 트레이 표시 방식

### 선택지

| 값          | 표시                                                      | 구현                                                |
| ----------- | --------------------------------------------------------- | --------------------------------------------------- |
| `clock`     | 현재와 동일. 마스코트 아이콘 + `MM:SS` 제목               | `tray.setTitle` 유지                                |
| `bar`       | 마스코트 아이콘 + 가로 막대. 남은 비율만큼 채움           | 제목 비우고 아이콘을 매 갱신마다 그린 이미지로 교체 |
| `ring`      | 마스코트 아이콘 + 원형 막대. 남은 비율만큼 호를 그림      | 위와 같음                                           |
| `hourglass` | 마스코트 아이콘 + 모래시계. 위 칸이 비고 아래 칸이 채워짐 | 위와 같음                                           |

- 막대·원형·모래시계는 비율만 보여주고 숫자는 표시하지 않는다. 숫자가 필요하면 팝오버에서 본다.
- 휴식 중에는 집중과 같은 도형을 쓰되 색을 바꾼다. 색 값은 `src/styles/theme.css`의 집중·휴식 색을 그대로 가져온다.
- 타이머가 없을 때(집중 대기)는 도형을 비운 채로 둔다. 일시정지는 도형을 유지하고 투명도만 낮춘다.
- 모든 방식에서 마스코트 아이콘은 그대로 둔다. 도형은 마스코트 오른쪽에 붙는다.

### 이미지 생성

- 메인 프로세스에서 Node 전용으로 그린다. 외부 캔버스 의존성을 추가하지 않는다.
- 방법: 마스코트 SVG(`electron/assets/mascot.svg`)와 도형을 하나의 SVG 문자열로 합쳐 `nativeImage.createFromDataURL`로 변환한다. 22pt 높이, 1x·2x를 `addRepresentation`으로 합친다. `setTitle`은 비운다.
- `nativeImage.createFromDataURL`의 SVG 지원은 Electron에서 보장되지 않는다. 구현 첫 단계에서 확인하고, 안 되면 숨긴 `BrowserWindow`에서 `capturePage`로 렌더하거나 PNG를 직접 인코딩하는 작은 함수를 쓴다. 이 확인 결과에 따라 아래 구현 순서 1단계의 범위가 달라진다.
- 갱신 빈도: 비율 표시는 초 단위 변화가 필요 없다. 도형 방식은 폭 기준 1px 변화가 있을 때만 다시 그린다. 25분 집중이면 막대 기준 약 40~60회만 갱신된다. 현재 `signature` 비교 로직에 비율 버킷을 넣으면 된다.
- 템플릿 이미지로 만들지 않는다. 지금처럼 색을 유지한다. 다크·라이트 메뉴 막대에서 모두 보이는 색인지 구현 때 확인한다.

### 설정

- `settings.trayDisplay: 'clock' | 'bar' | 'ring' | 'hourglass'`. 기본값 `clock`.
- `validateSettings`에서 알 수 없는 값은 `clock`으로 되돌린다. 기존 저장 데이터에 항목이 없으면 `clock`.
- `settings:save`에 `trayDisplay` 추가. 저장소 스키마는 설정이 JSON 한 덩어리라면 변경 없음. 컬럼이면 마이그레이션 1건.
- 설정 화면 `포모도로 설정` 카드에 항목 하나 추가. 라벨과 선택지 문구는 아래 "새 문구" 표의 초안이며 승인 후 넣는다.

## 2. 팝오버 화면

### 동작

- 트레이 아이콘을 클릭하면 아이콘 바로 아래에 프레임 없는 작은 창이 뜬다. 다시 클릭하거나 창 밖을 클릭하면 닫힌다.
- 우클릭은 최소 메뉴만 유지한다. 항목은 `To3mato 열기`, `종료` 두 개. 팝오버가 뜨지 않는 상황의 대비책이다.
- 메인 창이 닫혀 있어도 팝오버는 동작한다. 지금 `window-all-closed`에서 앱을 종료하므로 이 부분은 바꾸지 않는다. 메인 창이 있을 때만 팝오버가 열린다는 뜻이다.

### 창 속성

```
new BrowserWindow({
  width: 280, height: 220,         // 내용에 맞춰 조정
  frame: false, resizable: false, movable: false,
  show: false, skipTaskbar: true, alwaysOnTop: true,
  transparent: false, backgroundColor: '#fff3e3',
  type: 'panel',                   // macOS에서 포커스를 뺏지 않음
  webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
})
```

- 위치: `tray.getBounds()` 기준 가로 중앙 정렬, 메뉴 막대 아래. 화면 가장자리에 걸리면 `screen.getDisplayNearestPoint`로 안쪽으로 민다.
- 닫기: `blur` 이벤트에서 `hide()`. 트레이 클릭으로 닫을 때 `blur`가 먼저 와서 바로 다시 열리는 문제가 있으므로 `blur` 시각을 기록해 200ms 이내의 클릭은 토글하지 않는다.
- 창은 앱 시작 시 한 번 만들어 숨겨 둔다. 매번 생성하면 첫 표시가 느리다.
- `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`로 전체 화면 앱 위에서도 뜨게 한다.

### 화면 내용

위에서 아래로 다음 요소만 둔다.

1. 남은 시간 `MM:SS`. 메인 창 `#clock`과 같은 글꼴·숫자 분할 표시.
2. 상태 한 줄. 기존 `timerMenuState().status` 값 그대로 (`집중 대기`, `집중 중`, `일시정지`, `휴식 중`, `휴식 대기`).
3. 현재 할 일 제목. 타이머가 없으면 다음 할 일 제목. 둘 다 없으면 줄을 비운다.
4. 버튼 두 개. 기존 `primary`·`end` 라벨과 활성 조건 그대로.
5. 아래 작은 링크 하나: `To3mato 열기`. 메인 창을 앞으로 가져온다.

- 새 문구는 5번의 `To3mato 열기`와 우클릭 메뉴의 `종료`뿐이다. 나머지는 기존 문구 재사용.
- 메인 창의 `ExecutionPanel` 전체를 넣지 않는다. 팝오버는 시간·상태·주 동작만 다룬다.

### 렌더러 구조

- 진입점을 하나 추가한다. `tray.html` → `src/tray.ts` → `src/TrayApp.svelte`.
- Vite `build.rollupOptions.input`에 `index.html`, `tray.html` 둘을 등록. 개발 서버는 `${dev}/tray.html`, 배포는 `app://to3mato/tray.html`로 로드. `main.mjs`의 `will-navigate`·권한 핸들러의 허용 조건은 이미 origin 기준이라 변경 없음.
- preload는 기존 `preload.cjs`를 그대로 쓴다. `load`, `dispatch`, `subscribe`만 쓰면 되고 추가 IPC는 `window:show`(메인 창 앞으로) 하나다.
- `broadcast()`를 메인 창과 팝오버 둘 다에 보낸다. 지금은 `window?.webContents.send` 한 곳이다.
- 팝오버 안의 시계는 렌더러에서 `requestAnimationFrame`이나 250ms 간격으로 `elapsedSeconds`를 계산한다. 메인 창 `ExecutionPanel`과 같은 방식이다. 숨겨진 상태에서는 갱신을 멈춘다(`visibilitychange`).

### 기존 메뉴 제거

- `timerMenuState()`는 그대로 둔다. 팝오버 Svelte 컴포넌트와 도형 이미지 생성이 같은 함수를 쓴다. 다만 `clock`·`status`·`primary`·`end`·`command`에 더해 `ratio`(남은 비율 0~1)와 `phase`를 반환하게 확장한다.
- `createTimerTray`의 반환값에서 `menu`를 빼고 `popover`(BrowserWindow)와 `contextMenu`(우클릭 최소 메뉴)를 둔다.

## 3. 영향 범위

| 파일                                 | 변경                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `src/lib/domain.mjs`                 | `settings.trayDisplay` 기본값·검증·`settings:save`. `timerMenuState`를 여기로 옮길지 검토 |
| `src/lib/types.ts`                   | `settings` 타입에 `trayDisplay` 추가                                                      |
| `electron/tray.mjs`                  | 도형 이미지 생성, 팝오버 창 생성·위치·토글, 우클릭 최소 메뉴                              |
| `electron/tray-image.mjs` (신규)     | SVG 문자열 생성과 `nativeImage` 변환. 순수 함수로 두고 단위 테스트                        |
| `electron/main.mjs`                  | `broadcast`를 두 창에 전송, `window:show` IPC, 팝오버에 상태 전달                         |
| `electron/preload.cjs`               | `showMain()` 추가                                                                         |
| `vite.config.ts`, `tray.html`        | 두 번째 진입점                                                                            |
| `src/tray.ts`, `src/TrayApp.svelte`  | 팝오버 화면                                                                               |
| `src/components/SettingsView.svelte` | 표시 방식 선택 항목                                                                       |
| `tests/tray.spec.ts`                 | `menu.items` 대신 팝오버 DOM과 `tray.getImage()` 크기·`getTitle()`을 검증                 |
| `tests/domain.test.mjs`              | `trayDisplay` 검증·저장 케이스                                                            |
| `tests/tray-image.test.mjs` (신규)   | 비율별 SVG 출력, 버킷 갱신 조건                                                           |

## 4. 구현 순서

1. `nativeImage`에서 SVG data URL이 렌더되는지 확인. 안 되면 대체 렌더 방식 결정. 이 단계 결과를 사용자에게 보고한다.
2. `settings.trayDisplay` 도메인·타입·테스트. 설정 화면 항목 추가(문구 승인 후).
3. `electron/tray-image.mjs`와 `clock` 외 세 방식의 트레이 표시. 기존 메뉴는 유지한 채로 먼저 배포 가능한 상태를 만든다.
4. 팝오버 진입점과 `TrayApp.svelte`. 트레이 좌클릭을 팝오버로 바꾸고 메뉴는 우클릭 최소 메뉴로 축소.
5. `tests/tray.spec.ts` 재작성. 전체 화면 앱 위, 다크 메뉴 막대, 메인 창 최소화 상태에서 수동 확인.

3단계까지만 끝내도 표시 방식 변경은 출시할 수 있다. 4단계가 팝오버다.

## 5. 결정이 필요한 항목

1. 도형 방식에서 숫자를 완전히 뺄지, 아니면 `bar`·`ring` 옆에 분 단위(`12`)만 작게 둘지.
2. 모래시계 모양. 위·아래 삼각형 두 개로 단순하게 그릴지, 마스코트 색과 맞춘 둥근 형태로 그릴지.
3. 팝오버 폭·높이와 글꼴 크기. 메인 창 시계 글꼴(Gamja Flower)을 그대로 쓸지.
4. 우클릭 최소 메뉴를 둘지. 두지 않으면 종료 경로는 메인 창의 앱 메뉴뿐이다.
5. 팝오버에 현재 할 일 제목을 보여줄지. 보여주면 긴 제목은 한 줄로 자른다.

## 새 문구 (승인 전)

| 위치               | 초안                               |
| ------------------ | ---------------------------------- |
| 설정 항목 라벨     | `트레이 표시`                      |
| 설정 선택지        | `시간`, `막대`, `원형`, `모래시계` |
| 팝오버 하단 링크   | `To3mato 열기`                     |
| 트레이 우클릭 메뉴 | `To3mato 열기`, `종료`             |

나머지 팝오버 문구(`집중 대기`, `집중 중`, `일시정지`, `휴식 중`, `휴식 대기`, `집중 시작`, `집중 재개`, `휴식 시작`, `집중 종료`, `휴식 종료`)는 기존 `timerMenuState` 값을 그대로 쓴다.

## 구현 결과 (2026-10-20)

- Electron 44.9.0에서 SVG data URL은 빈 `nativeImage`를 반환했다. 기존 마스코트 PNG와 도형을 메인 프로세스에서 합성하고 PNG로 인코딩한다. 외부 캔버스 의존성이나 렌더 전용 창은 추가하지 않았다.
- 높이 22pt에 1x·2x 이미지를 제공한다. 막대·원형은 48단계, 모래시계는 32단계로 갱신한다. 집중·휴식 색은 `src/styles/theme.css`에서 읽는다.
- 도형 옆 숫자는 표시하지 않는다. 모래시계는 삼각형 두 개를 사용한다. 팝오버는 280×250이며 실제 메인 시계의 `--font-num`과 숫자 분할 방식을 사용한다.
- `timerMenuState`는 `src/lib/domain.mjs`로 옮겨 팝오버와 메인 프로세스가 공유한다. 다음 할 일 또는 현재 할 일 제목을 한 줄로 표시한다. 우클릭에는 `To3mato 열기`와 `종료`를 둔다.
- 저장소는 설정별 컬럼을 사용하므로 스키마 v3에 `tray_display`를 추가했다. v2 이전 시 `to3mato.pre-v3.sqlite3` 백업을 만들고 기본값 `clock`을 적용한다. 설정 변경 로그와 가져오기·내보내기에도 포함한다.
- 숨긴 팝오버가 앱 종료를 막지 않도록 메인 창이 닫히면 팝오버와 트레이를 함께 해제한다. 팝오버 IPC는 상태 읽기·타이머 명령·창 표시 상태 읽기·메인 창 열기만 허용한다. 숨김 상태는 메인 프로세스의 실제 창 상태로 확인하며 숨겨진 동안 렌더러의 시계 갱신을 중지한다.
- 새 UI 문구는 위 표의 필수 설정 라벨·선택지·동작 이름만 사용했다.
- 자동 검증: 기본값과 검증, 기존 타이머 보존, v2 이전과 재시작 저장, 이미지 비율·크기·마스코트 보존, 팝오버 제어와 휴식 전환, 두 창 동기화, 최소화 복원, 앱 종료.
- 밝고 어두운 배경에서 도형 미리보기를 확인했다. 실제 전체 화면 앱과 메뉴 막대 테마 전환은 별도 수동 검증이 남아 있다.

검증 결과: `npm run check` 오류·경고 0건, `npm run build` 성공, 단위 테스트 71개 통과. UI 테스트는 실행 가능한 15개 통과했으며 서명된 배포 파일이 필요한 3개는 제외했다.

## 대기·휴식 상태 표시 (2026-10-21)

트레이 아이콘만 보고 타이머가 돌고 있는지, 멈췄는지, 휴식인지 구분할 수 있도록 마스코트 이미지를 상태별로 바꾼다. 네 가지 표시 방식 모두 같은 규칙을 쓴다. `시간` 방식도 고정 PNG 대신 같은 생성 함수를 거친다.

| 상태                    | 마스코트         | 배지                      |
| ----------------------- | ---------------- | ------------------------- |
| 집중 중                 | 원래 색          | 없음                      |
| 집중 대기 (타이머 없음) | 흑백, 투명도 65% | 없음                      |
| 일시정지                | 흑백             | 잉크색 원 + 흰 막대 두 개 |
| 휴식 중                 | 원래 색          | 초록 원 + 흰 컵           |
| 휴식 대기               | 흑백             | 초록 원 + 흰 막대 두 개   |

- 배지는 마스코트 오른쪽 아래에 지름 12pt로 그린다. 흰 테두리를 둘러 어두운 메뉴 막대와 밝은 메뉴 막대에서 모두 보이게 한다. 원 색은 `theme.css`의 `--ink`와 `--green`을 읽는다.
- 막대·원형·모래시계의 도형 처리(휴식 색, 일시정지 투명도, 대기 시 빈 도형)는 그대로 두고 배지를 더한다.
- 이미지 갱신 키에 `clock`도 포함한다. `clock`은 비율 단계가 0이라 상태가 바뀔 때만 다시 그린다.
- 실제 메뉴 막대의 다크·라이트 전환은 수동 확인이 필요하다.
