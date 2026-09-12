import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

function planView(document) {
  const root = document?.[0]?.Plan;
  if (!root) return null;
  const nodes = [];
  function walk(node, depth = 0) {
    nodes.push({ depth, type: node['Node Type'], parallel: node['Parallel Aware'] === true,
      index: node['Index Name'], rows: node['Actual Rows'], loops: node['Actual Loops'],
      heap_fetches: node['Heap Fetches'] });
    for (const child of node.Plans ?? []) walk(child, depth + 1);
  }
  walk(root);
  return { nodes, execution_ms: document[0]['Execution Time'], planning_ms: document[0]['Planning Time'],
    hit_blocks: root['Shared Hit Blocks'], read_blocks: root['Shared Read Blocks'] };
}

export function measurementDetails(r) {
  const segments = (r.segments ?? []).map(s => ({ segment: s.segment, variant: s.variant, summary: s.summary,
    sizes: s.sizes, plans: Object.fromEntries(Object.entries(s.plans ?? {}).map(([id,p]) => [id, planView(p)])) }));
  const samples = (r.segments ?? []).flatMap(s => (s.raw ?? []).map(v => ({ segment: s.segment, variant: s.variant,
    customer_id: v.customer_id, elapsed_ms: v.elapsed_ms, rows: v.rows, sha256: v.sha256 })));
  const hashes = new Map();
  const sameResults = samples.length > 0 && samples.every(s => {
    if (!s.sha256) return false;
    if (!hashes.has(s.customer_id)) hashes.set(s.customer_id,s.sha256);
    return hashes.get(s.customer_id) === s.sha256;
  });
  return { segments, samples, results_match: sameResults,
    customers: Object.entries(r.query_summary.baseline.by_customer ?? {}).map(([id,before]) => ({id, before, after:r.query_summary.indexed.by_customer?.[id]})).filter(c=>c.after),
    conditions: { clients:r.config?.query_clients, warmup:r.config?.warmup_per_segment,
      rounds:r.config?.query_rounds, concurrency:r.config?.concurrency, initial_stock:r.config?.initial_stock,
      node:r.environment.node, platform:r.environment.platform, settings:r.environment.settings ?? [] }
  };
}

// Return a small, allowlisted view of a saved measurement, never invented metrics.
export async function latestMeasurement(directory, runId) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  for (const entry of entries.filter(e => e.isDirectory() && (!runId || e.name === runId)).sort((a, b) => b.name.localeCompare(a.name))) {
    try {
      const r = JSON.parse(await readFile(path.join(directory, entry.name, 'results.json'), 'utf8'));
      if (r.status !== 'completed' || r.environment?.execution !== 'docker-compose') continue;
      const before = r.query_summary?.baseline?.overall;
      const after = r.query_summary?.indexed?.overall;
      if (![before?.p95_ms, after?.p95_ms].every(n => Number.isFinite(n) && n > 0)) continue;
      if (!Array.isArray(r.stock) || !Number.isFinite(r.environment?.fingerprint?.count) || typeof r.environment.source_sha256 !== 'string') continue;
      return {
        run_id: entry.name,
        measured_at: r.started_at, source_sha256: r.environment.source_sha256,
        environment: 'Docker Compose', postgres: r.environment.postgres,
        rows: r.environment.fingerprint.count, before, after,
        ...measurementDetails(r),
        stock: r.stock.map(s => ({ mode: s.mode, round: s.round, accepted: s.accepted,
          rejected: s.rejected, oversold_units: s.oversold_units, errors: s.errors,
          initial_stock:s.initial_stock, remaining_stock:s.remaining_stock,
          conservation_holds:s.conservation_holds }))
      };
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) continue; // Writer may still be saving.
      throw error;
    }
  }
  return null;
}
