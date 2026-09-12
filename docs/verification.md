# 실행 검증 기록

검증일: 2026-09-11. 아래 결과는 실제 실행에서 가져왔습니다.

## Docker Compose 검증 완료 — 최신 결과

사용자가 `Run-Docker-Lab.cmd`를 실행했고, 2026-09-11 23:12:52 KST에 SUCCESS로 종료했습니다. 저장된 로그와 원본 결과를 다시 검산했습니다.

- Docker Desktop 4.90.0, Engine 29.7.2, Compose v5.5.1, Linux/amd64·WSL2.
- PostgreSQL 18.4 Debian, Node.js v22.23.2. shared_buffers 128MB, work_mem 4MB, jit off.
- API·runner 이미지 빌드, PostgreSQL 이미지 다운로드, DB 볼륨과 결과 bind mount, healthcheck 기반 DB·API 기동 성공.
- 컨테이너 단위 테스트 6개·DB 통합 테스트 6개 통과, 실패 0개.
- 합성 주문 300,000건, 구현별 조회 480회, 재고 정합성 시험 구현별 3회 완료.
- 호스트에서 API `/health` 200·ready, 고객 주문 조회 200·50건, 고객 파라미터 누락 400, 없는 경로 404를 실제 확인.
- 원본 조회 960개로 집계 재계산, 구간별 파라미터 동등성, 제공 소스와 측정 소스 SHA-256 일치 검사 통과.

| Docker 실측 항목 | 개선 전 | 개선 후 |
|---|---:|---:|
| 재고 10개에 동시 요청 32개: 승인, 회차당 | 32 | 10 |
| 초과 판매, 회차당 | 22 | 0 |
| 조회 평균 ms | 23.665 | 0.591 |
| 조회 p50 ms | 17.513 | 0.552 |
| 조회 p95 ms | 49.075 | 0.838 |

이 실행에서 p95 비율은 약 58.55배입니다. 단일 클라이언트의 지정 고객 혼합에서 측정한 지연 시간이며, 전체 서비스 TPS 개선이나 일반적인 성능 보장을 의미하지 않습니다. 아래 Windows 결과와는 OS·Node 런타임 등이 달라 직접적인 플랫폼 우열 비교로 사용할 수 없습니다.

PostgreSQL 이미지 digest: `postgres@sha256:882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382`.

근거: [Docker 실행 로그](../results/docker-verification.log), [최신 보고서](../results/2026-09-11T14-12-27-197Z-c68bbddc/report.md), [전체 원본](../results/2026-09-11T14-12-27-197Z-c68bbddc/results.json), [재검산 기록](../results/2026-09-11T14-12-27-197Z-c68bbddc/artifact-audit.json), [Docker API 확인](../results/docker-http-read-check.json).

## 앞선 Windows 네이티브 검증

| 항목 | 결과 | 증거 |
|---|---|---|
| JS 모듈 문법 검사 | src/test 전체 통과 | Node `--check` |
| 단위 테스트 | 6개 통과 | [실행 로그](validation-output.txt) |
| 실제 PostgreSQL 통합 테스트 | 6개 통과 | [실행 로그](validation-output.txt) |
| HTTP 동작 | 13개 상태 코드 검사 + 결과 순서·재고 합계 검증 통과 | [HTTP 원본](../results/http-smoke.json) |
| 기본 벤치마크 | 재고 6회, 조회 8구간 완료 | [전체 원본](../results/2026-09-11T10-33-30-674Z-ab1a409b/results.json) |
| 전후 조회 결과 동등성 | 960개 측정 요청의 고객별 결과 해시 검사 통과 | [원본 CSV](../results/2026-09-11T10-33-30-674Z-ab1a409b/query-samples.csv) |
| Compose·GitHub Actions YAML | 파싱 및 환경변수 anchor 확인 통과 | YAML 정적 검사, 실행 검증과 구분 |
| npm 의존성 | pg 8.16.3 설치 및 package-lock 생성 완료 | package-lock.json |

## 앞선 Windows 측정 환경

