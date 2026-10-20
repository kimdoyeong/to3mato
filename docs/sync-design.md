# To3mato 계정과 동기화 상세 설계

작성일: 2026-10-20
상태: 상세 설계 초안. `server-community-design.md`의 결정 사항(순서 1, Supabase)을 따른다. 2026-10-20 직접 운영하는 API 서버(Cloudflare Workers) 설계를 Supabase 기준으로 다시 썼다. 구현 전 "승인 필요 문구"와 "구현 전 확인"에 답을 받는다.

범위는 0단계(로컬 스키마 v2)와 1단계(계정 + 변경 로그 동기화)다. 그룹·통계 공유(2단계)는 별도 문서로 설계한다.

## 목표

- 같은 계정으로 로그인한 Mac 두 대에서 할 일·프로젝트·집중 기록·설정이 같아진다.
- 오프라인에서 쓴 변경은 로컬에 쌓였다가 연결되면 올라간다. 네트워크 오류가 작업을 막지 않는다.
- 계정 없이 쓰는 사용자에게는 아무것도 바뀌지 않는다.
- 로컬 데이터 유실이 없다. 서버 병합이 로컬 행을 지우는 경우는 다른 기기에서 사용자가 지운 경우뿐이다.

범위 밖: 타이머 상태, 3초 클립과 영상 편지, 브라우저 미리보기, Windows·Linux.

## 0단계: 로컬 스키마 v2

서버 없이 먼저 배포한다. 1단계가 의존하는 모든 로컬 변경을 포함한다.

### 변경 요약

| 항목                  | v1                           | v2                                                                                              |
| --------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `focus_records.id`    | 배열 인덱스. 저장마다 재계산 | 안정적인 문자열 ID. `FocusRecord.id`가 상태 객체에도 포함된다                                   |
| 기록 순서             | `id` 순                      | `at, id` 순. 위치 값을 두지 않는다                                                              |
| 행 메타데이터         | 없음                         | `projects`·`tasks`·`focus_records`에 `updated_at`(HLC)과 `deleted`. `settings`는 `updated_at`만 |
| 삭제                  | 행 삭제                      | `deleted = 1` tombstone. 30일 뒤 정리                                                           |
| 할 일 → 프로젝트 FK   | 있음                         | 없음. 프로젝트가 없거나 삭제된 할 일은 프로젝트 없이 불러온다                                   |
| 변경 로그             | 없음                         | `changes` 테이블. 동기화를 켠 동안만 바뀐 행마다 한 줄                                          |
| 동기화 상태           | 없음                         | `sync_state` 테이블 (단일 행)                                                                   |
| `PRAGMA user_version` | 1                            | 2                                                                                               |

### 기록 ID

- 새 기록: `settleTimer`가 `crypto.randomUUID()`로 만든다.
- 기존 기록과 ID 없는 JSON: `normalizeState`가 `legacyRecordId()`로 채운다. `[taskId, at, seconds, duration, pomodoros]`의 FNV-1a 해시 두 개를 이어 `legacy-` + 16자리 16진수로 만든다. 같은 기록은 항상 같은 ID가 되므로 v1 백업을 다시 가져와도 중복되지 않는다. 길이가 고정이라 서버의 120자 제한에 걸리지 않는다.
- 값이 완전히 같은 기존 기록이 여러 개면 두 번째부터 `-2`, `-3`을 붙인다. 파일에 이미 있는 ID와도 겹치지 않게 한다.
- `normalizeState`는 파일에 명시된 기록 ID의 중복을 거부한다. `tasks`·`projects`와 같은 규칙이다.
- JSON 내보내기에 `id`가 포함된다. v1 앱은 `normalizeState`가 모르는 필드를 버리므로 v2 백업을 v1에서 가져와도 된다.

### DDL

전체 DDL은 `electron/storage.mjs`의 `SCHEMA_V2`가 기준이다. v1과 달라진 부분만 적는다.

```sql
-- projects, tasks, focus_records 공통
updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1))
-- tasks.project_id는 REFERENCES 없이 TEXT
-- focus_records: id TEXT PRIMARY KEY. position 열 없음
-- settings: updated_at TEXT NOT NULL 추가
CREATE TABLE changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL CHECK(entity IN ('project','task','record','settings')),
  id TEXT NOT NULL, data TEXT, hlc TEXT NOT NULL        -- data: 행 JSON. 삭제면 NULL
) STRICT;
CREATE TABLE sync_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  device_id TEXT NOT NULL,
  logging INTEGER NOT NULL DEFAULT 0 CHECK(logging IN (0,1)),
  cursor INTEGER NOT NULL DEFAULT 0 CHECK(cursor >= 0),   -- 서버에서 마지막으로 받은 server_seq
  last_sync_at REAL
) STRICT;
```

`timer` 테이블은 바꾸지 않는다. 불러오는 순서에 맞춰 `(deleted, position, id)`·`(deleted, at, id)` 인덱스를 추가했다.

### 마이그레이션 (v1 → v2)

1. 트랜잭션 밖에서 `to3mato.pre-v2.sqlite3`를 `VACUUM INTO`로 만든다. 이미 있으면 두어 첫 백업을 지킨다.
2. 한 트랜잭션에서 v1 상태를 읽고(`normalizeState`가 기록에 해시 ID를 붙인다) v1 테이블을 자식부터 지운다.
3. v2 스키마를 만들고 `sync_state`에 새 `device_id`를 넣는다.
4. 읽은 상태를 v2 테이블에 쓴다. 모든 행에 HLC가 붙는다. 변경 로그는 쓰지 않는다.
5. `PRAGMA user_version = 2`.

