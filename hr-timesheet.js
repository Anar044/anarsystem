(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let data={employees:[],factualDays:[],officialDays:[],intervals:[],issues:[],summary:{}},busy=false,mode='FACTUAL';

  async function authToken(){const client=await window.SHAuth?.createClient?.();if(!client)throw new Error('Supabase Auth не готов');const r=await client.auth.getSession();const t=r?.data?.session?.access_token;if(r?.error||!t)throw new Error('Сессия пользователя не найдена');return t}
  function setStatus(text,kind=''){const el=$('tsStatus');if(!el)return;el.textContent=text;el.className=`hr-status ${kind}`.trim()}
  const pad=n=>String(n).padStart(2,'0');
  function localYmd(d=new Date()){return`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
  function monthStart(){const d=new Date();return`${d.getFullYear()}-${pad(d.getMonth()+1)}-01`}
  function localDateTime(v){if(!v)return'—';try{return new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}catch{return String(v)}}
  function localTime(v){if(!v)return'—';try{return new Date(v).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}catch{return String(v)}}
  function hours(min){const m=Math.max(0,Number(min||0)),h=Math.floor(m/60),r=Math.round(m%60);return`${h} ч ${String(r).padStart(2,'0')} мин`}
  function issueLabel(code){return({MISSING_OUT:'Нет отметки выхода',MISSING_IN:'Нет отметки входа',DUPLICATE_IN:'Повторный вход',DUPLICATE_OUT:'Повторный выход',UNKNOWN_EVENT_TYPE:'Неизвестный тип события',INVALID_ORDER:'Выход раньше входа',LONG_INTERVAL:'Интервал больше 15 часов'})[code]||code||'Проверить'}
  function factualStatus(x){
    if(x.status==='LEAVE')return['leave','Отпуск'];
    if(x.status==='LEAVE_WITH_WORK')return['review','Отпуск + работа'];
    if(x.status==='ABSENT')return['absent','Y / Нет'];
    if(x.status==='REVIEW')return['review','Проверить'];
    return['work','Работа'];
  }
  function officialStatus(x){
    if(x.status==='LEAVE')return['leave','ƏM · Отпуск'];
    if(x.status==='REST')return['rest','İ · Выходной'];
    if(x.status==='WORK_HOLIDAY')return['holiday','Работа в праздник'];
    return['work','Работа'];
  }
  async function api(){
    const t=await authToken(),q=new URLSearchParams({from:$('tsFrom').value,to:$('tsTo').value});
    const r=await (window.SH_IikoContext?.fetchWithTimeout||fetch)(`/api/hr/timesheet?${q}`,{headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}},90000);
    const j=await r.json().catch(()=>({success:false,message:'Некорректный ответ API'}));
    if(!r.ok||!j.success)throw new Error(j.message||`HTTP ${r.status}`);
    return j;
  }
  function selectedEmployee(){return $('tsEmployee')?.value||''}
  function filtered(list){const id=selectedEmployee();return id?(list||[]).filter(x=>x.employeeId===id):(list||[])}

  function renderEmployeeSelector(){
    const el=$('tsEmployee'),selected=el.value;const active=(data.employees||[]).filter(x=>!x.deleted);
    el.innerHTML='<option value="">Все сотрудники</option>'+active.map(x=>`<option value="${esc(x.id)}">${esc(x.name||x.code)}${x.code?' · № '+esc(x.code):''}</option>`).join('');
    if(active.some(x=>x.id===selected))el.value=selected;
  }

  function renderSummary(){
    if(mode==='FACTUAL'){
      const rows=filtered(data.factualDays),worked=rows.filter(x=>x.workedMinutes>0),leave=rows.filter(x=>x.status==='LEAVE'),absent=rows.filter(x=>x.status==='ABSENT'),review=rows.filter(x=>['REVIEW','LEAVE_WITH_WORK'].includes(x.status));
      const mins=worked.reduce((s,x)=>s+Number(x.workedMinutes||0),0);
      $('tsSummary').innerHTML=`<article class="hr-summary-card"><span>Фактически отработано</span><strong class="hr-text-value">${esc(hours(mins))}</strong><small>${worked.length} дней с Face ID временем</small></article><article class="hr-summary-card"><span>Фактический отпуск</span><strong>${leave.length}</strong><small>Дней отпуска из карточек сотрудников</small></article><article class="hr-summary-card"><span>Y / Нет</span><strong>${absent.length}</strong><small>Нет Face ID отметок и нет отпуска</small></article><article class="hr-summary-card"><span>Требует проверки</span><strong>${review.length}</strong><small>Ошибки или работа во время отпуска</small></article>`;
    }else{
      const rows=filtered(data.officialDays),work=rows.filter(x=>['WORK','WORK_HOLIDAY'].includes(x.status)),leave=rows.filter(x=>x.status==='LEAVE'),rest=rows.filter(x=>x.status==='REST');
      const mins=rows.reduce((s,x)=>s+Number(x.plannedMinutes||0),0);
      $('tsSummary').innerHTML=`<article class="hr-summary-card"><span>Плановые часы</span><strong class="hr-text-value">${esc(hours(mins))}</strong><small>По графику и норме сотрудника</small></article><article class="hr-summary-card"><span>Рабочие дни</span><strong>${work.length}</strong><small>Включая работу в праздник</small></article><article class="hr-summary-card"><span>Официальный отпуск</span><strong>${leave.length}</strong><small>Из официального контура карточки</small></article><article class="hr-summary-card"><span>İ / Выходной</span><strong>${rest.length}</strong><small>По графику / производственному календарю</small></article>`;
    }
  }

  function renderFactual(){
    const list=filtered(data.factualDays);$('tsFactualCount').textContent=`${list.length} строк`;
    $('tsFactualRows').innerHTML=list.length?list.map(x=>{
      const [cls,label]=factualStatus(x);
      const leave=x.leaveName?`<span class="ts-leave-name">${esc(x.leaveName)}</span>${x.leaveNote?`<span class="ts-leave-note" title="${esc(x.leaveNote)}">${esc(x.leaveNote)}</span>`:''}`:'—';
      return `<tr><td>${esc(x.workDate)}</td><td class="text-left"><div class="hr-name"><a class="ts-employee-link" href="/hr-employee.html?id=${encodeURIComponent(x.employeeId)}">${esc(x.employeeName||'—')}</a></div><div class="hr-sub">${x.employeeCode?'№ '+esc(x.employeeCode):''}${x.roleName?' · '+esc(x.roleName):''}</div></td><td><span class="ts-status ${cls}">${esc(label)}</span></td><td>${x.firstIn?esc(localTime(x.firstIn)):'—'}</td><td>${x.lastOut?esc(localTime(x.lastOut)):'—'}</td><td><strong>${esc(hours(x.workedMinutes))}</strong></td><td>${leave}</td><td>${Number(x.issueCount||0)?`<span class="hr-badge pending">${Number(x.issueCount||0)}</span>`:'0'}</td></tr>`;
    }).join(''):'<tr><td colspan="8" class="hr-empty">За выбранный период фактический табель пуст</td></tr>';
  }

  function renderOfficial(){
    const list=filtered(data.officialDays);$('tsOfficialCount').textContent=`${list.length} строк`;
    $('tsOfficialRows').innerHTML=list.length?list.map(x=>{
      const [cls,label]=officialStatus(x);
      const shift=x.shiftStart&&x.shiftEnd?`${esc(x.shiftStart)}–${esc(x.shiftEnd)}`:'—';
      const leave=x.leaveName?`<span class="ts-leave-name">${esc(x.leaveName)}</span>${x.leaveNote?`<span class="ts-leave-note" title="${esc(x.leaveNote)}">${esc(x.leaveNote)}</span>`:''}`:'—';
      const calendar=x.calendarName?`${esc(x.calendarName)}${x.calendarType&&x.calendarType!=='WORKDAY'?`<span class="ts-cell-sub">${esc(x.calendarType)}</span>`:''}`:'—';
      return `<tr><td>${esc(x.workDate)}</td><td class="text-left"><div class="hr-name"><a class="ts-employee-link" href="/hr-employee.html?id=${encodeURIComponent(x.employeeId)}">${esc(x.employeeName||'—')}</a></div><div class="hr-sub">${x.employeeCode?'№ '+esc(x.employeeCode):''}${x.roleName?' · '+esc(x.roleName):''}</div></td><td><span class="ts-status ${cls}">${esc(label)}</span></td><td class="ts-official-plan"><strong>${esc(hours(x.plannedMinutes))}</strong></td><td>${shift}${x.breakMinutes?`<span class="ts-cell-sub">перерыв ${Number(x.breakMinutes)} мин</span>`:''}</td><td>${esc(x.scheduleName||'—')}<span class="ts-cell-sub">${x.scheduleSource==='ROLE'?'График должности':'Производственный календарь'}</span></td><td>${leave}</td><td>${calendar}</td></tr>`;
    }).join(''):'<tr><td colspan="8" class="hr-empty">За выбранный период официальный табель пуст</td></tr>';
  }

  function renderIntervals(){
    const list=filtered(data.intervals);$('tsIntervalCount').textContent=`${list.length} интервалов`;
    $('tsIntervalRows').innerHTML=list.length?list.map(x=>`<tr><td>${esc(x.workDate)}</td><td class="text-left"><div class="hr-name">${esc(x.employeeName||'—')}</div><div class="hr-sub">${x.employeeCode?'№ '+esc(x.employeeCode):''}</div></td><td>${esc(localDateTime(x.startTime))}</td><td>${esc(localDateTime(x.endTime))}</td><td><strong>${esc(hours(x.durationMinutes))}</strong></td><td><span class="hr-badge ${x.status==='OK'?'active':'pending'}">${x.status==='OK'?'Корректно':'Проверить'}</span></td></tr>`).join(''):'<tr><td colspan="6" class="hr-empty">Корректные пары IN → OUT пока не найдены</td></tr>';
  }

  function renderIssues(){
    const list=filtered(data.issues);$('tsIssueCount').textContent=`${list.length} ошибок`;
    $('tsIssueRows').innerHTML=list.length?list.map(x=>`<tr><td>${esc(localDateTime(x.eventTime))}</td><td class="text-left"><div class="hr-name">${esc(x.employeeName||'—')}</div><div class="hr-sub">${x.employeeCode?'№ '+esc(x.employeeCode):''}</div></td><td><span class="hr-badge pending">${esc(issueLabel(x.code))}</span>${x.durationMinutes?`<div class="hr-sub">${esc(hours(x.durationMinutes))}</div>`:''}</td><td><code class="hr-event-code">${esc(x.eventId||'—')}</code></td></tr>`).join(''):'<tr><td colspan="4" class="hr-empty">Ошибок журнала за выбранный период нет</td></tr>';
  }

  function renderMode(){
    const factual=mode==='FACTUAL';
    $('tsFactualTab').classList.toggle('active',factual);$('tsOfficialTab').classList.toggle('active',!factual);
    $('tsFactualPanel').hidden=!factual;$('tsOfficialPanel').hidden=factual;
    renderSummary();
  }
  function render(){renderEmployeeSelector();renderFactual();renderOfficial();renderIntervals();renderIssues();renderMode()}

  async function load(){
    if(busy)return;const err=$('tsError');
    try{busy=true;$('tsRefresh').disabled=true;err.hidden=true;setStatus('Пересчитываем…','loading');data=await api();render();setStatus('Готово','ok')}
    catch(e){console.error(e);err.hidden=false;err.textContent=e?.message||String(e);setStatus('Ошибка','error')}
    finally{busy=false;$('tsRefresh').disabled=false}
  }
  function setMode(next){mode=next;renderMode()}
  function bind(){
    $('tsRefresh').onclick=load;$('tsFrom').onchange=load;$('tsTo').onchange=load;
    $('tsEmployee').onchange=()=>{renderFactual();renderOfficial();renderIntervals();renderIssues();renderSummary()};
    $('tsFactualTab').onclick=()=>setMode('FACTUAL');$('tsOfficialTab').onclick=()=>setMode('OFFICIAL');
  }
  async function init(){$('tsFrom').value=monthStart();$('tsTo').value=localYmd();bind();await load()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
