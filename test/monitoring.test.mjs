import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RequestMetrics,routeLabel,databaseSnapshot} from '../src/monitoring.mjs';

test('bounded window uses only actual samples and separates 4xx from 5xx',()=>{
  const m=new RequestMetrics(2,()=>{});
  assert.equal(m.snapshot().latency,null);
  [200,409,500].forEach((status,i)=>m.record({route:'POST /orders',status,elapsed_ms:i+1,at:'2026-09-12T00:00:00Z'}));
  const s=m.snapshot();assert.equal(s.total_completed,3);assert.equal(s.count,2);assert.equal(s.server_errors,1);assert.equal(s.client_errors,1);assert.equal(s.latency.p95_ms,3);
});
test('request logs exclude identifiers in URLs and finish/close is counted once',()=>{
  const logs=[],m=new RequestMetrics(100,e=>logs.push(e)),res=new EventEmitter();res.setHeader=()=>{};res.statusCode=200;res.writableFinished=true;
  m.observe({method:'POST',url:'/orders/123/cancel?customer_id=secret'},res);assert.equal(m.snapshot().inflight,1);
  res.emit('finish');res.emit('close');assert.equal(m.snapshot().total_completed,1);assert.equal(m.snapshot().inflight,0);
  assert.equal(logs[0].route,'POST /orders/:id/cancel');assert.ok(!JSON.stringify(logs).includes('secret'));
  assert.equal(routeLabel('GET','/arbitrary-sensitive-value'),'GET OTHER');
});
test('polling is excluded and aborted requests are not successful samples',()=>{
  const m=new RequestMetrics(100,()=>{}),res=new EventEmitter();res.setHeader=()=>{};
  m.observe({method:'GET',url:'/api/monitoring'},res);assert.equal(m.snapshot().inflight,0);
  m.observe({method:'GET',url:'/orders'},res);res.emit('close');assert.equal(m.snapshot().aborted,1);assert.equal(m.snapshot().count,0);
});
test('DB failure is unknown, never fabricated zero connections',async()=>{
  assert.deepEqual(await databaseSnapshot(async()=>{throw Error('offline');}),{status:'unavailable'});
});