`ALTER TABLE` 대신 다시 만드는 이유는 `tasks`의 외래 키를 없애고 `focus_records`의 PK 타입을 바꿔야 하기 때문이다.

`load()`는 `user_version`이 0이면 v2를 바로 만들고 1이면 마이그레이션한다. 3 이상은 거부한다. v2 DB를 v1 앱이 열면 `지원하지 않는 DB 버전입니다: 2`로 중단하므로 다운그레이드는 지원하지 않는다.

### 하이브리드 논리 시계 (HLC)

- 형식: `${wall(15자리 0패딩 ms)}-${counter(4자리 0패딩)}-${deviceId}`. 문자열 비교가 시간 순서다.
- 로컬 변경: `wall = max(now, last.wall)`. `wall`이 같으면 `counter + 1`. 아니면 0.
- 원격 수신: `wall = max(now, last.wall, remote.wall)`. 같은 쪽의 counter + 1.
- counter가 9999를 넘으면 `wall`을 1ms 올리고 0부터 다시 센다. 한 번에 수천 행을 쓰는 스냅샷에서 생긴다.
- 시계 값은 따로 저장하지 않는다. 열 때 모든 행의 `updated_at`과 `changes.hlc` 중 최댓값에서 이어간다. 저장된 어떤 값보다 뒤에 오므로 재시작해도 단조 증가한다.
- 같은 행에 같은 HLC가 두 번 올 수 없다. deviceId가 다르면 문자열이 다르다.

시계가 크게 앞서는 기기는 늦은 변경 우선 규칙에서 계속 이긴다. `changes` 테이블의 insert 트리거가 `wall`이 서버 시각 + 24시간을 넘는 변경을 거부한다. 그 이내의 어긋남은 그대로 받는다.

### 저장 경로 변경 (`electron/storage.mjs`)

- `writeChanges`가 행을 넣거나 바꿀 때 `updated_at = tick()`을 함께 쓴다. 삭제는 `deleted = 1`과 `updated_at` 갱신. 동기화를 켠 동안에는 `changes`에도 한 줄씩 쓴다. 삭제는 `data = NULL`.
- 다시 넣은 ID가 tombstone이면 `deleted = 0`으로 되살린다.
- `load()`는 `deleted = 0`인 행만 상태로 만든다. 할 일·프로젝트는 `position, id` 순, 기록은 `at, id` 순.
- 동기화용 메서드
  - `pendingChanges(limit)`: 보낼 로그를 `seq` 순으로 반환
  - `markPushed(seqs)`: 보낸 로그를 지운다. 서버에 있으므로 로컬에 남길 필요가 없다
  - `applyRemote(changes, { cursor })`: 아래 "원격 변경 적용"
  - `resetSync()`: 로그를 비우고 기록을 켠 뒤 살아 있는 행과 tombstone 전체를 각 행의 `updated_at`으로 넣는다. `cursor = 0`. 로그인 때 호출
  - `disableSync()`: 로그를 비우고 기록을 끈다. `cursor = 0`. 로그아웃 때 호출
  - `syncState()` / `saveSyncState({ cursor, lastSyncAt })`
- 동기화를 켜지 않은 사용자에게는 로그가 쌓이지 않는다. 로그인하면 `resetSync()`가 전체를 보내므로 그 전 로그는 필요 없다.
- tombstone 정리: `load()` 때 `deleted = 1`이고 `updated_at`의 wall이 30일 이전이며 같은 행의 보낼 로그가 없는 행을 지운다.

### 원격 변경 적용 (`applyRemote`)

한 트랜잭션에서 수행한다. 적용 순서는 `project → task → record → settings`. 같은 entity 안에서는 `hlc` 순.

1. 변경마다 형식과 값을 `validate*Row`로 검사한다. 통과하지 못한 변경은 건너뛰고 수만 반환한다.
2. 모든 entity에 같은 규칙을 쓴다. 로컬 행이 없거나 `remote.hlc > local.updated_at`이면 적용한다. 같거나 작으면 무시한다. 같은 묶음을 두 번 받아도 결과가 같다.
3. 원격 삭제(`data = NULL`)는 tombstone으로 만든다. 로컬에 없는 행이면 자리표시 값으로 tombstone을 넣는다. 나중에 더 오래된 사본이 와도 되살아나지 않는다.
4. 할 일의 `project`는 그대로 저장한다. 프로젝트가 아직 없거나 삭제됐으면 불러올 때만 프로젝트 없이 보인다. 프로젝트가 나중에 도착하면 연결이 돌아온다.
5. 할 일과 프로젝트의 위치를 다시 매긴다. 원격 행과 같은 위치 값이 생기면 `id`로 순서를 정하고 0부터 빈칸 없이 다시 쓴다. 바뀐 위치는 로컬 변경으로 로그에 남는다. 같은 규칙을 쓰므로 기기들이 같은 순서로 수렴한다.
6. `cursor`를 받으면 같은 트랜잭션에서 저장한다.
7. 커밋 전에 결과 상태를 `normalizeState`로 검사한다. 실패하면 전체를 되돌린다. 원격 변경 때문에 앱을 열 수 없는 DB가 되지 않는다.

