# To3mato UI/UX 리워크 3단계 작업 프롬프트

아래 내용을 그대로 다른 에이전트에게 전달한다.

---

To3mato(Electron + Vite + Svelte 5 포모도로·할 일 앱, 저장소 `/Users/doyeongkim/Documents/projects/to3mato`)의 UI/UX 리워크 3단계를 구현한다. 1단계와 2단계는 끝났고, 이 작업은 **계획 시작 카드, 돌아보기 화면, 알림 설정, 템플릿**이다.

## 먼저 읽을 것

1. `AGENTS.md` 전체. 특히 카피 규칙(새 문구를 임의로 만들지 않는다, T 톤, 장식 문구 금지, `·` 메타 줄 금지). 아래 "승인된 문구" 밖의 문구가 필요하면 넣지 말고 초안을 사용자에게 먼저 보여준다.
2. 구현 계획 `/Users/doyeongkim/.claude/plans/inherited-puzzling-allen.md`의 "3단계" 절과 "데이터 모델과 저장소" 절.
3. 디자인 캔버스 https://claude.ai/artifact/4ADqho49kRcxzMkjg6uAWH (Claude Design). Artifact 도구의 read로 `project/canvas.json`과 아트보드 파일을 읽는다. 이번 단계의 기준 아트보드는 `project/Plan.dc.html`(계획 시작 카드), `project/Review.dc.html`(돌아보기), `project/Template.dc.html`(템플릿으로 추가 대화상자), `project/MainTemplate.dc.html`(할 일 탭에서 템플릿 버튼을 눌러 펼친 상태)이다. 캔버스 왼쪽 메모의 "리워크 원칙", "손글씨 부품 여섯 가지", "데이터 모델 변경"도 읽는다.
4. 코드: `src/lib/domain.mjs`(모든 상태 변경은 `applyCommand`), `src/lib/types.ts`, `src/components/TodoView.svelte`, `QuickAdd.svelte`, `BatchTaskDialog.svelte`, `SettingsView.svelte`, `ExecutionPanel.svelte`, `src/styles/tokens.css`, `components.css`, `app.css`, `electron/main.mjs`, `electron/notifications.mjs`, `electron/preload.cjs`, `tests/rework.test.mjs`, `tests/usability.spec.ts`.

## 현재 상태

- 브랜치: `main`에 1단계가 합쳐져 있다. 2단계는 `rework/2-diary` 브랜치의 커밋 `71bbb2e`에 있고 아직 main에 합치지 않았다. **3단계는 `rework/2-diary`에서 갈라낸 새 브랜치 `rework/3-rituals`에서 작업한다.** `release/*` 브랜치는 만들지 않는다(푸시 시 자동 배포). main 병합과 푸시, PR은 사용자가 지시할 때만 한다.
- 데이터 모델(스키마 v4)은 이미 들어가 있어 **마이그레이션을 추가하지 않는다.** 쓸 수 있는 것:
  - `settings.dailyCapacity`(1~16), `settings.planAt`·`settings.reviewAt`(`'HH:MM'` 또는 `''`, 기본 `''` = 꺼짐), `settings.remindDays`(0~6 정수 배열, 기본 `[1,2,3,4,5]`). `settings:save`는 넘긴 키만 병합한다.
  - `templates` 엔티티와 명령 `template:save {id?, name, steps:[{title, estimate:1|2}]}`, `template:delete {id}`, `template:apply {id, date, project?}`(단계를 그 날짜의 할 일로 즉시 생성, `%n%`은 `1`로 치환). 단계는 1~20개, 템플릿은 500개까지.
  - `task:move {id, date}`(빈 문자열이면 미지정), `task:reorder {id, before}`, `task:toggle`, `task:delete`.
  - `usedPomodoros(state, taskId)`, `getTodoSections(tasks, today)`(오늘, 내일, 할 일이 있는 날짜, 미완료가 있는 지난 날짜, 미지정 순).
  - 도메인 검증 오류 메시지는 이미 있다: `템플릿을 찾을 수 없습니다.`, `템플릿 단계는 1~20개여야 합니다.`, `템플릿은 500개까지 저장할 수 있습니다.`, `시간 형식이 올바르지 않습니다.`, `요일 선택을 확인하세요.`
