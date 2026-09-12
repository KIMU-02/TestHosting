# TestHosting · PostgreSQL 주문·재고 실험실

## 자동 검증과 면접 시연

`Test-Portfolio.cmd`로 별도 테스트 DB에서 기능·정합성·복원을 검사합니다. **2026-09-12 Docker 전체 검증 통과:** 테스트 22개, HTTP 검사, 1만 건 DB의 실제 덤프·복원·복원 후 쓰기 검사, 임시 환경 정리 완료. [실행 보고서](results/ci/20260912T095459656Z_cf6d36a1/report.json), [CI 설계·검증 범위](docs/ci.md)를 참고하세요. GitHub Actions 원격 실행은 아직 확인하지 않았습니다.

## 백업·복구 연습

`Backup-Restore.cmd`는 원본 DB를 백업하고 별도 임시 DB에 복원·검증한 뒤 임시 DB만 제거합니다. **2026-09-12 운영 DB 백업·복원 성공:** 주문 300,002건(과거 300,000건·취소 checkout 2건), 요청 키 1건 복원, 제약조건·쓰기 검사 및 정리 완료. [실행 보고서](results/recovery/20260912T100701681Z_0344939e/report.json), [설계·실행법·검증 범위](docs/recovery.md)를 참고하세요. 백업 파일은 로컬에 보관하며 GitHub 제출본에는 포함하지 않습니다.

## 주문·재고 관리 화면

이제 `http://localhost:8080/`에서 재고와 주문 현황을 보고, 고객 번호·수량을 입력해 주문할 수 있습니다. 최근 주문 조회와 저장된 Docker 성능 측정 결과도 같은 화면에 표시합니다. 금액은 USD, 날짜는 한국 시간으로 표시합니다.

이미 기존 버전을 실행하고 있다면 **`Update-Dashboard.cmd`를 실행한 뒤 브라우저를 새로고침**하세요. 이 파일은 화면과 API를 재빌드하고 읽기 검사를 수행하며, 기존 주문과 재고를 초기화하지 않습니다. 전체 실험을 다시 수행하는 `Run-Docker-Lab.cmd`와 구분하세요.

[화면 설계·검증 기록](docs/dashboard.md)

동시 주문의 **재고 초과 판매를 재현·해결**하고, **동일 주문 조회의 인덱스 전후 성능**을 측정하는 개인 포트폴리오입니다. Node.js는 HTTP·실험 도구 역할이며 핵심은 PostgreSQL의 트랜잭션, 실행 계획, 측정 설계입니다.

**2026-09-11 Docker Compose 실측 완료:** 30만 건·구현별 480회 조회에서 p95 **49.075ms → 0.838ms**, 재고 정합성 시험 3회 모두 개선 후 초과 판매 **0건**. 단위 테스트 6개·DB 통합 테스트 6개도 컨테이너에서 통과했습니다. [실측 보고서](results/2026-09-11T14-12-27-197Z-c68bbddc/report.md)와 [검증 범위](docs/verification.md)를 확인하세요. 수치는 해당 로컬 환경·부하 조건에 한정됩니다.

## 빠른 실행

Docker Desktop의 Linux 컨테이너와 Docker Compose v2가 필요합니다. 아래 명령은 이 README가 있는 폴더에서 실행합니다. DB는 호스트 포트를 공개하지 않고 API는 `127.0.0.1:8080`으로만 공개합니다.

Windows에서는 `Run-Docker-Lab.cmd`를 실행하면 아래 과정을 순서대로 수행하고 `results/docker-verification.log`에 로그를 저장합니다. 설치된 Docker Desktop이 먼저 실행되어 있어야 합니다. 스크립트는 실험 데이터를 초기화하며 완료 후 API와 DB를 실행 상태로 둡니다.

```powershell
docker compose build
docker compose up -d db
docker compose run --rm runner npm test
docker compose run --rm runner npm run test:integration
docker compose run --rm runner npm run seed
docker compose run --rm runner npm run bench
docker compose up -d api
```

**데이터 초기화 범위:** `seed`와 통합 테스트는 전용 `portfolio` DB의 `lab` 스키마를 재생성합니다. 벤치마크는 `checkout` 주문을 삭제하고 실험용 상품 재고를 10으로 초기화합니다. 보존할 주문은 이 실험 DB에 넣지 마세요. 역사 주문(`history`)은 조회 실험용 합성 자료이며 현재 재고와 별도입니다.

벤치마크 완료 후 조회 인덱스를 설치한 상태로 돌려놓습니다. 실행 결과는 `results/<실행 시각>-<ID>/`에 저장됩니다.

| 파일 | 내용 |
|---|---|
| `report.md` | 실제 실행값으로 생성한 요약 |
| `results.json` | 환경, 설정, 모든 주문 판정, 원본 조회 시간, 실행 계획, 고객별 통계 |
| `query-samples.csv` | 조회별 시간과 파라미터·결과 해시 |

실패한 실행은 `results.json`의 `status: failed`와 오류를 남기고 성공 보고서를 생성하지 않습니다. 현재 검증 범위는 [검증 기록](docs/verification.md)에 있습니다.

## API 사용

```powershell
Invoke-RestMethod http://localhost:8080/health
Invoke-RestMethod 'http://localhost:8080/orders?customer_id=1'
Invoke-RestMethod -Method Post -Uri http://localhost:8080/orders -ContentType 'application/json' -Body '{"customer_id":1,"product_id":1,"quantity":2}'
```