원격 변경을 적용한 행은 `changes`에 다시 쓰지 않는다. 반환값은 `{ state, applied, skipped }`다.

타이머와의 충돌:

- 집중 중인 작업이 원격에서 삭제되거나 완료되고 그 변경이 이기면 적용 전에 `settleTimer`를 실행해 기록을 남기고 타이머를 비운다. 로컬 `task:delete`·`task:toggle`과 같은 규칙이다. 이때 생긴 기록은 로컬 변경으로 로그에 들어간다.
- 휴식 타이머는 영향이 없다.

메인은 반환된 상태를 `state`로 바꾸고 기존 `state:changed` 경로로 렌더러에 보낸다. 렌더러는 바뀌지 않는다.

### JSON 가져오기

로그인 여부와 관계없이 같은 경로를 쓴다. `replace()`는 백업(`to3mato.pre-import.sqlite3`)을 만든 뒤 일반 저장과 같은 `writeChanges`로 쓴다.

- 가져온 파일에 없는 로컬 행은 tombstone이 된다.
- 바뀐 행과 새 행은 새 HLC로 쓴다. tombstone이던 ID는 되살아난다.
- 동기화를 켠 동안에는 각각 `changes`에 기록된다.

로그인 상태라면 가져오기 결과가 다른 기기에도 전파된다. 확인 대화상자의 `detail`에 승인된 한 줄을 추가한다(6단계).

### `src/lib/domain.mjs`

- `FocusRecord`에 `id: string` 추가. `settleTimer`가 생성. `normalizeState`가 검증하고 없으면 `legacyRecordId()`로 채운다.
- 행 단위 검증 함수를 export한다. `applyRemote`가 원격 행을 받을 때 같은 함수로 검증한다. 서버에는 코드가 없으므로 검증은 받는 쪽 앱이 한다.
  - `validateProjectRow(raw)` → `{ id, name, icon, color, position }`
  - `validateTaskRow(raw)` → `{ id, title, estimate, project, date, done, position }`. 프로젝트 존재 여부는 검사하지 않는다(호출자 책임).
  - `validateRecordRow(raw)` → `{ id, taskId, seconds, pomodoros, duration, at }`. 기록에는 위치 값이 없다
  - `validateSettings(raw)` → `{ focus, rest }`
- `normalizeState`는 위 함수를 내부에서 호출하도록 정리한다. 동작은 같다.

할 일과 프로젝트의 `position`은 상태 배열의 인덱스다. 동기화에서는 행 필드로 다룬다. 두 기기가 동시에 순서를 바꾸면 늦은 변경이 이기므로 결과가 섞일 수 있다. 1단계에서는 받아들인다.

## 1단계: 계정과 동기화

직접 운영하는 서버 코드는 없다. Supabase 프로젝트 하나에 Auth와 Postgres 테이블 두 개와 SQL 함수 세 개를 둔다. 앱은 `@supabase/supabase-js`로 메인 프로세스에서 호출한다.

### 구성

```
[앱 메인 프로세스]                                     [Supabase 프로젝트]
electron/auth.mjs  ── supabase.auth (OTP) ──────────▶  Auth: 이메일 OTP, 세션(JWT + refresh token)
electron/sync.mjs  ── from('changes') / rpc(...) ───▶  Postgres: public.changes, public.devices (RLS)
storage.mjs (changes, applyRemote)                        ├─ rpc pull_changes(), sync_cursor()
safeStorage (세션 파일)                                    ├─ rpc delete_my_account()
                                                          └─ SMTP(Resend) ← Auth가 인증 코드 메일 발송
```

- 프로젝트 URL과 anon key는 `electron/sync.mjs`에 상수로 고정한다. anon key는 공개 가능한 값이다. 접근 경계는 RLS다.
- 재정의: `TO3MATO_SUPABASE_URL`과 `TO3MATO_SUPABASE_ANON_KEY`. URL은 `updateFeedURL`과 같은 검사(`http://127.0.0.1`만 허용). 로컬 `supabase start`(포트 54321)와 모의 서버용이다.
- 활성 조건: `isDesktop`이고 (`app.isPackaged`이거나 `TO3MATO_SUPABASE_URL`이 있을 때). 개발 실행에서 재정의가 없으면 계정 카드는 보이되 상태는 `off`로 두고 로그인을 받지 않는다. 실수로 개발 데이터를 실제 프로젝트에 올리지 않기 위한 조건이다.
- `service_role` 키는 앱에 넣지 않는다. 어디에도 저장하지 않는다.

### Supabase 프로젝트 설정 (`supabase/` 디렉터리)

```
supabase/
  config.toml                   supabase CLI 설정. 로컬 실행과 Auth 설정값
  migrations/0001_sync.sql      테이블, RLS, 함수, 트리거
  templates/otp.html            인증 코드 메일 템플릿. {{ .Token }} 사용
  tests/sync.test.sql           pgTAP. `supabase test db`로 실행
```

Auth 설정 (대시보드 또는 `config.toml`)

