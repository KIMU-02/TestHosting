import test from 'node:test';
import assert from 'node:assert/strict';
import {connect} from '../src/db.mjs';
import {databaseSnapshot} from '../src/monitoring.mjs';

test('real lock waiter and blocker appear, and disappear after release',async()=>{
  const blocker=await connect(),waiter=await connect();let pending;
  const lock=880000000+Math.floor(Math.random()*1000000);
  try {
    await blocker.query('SELECT pg_advisory_lock($1)',[lock]);
    const pid=(await waiter.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    pending=waiter.query('SELECT pg_advisory_lock($1)',[lock]);pending.catch(()=>{});
    let snapshot;
    for(let i=0;i<30;i++){
      snapshot=await databaseSnapshot();
      if(snapshot.waiting?.some(w=>w.pid===pid))break;
      await new Promise(r=>setTimeout(r,50));
    }
    const row=snapshot.waiting.find(w=>w.pid===pid);
    assert.equal(snapshot.status,'available');assert.ok(snapshot.lock_waiters>=1);assert.ok(row.blocking_pids.length>0);assert.equal(row.wait_event_type,'Lock');
    await blocker.query('SELECT pg_advisory_unlock($1)',[lock]);await pending;
    assert.ok(!(await databaseSnapshot()).waiting.some(w=>w.pid===pid));
  } finally {
    await blocker.end();if(pending)await pending.catch(()=>{});await waiter.end();
  }
});
