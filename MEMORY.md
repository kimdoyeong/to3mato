# To3mato 의사결정 기록

에이전트는 작업을 시작하기 전에 이 파일을 읽는다. 새 결정은 날짜와 함께 아래에 추가한다.

## 도메인

2026-11-05 결정, 2026-11-08 전환 완료. 상세는 `docs/domain-migration.md`.

- 제품 도메인은 `to3mato.com`이다. `www`는 쓰지 않는다.
- 사이트는 Pages 프로젝트 `to3mato`의 `to3mato.com`이다. 릴리스 CI의 공개 검증 주소는 `scripts/release-files.mjs`의 `SITE_URL`이다.
- `to3mato.doyeong.dev`는 경로와 쿼리를 유지한 채 `to3mato.com`으로 301한다. 프록시 DNS 레코드 + Redirect Rule로 처리한다.
- `downloads.to3mato.doyeong.dev`는 바꾸지 않는다. 설치된 앱의 업데이트 피드 주소다.
- 로그인 메일 발신은 `To3mato <noreply@to3mato.com>`, Resend(`ap-northeast-1`) 경유. 발신 도메인은 루트 `to3mato.com`이다.
- 마이크로블로그 공유 페이지는 제품 사이트와 다른 하위 도메인에 둔다. 이름은 미정.

## 마이크로블로그

2026-11-05 구상 단계.

- 링크 공유 방식이다. 링크를 받은 사람은 웹 페이지에서 읽기만 한다. 댓글, 좋아요, 팔로우, 보는 사람의 계정은 없다.
