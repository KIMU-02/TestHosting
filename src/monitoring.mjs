import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { summarize } from './util.mjs';
import { connect } from './db.mjs';

export function routeLabel(method, pathname) {
  if (!['GET','POST'].includes(method)) return 'OTHER';
  if (/^\/orders\/\d+\/cancel$/.test(pathname)) return `${method} /orders/:id/cancel`;
  return `${method} ${['/orders','/api/orders','/api/overview','/api/measurements','/api/measurements.csv','/api/measurements.json'].includes(pathname) ? pathname : 'OTHER'}`;
}
export class RequestMetrics {
  constructor(limit=1000, log=entry=>console.log(JSON.stringify(entry))) {
    this.limit=limit;this.log=log;this.started=new Date().toISOString();this.samples=[];this.total=0;this.inflight=0;this.aborted=0;
  }
  observe(req,res) {
    const pathname=new URL(req.url,'http://localhost').pathname;
    // Polling and static assets must not make business traffic appear healthier.
    if (['/health','/live','/api/monitoring'].includes(pathname) || ['/', '/dashboard.js','/dashboard.css','/benchmarks.js','/benchmarks.css','/monitoring.js','/favicon.svg'].includes(pathname)) return;
    const id=randomUUID(), start=performance.now(), route=routeLabel(req.method,pathname);
    res.setHeader('X-Request-Id',id);this.inflight++;
    let done=false;
    const finish=aborted=>{
      if(done)return;done=true;this.inflight--;
      if(aborted){this.aborted++;this.log({event:'http_aborted',request_id:id,route});return;}
      this.record({request_id:id,route,status:res.statusCode,elapsed_ms:performance.now()-start,at:new Date().toISOString()});
    };
    res.once('finish',()=>finish(false));res.once('close',()=>finish(!res.writableFinished));
  }
  record(sample){this.total++;this.samples.push(sample);if(this.samples.length>this.limit)this.samples.shift();this.log({event:'http_request',...sample});}
  snapshot(){
    const summarizeRows=rows=>({count:rows.length,server_errors:rows.filter(s=>s.status>=500).length,client_errors:rows.filter(s=>s.status>=400&&s.status<500).length,latency:rows.length?summarize(rows.map(s=>s.elapsed_ms)):null});
    return {started_at:this.started,total_completed:this.total,inflight:this.inflight,aborted:this.aborted,window_limit:this.limit,window_start:this.samples[0]?.at??null,...summarizeRows(this.samples),
      routes:[...new Set(this.samples.map(s=>s.route))].map(route=>({route,...summarizeRows(this.samples.filter(s=>s.route===route))})),
      recent_errors:this.samples.filter(s=>s.status>=400).slice(-10).reverse()};
  }
}

export async function databaseSnapshot(connectFn=connect) {
  let client;
  try {
    client=await connectFn();
    await client.query("SET statement_timeout='2000ms'");
    const {rows:[counts]}=await client.query(`SELECT
      count(*) FILTER (WHERE backend_type='client backend')::int AS cluster_connections,
      current_setting('max_connections')::int AS max_connections,
      count(*) FILTER (WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend')::int AS database_connections,
      count(*) FILTER (WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active' AND backend_type='client backend')::int AS active,
      count(*) FILTER (WHERE datname=current_database() AND pid<>pg_backend_pid() AND state LIKE 'idle in transaction%')::int AS idle_in_transaction,
      count(*) FILTER (WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock')::int AS lock_waiters
      FROM pg_stat_activity`);
    const {rows:waiting}=await client.query(`SELECT pid,wait_event_type,wait_event,
      greatest(0,extract(epoch FROM clock_timestamp()-xact_start))::float8 AS transaction_seconds,
      pg_blocking_pids(pid) AS blocking_pids FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid() AND (wait_event_type='Lock' OR state LIKE 'idle in transaction%') ORDER BY xact_start LIMIT 20`);
    return {status:'available',...counts,waiting};
  } catch {return {status:'unavailable'};}
  finally {if(client)await client.end();}
}