| 항목          | 값                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------- |
| 로그인 방식   | 이메일만. OAuth·전화·익명 비활성                                                              |
| 이메일 OTP    | 길이 6, 유효 10분(`otp_expiry = 600`)                                                         |
| 가입          | OTP 첫 로그인 때 자동 생성(`shouldCreateUser: true`)                                          |
| 이메일 확인   | 불필요. OTP 자체가 확인이다                                                                   |
| SMTP          | Resend. 발신 `noreply@to3mato.doyeong.dev`. 내장 발송은 시간당 몇 통이라 실배포에 쓰지 않는다 |
| 발송 제한     | 이메일당 시간당 3회. Auth 기본 제한 설정으로 둔다                                             |
| JWT 유효 기간 | 1시간(기본). refresh token으로 자동 갱신                                                      |
| 세션 만료     | 로그아웃 전까지 유지. 비활동 만료는 Pro 전용 설정이라 쓰지 않는다                             |
| 리전          | 서울(ap-northeast-2)                                                                          |

### Postgres 스키마 (`migrations/0001_sync.sql`)

```sql
create table public.devices (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  last_sync_at timestamptz,
  primary key (user_id, id)
);

create table public.changes (
  server_seq bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device_id uuid not null,
  entity text not null check (entity in ('project','task','record','settings')),
  id text not null check (char_length(id) between 1 and 120),
  data jsonb check (data is null or pg_column_size(data) <= 4096),
  hlc text not null check (hlc ~ '^[0-9]{15}-[0-9]{4}-[0-9a-f-]{36}$'),
  created_at timestamptz not null default now()
);
create index changes_user_seq_idx on public.changes (user_id, server_seq);

-- 시계가 24시간 이상 앞선 변경은 거부한다
create function public.changes_check_hlc() returns trigger
language plpgsql as $$
begin
  if substr(new.hlc, 1, 15)::bigint > (extract(epoch from clock_timestamp()) * 1000)::bigint + 86400000 then
    raise exception 'hlc too far in the future' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger changes_check_hlc before insert on public.changes
  for each row execute function public.changes_check_hlc();

-- RLS: 자기 행만. changes는 추가만 가능
alter table public.devices enable row level security;
alter table public.changes enable row level security;
revoke all on public.devices, public.changes from anon, authenticated;
grant select, insert, update on public.devices to authenticated;
grant select, insert on public.changes to authenticated;
create policy devices_own on public.devices for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy changes_select on public.changes for select to authenticated
  using (user_id = auth.uid());
create policy changes_insert on public.changes for insert to authenticated
  with check (user_id = auth.uid());

-- pull. 5초 이내에 만들어진 행은 다음 pull로 미룬다. 순번이 낮은 트랜잭션이 늦게 커밋되어 건너뛰는 일을 막는다
create function public.pull_changes(p_since bigint, p_device uuid, p_limit int)
returns setof public.changes
language sql stable security invoker set search_path = '' as $$
  select * from public.changes
  where user_id = auth.uid() and server_seq > p_since and device_id <> p_device
    and created_at <= clock_timestamp() - interval '5 seconds'
  order by server_seq limit least(greatest(p_limit, 1), 500);
$$;

create function public.sync_cursor() returns bigint
language sql stable security invoker set search_path = '' as $$
  select coalesce(max(server_seq), 0) from public.changes
  where user_id = auth.uid() and created_at <= clock_timestamp() - interval '5 seconds';
$$;

-- 탈퇴. auth.users 삭제가 devices·changes로 cascade된다
create function public.delete_my_account() returns void
language sql security definer set search_path = '' as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
```

서버는 변경 로그만 보관하고 현재 상태 테이블을 두지 않는다. 새 기기는 로그를 처음부터 받는다. 로그가 커지면 사용자별 스냅샷 압축을 추가한다. 1단계에서는 하지 않는다.

`changes`에 update·delete 권한이 없으므로 세션이 유출되어도 기록을 지울 수 없다. 삭제는 탈퇴로만 한다.

### 앱이 쓰는 호출

| 동작        | supabase-js 호출                                                             | 비고                                             |
| ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------ |
| 코드 요청   | `auth.signInWithOtp({ email, options: { shouldCreateUser: true } })`         | 이메일 존재 여부와 무관하게 성공                 |
| 로그인      | `auth.verifyOtp({ email, token: code, type: 'email' })`                      | 세션 반환. storage 어댑터가 `safeStorage`로 저장 |
| 기기 등록   | `from('devices').upsert({ id, name })`                                       | 로그인 직후. `name`은 `os.hostname()`            |
| push        | `from('changes').insert(rows)` 500개 이하                                    | 한 요청이 한 트랜잭션. 반쯤 들어가지 않는다      |
| pull        | `rpc('pull_changes', { p_since: cursor, p_device: deviceId, p_limit: 500 })` | 500개면 `more`                                   |
| 서버 cursor | `rpc('sync_cursor')`                                                         | 로그인 직후와 복구 감지용                        |
| 로그아웃    | `auth.signOut({ scope: 'local' })`                                           | 서버 호출 실패와 무관하게 로컬 세션 파일 삭제    |
| 탈퇴        | `rpc('delete_my_account')` → `auth.signOut({ scope: 'local' })`              |                                                  |

클라이언트 생성 옵션: `auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: safeStorageAdapter }`, `global: { fetch: net.fetch }`. Node 환경에서는 자동 갱신이 저절로 시작되지 않으므로 메인이 `auth.startAutoRefresh()`를 호출하고 종료 때 `stopAutoRefresh()`한다.

오류 매핑 (supabase-js `error.code`)

