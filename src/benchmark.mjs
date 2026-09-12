import assert from 'node:assert/strict';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connect, exclusive } from './db.mjs';
import { integer, summarize } from './util.mjs';
import { stockTrial, verifyStock, resetCheckout, querySegment, setIndex } from './experiments.mjs';

async function sourceHash() {
  const hash = createHash('sha256');
  for (const directory of ['src', 'sql']) {
    for (const file of (await readdir(directory)).sort()) {
      hash.update(`${directory}/${file}\n`);
      hash.update(await readFile(path.join(directory, file)));
    }
  }
  for (const file of ['package.json', 'package-lock.json', 'compose.yaml', 'Dockerfile']) {
    try { hash.update(file); hash.update(await readFile(file)); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return hash.digest('hex');
}

const config = {
  samples_per_segment: integer(process.env.SAMPLES ?? 120, 'SAMPLES', 20, 10000),
  query_rounds: integer(process.env.ROUNDS ?? 2, 'ROUNDS', 1, 20),
  stock_rounds: integer(process.env.STOCK_ROUNDS ?? 3, 'STOCK_ROUNDS', 1, 20),
  concurrency: integer(process.env.CONCURRENCY ?? 32, 'CONCURRENCY', 11, 64),
  initial_stock: 10, warmup_per_segment: 8, query_clients: 1,
  customers: [1, 2, 42, 999], order_per_round: ['baseline', 'indexed', 'indexed', 'baseline']
};
const dir = path.resolve(process.env.RESULTS_DIR ?? 'results', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
await mkdir(dir, { recursive: true });
const result = { status: 'running', started_at: new Date().toISOString(), config, stock: [], segments: [] };
const save = () => writeFile(path.join(dir, 'results.json'), JSON.stringify(result, null, 2));
await save();
let client;
try {
  client = await connect();
  await exclusive(client, async () => {
    const dataset = await client.query('SELECT * FROM lab.dataset');
    assert.equal(dataset.rows.length, 1, 'Seed the lab first');
    const fingerprint = await client.query(`SELECT count(*)::integer AS count,
      sum(id)::text AS sum_ids, sum(customer_id)::text AS sum_customers,
      min(created_at) AS first_created, max(created_at) AS last_created
      FROM lab.orders WHERE source='history'`);
    assert.equal(fingerprint.rows[0].count, dataset.rows[0].row_count);
    const settings = await client.query(`SELECT name, setting, unit FROM pg_settings
      WHERE name IN ('shared_buffers','work_mem','effective_cache_size','max_connections','jit','random_page_cost','max_parallel_workers_per_gather','transaction_isolation','lc_collate','lc_ctype','TimeZone') ORDER BY name`);
    result.environment = {
      execution: process.env.EXECUTION_ENVIRONMENT ?? 'unspecified-direct-node',
      source_sha256: await sourceHash(), postgres: (await client.query('SELECT version()')).rows[0].version,
      node: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      visible_cpu: os.cpus()[0]?.model, available_parallelism: os.availableParallelism(),
      visible_total_memory_bytes: os.totalmem(),
      note: 'Container-visible values may describe the Docker VM/host, not container resource limits.',
      settings: settings.rows, dataset: dataset.rows[0], fingerprint: fingerprint.rows[0]
    };
    await save();
    try {
      for (let round = 0; round < config.stock_rounds; round++) {
        const modes = round % 2 ? ['safe', 'unsafe'] : ['unsafe', 'safe'];
        for (const mode of modes) {
          console.log(`Stock correctness round ${round + 1}: ${mode}`);
          const trial = { round: round + 1, ...await stockTrial(client, mode, config.concurrency, config.initial_stock) };
          result.stock.push(trial);
          await save();
          verifyStock(trial);
        }
      }
      await resetCheckout(client);
      await client.query('VACUUM (ANALYZE) lab.orders');
      const expected = new Map();
      for (let round = 0; round < config.query_rounds; round++) {
        for (const variant of config.order_per_round) {
          const number = result.segments.length + 1;
          console.log(`Query segment ${number}: ${variant}`);
          result.segments.push(await querySegment(client, variant, config.samples_per_segment, expected, number));
          await save();
        }
      }
      result.query_summary = {};
      for (const variant of ['baseline', 'indexed']) {
        const raw = result.segments.filter(s => s.variant === variant).flatMap(s => s.raw);
        result.query_summary[variant] = {
          overall: summarize(raw.map(x => x.elapsed_ms)),
          by_customer: Object.fromEntries(config.customers.map(id => [id, summarize(raw.filter(x => x.customer_id === id).map(x => x.elapsed_ms))]))
        };
      }
    } finally {
      // Return the educational lab to a usable, optimized state even after a failed trial.
      await resetCheckout(client);
      await setIndex(client, true);
    }
  });
  result.status = 'completed';
  result.finished_at = new Date().toISOString();
  await save();
  const csv = ['segment,variant,sample,customer_id,elapsed_ms,rows,sha256',
    ...result.segments.flatMap(s => s.raw.map(r => [r.segment, r.variant, r.sample, r.customer_id, r.elapsed_ms, r.rows, r.sha256].join(',')))].join('\n');
  await writeFile(path.join(dir, 'query-samples.csv'), csv + '\n');
  const stats = result.query_summary;
  const report = [
    '# PostgreSQL 주문·재고 실측 보고서', '',
    `실행: ${result.started_at}`, '',
    `실행 환경: ${result.environment.execution}`, '',
    '이 문서의 수치는 해당 실행의 원본 results.json에서만 계산했습니다.', '',
    '## 재고 정합성', '',
    '의도적으로 모든 트랜잭션이 읽기를 마친 후 쓰기를 시작한 재현 시험입니다. 처리량 시험이 아닙니다.', '',
    '| 회차 | 구현 | 승인 | 품절 | 오류 | 잔여 재고 | 초과 판매 | 재고 보존 |',
    '|---|---|---|---|---|---|---|---|',
    ...result.stock.map(r => `| ${r.round} | ${r.mode} | ${r.accepted} | ${r.rejected} | ${r.errors} | ${r.remaining_stock} | ${r.oversold_units} | ${r.conservation_holds} |`), '',
    '## 주문 조회', '',
    '| 구현 | 표본 수 | 평균 ms | p50 ms | p95 ms |',
    '|---|---|---|---|---|',
    ...['baseline', 'indexed'].map(v => {
      const s = stats[v].overall;
      return `| ${v} | ${s.count} | ${s.mean_ms.toFixed(3)} | ${s.p50_ms.toFixed(3)} | ${s.p95_ms.toFixed(3)} |`;
    }), '',
    `baseline p95 / indexed p95: ${(stats.baseline.overall.p95_ms / stats.indexed.overall.p95_ms).toFixed(3)} (1보다 클 때 감소)`, '',
    '단일 연결에서 SQL 전송부터 행 수신까지 측정했습니다. 연결 생성·워밍업·해시 검증·EXPLAIN은 제외했습니다.',
    '동일 데이터, 고객 순서, SQL, 연결과 세션 설정을 사용하고 ABBA 순서로 반복했습니다. OS 캐시를 비우지 않았습니다.',
    '집계는 지정 고객 혼합에 한정됩니다. 고객별 통계, 회차별 통계, 실행 계획·버퍼·인덱스 크기는 results.json을 확인하세요.',
    '인덱스 생성 비용·쓰기 처리량·다중 클라이언트 포화 부하는 측정하지 않았으므로 전체 서비스 성능으로 일반화하지 마세요.', '',
    '## 재현 정보', '',
    `- 소스 SHA-256: ${result.environment.source_sha256}`,
    `- PostgreSQL: ${result.environment.postgres}`,
    `- 역사 주문 수: ${result.environment.fingerprint.count}`,
    '- 전체 환경 및 설정: results.json → environment / config',
    '- 원본 조회 표본: query-samples.csv',
    '- 결과 행 해시가 전후 일치함을 검사했고, 오류 발생 시 성공 보고서를 만들지 않습니다.', ''
  ].join('\n');
  await writeFile(path.join(dir, 'report.md'), report);
  console.log(`Completed. Results: ${dir}`);
} catch (error) {
  result.status = 'failed';
  result.error = { message: error.message, stack: error.stack };
  result.finished_at = new Date().toISOString();
  await save();
  console.error(error);
  process.exitCode = 1;
} finally { if (client) await client.end(); }