- `POST /orders`: 안전한 조건부 차감만 실행. 성공 201, 품절·없는 상품 409, 잘못된 입력 400.
- `GET /orders`: 특정 고객의 최근 50건. 같은 시각의 주문은 `id DESC`로 순서를 확정.
- `GET /health`: DB 연결과 데이터셋 존재 확인. 초기화 전에는 준비되지 않은 상태.
- 실험·초기화 중 주문·조회는 503으로 거절되어 측정 데이터의 변경을 막습니다.
- 취약 구현은 `src/orders.mjs`의 실험 경로에서만 호출하며 HTTP로 선택할 수 없습니다.

## 두 실험의 질문

### 1. 재고가 음수가 아니면 안전한가?

취약 구현은 `SELECT stock` 후 애플리케이션에서 계산한 값으로 `UPDATE stock = 읽은 값 - 수량`을 실행합니다. 동시 주문이 같은 값을 읽으면 갱신이 유실되어 재고 제약조건을 통과해도 초과 판매될 수 있습니다.

개선 구현은 다음 SQL과 주문 INSERT를 한 트랜잭션으로 묶습니다.

```sql
UPDATE lab.products SET stock = stock - $1
WHERE id = $2 AND stock >= $1
RETURNING price_cents;
```

수정된 행이 없으면 주문을 거절합니다. 주문 INSERT가 실패하면 차감도 롤백합니다. 검증 기준은 **초기 재고 = 판매 수량 + 남은 재고**, **판매 수량 ≤ 초기 재고**, **예상하지 못한 DB 오류 0건**입니다.

### 2. 같은 SQL에 맞는 인덱스를 추가하면 어떤 변화가 있는가?

30만 건의 결정적 합성 데이터에서 특정 고객의 최근 50건을 조회합니다. 절반은 고객 1에게 몰리고 나머지는 다른 고객에게 분산됩니다.

```sql
CREATE INDEX orders_customer_recent_idx
ON lab.orders (customer_id, created_at DESC, id DESC)
INCLUDE (total_cents, status);
```

인덱스 없이 / 인덱스 포함 / 포함 / 없이(ABBA)를 두 차례 실행합니다. 동일 SQL·고객 순서·표본 수·연결·설정을 사용하고 고객별 결과 해시까지 대조합니다. 평균·p50·p95와 `EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON)`을 남깁니다.

## 규모 조정

```powershell
docker compose run --rm -e ROWS=1000000 runner npm run seed
docker compose run --rm -e SAMPLES=200 -e ROUNDS=3 -e CONCURRENCY=32 runner npm run bench
```

| 환경 변수 | 기본값 | 의미 |
|---|---:|---|
| `ROWS` | 300000 | 합성 역사 주문 수, 1천~5백만 |
| `SAMPLES` | 120 | 조회 구간별 측정 횟수, 20~1만 |
| `ROUNDS` | 2 | ABBA 반복 횟수, 1~20 |
| `STOCK_ROUNDS` | 3 | 구현별 정합성 시험 횟수, 1~20 |
| `CONCURRENCY` | 32 | 동시 주문 세션 수, 11~64 |

첫 시도는 기본값을 권장합니다. 데이터 증가는 성능 목표가 아니라 접근 방식 차이를 관찰하기 위한 수단입니다. 인덱스가 반드시 특정 배수만큼 빨라져야 한다는 테스트는 없습니다.

## 읽을 문서

- [실험 방법과 해석 한계](docs/methodology.md)
- [변경별 설계 이유·대안·검증 방법](docs/decisions.md)

- [실행 검증 기록](docs/verification.md)

## 구조

```text
compose.yaml          PostgreSQL + HTTP API + 실험 runner
sql/                  스키마, 동일 조회 SQL, 후보 인덱스
src/orders.mjs        취약/안전 트랜잭션
src/experiments.mjs   동시 실행·인덱스 비교
src/benchmark.mjs     실측·검증·보고서 생성
src/seed.mjs          결정적 합성 데이터 초기화
src/server.mjs        안전 주문·조회 HTTP API
test/                 단위 테스트 + PostgreSQL 통합 테스트
docs/                 방법론·설계 결정·면접 준비
results/              실행별 실제 결과
```

종료는 `docker compose down`입니다. 이 명령은 DB 볼륨을 보존합니다. 모든 실험 데이터를 지울 때만 `docker compose down -v`를 사용하세요.

## 범위와 다음 단계

이 버전은 단일 상품 주문과 단일 고객 조회를 다룹니다. 결제, 인증, 주문 요청의 멱등성, 다중 상품 잠금 순서, 운영용 연결 풀·권한 분리는 후속 작업입니다. HTTP 재시도는 별개의 주문을 만들 수 있습니다. 다음 확장은 멱등성 키와 장애 재시도, 인덱스의 쓰기 비용, PITR 복구 실험 순서를 추천합니다.

로컬 계정·비밀번호는 공개된 실험용 값이며 운영 설정이 아닙니다. 이미지 버전 태그와 npm 잠금 파일을 사용합니다. 장기간 정확히 같은 컨테이너를 재현하려면 실제 사용한 이미지 digest도 기록해 고정하세요.
