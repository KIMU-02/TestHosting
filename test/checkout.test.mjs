import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {connect} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {placeOrder,cancelOrder} from '../src/orders.mjs';

// Dedicated fixture only; never seed/reset existing orders or inventory.
test('concurrent retries and cancellations preserve one order and one stock restoration',async () => {
  await migrate();
  const admin=await connect(), productId=1900000000+Math.floor(Math.random()*10000000), customerId=productId;
  let created=false;
  const use=async fn=>{const c=await connect();try{return await fn(c);}finally{await c.end();}};
  try {
    await admin.query("INSERT INTO lab.products VALUES($1,'checkout test fixture',10,100)",[productId]); created=true;
    const args={customerId,productId,quantity:2,requestKey:randomUUID()};
    const results=await Promise.all(Array.from({length:16},()=>use(c=>placeOrder(c,args))));
    assert.equal(new Set(results.map(r=>r.id)).size,1);
    assert.equal(results.filter(r=>!r.replayed).length,1);
    assert.equal((await admin.query('SELECT stock FROM lab.products WHERE id=$1',[productId])).rows[0].stock,8);
    await assert.rejects(use(c=>placeOrder(c,{...args,quantity:3})),{status:409});
    await assert.rejects(use(c=>placeOrder(c,{...args,requestKey:'bad'})),{status:400});
    await assert.rejects(use(c=>cancelOrder(c,{orderId:results[0].id,customerId:1})),{status:404});
    const cancels=await Promise.all(Array.from({length:16},()=>use(c=>cancelOrder(c,{orderId:results[0].id,customerId}))));
    assert.equal(cancels.filter(r=>!r.replayed).length,1);
    assert.equal((await admin.query('SELECT stock FROM lab.products WHERE id=$1',[productId])).rows[0].stock,10);
    assert.equal((await use(c=>placeOrder(c,args))).id,results[0].id);
    const failed={...args,quantity:11,requestKey:randomUUID()};
    await assert.rejects(use(c=>placeOrder(c,failed)),{status:409});
    assert.equal((await admin.query('SELECT count(*)::int n FROM lab.order_requests WHERE request_key=$1',[failed.requestKey])).rows[0].n,0);
    const history=await admin.query("INSERT INTO lab.orders(customer_id,product_id,quantity,total_cents,status,source) VALUES($1,$1,1,100,'paid','history') RETURNING id",[productId]);
    await assert.rejects(use(c=>cancelOrder(c,{orderId:history.rows[0].id,customerId})),{status:409});
    if(process.env.DASHBOARD_URL) {
      const base=process.env.DASHBOARD_URL, key=randomUUID();
      const post=async (route,data,headers={})=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});return {status:r.status,body:await r.json()};};
      const payload={customer_id:customerId,product_id:productId,quantity:3};
      const first=await post('/orders',payload,{'Idempotency-Key':key});assert.equal(first.status,201);
      const retry=await post('/orders',payload,{'Idempotency-Key':key});assert.equal(retry.status,200);assert.equal(retry.body.id,first.body.id);
      assert.equal((await post('/orders',{...payload,quantity:4},{'Idempotency-Key':key})).status,409);
      const cancel=await post(`/orders/${first.body.id}/cancel`,{customer_id:customerId});assert.equal(cancel.status,200);assert.equal(cancel.body.replayed,false);
      assert.equal((await post(`/orders/${first.body.id}/cancel`,{customer_id:customerId})).body.replayed,true);
      assert.equal((await admin.query('SELECT stock FROM lab.products WHERE id=$1',[productId])).rows[0].stock,10);
      console.log('Verified HTTP: create 201, replay 200, conflict 409, cancellation and repeat cancellation 200; inventory restored.');
    }
    console.log('Verified: 16 create retries -> 1 order; 16 cancels -> 1 restoration; payload conflict, invalid key, wrong customer, failed rollback, history guard, cancelled replay.');
  } finally {
    if(created){await admin.query('DELETE FROM lab.orders WHERE product_id=$1',[productId]);await admin.query('DELETE FROM lab.products WHERE id=$1',[productId]);}
    await admin.end();
  }
});
