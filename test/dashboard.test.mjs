import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { latestMeasurement, measurementDetails } from '../src/dashboard-data.mjs';

test('archive selects a completed Docker run and exposes only public fields', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'stockroom-test-'));
  try {
    const valid = { status: 'completed', started_at: '2026-09-11T00:00:00Z', environment: {execution: 'docker-compose', source_sha256: 'abc', postgres: '18.4', fingerprint: {count: 300000}, secret: 'not-for-http'}, stock: [], query_summary: {baseline: {overall: {p95_ms: 10}}, indexed: {overall: {p95_ms: 1}}} };
    for (const [name, value] of [['01-valid', JSON.stringify(valid)], ['02-native', JSON.stringify({...valid, environment: {...valid.environment, execution: 'windows-native'}})], ['03-running', JSON.stringify({...valid, status: 'running'})], ['04-partial', '{'], ['05-malformed', JSON.stringify({...valid, stock: undefined})]]) {
      await mkdir(path.join(temp,name)); await writeFile(path.join(temp,name,'results.json'), value);
    }
    const result = await latestMeasurement(temp);
    assert.equal(result.before.p95_ms, 10);
    assert.equal(result.environment, 'Docker Compose');
    assert.equal(result.secret, undefined);
    assert.equal(result.source_sha256, 'abc');
  } finally {
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'stockroom-test-'));
    await rm(temp, { recursive: true });
  }
});
test('a missing archive is an empty state, not fake measurements', async () => {
  assert.equal(await latestMeasurement(path.join(os.tmpdir(),'stockroom-nonexistent-'+Date.now())), null);
});

test('detail export preserves samples, detects changed results, and avoids double-counting buffers', () => {
  const r = { environment: {}, query_summary: {baseline:{by_customer:{}},indexed:{by_customer:{}}},segments:[
    {segment:1,variant:'baseline',raw:[{customer_id:1,elapsed_ms:10,sha256:'same'}],plans:{1:[{Plan:{'Node Type':'Limit','Shared Hit Blocks':5,Plans:[{'Node Type':'Index Only Scan','Shared Hit Blocks':5,'Heap Fetches':2}]},'Execution Time':3}]}},
    {segment:2,variant:'indexed',raw:[{customer_id:1,elapsed_ms:1,sha256:'same'}]}
  ]};
  const d=measurementDetails(r);
  assert.equal(d.samples.length,2);
  assert.equal(d.results_match,true);
  assert.equal(d.segments[0].plans[1].hit_blocks,5);
  assert.equal(d.segments[0].plans[1].nodes[1].heap_fetches,2);
  r.segments[1].raw[0].sha256='different';
  assert.equal(measurementDetails(r).results_match,false);
  r.segments=[];
  assert.equal(measurementDetails(r).results_match,false);
});
