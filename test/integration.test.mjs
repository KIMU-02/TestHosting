import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { connect, shared } from '../src/db.mjs';
import { LAB_LOCK } from '../src/util.mjs';
import { seed } from '../src/seed.mjs';
import { placeOrder } from '../src/orders.mjs';
import { stockTrial, verifyStock, resetCheckout, querySQL, setIndex } from '../src/experiments.mjs';

let client;
before(async () => {
  client = await connect();
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LAB_LOCK]);
  assert.equal(rows[0].ok, true, 'Lab is busy');
  await seed(client, 10000);
});
after(async () => { if (client) await client.end(); });

test('controlled lost update oversells while CHECK still holds', async () => {
  const result = await stockTrial(client, 'unsafe');
  verifyStock(result);
  assert.equal(result.accepted, 32);
  assert.equal(result.remaining_stock, 9);
});
test('atomic decrement preserves inventory under the same concurrent reads', async () => {
  const result = await stockTrial(client, 'safe');
  verifyStock(result);
  assert.equal(result.accepted, 10);
  assert.equal(result.rejected, 22);
  assert.equal(result.remaining_stock, 0);
});
test('order insert failure rolls back its inventory decrement', async () => {
  await resetCheckout(client);
  await assert.rejects(placeOrder(client, { customerId: -1, coordinated: false }), { code: '23514' });
  const { rows } = await client.query('SELECT stock FROM lab.products WHERE id=1');
  assert.equal(rows[0].stock, 10);
  const orders = await client.query("SELECT count(*)::integer AS n FROM lab.orders WHERE source='checkout'");
  assert.equal(orders.rows[0].n, 0);
});
test('multi-unit order and stock exhaustion remain atomic', async () => {
  await resetCheckout(client);
  await placeOrder(client, { customerId: 1, quantity: 7, coordinated: false });
  await assert.rejects(placeOrder(client, { customerId: 2, quantity: 4, coordinated: false }), { status: 409 });
  const { rows } = await client.query('SELECT stock FROM lab.products WHERE id=1');
  assert.equal(rows[0].stock, 3);
});
test('covering index does not change any tested result rows or ordering', async () => {
  await resetCheckout(client);
  await setIndex(client, false);
  const beforeRows = [];
  for (const id of [1, 2, 42, 999, 2147483647]) beforeRows.push((await client.query(querySQL, [id])).rows);
  await setIndex(client, true);
  for (const [i, id] of [1, 2, 42, 999, 2147483647].entries()) {
    assert.deepEqual((await client.query(querySQL, [id])).rows, beforeRows[i]);
  }
});
test('API shared guard refuses access during exclusive experiments', async () => {
  const api = await connect();
  try {
    await api.query('BEGIN');
    await assert.rejects(shared(api), { status: 503 });
    await api.query('ROLLBACK');
  } finally { await api.end(); }
});
