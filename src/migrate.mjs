import { readFile } from 'node:fs/promises';
import { connect, exclusive } from './db.mjs';
export async function migrate() {
  const client = await connect();
  try { await exclusive(client, async () => {
    await client.query(await readFile(new URL('../sql/checkout.sql', import.meta.url), 'utf8'));
  }); } finally { await client.end(); }
}
