# 실측 상태

2026-09-11 Docker Compose와 Windows 네이티브 PostgreSQL 18.4에서 각각 실제 실행을 완료했습니다.

## 최신 Docker 결과

- [Docker 실측 보고서](2026-09-11T14-12-27-197Z-c68bbddc/report.md)
- [Docker 원본 측정·실행 계획](2026-09-11T14-12-27-197Z-c68bbddc/results.json)
- [Docker 조회 CSV](2026-09-11T14-12-27-197Z-c68bbddc/query-samples.csv)
- [빌드·테스트·기동 로그](docker-verification.log)
- [원본 재검산](2026-09-11T14-12-27-197Z-c68bbddc/artifact-audit.json)
- [API 읽기 경로 확인](docker-http-read-check.json)

## 앞선 Windows 결과

- [실측 보고서](2026-09-11T10-33-30-674Z-ab1a409b/report.md)
- [원본 측정·실행 계획](2026-09-11T10-33-30-674Z-ab1a409b/results.json)
- [원본 조회 CSV](2026-09-11T10-33-30-674Z-ab1a409b/query-samples.csv)
- [HTTP 검사 결과](http-smoke.json)
- [검증 범위와 한계](../docs/verification.md)

두 환경의 수치를 합산하지 않습니다. `docker compose run --rm runner`를 다시 실행하면 별도 디렉터리에 새 결과를 생성합니다.
