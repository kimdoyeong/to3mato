# Supabase 동기화 구성과 검증

작성일: 2026-10-26

구현 기준은 `supabase-sync-plan.md`다. 이 문서는 운영 프로젝트 연결과 검증 절차를 기록한다. 아래 CLI 적용 기록에 실제 서버 배포 결과와 미검증 범위를 구분한다.

## 앱 구성

- 앱에는 프로젝트 URL과 publishable key만 넣는다. secret key 또는 service role key는 앱에 넣지 않는다.
- 개발 실행은 `TO3MATO_SUPABASE_URL`과 `TO3MATO_SUPABASE_PUBLISHABLE_KEY`를 사용한다.
- 패키징 전에 같은 환경 변수로 `npm run sync:configure`를 실행한다. 생성되는 `electron/supabase-config.json`은 앱에 포함되며 Git에서는 제외한다.
- 구성 값이 없으면 로컬 기능은 유지되고 계정 기능만 사용할 수 없다. 잘못된 구성도 로컬 데이터를 변경하지 않는다.
- HTTP 주소는 `127.0.0.1` 시험 서버만 허용한다. 시험 키 예외에는 `TO3MATO_SYNC_TEST=1`이 필요하다. 운영 설정 생성 도구는 HTTPS와 publishable key를 요구한다.
- 브라우저 시험 클라이언트는 `tests/sync-harness.html`이다. 배포용 Vite 입력에 포함하지 않는다. 테스트 세션은 메모리, 데이터와 전송 대기열은 IndexedDB에 둔다.

## Supabase 프로젝트

