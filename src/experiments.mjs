import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { connect } from './db.mjs';
import { placeOrder } from './orders.mjs';
import { barrier, stockVerdict, summarize } from './util.mjs';

export const querySQL = await readFile(new URL('../sql/query.sql', import.meta.url), 'utf8');
export const indexSQL = await readFile(new URL('../sql/index.sql', import.meta.url), 'utf8');
const digest = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');

export async function resetCheckout(client, stock = 10) {
  await client.query('BEGIN');
  try {
    await client.query("DELETE FROM lab.orders WHERE source='checkout'");
    await client.query('UPDATE lab.products SET stock=$1 WHERE id=1', [stock]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

// Caller must hold the exclusive lab advisory lock for the entire experiment.
// This deliberately controlled interleaving proves correctness, not throughput.
export async function stockTrial(coordinator, mode, concurrency = 32, initial = 10) {
  await resetCheckout(coordinator, initial);
  const connections = await Promise.allSettled(Array.from({ length: concurrency }, () => connect()));
  const clients = connections.filter(x => x.status === 'fulfilled').map(x => x.value);
  try {
    const failure = connections.find(x => x.status === 'rejected');
    if (failure) throw failure.reason;
    const afterRead = barrier(concurrency);
    const outcomes = await Promise.all(clients.map(async (client, i) => {
      try {
        const order = await placeOrder(client, { mode, customerId: i + 1, afterRead, coordinated: false });
        return { request: i, status: 'accepted', order_id: order.id };
      } catch (error) {
        return { request: i, status: error.status === 409 ? 'out_of_stock' : 'error', error: error.message };
      }
    }));
    const { rows } = await coordinator.query(`
      SELECT stock, (SELECT coalesce(sum(quantity),0)::integer FROM lab.orders WHERE source='checkout') AS sold
      FROM lab.products WHERE id=1`);
    const verdict = stockVerdict(initial, rows[0].stock, rows[0].sold);
    return { mode, concurrency, schedule: 'all clients read before any update; safe ignores the test-only read',
      ...verdict, accepted: outcomes.filter(x => x.status === 'accepted').length,
      rejected: outcomes.filter(x => x.status === 'out_of_stock').length,
      errors: outcomes.filter(x => x.status === 'error').length, outcomes };
  } finally { await Promise.all(clients.map(client => client.end())); }
}

export function verifyStock(result) {
  assert.equal(result.errors, 0, 'Infrastructure errors invalidate the trial');
  assert.equal(result.accepted, result.sold_units);
  assert.equal(result.accepted + result.rejected, result.concurrency);
  assert.equal(result.nonnegative_stock, true);
  if (result.mode === 'safe') {
    assert.equal(result.conservation_holds, true);
    assert.equal(result.oversold_units, 0);
    assert.equal(result.accepted, Math.min(result.initial_stock, result.concurrency));
  } else {
    assert.ok(result.oversold_units > 0, 'Controlled race was not reproduced');
    assert.equal(result.conservation_holds, false);
  }
}

export async function setIndex(client, enabled) {
  await client.query('DROP INDEX IF EXISTS lab.orders_customer_recent_idx');
  if (enabled) await client.query(indexSQL);
}

export async function querySegment(client, variant, samples, expected, segment) {
  await setIndex(client, variant === 'indexed');
  const customers = [1, 2, 42, 999];
  // Same warmup parameters and count in every segment; no OS-cache clearing claim.
  for (let i = 0; i < 8; i++) await client.query(querySQL, [customers[i % customers.length]]);
  const raw = [];
  for (let i = 0; i < samples; i++) {
    const customer = customers[i % customers.length];
    const start = performance.now();
    const { rows } = await client.query(querySQL, [customer]);
    const elapsed = performance.now() - start;
    const hash = digest(rows); // Validation and hashing excluded from timing.
    if (!expected.has(customer)) expected.set(customer, hash);
    assert.equal(hash, expected.get(customer), 'Query result changed across index variants');
    raw.push({ segment, variant, sample: i, customer_id: customer, elapsed_ms: elapsed, rows: rows.length, sha256: hash });
  }
  const plans = {};
  for (const customer of customers) {
    const { rows } = await client.query(`EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON) ${querySQL}`, [customer]);
    plans[customer] = rows[0]['QUERY PLAN'];
  }
  const size = await client.query(`SELECT pg_relation_size('lab.orders') AS heap_bytes,
    pg_indexes_size('lab.orders') AS all_indexes_bytes,
    coalesce(pg_relation_size(to_regclass('lab.orders_customer_recent_idx')),0) AS candidate_index_bytes`);
  return { segment, variant, summary: summarize(raw.map(x => x.elapsed_ms)), raw, plans, sizes: size.rows[0] };
}
