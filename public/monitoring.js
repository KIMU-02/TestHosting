(() => {
  const $=id=>document.getElementById(id), fmt=n=>n==null?'—':new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(n);
  const el=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
  function table(id,headers,rows){
    const t=document.createElement('table'),head=document.createElement('thead'),tr=document.createElement('tr'),body=document.createElement('tbody');
    headers.forEach(h=>{const th=el('th',h);th.scope='col';tr.append(th);});head.append(tr);
    rows.forEach(row=>{const r=document.createElement('tr');row.forEach(v=>r.append(el('td',v)));body.append(r);});
    if(!rows.length){const row=document.createElement('tr'),td=el('td','해당 기록이 없습니다.');td.colSpan=headers.length;row.append(td);body.append(row);}
    t.append(head,body);$(id).replaceChildren(t);
  }
  let busy=false;
  async function refresh(){
    if(busy)return;busy=true;$('monitor-refresh').disabled=true;
    try {
      const response=await fetch('/api/monitoring',{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('Unavailable');
      const {api:a,database:d,observed_at}=await response.json();
      $('monitor-data').hidden=false;
      $('monitor-status').textContent=`${new Date(observed_at).toLocaleString('ko-KR')} 조회 · ${d.status!=='available'?'DB 확인 불가':d.lock_waiters?'잠금 대기 있음':a.server_errors?'최근 서버 오류 있음':'조회 완료'}`;
      const cards=[['표본 요청',`${fmt(a.count)}건`],['서버 오류율 · 5xx',a.count?`${fmt(a.server_errors/a.count*100)}%`:'표본 없음'],['운영 응답 p95',a.latency?`${fmt(a.latency.p95_ms)} ms`:'표본 없음'],['현재 처리 중',`${fmt(a.inflight)}건`]];
      $('monitor-cards').replaceChildren(...cards.map(([name,value])=>{const c=document.createElement('article');c.className='bench-score';c.append(el('span',name),el('strong',value));return c;}));
      $('monitor-window').textContent=`API 시작 ${new Date(a.started_at).toLocaleString('ko-KR')} · 누적 완료 ${fmt(a.total_completed)}건 · 응답 전 연결 종료 ${fmt(a.aborted)}건 · 표본 시작 ${a.window_start?new Date(a.window_start).toLocaleString('ko-KR'):'없음'}`;
      table('monitor-routes',['경로','표본','4xx','5xx','평균 ms','p95 ms'],a.routes.map(r=>[r.route,r.count,r.client_errors,r.server_errors,fmt(r.latency?.mean_ms),fmt(r.latency?.p95_ms)]));
      $('monitor-db').textContent=d.status==='available'?`전체 서버 연결 ${d.cluster_connections} / 설정 상한 ${d.max_connections} (관측 연결 포함) · 현재 DB 연결 ${d.database_connections} · 실행 중 ${d.active} · 트랜잭션 열린 채 대기 ${d.idle_in_transaction} · 잠금 대기 ${d.lock_waiters}. 현재 DB 값은 관측 연결을 제외합니다. 설정 상한에는 예약 연결도 포함됩니다.`:'DB 통계를 읽지 못했습니다. 연결·권한·DB 상태를 확인하세요. 이전 값을 표시하지 않습니다.';
      table('monitor-locks',['대기 PID','종류','이벤트','트랜잭션 초','차단 PID'],(d.waiting??[]).map(w=>[w.pid,w.wait_event_type??'—',w.wait_event??'—',fmt(w.transaction_seconds),w.blocking_pids.join(', ')||'없음']));
      table('monitor-errors',['시각','경로','상태','요청 ID'],a.recent_errors.map(r=>[new Date(r.at).toLocaleTimeString('ko-KR'),r.route,r.status,r.request_id]));
    } catch { $('monitor-data').hidden=true;$('monitor-status').textContent='운영 상태를 확인하지 못했습니다. API 실행 상태를 확인하고 다시 조회하세요.'; }
    finally {busy=false;$('monitor-refresh').disabled=false;}
  }
  $('monitor-refresh').onclick=refresh;
  $('monitor-auto').onchange=()=>{if($('monitor-auto').checked)refresh();};
  setInterval(()=>{if($('monitor-auto').checked&&!document.hidden)refresh();},5000);
})();