1. 프로젝트를 준비하고 이메일 OTP를 구성한다. `supabase/config.toml`의 OTP 유효 시간은 600초다. 실제 메일 발송용 SMTP와 인증 코드 템플릿을 적용한다. 발신 문구는 기존 승인 내용을 사용한다.
2. `supabase/migrations/202610260001_sync.sql`을 테스트 프로젝트에 적용한다. 운영 적용 전 DB 백업과 `supabase test db`를 수행한다.
3. Realtime 설정에서 공개 채널 접근을 끈다. 앱은 `account:<user_id>` 비공개 채널만 구독한다. DB·Realtime·Storage 각각에 소유자 정책을 적용한다.
4. `delete-account`, `purge-assets` Edge Function을 배포한다. 각 함수는 Authorization의 사용자 토큰을 Auth에서 검증한다. 함수는 Supabase가 주입하는 `SUPABASE_SECRET_KEYS`의 `default` 키를 사용하고, 구형 런타임에서는 `SUPABASE_SERVICE_ROLE_KEY`를 사용한다. 별도 키가 필요한 환경만 `TO3MATO_ADMIN_KEY`로 재정의한다. 키를 추출하거나 앱·소스·로그에 기록하지 않는다. 사용자 정의 Secret에는 예약된 `SUPABASE_` 접두사를 사용하지 않는다. [공식 환경 변수 문서](https://supabase.com/docs/guides/functions/secrets)
5. 사용자 호출용 함수의 `verify_jwt=true`를 유지한다. 앱은 publishable key와 별도로 사용자 세션 JWT를 Authorization에 보낸다. 함수 내부에서도 `auth.getUser(token)`으로 확인한다. [공식 인증 문서](https://supabase.com/docs/guides/functions/auth)
6. 실제 프로젝트에서 이메일 수신, 재로그인, private Broadcast, Storage 업로드·다운로드·삭제, 탈퇴 후 DB와 파일 제거를 확인한다. 이 절차는 로컬 HTTP 시험 서버만으로 대체되지 않는다.

RLS는 모든 계정 테이블에서 `auth.uid()`로 격리한다. 클라이언트 직접 쓰기는 허용하지 않고 RPC에서 계정 행을 잠근 뒤 revision을 부여한다. 인증이 만료되어도 로컬 큐는 남는다.

## 저장과 복구

- 기존 로컬 DB는 v5로 이전한다. v4 이전의 데이터·기록 ID를 유지하며 `sync_document`에 계정 문서·cursor·전송 대기열을 함께 저장한다.
- 계정 데이터는 `userData/accounts/<user_id>/`에 둔다. 로컬 전용 DB와 다른 계정의 DB를 자동으로 합치지 않는다.
- 최초 연동 시 로컬 DB와 계정 DB의 복구 지점을 만들고 렌더러 영상 저장소도 별도 IndexedDB로 복사한다. 원본 로컬 저장소를 지우지 않는다.
- `account-binding.json`은 최초 로컬 데이터 이전 대상을 기록한다. 미디어 이전 완료 여부도 기록해 중단 후 재개한다.
- JSON 내보내기는 데이터만 포함한다. 연동 중 가져오기는 추가·갱신만 전파하고 누락 항목을 삭제하지 않는다. 현재 공유 타이머도 가져온 파일로 교체하지 않는다.
- 미전송 변경은 연동 해제·인증 만료·로그아웃 때 삭제하지 않는다. 로그인 자격 증명과 전송 권한은 계정 데이터와 분리한다.
- 삭제 표식·처리한 명령·변경 이력은 현재 자동 정리하지 않는다. 보존 비용을 관찰하고 snapshot/epoch 기반 정리가 구현되기 전에는 수동으로 오래된 행만 삭제하지 않는다.
- DB 백업을 복원할 때는 모든 `account_sync_state.epoch`를 새 UUID로 바꾼다. 복원된 DB의 epoch를 그대로 유지하면 클라이언트가 복원 이전 cursor를 유효하다고 판단할 수 있다.
- 충돌 항목은 설정에서 내보내거나 별도 보관할 수 있다. 겹친 오프라인 기록을 자동으로 합산하지 않는다. 초기 타이머가 양쪽에 있으면 서버 타이머를 표시하고 로컬 타이머 적용 여부를 별도로 선택한다.

## 미디어 용량과 재시도

현재 기본 상한은 계정당 250 MiB다. 유료 플랜으로 자동 전환하지 않는다. 앱에서 예약 용량을 확인하고 Storage 업로드 정책에서도 예약 합계를 확인한다. 파일 예약 크기는 Storage 사전 권한 검사(`contentLength`)와 업로드 완료 검사(`size`)에 모두 적용한다. [Storage 업로드 구현](https://github.com/supabase/storage/blob/master/src/storage/uploader.ts)

상한 또는 전송 오류가 발생해도 할 일·타이머 등 데이터 동기화는 계속한다.

예상량의 예: 3초 클립이 2 Mbps이고 썸네일이 0.05 MB라면 한 번에 약 0.8 MB다. 하루 10개를 30일 보관하면 약 240 MB이며 주간 영상의 재인코딩 결과가 비슷한 비트레이트면 추가 저장량이 발생한다. 실제 파일 크기·활성 사용자 수·다운로드 횟수로 운영 프로젝트의 보관량과 전송량을 산정한 뒤 상한 또는 서비스 플랜을 수동 결정한다. 이 계산은 Supabase 요금제의 제공량을 뜻하지 않는다.

파일 업로드는 `pending → ready`로 진행한다. 파일 해시와 크기를 확인한 뒤 완료 상태를 전파한다. 업로드 성공 응답을 잃으면 같은 객체를 읽어 해시를 확인하고 이어간다. 파일을 덮어쓰지 않는다. 썸네일·클립·주간 영상은 재시도 가능한 IndexedDB 큐와 메인 프로세스의 로컬 캐시를 사용한다.

클립 삭제 또는 프로젝트 표지 교체로 참조가 사라진 파일은 삭제 표식을 남긴 뒤 `purge-assets`에서 제거한다. 기존에 생성한 `pending` 파일은 앱 중단 후 재시도 대상으로 보존한다. 참조 없이 남은 업로드를 정리할 때도 미전송 큐가 있을 수 있으므로 먼저 보관 여부를 확인한다. 현재 만료 기간만으로 미완료 업로드를 삭제하지 않는다.

## 검증 명령과 경계

```sh
npm run check
npm test
npm run build
npm run test:sync:ui
supabase test db
```

- `npm run test:sync`는 PGlite의 실제 PostgreSQL 엔진에서 SQL 마이그레이션·RPC·RLS를 실행한다. Supabase Auth·Realtime·Storage의 외부 서비스 부분은 시험용 스키마로 대체한다.
- `test:sync:ui`는 별도 임시 폴더의 Electron 두 인스턴스와 설치된 Chrome을 사용한다. 실제 Supabase SDK를 HTTP/WebSocket 시험 서버에 연결하고 RPC는 위 PostgreSQL에서 실행한다.
- 시험 서버는 OTP와 파일 저장·Broadcast 전달을 흉내 낸다. 운영 Supabase의 메일 발송, 네트워크 지연, Realtime 서비스 제한, Storage 서비스 동작과 Edge Function 배포는 별도 확인한다.
- 지연 측정은 로컬 시험 환경의 10회 변경 전파를 기록한다. 결과는 `test-results/sync-latency.json`에 저장하며 p95 1초 이내를 검사한다. 실제 네트워크의 서비스 보장 수치가 아니다.
- 다른 플랫폼 앱 출시, 서명·공증, R2와 웹사이트 배포는 이 구현 검증에 포함하지 않는다. 개인정보 처리방침·이용약관은 사용자가 작성한 문구가 준비된 뒤 공개 배포 전에 추가한다.

## 2026-10-26 구현 검증 결과

- 정적 검사: 오류 0건·경고 0건. 프로덕션 웹 빌드 성공.
- Node 테스트: 134건 통과. 실제 PostgreSQL에서 멱등 재전송, 타이머 JS/SQL 결과 일치, 종료 시각 정산, 계정·파일·비공개 채널 격리, 파일 예약 용량을 확인했다.
- 데스크톱 두 인스턴스와 Chrome: 로그인만으로 연동하지 않음, 할 일·프로젝트 전파, 공유 타이머 시작·정지·재개·동시 종료, 연동 해제 후 대기열 보존·재연동, 재시작 복원, 다른 계정 분리를 확인했다.
- 파일 용량 초과 상태에서도 다른 항목의 읽음 상태와 삭제가 전송되는 것을 확인했다. 파일 대기열은 저장된 순번으로 처리해 수정 순서가 바뀌지 않는다.
- 기존 클립·주간 영상의 최초 계정 이전 후 다른 데스크톱에서 다운로드와 실제 WebM 재생을 확인했다. 기존 촬영·주간 영상 생성·다운로드 테스트와 JSON/SQLite 이전 테스트도 통과했다.
- 로컬 전파 지연: 10회 측정에서 p95 121 ms. 운영 네트워크 성능 측정은 아니다.
- Supabase CLI 전체 스택과 `supabase test db`는 실행하지 못했다. Docker 실행 환경이 없어 PGlite와 HTTP/WebSocket 시험 서버로 검증했다. SQL 정책은 실행했지만 실제 Supabase Auth·Realtime·Storage 서비스와 Edge Functions 배포까지 검증했다고 간주하지 않는다.
- 이 로컬 검증 이후 URL·publishable key 구성과 SQL·Edge Functions 배포를 진행했다. 이어지는 CLI 적용 기록을 참고한다. 앱 릴리스·서명·공증·사이트 배포는 수행하지 않았다.

## 2026-10-26 CLI 서버 적용 기록

- 사용자가 제공한 프로젝트 `nhlohcvnakltmhergjzx`의 URL·publishable key를 Git 제외 대상인 `electron/supabase-config.json`에 저장했다.
- Supabase CLI 2.122.0을 `npx --yes supabase`로 실행했다. 기존 로그인으로 해당 프로젝트에 접근하고 저장소를 연결했다. 별도 로그인 토큰이나 관리자 키를 사용자에게 요청하지 않았다.
- `db push --linked --dry-run --skip-vault`로 적용 SQL 한 건을 확인한 뒤 `202610260001_sync.sql`을 적용했다. seed나 별도 역할 변경은 적용하지 않았다.
- `delete-account`, `purge-assets`를 `functions deploy --use-api`로 배포했다. 두 함수 모두 버전 1, ACTIVE, `verify_jwt=true`를 확인했다. [서버 함수 관리](https://supabase.com/dashboard/project/nhlohcvnakltmhergjzx/functions)
- 실제 DB에서 직접 쓰기 금지·익명 읽기/호출 금지·인증 사용자 RPC·내부 함수 접근 금지·비공개 파일 bucket·15개 소유자 정책·비공개 채널 정책·15개 테이블 RLS 활성화 등 9개 항목이 모두 참이었다.
- 공개 API의 `sync_pull`은 미존재 응답에서 인증 없는 호출 거부(401)로 바뀌었다. 두 Edge Functions도 로그인하지 않은 요청에 401을 반환했다. 이메일 인증 기능 활성화도 확인했다.
- `supabase test db --linked`는 로컬 Docker 미실행으로 수행하지 못했다. 해당 권한 검사를 원격 SQL 조회로 대신했다. 로컬 동기화 테스트 13건은 재실행해 통과했다.
- 실제 이메일 수신·OTP 로그인, 로그인한 사용자의 실서버 Broadcast·파일 전송·계정 삭제 전체 동작은 아직 검증하지 않았다. SMTP·인증 메일 템플릿·만료 시간 등 원격 Auth 설정은 이번 작업에서 덮어쓰지 않았다.