- 손글씨 부품: `src/components/parts/Paper.svelte`, `Circ.svelte`, `HandBar.svelte`, `CapacityRow.svelte`, `Tomato.svelte`(variant), `Icon.svelte`(grip, lock, close, pencil, star, heart, prev, next 포함). CSS 클래스는 `components.css`의 `.paper .tape .wave .hl .circ .badge .chip .step .seg .seg-b .btn-text .btn-dash .btn-line .quick .qinput .receipt .rline .tag .sticker-date .divider .film` 등을 쓴다. 새 규칙은 `app.css` 끝에 "리워크 3단계" 주석 아래에 추가한다. `components.css`와 `tokens.css`는 값 추가 외에 건드리지 않는다.
- `QuickAdd.svelte`의 `템플릿` 버튼은 `disabled` 상태로 자리만 잡혀 있다. 이번 단계에서 활성화한다.
- `BatchTaskDialog.svelte`에는 add-mode(`하나 추가`, `여러 개 추가`)가 있고 `generateTaskBatch`(`src/lib/batch.mjs`)가 `%n%`·`%date%` 패턴과 요일 배치를 처리한다.
- `electron/main.mjs`의 250ms 티커가 `advanceTimer`를 돌리고, `electron/notifications.mjs`의 `createTimerNotifications`가 시스템 알림을 만든다(클릭 시 메인 창 표시). preload는 `contextBridge`로 `window.to3mato`에 메서드를 노출하고 타입은 `src/lib/types.ts`의 `Window.to3mato`에 선언한다.

## 구현할 것

### A. 템플릿

1. 할 일 탭 바로 추가 줄(`QuickAdd.svelte`)의 `템플릿` 버튼을 활성화한다. 누르면 그 줄 아래에 종이 메모(`.paper.alt`)가 펼쳐지고 저장된 템플릿 목록이 보인다(`MainTemplate.dc.html` 기준). 각 항목은 이름, 단계 칩(제목과 토마토), 예상 합계. 항목을 누르면 `template:apply {id, date: 섹션 날짜, project}`로 **즉시** 생성되고 메모가 닫힌다. 템플릿이 없으면 메모 안에 `템플릿 추가` 버튼만 두고 누르면 아래 대화상자를 템플릿 모드로 연다. 버튼 눌림 상태는 `.btn-line.pressed`.
2. `BatchTaskDialog.svelte`의 add-mode에 세 번째 `템플릿`을 추가한다(`Template.dc.html` 기준). 왼쪽: 템플릿 목록(선택 상태 `.tpl.on`)과 `템플릿 추가`. 오른쪽: 선택한 템플릿의 단계 편집(제목 입력, 예상 1/2 `.seg`, 삭제, `단계 추가`), `회차` 스테퍼, `시작일`, 기존 `배치할 요일` 토글 재사용, 프로젝트 선택, 미리보기(`생성될 할 일 N`, `예상 합계 N`, 처음 4개 행과 `외 N개`), 아래에 `템플릿으로 저장`(→ `template:save`)과 `저장`(→ 생성). 생성은 `generateTaskBatch`를 단계별로 돌려 합치거나 같은 규칙(회차 n의 `%n%` 치환, 요일 순서 배치)으로 직접 만든 뒤 `task:batch`로 보낸다. 기존 `하나 추가`·`여러 개 추가` 동작과 테스트(`tests/batch.spec.ts`, `tests/usability.spec.ts`)는 그대로 통과해야 한다.
3. 다이어리(`DiaryView.svelte`)의 `템플릿으로 저장` 버튼(현재 자리만 있음)을 활성화한다. 그 프로젝트의 완료 티켓 중 최근 1~6개를 골라 단계로 저장하는 작은 대화상자. 템플릿 이름 입력, 티켓 체크 목록, `저장`.

### B. 계획 시작 카드 (`PlanCard.svelte`, `Plan.dc.html` 기준)

