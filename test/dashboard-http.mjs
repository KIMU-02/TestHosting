import assert from 'node:assert/strict';
const base = process.env.DASHBOARD_URL ?? 'http://127.0.0.1:8080';
assert.equal((await fetch(base+'/live')).status,200);
assert.equal((await fetch(base+'/monitoring.js')).status,200);
const bad=await fetch(base+'/orders?customer_id=invalid');
assert.equal(bad.status,400);assert.match(bad.headers.get('x-request-id'),/^[a-f0-9-]{36}$/);
const monitor=await (await fetch(base+'/api/monitoring')).json();
assert.equal(monitor.database.status,'available');assert.ok(monitor.api.client_errors>=1);
assert.ok(monitor.api.recent_errors.some(e=>e.request_id===bad.headers.get('x-request-id')));
console.log('PASS liveness, live DB monitoring and error request ID correlation');
for (const [route, type] of [['/', 'text/html'], ['/dashboard.css','text/css'], ['/dashboard.js','text/javascript'], ['/benchmarks.js','text/javascript'], ['/benchmarks.css','text/css'], ['/favicon.svg','image/svg+xml']]) {
  const response = await fetch(base + route);
  assert.equal(response.status, 200, route);
  assert.ok(response.headers.get('content-type').startsWith(type), route);
  assert.ok((await response.text()).length > 0);
  console.log(`PASS asset ${route}`);
}
const overview = await (await fetch(base + '/api/overview')).json();
assert.ok(Array.isArray(overview.products));
assert.ok(overview.products.every(p => Number.isInteger(p.stock) && p.stock >= 0));
assert.ok(Number.isInteger(overview.checkout.orders));
console.log('PASS live stock and order overview');
const orders = await (await fetch(base + '/api/orders?customer_id=1')).json();
assert.ok(Array.isArray(orders) && orders.length <= 50);
assert.ok(orders.every(o => o.customer_id === 1 && ['history','checkout'].includes(o.source)));
assert.equal((await fetch(base + '/api/orders?customer_id=0')).status, 400);
console.log('PASS customer order list and input validation');
const response = await fetch(base + '/api/measurements');
assert.equal(response.status, 200);
const { measurement } = await response.json();
if (measurement) {
  assert.equal(measurement.environment, 'Docker Compose');
  assert.ok(measurement.before.p95_ms > 0 && measurement.after.p95_ms > 0);
  const run = encodeURIComponent(measurement.run_id);
  const csv = await fetch(base + '/api/measurements.csv?run=' + run);
  assert.equal(csv.status, 200);
  assert.ok(csv.headers.get('content-disposition').startsWith('attachment;'));
  const lines = (await csv.text()).trim().split('\n');
  assert.equal(lines.length, measurement.samples.length + 1);
  assert.deepEqual(lines.slice(1), measurement.samples.map(s => [s.segment,s.variant,s.customer_id,s.elapsed_ms,s.rows,s.sha256].join(',')));
  const summary = await (await fetch(base + '/api/measurements.json?run=' + run)).json();
  assert.equal(summary.run_id, measurement.run_id);
  assert.deepEqual(summary.before, measurement.before);
  assert.equal(summary.samples, undefined);
  assert.ok(summary.segments.every(s => s.plans === undefined));
  assert.equal((await fetch(base + '/api/measurements.csv?run=..%2Fmissing')).status, 404);
  console.log(`PASS CSV ${measurement.samples.length} exact samples, summary export, invalid archive rejection`);
}
console.log('PASS stored measurements or explicit empty state');
