(() => {
  const $ = id => document.getElementById(id);
  const fmt = n => Number.isFinite(Number(n)) && n != null ? Number(n).toLocaleString('ko-KR', {maximumFractionDigits:3}) : '—';
  const ms = n => `${fmt(n)} ms`;
  const el = (tag, text, cls) => { const node = document.createElement(tag); if(text != null) node.textContent = text; if(cls) node.className = cls; return node; };
  const table = (heads, rows) => {
    const t = el('table'); const head=el('thead'), tr=el('tr');
    heads.forEach(text => {const th=el('th',text); th.scope='col'; tr.append(th);}); head.append(tr);t.append(head);
    const body=el('tbody');rows.forEach(values => {const row=el('tr');values.forEach(v=>row.append(el('td',v)));body.append(row);});t.append(body);return t;
  };
  const ratio = (before,after) => before > 0 && after > 0 ? `${fmt(before / after)}배` : '—';
  let record;
  function plans() {
    const id = $('bench-customer').value === 'all' ? (record.customers[0]?.id ?? '1') : $('bench-customer').value;
    const before = record.segments.find(s=>s.variant === 'baseline' && s.plans[id]);
    const after = record.segments.find(s=>s.variant === 'indexed' && s.plans[id]);
    $('plan-context').textContent = `고객 ${id}의 첫 전·후 구간에서 수집한 계획입니다. 전체 고객 혼합을 선택하면 첫 고객의 계획을 표시합니다.`;
    $('plan-comparison').replaceChildren(...[['인덱스 전',before],['인덱스 후',after]].map(([label,segment])=> {
      const card=el('article',null,'plan-card');card.append(el('h4',label));
      const p=segment?.plans[id];
      if(!p){card.append(el('p','실행 계획 기록 없음'));return card;}
      card.append(el('p',`구간 ${segment.segment} · 실행 ${ms(p.execution_ms)}`,'field-note'));
      const list=el('ol',null,'plan-tree');
      p.nodes.forEach(n=>{const li=el('li');li.style.paddingLeft=`${n.depth * 14}px`;li.append(el('code',`${n.parallel?'Parallel ':''}${n.type}`));if(n.heap_fetches != null)li.append(el('small',`힙 접근 ${fmt(n.heap_fetches)}회`)); list.append(li);});card.append(list);
      card.append(el('p',`버퍼 적중 ${fmt(p.hit_blocks)} · 읽기 ${fmt(p.read_blocks)} 블록`,'field-note'));
      const size=segment.sizes?.candidate_index_bytes;
      card.append(el('p',`후보 인덱스 ${size != null ? fmt(Number(size)/1024/1024)+' MiB' : '기록 없음'}`,'field-note'));return card;
    }));
  }
  function selection() {
    if(!record)return;
    const customer=record.customers.find(c=>c.id === $('bench-customer').value);
    const before=customer?.before ?? record.before, after=customer?.after ?? record.after;
    const key=$('bench-metric').value, label={p95_ms:'p95',p50_ms:'p50',mean_ms:'평균'}[key];
    const b=before[key], a=after[key], reduction=b>0?(1-a/b)*100:null;
    $('metric-explanation').textContent = {p95_ms:'측정 요청의 약 95%가 이 시간 이내에 완료되었습니다.',p50_ms:'측정 요청을 시간순으로 정렬했을 때 가운데에 해당하는 값입니다.',mean_ms:'모든 측정 요청의 소요 시간을 더해 요청 수로 나눈 값입니다.'}[key];
    $('chart-title').textContent=`최근 주문 조회 · ${label}`;
    $('before-ms').textContent=ms(b);$('after-ms').textContent=ms(a);
    const max=Math.max(b,a);$('before-bar').style.width=`${b/max*100}%`;$('after-bar').style.width=`${a/max*100}%`;
    $('bench-scorecards').replaceChildren(...[
      [`${label} 감소율`,reduction != null ? `${fmt(Math.abs(reduction))}%` : '—',reduction>=0?'동일 조건의 전후 비교':'응답 시간이 증가했습니다'],
      ['전 / 후 시간 비율',ratio(b,a),'1보다 클수록 개선'],
      ['비교한 요청 수',`${fmt(before.count)} / ${fmt(after.count)}`,'인덱스 전 / 인덱스 후'],
      ['조회 결과 일치',record.results_match?'확인 완료':'확인 불가','전체 원본 표본의 고객별 해시 비교']
    ].map(([label,value,note],i)=>{const card=el('article',null,i===0?'bench-score accent':'bench-score');card.append(el('span',label),el('strong',value),el('small',note));return card;}));
    if(reduction<0)$('bench-scorecards').firstChild.firstChild.textContent=`${label} 증가율`;
    $('bench-stats').replaceChildren(table(['지표','인덱스 전','인덱스 후'],[['평균',ms(before.mean_ms),ms(after.mean_ms)],['p50',ms(before.p50_ms),ms(after.p50_ms)],['p95',ms(before.p95_ms),ms(after.p95_ms)]]));
    plans();
  }
  window.renderBenchmarkDetails = r => {
    record=r; r.customers ??=[];r.segments ??=[];r.samples ??=[];r.conditions ??={};
    const selected=$('bench-customer').value;
    $('bench-customer').replaceChildren(new Option('전체 고객 혼합','all'),...r.customers.map(c=>new Option(`고객 ${c.id}`,c.id)));
    if(r.customers.some(c=>c.id===selected))$('bench-customer').value=selected;
    $('bench-customer').onchange=selection;$('bench-metric').onchange=selection;
    const max=Math.max(0,...r.segments.map(s=>s.summary.p95_ms));
    const columns=el('div',null,'segment-columns');
    r.segments.forEach(s=>{const col=el('div',null,'segment-col');col.append(el('strong',fmt(s.summary.p95_ms)));const track=el('div',null,'segment-track'),bar=el('div',null,`segment-bar ${s.variant==='baseline'?'before':'after'}`);bar.style.height=`${max>0?s.summary.p95_ms/max*100:0}%`;track.append(bar);col.append(track,el('span',`${s.segment} · ${s.variant==='baseline'?'전':'후'}`));columns.append(col);});
    $('segment-chart').replaceChildren(el('p',`공통 축 0 – ${ms(max)}`,'axis-label'),columns);
    $('segment-note').textContent=r.segments.length?`${r.segments.length}개 구간 · 각 ${fmt(r.segments[0].summary.count)}회 측정. 숫자는 각 구간의 p95(ms)입니다.`:'반복 구간 기록 없음';
    $('customer-comparison').replaceChildren(table(['고객','전 p95','후 p95','전 / 후'],r.customers.map(c=>[c.id,ms(c.before.p95_ms),ms(c.after.p95_ms),ratio(c.before.p95_ms,c.after.p95_ms)])));
    $('stock-context').textContent=`초기 재고 ${fmt(r.conditions.initial_stock)}개 · 동시 요청 ${fmt(r.conditions.concurrency)}개. 같은 재고를 읽고 쓰도록 순서를 제어한 정합성 시험입니다. 처리량 시험이 아닙니다.`;
    $('stock-trials').replaceChildren(table(['회차','구현','승인','품절','초과 판매','잔여 재고','오류','재고 보존'],r.stock.map(s=>[s.round,s.mode==='safe'?'개선 후':'개선 전',s.accepted,s.rejected,s.oversold_units,s.remaining_stock,s.errors,s.conservation_holds===true?'성립':s.conservation_holds===false?'불성립':'—'])));
    const setting = name => {const s=r.conditions.settings?.find(s=>s.name===name);return s?`${s.setting}${s.unit?' '+s.unit:''}`:'기록 없음';};
    const conditions=[['데이터 규모',`${fmt(r.rows)}건`],['동시 조회 연결',`${fmt(r.conditions.clients)}개`],['구간별 워밍업',`${fmt(r.conditions.warmup)}회`],['ABBA 반복',`${fmt(r.conditions.rounds)}회`],['PostgreSQL',r.postgres],['Node.js',r.conditions.node ?? '기록 없음'],['실행 환경',r.conditions.platform ?? r.environment],['work_mem',setting('work_mem')],['shared_buffers',setting('shared_buffers')],['JIT',setting('jit')],['측정 코드 SHA-256',r.source_sha256]];
    $('bench-conditions').replaceChildren(...conditions.flatMap(([key,value])=>[el('dt',key),el('dd',value)]));
    $('export-csv').disabled=!r.samples.length;
    $('export-csv').onclick=()=>{ window.location.href=`/api/measurements.csv?run=${encodeURIComponent(r.run_id)}`; };
    $('export-summary').onclick=()=>{ window.location.href=`/api/measurements.json?run=${encodeURIComponent(r.run_id)}`; };
    selection();
  };
})();
