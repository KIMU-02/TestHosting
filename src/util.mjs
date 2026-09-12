export const LAB_LOCK = 7429181;

export function integer(value, name, min, max) {
  const n = Number(value);
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !/^\d+$/.test(value)) || !Number.isSafeInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}]`);
  }
  return n;
}

// Nearest-rank percentile. Empty samples are an error, never a fabricated zero.
export function summarize(values) {
  if (!values.length || values.some(x => !Number.isFinite(x) || x < 0)) {
    throw new Error('Expected nonempty finite, nonnegative samples');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return {
    count: sorted.length,
    mean_ms: values.reduce((a, b) => a + b, 0) / values.length,
    p50_ms: percentile(0.5), p95_ms: percentile(0.95),
    min_ms: sorted[0], max_ms: sorted.at(-1)
  };
}

export function barrier(parties, timeout = 15000) {
  integer(parties, 'parties', 1, 64);
  let arrived = 0;
  let release;
  let reject;
  const ready = new Promise((resolve, fail) => { release = resolve; reject = fail; });
  // Attach immediately so a timed-out barrier cannot cause an unhandled rejection.
  ready.catch(() => {});
  const timer = setTimeout(() => reject(new Error('Concurrency barrier timed out')), timeout);
  return async () => {
    if (++arrived === parties) { clearTimeout(timer); release(); }
    return ready;
  };
}

export function stockVerdict(initial, remaining, sold) {
  return {
    initial_stock: initial, remaining_stock: remaining, sold_units: sold,
    oversold_units: Math.max(0, sold - initial),
    conservation_holds: initial === remaining + sold,
    nonnegative_stock: remaining >= 0
  };
}
