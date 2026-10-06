(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pad=n=>String(n).padStart(2,'0');
  const monthNames=['','Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const dayNames=['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
  let data={employees:[],factualDays:[],officialDays:[],intervals:[],issues:[],summary:{},access:{}};
  let busy=false,mode='FACTUAL',drawerDay=null,approval=null,approvalBusy=false,adjustmentBusy=false;

  async function authToken(){
    const client=await window.SHAuth?.createClient?.();
    if(!client)throw new Error('Supabase Auth не готов');
    const r=await client.auth.getSession();
    const t=r?.data?.session?.access_token;
    if(r?.error||!t)throw new Error('Сессия пользователя не найдена');
    return t;
  }
  function setStatus(text,kind=''){
    const el=$('tsStatus');if(!el)return;
    el.textContent=text;el.className=`hr-status ${kind}`.trim();
  }
  function localYmd(d=new Date()){return`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
  function currentMonth(){const d=new Date();return`${d.getFullYear()}-${pad(d.getMonth()+1)}`}
  function monthRange(value){
    const [y,m]=String(value||currentMonth()).split('-').map(Number);
    const last=new Date(y,m,0).getDate();
    return{year:y,month:m,from:`${y}-${pad(m)}-01`,to:`${y}-${pad(m)}-${pad(last)}`,days:last};
  }
  function shiftMonth(value,delta){
    const [y,m]=String(value||currentMonth()).split('-').map(Number);
    const d=new Date(y,m-1+delta,1);
    return`${d.getFullYear()}-${pad(d.getMonth()+1)}`;
  }
  function hours(min){
    const m=Math.max(0,Number(min||0)),h=Math.floor(m/60),r=Math.round(m%60);
    return r?`${h}:${pad(r)}`:String(h);
  }
  function hoursLong(min){
    const m=Math.max(0,Number(min||0)),h=Math.floor(m/60),r=Math.round(m%60);
    return`${h} ч ${pad(r)} мин`;
  }
  function hoursInput(min){const n=Math.max(0,Number(min||0))/60;return Number.isInteger(n)?String(n):String(Math.round(n*100)/100)}
  function inputMinutes(v){if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(v);return Number.isFinite(n)&&n>=0?Math.round(n*60):null}
  function overtimeStatusLabel(v){
    return({NONE:'Не отправлено',DRAFT:'Черновик',MANAGER_SUBMITTED:'Ожидает HR',HR_APPROVED:'Подтверждено HR',HR_CHANGED:'Изменено HR',HR_REJECTED:'Отклонено HR'})[v]||v||'—';
  }
  function overtimeStatusClass(v){
    return({HR_APPROVED:'approved',HR_CHANGED:'changed',HR_REJECTED:'rejected',MANAGER_SUBMITTED:'pending'})[v]||'draft';
  }
  function localDateTime(v){
    if(!v)return'—';
    try{return new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}catch{return String(v)}
  }
  function localTime(v){
    if(!v)return'—';
    try{return new Date(v).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}catch{return String(v)}
  }
  function issueLabel(code){
    return({MISSING_OUT:'Нет отметки выхода',MISSING_IN:'Нет отметки входа',DUPLICATE_IN:'Повторный вход',DUPLICATE_OUT:'Повторный выход',UNKNOWN_EVENT_TYPE:'Неизвестный тип события',INVALID_ORDER:'Выход раньше входа',LONG_INTERVAL:'Интервал больше 15 часов'})[code]||code||'Проверить';
  }
  async function api(){
    const range=monthRange($('tsMonth').value),t=await authToken(),q=new URLSearchParams({from:range.from,to:range.to});
    const fetcher=window.SH_IikoContext?.fetchWithTimeout||fetch;
    const r=await fetcher(`/api/hr/timesheet?${q}`,{headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}},90000);
    const j=await r.json().catch(()=>({success:false,message:'Некорректный ответ API'}));
    if(!r.ok||!j.success)throw new Error(j.message||`HTTP ${r.status}`);
    return j;
  }

  async function adjustmentApi(body){
    const t=await authToken(),fetcher=window.SH_IikoContext?.fetchWithTimeout||fetch;
    const r=await fetcher('/api/hr/timesheet-adjustments',{method:'POST',headers:{Authorization:`Bearer ${t}`,Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(body)},60000);
    const j=await r.json().catch(()=>({success:false,message:'Некорректный ответ API'}));
    if(!r.ok||!j.success)throw new Error(j.message||`HTTP ${r.status}`);
    if(j.access)data.access=j.access;
    return j;
  }
  async function approvalApi(method='GET',body=null){
    const t=await authToken(),fetcher=window.SH_IikoContext?.fetchWithTimeout||fetch,month=$('tsMonth').value,snapshotHash=data?.snapshotHashes?.[mode]||'';
    let url='/api/hr/timesheet-approval';
    const opt={method,headers:{Authorization:`Bearer ${t}`,Accept:'application/json','Content-Type':'application/json'}};
    if(method==='GET'){
      const q=new URLSearchParams({month,contour:mode,snapshotHash});url+=`?${q}`;
    }else{
      opt.body=JSON.stringify({...body,month,contour:mode,snapshotHash});
    }
    const r=await fetcher(url,opt,60000);
    const j=await r.json().catch(()=>({success:false,message:'Некорректный ответ API'}));
    if(!r.ok||!j.success)throw new Error(j.message||`HTTP ${r.status}`);
    return j;
  }

  function approvalDate(v){
    if(!v)return'—';
    try{return new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}catch{return String(v)}
  }
  function renderApproval(){
    const a=approval||{status:'DRAFT'},status=a.status||'DRAFT',badge=$('tsApprovalBadge'),title=$('tsApprovalTitle'),meta=$('tsApprovalMeta'),access=data.access||{};
    const managerDone=Boolean(a.manager),hrDone=Boolean(a.hr)&&status==='HR_APPROVED';
    if($('tsAccessBadge'))$('tsAccessBadge').textContent=`Роль: ${access.label||'Владелец'}`;
    $('tsManagerStep')?.classList.toggle('done',managerDone);
    $('tsManagerStep')?.classList.toggle('current',status==='DRAFT'||status==='STALE');
    $('tsHrStep')?.classList.toggle('done',hrDone);
    $('tsHrStep')?.classList.toggle('current',status==='MANAGER_APPROVED');
    $('tsPayrollStep')?.classList.toggle('done',status==='HR_APPROVED');
    $('tsManagerMeta').textContent=a.manager?`${a.manager.label} · ${approvalDate(a.manager.at)}`:'Ожидает подтверждения';
    $('tsHrMeta').textContent=a.hr?`${a.hr.label} · ${approvalDate(a.hr.at)}`:(status==='MANAGER_APPROVED'?'Ожидает HR':'После менеджера');
    if($('tsApprovalComment'))$('tsApprovalComment').value=a.comment||'';

    if(status==='HR_APPROVED'){
      title.textContent='Табель утверждён HR';meta.textContent='Эта версия готова для следующего слоя Payroll.';
      badge.textContent='Утверждён';badge.className='ts-approval-badge hr';
    }else if(status==='MANAGER_APPROVED'){
      title.textContent='Менеджер подтвердил';meta.textContent='Ожидается утверждение HR.';
      badge.textContent='Менеджер ✓';badge.className='ts-approval-badge manager';
    }else if(status==='STALE'){
      title.textContent='Табель изменился';meta.textContent='После подтверждения изменились Face ID, график, отпуск или другие данные. Нужно подтвердить заново.';
      badge.textContent='Нужно заново';badge.className='ts-approval-badge stale';
    }else{
      title.textContent='Черновик';meta.textContent='Менеджер ещё не подтвердил текущую версию табеля.';
      badge.textContent='Черновик';badge.className='ts-approval-badge draft';
    }

    $('tsManagerApprove').disabled=approvalBusy||!access.canManagerApprove||status==='MANAGER_APPROVED'||status==='HR_APPROVED';
    $('tsHrApprove').disabled=approvalBusy||!access.canHrApprove||status!=='MANAGER_APPROVED';
    $('tsReopen').disabled=approvalBusy||!access.canReopen||status==='DRAFT'||(status==='HR_APPROVED'&&!access.canHrApprove);
    $('tsManagerApprove').title=access.canManagerApprove?'':'Доступно роли Manager / Owner';
    $('tsHrApprove').title=access.canHrApprove?'':'Доступно роли HR / Owner';
  }
  async function loadApproval(){
    try{
      approvalBusy=true;renderApproval();
      const r=await approvalApi('GET');approval=r.approval||{status:'DRAFT'};if(r.access)data.access=r.access;
    }catch(e){
      console.error(e);approval={status:'DRAFT',comment:''};
    }finally{approvalBusy=false;renderApproval()}
  }
  async function approvalAction(action){
    if(approvalBusy)return;
    try{
      approvalBusy=true;renderApproval();setStatus('Сохраняем подтверждение…','loading');
      const r=await approvalApi('POST',{action,comment:$('tsApprovalComment')?.value||''});
      approval=r.approval||approval;if(r.access)data.access=r.access;renderApproval();setStatus('Готово','ok');
    }catch(e){
      console.error(e);setStatus(e?.message||'Ошибка подтверждения','error');alert(e?.message||'Ошибка подтверждения');
    }finally{approvalBusy=false;renderApproval()}
  }

  function selectedEmployee(){return $('tsEmployee')?.value||''}
  function selectedRole(){return $('tsRole')?.value||''}
  function searchText(){return String($('tsSearch')?.value||'').trim().toLowerCase()}
  function problemStatuses(){return mode==='FACTUAL'?new Set(['ABSENT','REVIEW','LEAVE_WITH_WORK','WORK_REST','NO_SCHEDULE','WORK_NO_SCHEDULE']):new Set([])}
  function dayList(){return mode==='FACTUAL'?(data.factualDays||[]):(data.officialDays||[])}

  function employeeDaysMap(){
    const map=new Map();
    for(const x of dayList()){
      if(!map.has(x.employeeId))map.set(x.employeeId,new Map());
      map.get(x.employeeId).set(x.workDate,x);
    }
    return map;
  }
  function filteredEmployees(){
    const empId=selectedEmployee(),role=selectedRole(),q=searchText(),problemsOnly=Boolean($('tsProblemsOnly')?.checked),pSet=problemStatuses(),byEmp=employeeDaysMap();
    return (data.employees||[]).filter(e=>{
      if(e.deleted)return false;
      if(empId&&e.id!==empId)return false;
      if(role&&e.roleCode!==role)return false;
      if(q&&!String(`${e.name} ${e.code} ${e.roleName}`).toLowerCase().includes(q))return false;
      if(problemsOnly){
        const days=byEmp.get(e.id);
        if(!days||![...days.values()].some(x=>pSet.has(x.status)||Number(x.issueCount||0)>0||(Number(x.overtimeCandidateMinutes||0)>0&&!['HR_APPROVED','HR_CHANGED'].includes(x.overtimeStatus||''))))return false;
      }
      return true;
    }).sort((a,b)=>String(a.name||a.code).localeCompare(String(b.name||b.code),'ru'));
  }

  function renderFilters(){
    const role=$('tsRole'),emp=$('tsEmployee'),roleSelected=role.value,empSelected=emp.value;
    const roles=[...new Map((data.employees||[]).filter(x=>!x.deleted&&x.roleCode).map(x=>[x.roleCode,{code:x.roleCode,name:x.roleName||x.roleCode}])).values()]
      .sort((a,b)=>a.name.localeCompare(b.name,'ru'));
    role.innerHTML='<option value="">Все должности</option>'+roles.map(x=>`<option value="${esc(x.code)}">${esc(x.name)}</option>`).join('');
    if(roles.some(x=>x.code===roleSelected))role.value=roleSelected;
    const active=(data.employees||[]).filter(x=>!x.deleted).sort((a,b)=>String(a.name||a.code).localeCompare(String(b.name||b.code),'ru'));
    emp.innerHTML='<option value="">Все сотрудники</option>'+active.map(x=>`<option value="${esc(x.id)}">${esc(x.name||x.code)}${x.code?' · № '+esc(x.code):''}</option>`).join('');
    if(active.some(x=>x.id===empSelected))emp.value=empSelected;
  }

  function dayView(x){
    if(!x)return{code:'',sub:'',cls:'future',label:'Нет данных'};
    if(mode==='FACTUAL'){
      const map={
        WORK:['Р',hours(x.workedMinutes),'work','Работа'],
        WORK_REST:['РВ',hours(x.workedMinutes),'holiday','Работа в выходной'],
        LEAVE:['ƏM','', 'leave','Отпуск'],
        LEAVE_WITH_WORK:['ƏM+Р',hours(x.workedMinutes),'review','Отпуск + работа'],
        ABSENT:['Y','', 'absent','Нет'],
        REST:['İ','', 'rest','Выходной'],
        NO_SCHEDULE:['—','', 'no-schedule','График не задан'],
        WORK_NO_SCHEDULE:['Р?',hours(x.workedMinutes),'review','Работа без графика'],
        REVIEW:['!',hours(x.workedMinutes),'review','Проверить'],
        FUTURE:['·','', 'future','Будущая дата']
      };
      const v=map[x.status]||['?',hours(x.workedMinutes),'review',x.status||'Неизвестно'];
      return{code:v[0],sub:v[1],cls:v[2],label:v[3]};
    }
    const map={
      WORK:['Р',hours(x.plannedMinutes),'work','Работа'],
      WORK_HOLIDAY:['РП',hours(x.plannedMinutes),'holiday','Работа в праздник'],
      LEAVE:['ƏM','', 'leave','Отпуск'],
      REST:['İ','', 'rest','Выходной']
    };
    const v=map[x.status]||['?',hours(x.plannedMinutes),'review',x.status||'Неизвестно'];
    return{code:v[0],sub:v[1],cls:v[2],label:v[3]};
  }

  function buildEmployeeTotals(days){
    if(mode==='FACTUAL'){
      return{
        work:days.filter(x=>['WORK','WORK_REST','WORK_NO_SCHEDULE','REVIEW','LEAVE_WITH_WORK'].includes(x.status)&&Number(x.workedMinutes||0)>0).length,
        plan:days.reduce((s,x)=>s+Number(x.plannedMinutes||0),0),
        fact:days.reduce((s,x)=>s+Number(x.workedMinutes||0),0),
        norm:days.reduce((s,x)=>s+Number(x.normMinutes||0),0),
        overtimeCandidate:days.reduce((s,x)=>s+Number(x.overtimeCandidateMinutes||0),0),
        overtimeApproved:days.reduce((s,x)=>s+Number(x.approvedOvertimeMinutes||0),0),
        overtimePayroll:days.reduce((s,x)=>s+Number(x.payrollOvertimeMinutes||0),0),
        overtimeUnpaid:days.reduce((s,x)=>s+Number(x.unpaidOvertimePotentialMinutes||0),0),
        overtimePending:days.reduce((s,x)=>s+(Number(x.overtimeCandidateMinutes||0)>0&&!['HR_APPROVED','HR_CHANGED','HR_REJECTED'].includes(x.overtimeStatus||'')?Number(x.overtimeRequestedMinutes||x.overtimeCandidateMinutes||0):0),0),
        extraDays:days.reduce((s,x)=>s+Number(x.overtimeDayEquivalent||0),0),
        leave:days.filter(x=>x.status==='LEAVE').length,
        absent:days.filter(x=>x.status==='ABSENT').length,
        rest:days.filter(x=>x.status==='REST').length,
        issues:days.filter(x=>['REVIEW','LEAVE_WITH_WORK','WORK_REST','WORK_NO_SCHEDULE'].includes(x.status)||Number(x.issueCount||0)>0||(Number(x.overtimeCandidateMinutes||0)>0&&!['HR_APPROVED','HR_CHANGED'].includes(x.overtimeStatus||''))).length
      };
    }
    return{
      work:days.filter(x=>['WORK','WORK_HOLIDAY'].includes(x.status)).length,
      plan:days.reduce((s,x)=>s+Number(x.plannedMinutes||0),0),
      leave:days.filter(x=>x.status==='LEAVE').length,
      rest:days.filter(x=>x.status==='REST').length,
      holiday:days.filter(x=>x.status==='WORK_HOLIDAY').length
    };
  }

  function renderSummary(){
    const employees=filteredEmployees(),ids=new Set(employees.map(x=>x.id)),rows=dayList().filter(x=>ids.has(x.employeeId));
    if(mode==='FACTUAL'){
      const t=buildEmployeeTotals(rows),noSchedule=rows.filter(x=>x.status==='NO_SCHEDULE').length;
      $('tsSummary').innerHTML=[
        ['Сотрудников',employees.length,'по текущему фильтру'],
        ['Факт',hoursLong(t.fact),'все фактически отработанные часы'],
        ['Норма',hoursLong(t.norm),'учитываемые нормативные часы'],
        ['Доп. часы HR',hoursLong(t.overtimeApproved),'только подтверждённые HR'],
        ['Ожидает HR',hoursLong(t.overtimePending),'ещё не подтверждено'],
        ['Неоплач. доп.',hoursLong(t.overtimeUnpaid),'между нормой и порогом оплаты'],
        ['Рабочих дней',t.work,'с фактическим временем'],
        ['Отпуск',t.leave,'дней'],
        ['Y / Нет',t.absent,'рабочих дней без отметок'],
        ['Нет графика',noSchedule,'не считаются отсутствием']
      ].map(x=>`<article class="ts-summary-item"><span>${esc(x[0])}</span><strong>${esc(x[1])}</strong><small>${esc(x[2])}</small></article>`).join('');
    }else{
      const t=buildEmployeeTotals(rows);
      $('tsSummary').innerHTML=[
        ['Сотрудников',employees.length,'по текущему фильтру'],
        ['План',hoursLong(t.plan),'по графику'],
        ['Рабочих дней',t.work,'по плану'],
        ['Отпуск',t.leave,'официальных дней'],
        ['Выходных',t.rest,'по графику'],
        ['Работа в праздник',t.holiday,'дней']
      ].map(x=>`<article class="ts-summary-item"><span>${esc(x[0])}</span><strong>${esc(x[1])}</strong><small>${esc(x[2])}</small></article>`).join('');
    }
  }

  function renderMatrix(){
    const range=monthRange($('tsMonth').value),employees=filteredEmployees(),byEmp=employeeDaysMap(),today=localYmd();
    const days=Array.from({length:range.days},(_,i)=>i+1);
    $('tsMatrixTitle').textContent=mode==='FACTUAL'?'Фактический табель':'Официальный табель';
    $('tsMatrixSub').textContent=`${monthNames[range.month]} ${range.year} · клик по ячейке открывает детали дня`;
    $('tsMatrixCount').textContent=`${employees.length} сотрудников`;

    const totalHeads=mode==='FACTUAL'
      ?['Раб. дни','План','Факт','Норма','Доп.ч','Ожид.','Неопл.','Отп.','Y','İ','Пров.']
      :['Раб. дни','План','Отп.','İ','Празд.'];

    $('tsMatrixHead').innerHTML=`<tr>
      <th class="ts-employee-head">Сотрудник</th>
      ${days.map(d=>{
        const date=`${range.year}-${pad(range.month)}-${pad(d)}`,dow=new Date(`${date}T00:00:00Z`).getUTCDay(),weekend=dow===0||dow===6;
        return `<th class="ts-day-head ${weekend?'weekend':''} ${date===today?'today':''}"><b>${d}</b><span>${dayNames[dow]}</span></th>`;
      }).join('')}
      ${totalHeads.map(x=>`<th class="ts-total-head">${esc(x)}</th>`).join('')}
    </tr>`;

    if(!employees.length){
      $('tsMatrixBody').innerHTML=`<tr class="ts-empty-row"><td colspan="${1+range.days+totalHeads.length}">По выбранным фильтрам сотрудников нет.</td></tr>`;
      return;
    }

    $('tsMatrixBody').innerHTML=employees.map(e=>{
      const map=byEmp.get(e.id)||new Map(),employeeDays=[...map.values()],totals=buildEmployeeTotals(employeeDays);
      const cells=days.map(d=>{
        const date=`${range.year}-${pad(range.month)}-${pad(d)}`,x=map.get(date),v=dayView(x);
        const overtimePending=x&&Number(x.overtimeCandidateMinutes||0)>0&&!['HR_APPROVED','HR_CHANGED'].includes(x.overtimeStatus||'');
        const problems=x&&(Number(x.issueCount||0)>0||['REVIEW','LEAVE_WITH_WORK','WORK_REST','WORK_NO_SCHEDULE'].includes(x.status)||overtimePending);
        const title=x?`${e.name} · ${date} · ${v.label}${v.sub?' · '+v.sub:''}${x.overtimeCandidateMinutes>0?' · доп. '+hours(x.overtimeCandidateMinutes)+' ч':''}${x.corrected?' · ручная корректировка':''}`:`${e.name} · ${date}`;
        return `<td class="ts-day-cell ${v.cls} ${x?.corrected?'corrected':''}" data-employee-id="${esc(e.id)}" data-date="${date}" title="${esc(title)}"><div class="ts-day-box"><span class="ts-day-code">${esc(v.code)}</span>${v.sub?`<span class="ts-day-sub">${esc(v.sub)}</span>`:''}</div>${problems?'<i class="problem-dot"></i>':''}${x?.corrected?'<i class="correction-dot"></i>':''}${x&&Number(x.overtimeCandidateMinutes||0)>0?`<span class="overtime-mini">+${esc(hours(x.overtimeCandidateMinutes))}</span>`:''}</td>`;
      }).join('');
      const totalsHtml=mode==='FACTUAL'
        ?`<td class="ts-total-cell">${totals.work}</td><td class="ts-total-cell">${esc(hours(totals.plan))}</td><td class="ts-total-cell emph">${esc(hours(totals.fact))}</td><td class="ts-total-cell">${esc(hours(totals.norm))}</td><td class="ts-total-cell overtime-ok">${esc(hours(totals.overtimeApproved))}</td><td class="ts-total-cell overtime-wait">${esc(hours(totals.overtimePending))}</td><td class="ts-total-cell">${esc(hours(totals.overtimeUnpaid))}</td><td class="ts-total-cell">${totals.leave}</td><td class="ts-total-cell">${totals.absent}</td><td class="ts-total-cell">${totals.rest}</td><td class="ts-total-cell">${totals.issues}</td>`
        :`<td class="ts-total-cell">${totals.work}</td><td class="ts-total-cell emph">${esc(hours(totals.plan))}</td><td class="ts-total-cell">${totals.leave}</td><td class="ts-total-cell">${totals.rest}</td><td class="ts-total-cell">${totals.holiday}</td>`;
      return `<tr>
        <td class="ts-employee-cell"><a class="ts-employee-main" href="/hr-employee.html?id=${encodeURIComponent(e.id)}">${esc(e.name||e.code||'—')}</a><span class="ts-employee-meta">${e.code?'№ '+esc(e.code):''}${e.roleName?' · '+esc(e.roleName):''}</span></td>
        ${cells}${totalsHtml}
      </tr>`;
    }).join('');
  }

  function renderIntervals(){
    const ids=new Set(filteredEmployees().map(x=>x.id)),list=(data.intervals||[]).filter(x=>ids.has(x.employeeId));
    $('tsIntervalCount').textContent=`${list.length} интервалов`;
    $('tsIntervalRows').innerHTML=list.length?list.map(x=>`<tr><td>${esc(x.workDate)}</td><td class="text-left"><div class="hr-name">${esc(x.employeeName||'—')}</div><div class="hr-sub">${x.employeeCode?'№ '+esc(x.employeeCode):''}</div></td><td>${esc(localDateTime(x.startTime))}</td><td>${esc(localDateTime(x.endTime))}</td><td><strong>${esc(hoursLong(x.durationMinutes))}</strong></td><td><span class="hr-badge ${x.status==='OK'?'active':'pending'}">${x.status==='OK'?'Корректно':'Проверить'}</span></td></tr>`).join(''):'<tr><td colspan="6" class="hr-empty">Интервалов за выбранный месяц нет</td></tr>';
  }

  function renderIssues(){
    const ids=new Set(filteredEmployees().map(x=>x.id)),list=(data.issues||[]).filter(x=>ids.has(x.employeeId));
    $('tsIssueCount').textContent=`${list.length} ошибок`;
    $('tsIssueRows').innerHTML=list.length?list.map(x=>`<tr><td>${esc(localDateTime(x.eventTime))}</td><td class="text-left"><div class="hr-name">${esc(x.employeeName||'—')}</div><div class="hr-sub">${x.employeeCode?'№ '+esc(x.employeeCode):''}</div></td><td><span class="hr-badge pending">${esc(issueLabel(x.code))}</span>${x.durationMinutes?`<div class="hr-sub">${esc(hoursLong(x.durationMinutes))}</div>`:''}</td><td><code class="hr-event-code">${esc(x.eventId||'—')}</code></td></tr>`).join(''):'<tr><td colspan="4" class="hr-empty">Проблем Face ID за выбранный месяц нет</td></tr>';
  }

  function renderMode(){
    const factual=mode==='FACTUAL';
    $('tsFactualTab').classList.toggle('active',factual);
    $('tsOfficialTab').classList.toggle('active',!factual);
    renderSummary();renderMatrix();renderIntervals();renderIssues();
  }
  function render(){renderFilters();renderMode();renderApproval()}

  function findDay(employeeId,date){
    return dayList().find(x=>x.employeeId===employeeId&&x.workDate===date)||null;
  }
  function employeeById(id){return(data.employees||[]).find(x=>x.id===id)||null}

  function detailBox(label,value){
    return `<div class="ts-detail-box"><span>${esc(label)}</span><strong>${esc(value||'—')}</strong></div>`;
  }
  function openDrawer(employeeId,date){
    const employee=employeeById(employeeId),x=findDay(employeeId,date),v=dayView(x);
    drawerDay={employeeId,date};
    $('tsDrawerTitle').textContent=employee?.name||'Сотрудник';
    $('tsDrawerSub').textContent=`${date} · ${employee?.roleName||'Без должности'}`;
    $('tsDrawerEmployee').href=`/hr-employee.html?id=${encodeURIComponent(employeeId)}`;

    if(!x){
      $('tsDrawerBody').innerHTML='<div class="ts-detail-note">На эту дату сотрудник ещё не был активен в выбранном контуре или данных нет.</div>';
    }else if(mode==='FACTUAL'){
      const issueItems=(data.issues||[]).filter(i=>i.employeeId===employeeId&&i.workDate===date);
      $('tsDrawerBody').innerHTML=`
        <div class="ts-detail-status"><div><span>Статус</span><strong>${esc(v.label)}</strong></div><b class="lg ${v.cls}">${esc(v.code)}</b></div>
        <div class="ts-detail-grid">
          ${detailBox('График',x.scheduleConfigured?(x.scheduleName||'График должности'):'Не задан')}
          ${detailBox('Смена',x.shiftStart&&x.shiftEnd?`${x.shiftStart}–${x.shiftEnd}`:'—')}
          ${detailBox('План',hoursLong(x.plannedMinutes))}
          ${detailBox('Факт',hoursLong(x.workedMinutes))}
          ${detailBox('Первый вход',localTime(x.firstIn))}
          ${detailBox('Последний выход',localTime(x.lastOut))}
          ${detailBox('Источник графика',x.scheduleSource==='EMPLOYEE'?'Индивидуальный':x.scheduleSource==='ROLE'?'Должность':'—')}
          ${detailBox('Ошибок Face ID',String(x.issueCount||0))}
        </div>
        ${x.leaveName?`<div class="ts-detail-note"><strong>Отпуск:</strong> ${esc(x.leaveName)}${x.leaveNote?'<br>'+esc(x.leaveNote):''}</div>`:''}
        ${x.scheduleOverrideNote?`<div class="ts-detail-note"><strong>Комментарий к индивидуальному графику:</strong><br>${esc(x.scheduleOverrideNote)}</div>`:''}
        ${issueItems.length?`<div class="ts-detail-note"><strong>Проблемы Face ID:</strong><br>${issueItems.map(i=>esc(issueLabel(i.code))).join('<br>')}</div>`:''}
      `;
    }else{
      $('tsDrawerBody').innerHTML=`
        <div class="ts-detail-status"><div><span>Статус</span><strong>${esc(v.label)}</strong></div><b class="lg ${v.cls}">${esc(v.code)}</b></div>
        <div class="ts-detail-grid">
          ${detailBox('График',x.scheduleName||'Производственный календарь')}
          ${detailBox('Смена',x.shiftStart&&x.shiftEnd?`${x.shiftStart}–${x.shiftEnd}`:'—')}
          ${detailBox('План',hoursLong(x.plannedMinutes))}
          ${detailBox('Перерыв',x.breakMinutes?`${x.breakMinutes} мин`:'—')}
          ${detailBox('Источник графика',x.scheduleSource==='EMPLOYEE'?'Индивидуальный':x.scheduleSource==='ROLE'?'Должность':'Календарь')}
          ${detailBox('Календарь',x.calendarName||'—')}
        </div>
        ${x.leaveName?`<div class="ts-detail-note"><strong>Официальный отпуск:</strong> ${esc(x.leaveName)}${x.leaveNote?'<br>'+esc(x.leaveNote):''}</div>`:''}
        ${x.scheduleOverrideNote?`<div class="ts-detail-note"><strong>Комментарий к индивидуальному графику:</strong><br>${esc(x.scheduleOverrideNote)}</div>`:''}
      `;
    }
    $('tsDayDrawer').hidden=false;
    document.body.style.overflow='hidden';
  }
  function closeDrawer(){
    $('tsDayDrawer').hidden=true;
    document.body.style.overflow='';
    drawerDay=null;
  }

  function csvValue(v){
    const s=String(v??'');
    return /[;"\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
  }
  function exportCsv(){
    const range=monthRange($('tsMonth').value),employees=filteredEmployees(),byEmp=employeeDaysMap(),days=Array.from({length:range.days},(_,i)=>i+1);
    const headers=['Сотрудник','Табельный №','Должность',...days.map(d=>String(d))];
    if(mode==='FACTUAL')headers.push('Рабочих дней','План часов','Факт часов','Отпуск','Y/Нет','Выходные','Проверить');
    else headers.push('Рабочих дней','План часов','Отпуск','Выходные','Работа в праздник');
    const lines=[headers.map(csvValue).join(';')];
    for(const e of employees){
      const map=byEmp.get(e.id)||new Map(),rows=[e.name||'',e.code||'',e.roleName||''];
      const empDays=[...map.values()],totals=buildEmployeeTotals(empDays);
      for(const d of days){
        const date=`${range.year}-${pad(range.month)}-${pad(d)}`,v=dayView(map.get(date));
        rows.push(v.code+(v.sub?` ${v.sub}`:''));
      }
      if(mode==='FACTUAL')rows.push(totals.work,(totals.plan/60).toFixed(2),(totals.fact/60).toFixed(2),totals.leave,totals.absent,totals.rest,totals.issues);
      else rows.push(totals.work,(totals.plan/60).toFixed(2),totals.leave,totals.rest,totals.holiday);
      lines.push(rows.map(csvValue).join(';'));
    }
    const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a'),url=URL.createObjectURL(blob);
    a.href=url;a.download=`SmartHoreca_Tabel_${$('tsMonth').value}_${mode==='FACTUAL'?'fact':'official'}.csv`;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  async function load(){
    if(busy)return;
    const err=$('tsError');
    try{
      busy=true;$('tsRefresh').disabled=true;err.hidden=true;setStatus('Загрузка месяца…','loading');
      data=await api();approval=null;render();await loadApproval();setStatus('Готово','ok');
    }catch(e){
      console.error(e);err.hidden=false;err.textContent=e?.message||String(e);setStatus('Ошибка','error');
    }finally{busy=false;$('tsRefresh').disabled=false}
  }

  function onFilter(){renderMode()}
  async function setMode(next){mode=next;if(mode==='OFFICIAL'&&$('tsProblemsOnly'))$('tsProblemsOnly').checked=false;closeDrawer();approval=null;renderMode();renderApproval();await loadApproval()}
  function changeMonth(delta){$('tsMonth').value=shiftMonth($('tsMonth').value,delta);load()}

  function bind(){
    $('tsRefresh').onclick=load;
    $('tsMonth').onchange=load;
    $('tsPrevMonth').onclick=()=>changeMonth(-1);
    $('tsNextMonth').onclick=()=>changeMonth(1);
    $('tsTodayMonth').onclick=()=>{$('tsMonth').value=currentMonth();load()};
    $('tsRole').onchange=onFilter;
    $('tsEmployee').onchange=onFilter;
    $('tsSearch').oninput=onFilter;
    $('tsProblemsOnly').onchange=onFilter;
    $('tsFactualTab').onclick=()=>setMode('FACTUAL');
    $('tsOfficialTab').onclick=()=>setMode('OFFICIAL');
    $('tsMatrixBody').addEventListener('click',e=>{
      const cell=e.target.closest('.ts-day-cell');if(cell)openDrawer(cell.dataset.employeeId,cell.dataset.date);
    });
    document.querySelectorAll('[data-drawer-close]').forEach(x=>x.addEventListener('click',closeDrawer));
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('tsDayDrawer').hidden)closeDrawer()});
    $('tsExport').onclick=exportCsv;
    $('tsPrint').onclick=()=>window.print();
    $('tsManagerApprove').onclick=()=>approvalAction('MANAGER_APPROVE');
    $('tsHrApprove').onclick=()=>approvalAction('HR_APPROVE');
    $('tsReopen').onclick=()=>approvalAction('REOPEN');
  }

  async function init(){
    $('tsMonth').value=currentMonth();
    bind();
    await load();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();