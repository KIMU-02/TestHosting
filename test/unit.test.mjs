import test from 'node:test';
import assert from 'node:assert/strict';
import { integer, summarize, barrier, stockVerdict } from '../src/util.mjs';

test('p95 uses nearest rank and leaves samples untouched', () => {
  const input = [100, ...Array.from({ length: 19 }, (_, i) => i + 1)];
  const s = summarize(input);
  assert.equal(s.p95_ms, 19);
  assert.equal(s.p50_ms, 10);
  assert.equal(s.mean_ms, 14.5);
  assert.equal(input[0], 100);
});
test('invalid samples cannot become fabricated metrics', () => {
  for (const values of [[], [NaN], [Infinity], [-1]]) assert.throws(() => summarize(values));
});
test('nonnegative inventory alone does not prove correctness', () => {
  assert.deepEqual(stockVerdict(10, 9, 32), { initial_stock: 10, remaining_stock: 9, sold_units: 32,
    oversold_units: 22, conservation_holds: false, nonnegative_stock: true });
  assert.equal(stockVerdict(10, 0, 10).conservation_holds, true);
});
test('barrier prevents progress until all workers arrive', async () => {
  const wait = barrier(2, 1000);
  let passed = false;
  const first = wait().then(() => { passed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(passed, false);
  await wait();
  await first;
  assert.equal(passed, true);
});
test('barrier times out rather than hanging on failed workers', async () => {
  const wait = barrier(2, 20);
  await assert.rejects(wait(), /timed out/);
});
test('input bounds reject malformed workload configuration', () => {
  for (const value of ['', ' ', true, [], null, undefined, '1.1', 'abc', 0, 65]) {
    assert.throws(() => integer(value, 'workers', 1, 64));
  }
  assert.equal(integer('32', 'workers', 1, 64), 32);
});