| code                                                    | 앱 처리                                               |
| ------------------------------------------------------- | ----------------------------------------------------- |
| `validation_failed`, `email_address_invalid`            | 이메일 확인 문구                                      |
| `otp_expired`                                           | 코드 오류 문구. 잘못된 코드와 만료를 구분하지 않는다  |
| `over_email_send_rate_limit`, `over_request_rate_limit` | 요청 과다 문구. 60초 재요청 제한과 별개               |
| `refresh_token_not_found`, `session_not_found`, 401     | 세션 파일 삭제 → `signed-out`                         |
| PostgREST `23514`(CHECK 위반), `42501`(RLS 거부)        | 묶음을 `markPushed`하지 않는다. `error`. 앱 버전 문제 |
| 그 외 네트워크·5xx                                      | `error`. 다음 주기 재시도                             |

### 앱 측 모듈

#### `electron/auth.mjs`

```js
export function createAuth({ client, safeStorage, file, hostname, log })
// 반환: { session(), requestCode(email), verify(email, code), logout(), deleteAccount(), storageAdapter }
```

- `storageAdapter`: supabase-js `storage` 인터페이스(`getItem`·`setItem`·`removeItem`). 값을 `safeStorage.encryptString`으로 `userData/session.bin`에 쓴다. 권한 `0600`. 복호화 실패는 세션 없음으로 처리하고 파일을 지운다.
- `session()`: `{ email }` 또는 `null`. 토큰은 반환하지 않는다.
- `safeStorage.isEncryptionAvailable()`이 false면 `requestCode`·`verify`를 거부한다. 토큰을 평문으로 저장하지 않는다.
- `logout()`·`deleteAccount()`는 서버 호출 결과와 무관하게 로컬 세션 파일을 지운다. 서버 오류는 로그만 남긴다.
- `client`는 메인이 만들어 주입한다. 단위 테스트는 가짜 객체를 넣는다.

#### `electron/sync.mjs`

```js
export function createSync({ store, auth, client, enabled, onStatus, onApplied, log, timers })
// 반환: { notify(), syncNow(), status(), login(email, code), logout(), destroy() }
```

- 상태 모델

| status       | 의미                                                   |
| ------------ | ------------------------------------------------------ |
| `off`        | 비활성 (브라우저, 개발 실행 재정의 없음, 암호화 불가)  |
| `signed-out` | 로그인 전                                              |
| `idle`       | 로그인 상태. `lastSyncAt` 포함                         |
| `syncing`    | push 또는 pull 진행 중                                 |
| `error`      | 마지막 동기화 실패. `message` 포함. 다음 주기에 재시도 |

- `login(email, code)`: `auth.verify` → 기기 upsert → `store.resetSync()` → `sync_cursor()` 확인 → `syncNow()`.
  - 서버 cursor가 0(빈 계정)이면 push만으로 끝난다.
  - 0이 아니면 pull 전체 → push 순서. 어느 쪽이든 결과는 ID 기준 합집합이다.
- `notify()`: 메인의 `commit` 뒤에 호출한다. 1초 debounce로 push.
- 주기: 실행 10초 후 pull. 이후 5분마다 pull. 창이 포커스를 받을 때 pull. push는 변경 직후.
- push: `pendingChanges(500)` → insert → 성공 시 `markPushed`. 남은 게 있으면 반복. 성공 후 `devices.last_sync_at` 갱신.
- pull: `pull_changes` → `applyRemote(changes, { cursor: 마지막 server_seq })` → `onApplied(result.state)`. 500개면 반복. 검증과 cursor 저장은 `applyRemote`가 한 트랜잭션에서 한다. 검증에 실패한 행은 건너뛰고 수만 로그에 남긴다. cursor는 그대로 전진한다.
- push와 pull은 직렬로 실행한다. 진행 중이면 요청을 한 번만 예약한다.
- 복구 감지: pull 시작 때 `sync_cursor()`가 로컬 cursor보다 작으면 서버가 복원된 것이다. cursor를 0으로 되돌리고 전체를 다시 받는다.
- 세션 오류와 로그아웃: 세션 파일 삭제 → `store.disableSync()` → `signed-out`. 다시 로그인하면 `resetSync()`가 전체를 다시 올린다.
- 타이머가 실행 중이어도 동기화한다. 타이머 행은 대상이 아니다.
- `destroy()`: 타이머 해제와 `stopAutoRefresh()`. 진행 중인 요청은 완료까지 기다리지 않는다. 종료 시 push되지 않은 로그는 다음 실행 때 올라간다.

#### 메인 프로세스 연결 (`electron/main.mjs`)

- `createClient(url, anonKey, options)`를 메인에서 한 번 만든다. `@supabase/supabase-js`는 `dependencies`에 추가한다. 렌더러 번들에는 들어가지 않는다.
- `commit()` 끝에 `sync?.notify()`.
- `onApplied(next)`: `state = next; broadcast(); timerTray?.update();`
- 종료 처리에 `sync?.destroy()`.
- 생성 실패는 업데이트 모듈과 같이 `try/catch`로 감싸 앱 시작을 막지 않는다.

#### IPC와 preload

| 채널                   | 방향            | 내용                                                    |
| ---------------------- | --------------- | ------------------------------------------------------- |
| `account:status`       | main → renderer | `{ session, sync }` 상태 객체. 구독 시 현재 값도 보낸다 |
| `account:status`       | renderer → main | 현재 값 조회. `trusted(event)`                          |
| `account:request-code` | renderer → main | `email`. `trusted(event)`. 결과 `{ ok }` 또는 오류 코드 |
| `account:verify`       | renderer → main | `email, code`. 성공 시 상태 변경                        |
| `account:logout`       | renderer → main |                                                         |
| `account:delete`       | renderer → main | 메인이 `dialog.showMessageBox`로 확인한 뒤 실행         |
| `sync:now`             | renderer → main | 즉시 동기화. 응답은 현재 상태                           |