- Windows 10.0.26200 x64, Node.js v24.14.0.
- PostgreSQL 18.4, MSVC 빌드. 작업 폴더의 임시 클러스터를 loopback에서 실행하고 검증 후 종료했습니다.
- 검증용 바이너리는 npm `@embedded-postgres/windows-x64@18.4.0-beta.17`로 확보했습니다. 프로젝트 실행 의존성에는 포함하지 않았습니다.
- Intel Core i7-1165G7, 표시된 논리 실행 가능 수 8, OS에 표시된 메모리 25,427,009,536 bytes.
- shared_buffers 128MB, work_mem 4MB, max_connections 80, jit off, max_parallel_workers_per_gather 2, READ COMMITTED, UTC.
- PostgreSQL 서버에서 합성 주문 300,000건을 생성했습니다.

Docker 이미지 설정은 PostgreSQL 18.4와 Node 22입니다. 실제 네이티브 실측은 Node 24이므로 컨테이너와 런타임·OS가 동일하다고 주장하지 않습니다.

## 앞선 Windows 실행 결과

| 항목 | 개선 전 | 개선 후 |
|---|---:|---:|
| 재고 시험 승인 주문, 회차당 | 32 | 10 |
| 재고 시험 품절 거절, 회차당 | 0 | 22 |
| 초과 판매 수량, 회차당 | 22 | 0 |
| 정합성 시험의 예상 밖 오류, 회차당 | 0 | 0 |
| 조회 표본 수 | 480 | 480 |
| 조회 평균 ms | 121.379 | 0.645 |
| 조회 p50 ms | 94.223 | 0.559 |
| 조회 p95 ms | 221.292 | 1.326 |

재고 시험은 구현별 3회 모두 동일한 판정을 보였습니다. 지연 시간은 지정한 네 고객을 같은 비율로 조회한 단일 연결 측정입니다.

첫 baseline 구간의 고객 1 실행 계획은 `Limit → Gather Merge → Sort → Parallel Seq Scan`이었고, 첫 indexed 구간은 `Limit → Index Only Scan`이었습니다. 첫 indexed 구간의 고객 1에는 Heap Fetches 12가 남았으므로 “힙 접근이 완전히 사라졌다”는 해석은 틀립니다. 후보 인덱스는 18,046,976 bytes였습니다.

큰 전후 차이에는 탐색 범위·정렬 제거뿐 아니라 Windows에서의 병렬 작업자 실행 비용도 포함될 수 있습니다. 실제 계획에 병렬 작업자가 있으나 그 비용을 별도로 분리 측정하지 않았습니다. 이 실행의 비율을 Linux 컨테이너나 운영 환경의 보장 수치로 표현하지 마세요. 자세한 제한은 [실험 방법](methodology.md)을 참고하세요.

## 아직 실행하지 못한 항목

GitHub Actions 워크플로는 작성만 했으며 원격 실행하지 않았습니다. Docker의 빌드·이미지 다운로드·healthcheck 기동·볼륨 마운트는 위 최신 실행에서 검증했습니다. 13개 HTTP 검사 전체는 Windows 네이티브에서 수행했으며, Docker에서는 4개 읽기 경로 검사와 컨테이너 내부 DB 통합 테스트를 수행했습니다.

## 네이티브 DB에서 같은 코드 실행

이미 PostgreSQL을 설치한 환경에서는 `portfolio`라는 전용 DB를 만든 후 접속 정보를 환경 변수로 지정하고 아래 명령을 실행할 수 있습니다. 실험용 스키마는 초기화됩니다.

```powershell
$env:PGHOST = '127.0.0.1'
$env:PGPORT = '5432'
$env:PGDATABASE = 'portfolio'
$env:PGUSER = 'portfolio'
$env:PGPASSWORD = '본인의 실험용 비밀번호'
$env:EXECUTION_ENVIRONMENT = 'windows-native'
npm ci
npm test
npm run test:integration
npm run seed
npm run bench
```

제공한 실행 증거를 Git 저장소에 넣으려면 `.gitignore`의 결과 제외 규칙을 고려해 선택한 실행 폴더만 명시적으로 추가하세요. 예: `git add -f results/2026-09-11T10-33-30-674Z-ab1a409b results/http-smoke.json`.
