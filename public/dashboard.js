const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('ko-KR');
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents) / 100);
const date = value => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
let products = [], busy = false, overviewReady = false, orderRequest = 0;
let pending = null;
try { pending = JSON.parse(sessionStorage.getItem('pending-order')); } catch {}
function savePending(value) { sessionStorage.setItem('pending-order',JSON.stringify(value)); pending = value; }
if (pending) {
  $('customer').value=pending.body.customer_id; $('quantity').value=pending.body.quantity;
  message('order-message','이전 주문의 응답이 확인되지 않았습니다. 재시도하면 같은 주문을 확인합니다.');
}
async function api(route, options = {}) {
  const response = await fetch(route, { ...options, signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error); error.status = response.status; throw error; }
  return data;
}
function message(id, text, error = false) { const el = $(id); el.textContent = text; el.className = `notice${error ? ' error' : ''}`; el.hidden = !text; }
function updateTotal() {
  const p = products.find(p => p.id === Number($('product').value));
  const q = Number($('quantity').value);
  $('total').textContent = p && Number.isInteger(q) && q > 0 ? money(p.price_cents * q) : '—';
  $('product-detail').textContent = p ? `${money(p.price_cents)} / 개 · 남은 재고 ${number.format(p.stock)}개` : '등록된 상품이 없습니다.';
  for (const id of ['customer','quantity','product']) $(id).disabled = busy || !!pending;
  $('submit-order').disabled = busy || !overviewReady || !p || (!pending && p.stock === 0);
  $('submit-order').textContent = busy ? '주문 처리 중…' : pending ? '같은 주문으로 재시도 →' : p?.stock === 0 ? '품절된 상품입니다' : '주문 생성하기 →';
}
async function overview() {
  try {
    const data = await api('/api/overview');
    const selected = $('product').value;
    products = data.products; overviewReady = true;
    $('stock').textContent = number.format(products.reduce((sum,p) => sum + p.stock, 0));
    $('checkout-count').textContent = number.format(data.checkout.orders);
    $('sold').textContent = number.format(data.checkout.units);
    $('history').textContent = number.format(data.history_orders);
    $('product').replaceChildren(...products.map(p => new Option(p.name, p.id)));
    if (products.some(p => String(p.id) === selected)) $('product').value = selected;
    if (pending) $('product').value = pending.body.product_id;
    $('product').disabled = !products.length;
    $('connection').textContent = 'API · DB 연결됨'; $('connection').className = 'pill green';
    $('updated').textContent = `${date(data.refreshed_at)} 기준 · 수동 새로고침`;
    message('global-error', '');
  } catch (error) {
    overviewReady = false;
    for (const id of ['stock','checkout-count','sold','history']) $(id).textContent = '—';
    $('connection').textContent = error.status === 503 ? '실험 진행 중' : '연결 확인 필요'; $('connection').className = 'pill red';
    $('updated').textContent = '최신 데이터를 확인하지 못했습니다.';
    message('global-error', error.status === 503 ? '성능 실험 중에는 주문과 조회가 잠시 중지됩니다. 완료 후 새로고침해 주세요.' : '서버에 연결할 수 없습니다. Docker Desktop에서 프로젝트가 실행 중인지 확인하고 새로고침해 주세요.', true);
  }
  updateTotal();
}
async function orders() {
  const request = ++orderRequest;
  const customer = $('filter-customer').value;
  const empty = text => { const row = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 5; td.className = 'empty'; td.textContent = text; row.append(td); $('orders-body').replaceChildren(row); };
  empty('주문을 불러오는 중입니다.'); $('list-count').textContent = '조회 중';
  try {
    const data = await api(`/api/orders?customer_id=${encodeURIComponent(customer)}`);
    if (request !== orderRequest) return;
    $('list-subtitle').textContent = `고객 ${customer} · 최신 50건 · 한국 시간`;
    $('list-count').textContent = `${data.length}건 표시`;
    if (!data.length) return empty('이 고객의 주문이 없습니다. 새 주문을 만들어 보세요.');
    $('orders-body').replaceChildren(...data.map(order => {
      const tr = document.createElement('tr');
      const id = document.createElement('td'); id.textContent = `#${order.id}`;
      const source = document.createElement('small'); source.textContent = order.source === 'history' ? '실험 데이터' : '직접 생성'; id.append(source);
      const status = document.createElement('td'); const badge = document.createElement('span'); badge.className = `pill ${order.status === 'paid' ? 'green' : 'neutral'}`; badge.textContent = order.status === 'paid' ? '결제 완료' : '취소'; status.append(badge);
      if (order.source === 'checkout' && order.status === 'paid') {
        const cancel = document.createElement('button'); cancel.type='button'; cancel.textContent='주문 취소';
        cancel.setAttribute('aria-label',`주문 ${order.id} 취소`);
        cancel.onclick = async () => {
          cancel.disabled=true;
          try {
            await api(`/orders/${order.id}/cancel`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer_id:order.customer_id})});
            message('order-message',`주문 #${order.id} 취소 완료. 재고가 복원되었습니다.`);
            await Promise.all([overview(),orders()]);
          } catch { message('order-message','취소 결과를 확인하지 못했습니다. 다시 취소해도 재고는 한 번만 복원됩니다.',true); cancel.disabled=false; }
        };
        status.append(cancel);
      }
      tr.append(id, status);
      for (const value of [`${order.quantity}개`, money(order.total_cents), date(order.created_at)]) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
      return tr;
    }));
  } catch (error) { if (request !== orderRequest) return; empty(error.status === 503 ? '실험 진행 중입니다. 잠시 후 조회해 주세요.' : '주문을 불러오지 못했습니다. 다시 조회해 주세요.'); $('list-count').textContent = '조회 실패'; }
}
async function measurements() {
  try {
    const { measurement: r } = await api('/api/measurements');
    $('measurement-content').hidden = !r;
    $('export-csv').disabled = $('export-summary').disabled = !r;
    if (!r) { $('measurement-state').textContent = '완료된 Docker 측정 기록이 없습니다. 실험을 완료하면 이곳에 표시됩니다.'; return; }
    $('measurement-state').textContent = `${r.environment} · ${date(r.measured_at)} 측정`;
    $('before-ms').textContent = `${r.before.p95_ms.toFixed(3)} ms`; $('after-ms').textContent = `${r.after.p95_ms.toFixed(3)} ms`;
    const max = Math.max(r.before.p95_ms, r.after.p95_ms);
    $('before-bar').style.width = `${r.before.p95_ms / max * 100}%`; $('after-bar').style.width = `${r.after.p95_ms / max * 100}%`;
    const unsafe = r.stock.filter(s => s.mode === 'unsafe'), safe = r.stock.filter(s => s.mode === 'safe');
    const range = trials => { if (!trials.length) return '기록 없음'; const values = trials.map(t => t.oversold_units); const min = Math.min(...values), max = Math.max(...values); return min === max ? `${min}개` : `${min}~${max}개`; };
    $('unsafe-sold').textContent = range(unsafe); $('safe-sold').textContent = range(safe);
    $('stock-rounds').textContent = `구현별 ${unsafe.length} / ${safe.length}회 시험 · 회차별 초과 판매 수량`;
    $('measurement-meta').replaceChildren(...[`${number.format(r.rows)}건 데이터`, `조회 ${r.before.count} / ${r.after.count}회`, '단일 연결 · 동일 SQL', `측정 코드 ${r.source_sha256.slice(0,12)}`].map(t => { const span = document.createElement('span'); span.textContent = t; return span; }));
    window.renderBenchmarkDetails(r);
  } catch { $('measurement-content').hidden = true; $('export-csv').disabled = $('export-summary').disabled = true; $('measurement-state').textContent = '측정 기록을 불러오지 못했습니다. 새로고침해 주세요.'; }
}
$('quantity').addEventListener('input', updateTotal); $('product').addEventListener('change', updateTotal);
$('filter-form').addEventListener('submit', event => { event.preventDefault(); orders(); });
$('order-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !overviewReady) return;
  busy = true; updateTotal(); message('order-message', '');
  const customer = Number($('customer').value);
  try {
    if (!pending) savePending({key:crypto.randomUUID(),body:{ customer_id: customer, product_id: Number($('product').value), quantity: Number($('quantity').value) }});
    const result = await api('/orders', { method: 'POST', headers: { 'Content-Type': 'application/json','Idempotency-Key':pending.key }, body: JSON.stringify(pending.body) });
    savePending(null);
    message('order-message', `주문 #${result.id} ${result.replayed ? '기존 요청 확인 완료' : '생성 완료'}. 현재 상태는 주문 목록에서 확인할 수 있습니다.`);
    $('filter-customer').value = customer;
    await Promise.all([overview(), orders()]);
  } catch (error) {
    if ([400,409].includes(error.status)) savePending(null);
    const text = error.status === 409 ? '재고가 부족하거나 상품을 찾을 수 없습니다. 수량과 현재 재고를 확인해 주세요.' : error.status === 503 ? '실험 진행 중에는 주문할 수 없습니다. 완료 후 다시 시도해 주세요.' : error.status === 400 ? '고객 번호와 주문 수량을 올바른 정수로 입력해 주세요.' : '주문 응답을 확인하지 못했습니다. 중복 주문을 피하려면 주문 목록을 확인한 뒤 다시 시도해 주세요.';
    message('order-message', pending ? '응답을 확인하지 못했습니다. 같은 주문으로 재시도 버튼을 누르면 중복 생성 없이 결과를 확인합니다.' : text, true); await overview();
  } finally { busy = false; updateTotal(); }
});
$('refresh').addEventListener('click', async () => { $('refresh').disabled = true; try { await Promise.all([overview(), orders(), measurements()]); } finally { $('refresh').disabled = false; } });
Promise.all([overview(), orders(), measurements()]);
