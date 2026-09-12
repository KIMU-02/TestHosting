import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connect, exclusive } from './db.mjs';
import { integer } from './util.mjs';

export async function seed(client, count) {
  integer(count, 'ROWS', 1000, 5000000);
  const schema = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(schema);
    await client.query(await readFile(new URL('../sql/checkout.sql', import.meta.url),'utf8'));
    await client.query(`INSERT INTO lab.products VALUES (1,'Portfolio keyboard',10,5000)`);
    await client.query(`
      INSERT INTO lab.orders(customer_id, product_id, quantity, total_cents, status, source, created_at)
      SELECT CASE WHEN g % 2 = 0 THEN 1 ELSE 2 + ((g * 17::bigint) % 999)::integer END,
        1, 1, 5000, CASE WHEN g % 7 = 0 THEN 'cancelled' ELSE 'paid' END, 'history',
        timestamptz '2025-01-01 00:00:00+00' + g * interval '1 second'
      FROM generate_series(1,$1::integer) AS g`, [count]);
    await client.query("INSERT INTO lab.dataset(version,row_count) VALUES ('deterministic-v1',$1)", [count]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  await client.query('VACUUM (ANALYZE) lab.orders');
  await client.query('ANALYZE lab.products');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const client = await connect();
  try {
    const count = integer(process.env.ROWS ?? 300000, 'ROWS', 1000, 5000000);
    await exclusive(client, () => seed(client, count));
    console.log(`Seeded ${count} historical orders. Replaced only schema lab.`);
  } finally { await client.end(); }
}
