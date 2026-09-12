import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { connect, shared } from './db.mjs';
import { integer } from './util.mjs';
import { placeOrder, cancelOrder } from './orders.mjs';
import { migrate } from './migrate.mjs';
import { latestMeasurement } from './dashboard-data.mjs';
import { fileURLToPath } from 'node:url';
import { RequestMetrics, databaseSnapshot } from './monitoring.mjs';
const metrics = new RequestMetrics();

const query = await readFile(new URL('../sql/query.sql', import.meta.url), 'utf8');
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/dashboard.css', ['dashboard.css', 'text/css; charset=utf-8']],
  ['/benchmarks.css', ['benchmarks.css', 'text/css; charset=utf-8']],
  ['/dashboard.js', ['dashboard.js', 'text/javascript; charset=utf-8']],
  ['/benchmarks.js', ['benchmarks.js', 'text/javascript; charset=utf-8']],
  ['/monitoring.js', ['monitoring.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]
]);
function respond(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 8192) { const e = new Error('Body too large'); e.status = 413; throw e; }
  }
  return JSON.parse(text);
}
const server = http.createServer(async (req, res) => {
  metrics.observe(req,res);
  let client;
  try {
    const url = new URL(req.url, 'http://localhost');
    if(req.method==='GET' && url.pathname==='/live') return respond(res,200,{status:'alive'});
    if(req.method==='GET' && url.pathname==='/api/monitoring') {
      res.setHeader('Cache-Control','no-store');
      return respond(res,200,{observed_at:new Date().toISOString(),api:metrics.snapshot(),database:await databaseSnapshot()});
    }
    if (req.method === 'GET' && assets.has(url.pathname)) {
      const [file, type] = assets.get(url.pathname);
      const content = await readFile(new URL(`../public/${file}`, import.meta.url));
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      return res.end(content);
    }
    if (req.method === 'GET' && url.pathname === '/api/measurements') {
      return respond(res, 200, { measurement: await latestMeasurement(process.env.RESULTS_DIR ?? fileURLToPath(new URL('../results', import.meta.url))) });
    }
    if (req.method === 'GET' && ['/api/measurements.csv','/api/measurements.json'].includes(url.pathname)) {
      const r = await latestMeasurement(process.env.RESULTS_DIR ?? fileURLToPath(new URL('../results', import.meta.url)), url.searchParams.get('run'));
      if (!r) return respond(res,404,{error:'Measurement not found'});
      const csv = url.pathname.endsWith('.csv');
      const {samples,segments,...summary} = r;
      const content = csv ? 'segment,variant,customer_id,elapsed_ms,rows,sha256\n'+samples.map(s=>[s.segment,s.variant,s.customer_id,s.elapsed_ms,s.rows,s.sha256].join(',')).join('\n')+'\n' : JSON.stringify({...summary,segments:segments.map(({plans,...s})=>s)},null,2);
      res.writeHead(200,{'content-type':csv?'text/csv; charset=utf-8':'application/json; charset=utf-8',
        'content-disposition':`attachment; filename="stockroom-${r.measured_at.slice(0,10)}.${csv?'csv':'json'}"`,'cache-control':'no-store'});
      return res.end(content);
    }
    if (req.method === 'GET' && url.pathname === '/api/overview') {
      client = await connect();
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await shared(client);
      const products = await client.query('SELECT id,name,stock,price_cents FROM lab.products ORDER BY id');
      const orders = await client.query(`SELECT count(*)::integer AS orders,
        coalesce(sum(quantity),0)::integer AS units FROM lab.orders WHERE source='checkout' AND status='paid'`);
      const dataset = await client.query('SELECT row_count FROM lab.dataset');
      await client.query('COMMIT');
      return respond(res, 200, { products: products.rows, checkout: orders.rows[0], history_orders: dataset.rows[0]?.row_count ?? 0, refreshed_at: new Date().toISOString() });
    }
    if (req.method === 'GET' && url.pathname === '/api/orders') {
      const id = integer(url.searchParams.get('customer_id'), 'customer_id', 1, 2147483647);
      client = await connect();
      await client.query('BEGIN');
      await shared(client);
      const { rows } = await client.query(`SELECT id,customer_id,product_id,quantity,total_cents,status,source,created_at
        FROM lab.orders WHERE customer_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50`, [id]);
      await client.query('COMMIT');
      return respond(res, 200, rows);
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      client = await connect();
      await client.query('SELECT 1 FROM lab.dataset');
      return respond(res, 200, { status: 'ready' });
    }
    if (req.method === 'GET' && url.pathname === '/orders') {
      const id = integer(url.searchParams.get('customer_id'), 'customer_id', 1, 2147483647);
      client = await connect();
      await client.query('BEGIN');
      await shared(client);
      const { rows } = await client.query(query, [id]);
      await client.query('COMMIT');
      return respond(res, 200, rows);
    }
    if (req.method === 'POST' && /^\/orders\/[0-9]+\/cancel$/.test(url.pathname)) {
      const data = await body(req);
      const customerId = integer(data?.customer_id,'customer_id',1,2147483647);
      const orderId = url.pathname.split('/')[2];
      if (BigInt(orderId) > 9223372036854775807n) return respond(res,400,{error:'Invalid order id'});
      client = await connect();
      return respond(res,200,await cancelOrder(client,{orderId,customerId}));
    }
    if (req.method === 'POST' && url.pathname === '/orders') {
      const data = await body(req);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SyntaxError('Expected a JSON object');
      const customerId = integer(data.customer_id, 'customer_id', 1, 2147483647);
      const productId = integer(data.product_id ?? 1, 'product_id', 1, 2147483647);
      const quantity = integer(data.quantity, 'quantity', 1, 10000);
      client = await connect();
      const result = await placeOrder(client, { customerId, productId, quantity, requestKey:req.headers['idempotency-key'] });
      return respond(res, result.replayed ? 200 : 201, result);
    }
    respond(res, 404, { error: 'Not found' });
  } catch (error) {
    const status = error.status ?? (error instanceof SyntaxError || error.message.includes('must be an integer') ? 400 : 500);
    if (status === 500) console.error(JSON.stringify({event:'server_error',request_id:res.getHeader('X-Request-Id')??null,error_type:error.name,code:error.code??null}));
    respond(res, status, { error: status === 500 ? 'Database unavailable or lab not seeded' : error.message });
  } finally {
    if (client) await client.end();
  }
});
server.requestTimeout = 30000;
const port = integer(process.env.PORT ?? 8080, 'PORT', 1, 65535);
await migrate();
server.listen(port, process.env.HOST ?? '0.0.0.0', () => console.log(`Dashboard http://localhost:${port} (safe orders only)`));
process.on('SIGTERM', () => server.close());