preload에 `account: { status, requestCode, verify, logout, remove, subscribe }`와 `sync: { now }`를 추가한다. 렌더러는 이메일과 코드만 보낸다. URL과 토큰은 다루지 않는다.

이메일은 메인에서 형식 검사(`^[^\s@]+@[^\s@]+\.[^\s@]+$`, 254자 이하)를 한 번 더 한다. 오류 코드는 위 매핑 표의 앱 처리 단위(`invalid_email`, `invalid_code`, `too_many_requests`, `encryption_unavailable`, `network`)로 줄여 렌더러에 보낸다.

#### 설정 화면

"업데이트" 카드 아래 "계정" 카드. `isDesktop`일 때만 표시. 기존 카드와 같은 구조(`h2` + `p` + 입력 + 버튼 행).

| 상태         | 표시                                                                                 |
| ------------ | ------------------------------------------------------------------------------------ |
| `off`        | 설명 한 줄만. 입력 없음                                                              |
| `signed-out` | 이메일 입력 + 버튼. 코드를 요청한 뒤에는 코드 입력 + 버튼. 오류는 `role="status"` 줄 |
| `idle`       | 이메일, 마지막 동기화 시각 줄, 버튼 행: 지금 동기화 / 로그아웃 / 계정 삭제           |
| `syncing`    | 같음. 상태 줄만 바뀐다. 지금 동기화 버튼 비활성                                      |
| `error`      | 같음. 상태 줄에 오류 문구                                                            |

코드 입력란은 `inputmode="numeric"` `maxlength="6"`. 요청 후 60초 동안 재요청 버튼을 비활성화한다.

문구는 아래 "승인 필요 문구"에 모았다. 승인 전에는 넣지 않는다.

### 보안

- 세션은 `safeStorage`로만 저장한다. 렌더러·로그·오류 메시지에 노출하지 않는다.
- 프로젝트 URL과 anon key는 메인 코드에 고정한다. 재정의는 `127.0.0.1`만. `service_role` 키는 앱과 저장소 어디에도 없다.
- 렌더러 CSP는 바꾸지 않는다. 네트워크는 메인 프로세스 `net.fetch`.
- 접근 경계는 RLS다. 모든 정책이 `auth.uid()`로 제한된다. 요청 본문의 `user_id`는 기본값으로 덮인다.
- `changes`는 추가만 된다. 행 크기와 형식은 CHECK 제약으로 막는다. 필드 내용 검증(제목 120자 등)은 받는 쪽 앱이 `validate*Row`로 한다. 자기 계정 데이터만 망칠 수 있다.
- 탈퇴는 즉시 하드 삭제. 복구 기간을 두지 않는다. 로컬 데이터는 남는다.
- 세션 파일 권한 `0600`. DB 파일과 같다.
- Auth 로그와 Postgres 로그는 Supabase가 보관한다. 앱 쪽 로그에는 이메일·토큰·변경 본문을 남기지 않는다.

### 실패 처리

| 상황                          | 동작                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 오프라인                      | `error` 상태. 로컬 로그 유지. 5분 뒤 재시도                                                                                                       |
| push 중 앱 종료               | insert 한 요청이 한 트랜잭션이므로 반쯤 들어가지 않는다. 다음 실행 때 남은 로그부터 재전송                                                        |
| 같은 변경이 두 번 push됨      | 서버는 그대로 받는다. 다른 기기는 HLC 비교로 두 번째를 무시한다                                                                                   |
| pull 적용 중 오류             | 트랜잭션 롤백. cursor 유지. 다음 주기 재시도. 같은 묶음이 계속 실패하면 `error`에 남는다                                                          |
| CHECK·RLS 거부(23514, 42501)  | 해당 묶음을 `markPushed`하지 않는다. 로그에 남기고 `error`. 앱 버전 문제이므로 수동 확인                                                          |
| 세션 만료·폐기                | `signed-out`. 다시 로그인하면 전체 재전송                                                                                                         |
| 다른 계정으로 로그인          | `resetSync()`가 전체 스냅샷을 새 계정에 올린다. 이전 계정 데이터는 서버에 남는다                                                                  |
| 프로젝트 일시 정지(무료 플랜) | 7일 동안 요청이 없으면 정지된다. 앱은 `error`로 두고 로컬로 계속 동작한다. 대시보드에서 재개하면 로그가 따라잡는다                                |
| 서버 복원                     | `sync_cursor()`가 로컬 cursor보다 작으면 cursor를 0으로 되돌리고 전체를 다시 받는다. 무료 플랜에는 백업이 없으므로 복원 자체는 Pro에서만 가능하다 |

## 테스트 계획

