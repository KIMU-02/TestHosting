import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';

test('recovery SQL guards original DB, validates a disposable fixture, and rejects corrupt mappings',async()=>{
  const query=await readFile(new URL('../sql/verify-recovery.sql',import.meta.url),'utf8');
  const admin=new pg.Client({database:'portfolio',connectionTimeoutMillis:10000,statement_timeout:30000});await admin.connect();
  const name='portfolio_restore_'+new Date().toISOString().replace(/[-:.]/g,'').toLowerCase()+'_'+randomBytes(4).toString('hex');
  assert.match(name,/^portfolio_restore_[0-9]{8}t[0-9]{9}z_[a-f0-9]{8}$/);
  let created=false,client;
  try {
    await assert.rejects(admin.query(query),/Refusing verification writes/);await admin.query('ROLLBACK');
    await admin.query(`CREATE DATABASE ${name} TEMPLATE template0`);created=true;
    client=new pg.Client({database:name,connectionTimeoutMillis:10000,statement_timeout:30000});await client.connect();
    await client.query(await readFile(new URL('../sql/schema.sql',import.meta.url),'utf8'));
    await client.query(await readFile(new URL('../sql/checkout.sql',import.meta.url),'utf8'));
    await client.query("INSERT INTO lab.products VALUES(1,'Recovery fixture',0,100); INSERT INTO lab.dataset(version,row_count) VALUES('test',1); INSERT INTO lab.orders(customer_id,product_id,quantity,total_cents,status,source) VALUES(1,1,1,100,'paid','history')");
    const result=await client.query(query);
    assert.equal(result.at(-1).rows[0].json_build_object.orders,1);
    assert.equal((await client.query('SELECT stock FROM lab.products')).rows[0].stock,0);
    await client.query("INSERT INTO lab.order_requests VALUES(2,'invalid_mapping',1,1,1)");
    await assert.rejects(client.query(query),/Invalid idempotency mapping/);await client.query('ROLLBACK');
  } finally {
    if(client)await client.end();
    if(created)await admin.query(`DROP DATABASE ${name}`);
    await admin.end();
  }
});
