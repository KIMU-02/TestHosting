import pg from 'pg';
import { LAB_LOCK } from './util.mjs';

export function newClient() {
  return new pg.Client({
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
    application_name: 'postgres-order-lab'
  });
}

export async function connect() {
  const client = newClient();
  await client.connect();
  try {
    const { rows } = await client.query('SELECT current_database() AS name');
    if (rows[0].name !== 'portfolio') throw new Error('This lab only runs in database portfolio');
    return client;
  } catch (error) { await client.end(); throw error; }
}

export async function exclusive(client, fn) {
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LAB_LOCK]);
  if (!rows[0].ok) throw new Error('Another experiment or API transaction is active. Retry when idle.');
  try { return await fn(); }
  finally { await client.query('SELECT pg_advisory_unlock($1)', [LAB_LOCK]); }
}

export async function shared(client) {
  const { rows } = await client.query('SELECT pg_try_advisory_xact_lock_shared($1) AS ok', [LAB_LOCK]);
  if (!rows[0].ok) {
    const error = new Error('Experiment in progress');
    error.status = 503;
    throw error;
  }
}