| 단계          | 내용                                                                                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 단위 (도메인) | `tests/domain.test.mjs`: 기록 ID 생성, `legacy-` ID 결정성, 중복 거부, `validate*Row` 경계값                                                                                                                                                                                                     |
| 단위 (저장)   | `tests/storage.test.mjs`: v1 → v2 마이그레이션(ID·순서·기록 보존, 백업 생성), 변경 로그 기록, tombstone, `applyRemote` 규칙별 동작, 타이머 중인 작업의 원격 삭제, JSON 가져오기의 로그화, HLC 단조성                                                                                             |
| 단위 (동기화) | `tests/sync.test.mjs`: 가짜 `client`로 push·pull 순서, 재시도, 세션 오류 처리, 로그인 시 `resetSync`, cursor 되돌림, 검증 실패 행 건너뛰기                                                                                                                                                       |
| 단위 (인증)   | `tests/auth.test.mjs`: 가짜 `safeStorage`·`client`로 저장·삭제, 복호화 실패, 암호화 불가 시 거부, URL 재정의 검사                                                                                                                                                                                |
| DB            | `supabase/tests/sync.test.sql`(pgTAP): 두 사용자 간 RLS 격리, `changes` update·delete 거부, HLC 트리거, `pull_changes`의 기기 제외와 5초 지연, `delete_my_account` cascade. `supabase test db`로 실행. Docker 필요                                                                               |
| 통합 (앱)     | `tests/sync-desktop.spec.ts`: Node `http`로 GoTrue·PostgREST의 사용 경로만 흉내 낸 모의 서버(`tests/helpers/mock-supabase.mjs`)를 `TO3MATO_SUPABASE_URL`로 지정. Electron 두 인스턴스(별도 `TO3MATO_USER_DATA`)에서 A가 만든 할 일이 B에 나타나는지, B의 완료가 A에 반영되는지, 오프라인 후 복구 |
| 통합 (실제)   | `supabase start`(로컬 Docker)에 앱을 붙여 1회 수동 실행. 인증 코드는 로컬 Mailpit(포트 54324)에서 읽는다. 배포 전                                                                                                                                                                                |
| 이전          | `tests/migration.spec.ts`에 v1 SQLite → v2 시나리오 추가                                                                                                                                                                                                                                         |

모의 서버가 흉내 내는 경로: `POST /auth/v1/otp`, `POST /auth/v1/verify`, `POST /auth/v1/token?grant_type=refresh_token`, `POST /auth/v1/logout`, `POST·GET /rest/v1/devices`, `POST /rest/v1/changes`, `POST /rest/v1/rpc/pull_changes`·`sync_cursor`·`delete_my_account`. 인증 코드는 모의 서버가 고정값을 돌려준다.

## 구현 단계

1. 도메인: 기록 ID, 검증 함수 export. 테스트.
2. 저장: 스키마 v2 마이그레이션, 변경 로그, tombstone, `applyRemote`, 가져오기 로그화. 테스트.
3. **0.4.0 배포** (서버 없음). 사용자 데이터가 v2로 이전된다.
4. Supabase: 프로젝트 생성(사용자), `supabase/` 디렉터리, 마이그레이션 SQL, Auth 설정, 메일 템플릿, pgTAP 테스트. `supabase start`로 확인.
5. 앱: `auth.mjs`, `sync.mjs`, IPC, preload, 메인 연결, `@supabase/supabase-js` 추가. 단위 테스트.
6. 설정 화면 계정 카드. 문구 승인 후 적용.
7. 모의 서버 통합 테스트. 이어서 `supabase start` 수동 통합.
8. 사이트에 개인정보 처리방침·이용약관 페이지(사용자 작성 문구).
9. Resend SMTP 연결과 발신 도메인 DNS(사용자). `supabase db push`로 마이그레이션 적용 → **0.5.0 배포**.

1~2는 순차. 4는 1 이후 독립 진행 가능. 5는 2와 4 이후. 6은 5 이후. 8은 언제든. 9는 전부 끝난 뒤.

## 승인 필요 문구

2026-10-20 사용자가 아래 문구를 승인했다. 구현 시 글자 그대로 넣는다. 날짜·시각과 코드 숫자만 실제 값으로 표시한다.

설정 화면 계정 카드

- 제목: `계정`
- 설명 (`signed-out`·`idle`): `로그인하면 할 일과 집중 기록을 같은 계정의 다른 Mac과 동기화합니다.`
- 설명 (`off`, 개발 실행): `이 실행 환경에서는 계정 기능을 사용할 수 없습니다.`
- 이메일 입력 레이블: `이메일`
- 코드 입력 레이블: `인증 코드`
- 버튼: `인증 코드 받기` / `로그인` / `지금 동기화` / `로그아웃` / `계정 삭제`
- 코드 발송 후 안내: `인증 코드를 보냈습니다. 10분 안에 입력하세요.`
- 상태 줄
  - idle: `마지막 동기화 10월 20일 14:02`
  - syncing: `동기화 중입니다.`
  - error (네트워크): `동기화하지 못했습니다. 네트워크 연결을 확인하세요.`
  - error (서버 거부): `동기화하지 못했습니다. 앱을 최신 버전으로 업데이트하세요.`
- 오류 줄
  - `invalid_email`: `이메일 주소를 확인하세요.`
  - `invalid_code` (Supabase는 잘못된 코드와 만료를 구분하지 않는다): `인증 코드가 올바르지 않거나 만료되었습니다. 다시 요청하세요.`
  - `too_many_requests`: `요청이 너무 많습니다. 잠시 후 다시 시도하세요.`
  - 암호화 불가: `이 컴퓨터에서는 로그인 정보를 안전하게 저장할 수 없습니다.`

계정 삭제 확인 대화상자 (메인 프로세스)

- 버튼: `취소` / `삭제`
- message: `서버에 저장된 계정과 동기화 데이터를 삭제합니다.`
- detail: `이 컴퓨터의 데이터는 남습니다.`