- `TodoView.svelte` 오늘 섹션 위에 종이 카드(`.paper.peach`)로 열린다. 제목 `계획 시작`, 닫기 버튼.
- 1단계 `어제 미완료`: 어제 날짜(`offsetDate(-1, today)`)의 미완료 할 일 행. 각 행에 `오늘로`(`task:move` 오늘), `보관`(`task:move` 빈 문자열), `삭제`(`task:delete`). 없으면 `어제 미완료 할 일이 없습니다.`
- 2단계 `오늘 가능`: 스테퍼(`settings:save {dailyCapacity}`), 옆에 `지난 7일 평균 N`(최근 7일 기록 포모도로 합 ÷ 7, 반올림), 연필 토마토 줄(`CapacityRow` 재사용).
- 3단계 `미지정`: 미지정 행과 `오늘에 배치` 버튼(이미 `TaskList`의 backlog 모드에 있음).
- 열림 조건: (a) 알림 클릭으로 `ritual:open` `'plan'`이 오거나, (b) `settings.planAt`이 설정되어 있고 오늘 그 시각이 지났으며 오늘 아직 닫지 않았을 때. 닫힘 기록은 **렌더러의 localStorage**(`to3mato-rituals-v1`, `{ plannedDate, reviewedDate }`)에 둔다. 설정 테이블에 날짜 컬럼을 추가하지 않는다. 닫기 또는 첫 포모도로 시작(`timer:play`) 시 닫고 오늘 날짜를 기록한다.

### C. 돌아보기 (`ReviewView.svelte`, `Review.dc.html` 기준)

- 왼쪽 작업 영역을 덮는 화면(탭이 아님). 제목 `돌아보기`, 날짜 스티커, 닫기.
- 오늘 완료 카드: `완료 N`, `오늘 가능 N`, `배치 N`, 토마토 도장 줄.
- `오늘 할 일` 표: 행마다 처음 예상 토마토, 실제 사용 토마토, 차이(`+1`, `-1`, `0`; 초과는 빨강, 절약은 초록).
- `미완료`: 오늘 미완료 행에 `내일로`(`task:move` 내일), `보관`, `완료`(`task:toggle`). 없으면 `미완료 할 일이 없습니다.`
- `내일`: `내일 가능` 스테퍼(같은 `dailyCapacity`를 바꾼다. 날짜별 용량은 두지 않는다), 배치 토마토 줄, 내일 할 일 목록.
- `저장` 버튼은 화면을 닫고 localStorage에 `reviewedDate`를 기록한다.
- 여는 방법: 알림 클릭(`ritual:open` `'review'`)과 설정 탭 알림 카드의 `돌아보기` 버튼.

### D. 알림 (`SettingsView.svelte`, `electron/main.mjs`, `electron/notifications.mjs`, `electron/preload.cjs`)

- 설정 탭에 `알림` 카드(기존 `settings-card` 형식): `계획 시각`과 `돌아보기 시각`(`<input type="time">`, 비우면 꺼짐), 요일 토글(기존 `BatchTaskDialog`의 요일 토글 모양 재사용, `settings:save {remindDays}`), `돌아보기` 열기 버튼. 데스크톱이 아닐 때(브라우저)도 설정은 저장되고 알림만 없다.
- main의 250ms 티커 안에서 1분에 한 번 `dueReminder(state, now, fired)`를 검사한다. 순수 함수로 `electron/notifications.mjs`에 두고 node 테스트를 쓴다: `planAt`/`reviewAt`이 비어 있지 않고, 오늘 요일이 `remindDays`에 있고, 현재 시각이 설정 시각 이상이며, 오늘 아직 보내지 않았으면 `{ kind:'plan'|'review', title, body }`를 돌려준다. 하루 한 번은 main 메모리의 `{ plan: 'YYYY-MM-DD', review: 'YYYY-MM-DD' }`로 막는다. 계획 알림의 제목은 `계획 시작`, 돌아보기 알림의 제목은 `돌아보기`, 본문은 빈 문자열.
- 알림 클릭 시 `showMain()` 후 `window.webContents.send('ritual:open', kind)`. preload에 `onRitual(callback)` 추가, `types.ts`에 선언. 렌더러(`App.svelte`)는 `'plan'`이면 할 일 탭으로 가서 계획 카드를 열고, `'review'`면 돌아보기 화면을 연다.

## 승인된 문구 (이 안에서만 쓴다)

계획 시작 / 어제 미완료 / 오늘로 / 보관 / 삭제 / 오늘 가능 / 지난 7일 평균 / 미지정 / 오늘에 배치 / 어제 미완료 할 일이 없습니다. / 돌아보기 / 완료 / 배치 / 오늘 할 일 / 처음 예상 / 실제 사용 / 미완료 / 내일로 / 미완료 할 일이 없습니다. / 내일 / 내일 가능 / 저장 / 닫기 / 알림 / 계획 시각 / 돌아보기 시각 / 템플릿 / 템플릿 추가 / 단계 / 단계 추가 / 회차 / 시작일 / 배치할 요일 / 프로젝트 / 생성될 할 일 / 예상 합계 / 외 N개 / 템플릿으로 저장 / 템플릿 이름

기존 문구는 그대로 쓴다: 할 일 추가, 여러 할 일 추가, 하나 추가, 여러 개 추가, 할 일 이름, 예상 포모도로, 예정일, 할 일 이름 규칙, 목록 생성, 설정 수정, N개 추가, 프로젝트 없음.

## 지켜야 할 것

- 기존 Playwright 사양이 쓰는 역할과 이름을 깨지 않는다: 탭 버튼 이름(할 일, 프로젝트, 캘린더, 집중 로그, 설정), 섹션 `region` 이름(오늘, 내일, 미지정), 버튼 `${label} 할 일 추가`, `${title} 완료 / 완료 취소 / 수정 / 시작 / 일시정지`, 대화상자 이름(할 일 추가, 할 일 수정, 여러 할 일 추가, 프로젝트 추가, 프로젝트 수정), `#clock`, `#focus-title`, `.todo-section`, `.workspace .task-row`, `.day-cell`, `.toast`.
- 섹션마다 `할 일 이름` 입력이 하나씩 있으므로 테스트 선택자는 `region`이나 `dialog`로 범위를 좁힌다.
- `src/components/CaptureMoment.svelte`, `FocusLog.svelte`, `src/lib/video.ts`는 prettier 기준과 어긋나 있는 기존 파일이다. 건드리지 않고 포맷도 바꾸지 않는다(`npx prettier --write`를 디렉터리 전체에 돌리지 말고 수정한 파일만 지정한다).
- 커밋은 기능 단위로 나누고 메시지는 영어 현재형 한 줄 제목과 짧은 본문.

## 검증 순서

1. `npm run check`(svelte-check 0 오류), `npm test`(node, 현재 101개 통과), `npm run build`.
2. `npm run test:ui`는 **build 이후**에 돌린다(Electron 테스트가 `dist/`를 읽는다). 현재 18개 통과, 3개는 서명 산출물이 없어 건너뛴다. `tests/tray.spec.ts`의 숨은 창 시계 단언이 드물게 시간 문제로 실패하는데 재실행에서 통과한다.
3. 새 테스트: `dueReminder`와 7일 평균 계산(node), 템플릿 즉시 생성·대화상자 생성·계획 카드 이월·돌아보기 미완료 처리(Playwright, `tests/usability.spec.ts`의 `ui` 픽스처 사용).
4. 화면 확인은 `npm run dev:web`(127.0.0.1:4173)의 브라우저 모드로 한다. 같은 origin의 다른 탭이 열려 있으면 storage 이벤트로 상태가 섞이므로 탭은 하나만 둔다.

## 완료 보고에 포함할 것

- 커밋 목록과 브랜치 이름, 통과·실패·건너뛴 테스트 범위.
- 승인된 목록 밖에서 필요했던 문구가 있으면 초안으로 따로 적는다(넣지 않은 채로).
- main 병합 여부는 사용자가 정한다. 합치지 말고 보고만 한다.

## 보류 중인 결정 (사용자에게 다시 물을 것)

- 집중 종료 알림 본문 `${할 일 이름} · 1포모도로 완료. 휴식 시간입니다`는 진척 확인 단계가 생기면서 뒤 문장이 맞지 않는다. 뒤 문장을 빼는 초안이 승인 대기 중이다. 승인 전에는 기존 문구를 유지한다.