JSON 가져오기 확인 대화상자 (기존 `detail`에 한 줄 추가, 로그인 상태일 때만)

- `로그인 상태이므로 가져온 데이터가 같은 계정의 다른 Mac에도 적용됩니다.`

인증 코드 메일 (Supabase Auth 템플릿. 코드는 `{{ .Token }}`)

- 제목: `To3mato 인증 코드 123456`
- 본문: `인증 코드: 123456` / `10분 안에 입력하세요. 요청하지 않았다면 이 메일을 무시하세요.`

## 구현 기록

2026-10-20

- Supabase CLI: Homebrew 설치가 오래된 Command Line Tools 때문에 중단됐다. 같은 버전(2.121.0)의 npm 배포판을 `npx supabase@2.121.0`으로 실행해 `supabase init`을 했다. Homebrew 설치는 Command Line Tools 업데이트 뒤 다시 한다(관리자 암호 필요).
- `supabase/config.toml`: `project_id = "to3mato"`. 승인 문구의 10분에 맞춰 `auth.email.otp_expiry = 600`으로 바꿨다. 나머지는 `init` 기본값이다. `.gitignore`에 `supabase/.temp/`·`supabase/.branches/`를 추가했다.
- 구현 단계 1(도메인) 완료.
  - `settleTimer`가 `crypto.randomUUID()`로 기록 ID를 만든다. `FocusRecord` 타입에 `id`를 추가했다.
  - `legacyRecordId`·`validateProjectRow`·`validateTaskRow`·`validateRecordRow`·`validateSettings`를 export했다. `normalizeState`는 이 함수들로 검증한다. 오류 문구는 기존 문구를 그대로 쓰고 기록 ID 중복에만 `집중 기록 ID가 중복됩니다.`를 추가했다.
  - `validateTaskRow`는 프로젝트 존재 여부를 검사하지 않는다. `normalizeState`가 따로 검사한다.
  - 테스트: `tests/domain.test.mjs`에 5개 추가. `tests/storage.test.mjs`와 `tests/migration.spec.ts`는 불러온 기존 기록에 해시 ID가 붙는 것을 기대하도록 바꿨다. 단위 52개, Playwright 9개(browser·desktop·migration·tray·notifications·usability·batch) 통과. `svelte-check` 오류 없음.
- 단계 2 전까지의 제약: v1 SQLite에는 기록 ID 열이 없다. 새 기록의 UUID는 앱을 다시 시작하면 해시 ID로 바뀐다. 단계 2에서 `focus_records_v2`가 ID를 저장하면 해소된다. 단계 1과 2는 함께 0.4.0으로 배포하므로 사용자에게는 드러나지 않는다.

- 구현 단계 2(저장) 완료.
  - `electron/storage.mjs`를 스키마 v2로 바꿨다. v1 마이그레이션, HLC, tombstone, 변경 로그, `applyRemote`, `resetSync`·`disableSync`, tombstone 정리를 구현했다. 테스트용으로 생성자에 `now`를 주입할 수 있다.
  - 설계에서 바꾼 점. 이유는 위 각 절에 적었다.
    - 기록은 위치 값 없이 `at, id` 순으로 정렬한다. `validateRecordRow`에서 `position`을 뺐다.
    - `tasks.project_id` 외래 키를 없앴다. 원격 할 일의 프로젝트를 `NULL`로 바꾸지 않고 그대로 둔다.
    - 원격 적용은 기록을 포함해 모든 entity에 늦은 변경 우선 규칙을 쓴다. 로컬에 없는 행의 원격 삭제도 tombstone으로 남긴다.
    - 원격 적용 뒤 할 일과 프로젝트의 위치를 다시 매긴다.
    - 변경 로그는 동기화를 켠 동안만 쓴다(`sync_state.logging`). 보낸 로그는 `pushed` 표시 대신 지운다.
    - HLC는 `sync_state`에 저장하지 않고 저장된 행의 최댓값에서 이어간다.
    - 마이그레이션은 `ALTER TABLE` 대신 v2 테이블을 새로 만든다.
    - 원격 적용 결과가 `normalizeState`를 통과하지 못하면 묶음 전체를 되돌린다.
  - 단계 1의 제약(새 기록 ID가 재시작 후 바뀜)은 해소됐다.
  - 테스트: `tests/storage-sync.test.mjs` 13개 추가. 단위 65개 통과. `svelte-check` 오류 없음. Playwright는 browser·desktop·migration·focus-log·notifications·usability·batch 통과.
  - Playwright `tray.spec.ts`와 `updater-desktop.spec.ts` 하나씩이 실패한다. 같은 시각에 다른 작업이 트레이(`tray.mjs`·`tray-image.mjs`·`main.mjs`·`preload.cjs`)와 설정 화면을 바꾸고 있다. 실패 지점은 옛 `timerTray.menu`와 업데이트 카드 상태 줄이다. 이번 변경과 관계없는 파일이다.

## 결정 사항 (2026-10-20 확정)

1. 위 문구 초안을 승인했다.
2. 0.4.0(스키마 v2만)과 0.5.0(서버 연동)으로 나누어 배포한다.
3. Supabase 무료 플랜으로 시작한다. 실사용자가 생기면 Pro로 올린다. 프로젝트 생성·Resend SMTP 연결·발신 도메인 DNS는 사용자가 한다.
4. 세션은 로그아웃 전까지 유지한다.
5. 메인 프로세스에 `@supabase/supabase-js` 의존성을 추가한다.
