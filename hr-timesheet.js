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
    return({MISSING_OUT:'Нет отметки выхода',MISSING_IN:'Нет отметки входа',MISSING_PAIR:'Только одна пробивка за смену',DUPLICATE_MARK:'Повторная пробивка менее чем через 10 секунд',DUPLICATE_IN:'Повторный вход',DUPLICATE_OUT:'Повторный выход',UNKNOWN_EVENT_TYPE:'Неизвестный тип события',INVALID_ORDER:'Выход раньше входа',LONG_INTERVAL:'Интервал больше 15 часов'})[code]||code||'Проверить';
  }
  async function digestText(text){
    try{
      const bytes=new TextEncoder().encode(String(text||'')),hash=await crypto.subtle.digest('SHA-256',bytes);
      return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
    }catch{return String(text||'').slice(0,128)}
  }
  function normalizeRuleRow(x){
    return{
      employeeId:String(x?.employeeId??x?.iiko_employee_id??''),
      thresholdMinutes:Number(x?.thresholdMinutes??x?.threshold_minutes??600),
      payableFromMinutes:Number(x?.payableFromMinutes??x?.payable_from_minutes??600),
      note:String(x?.note||''),
      updatedAt:String(x?.updatedAt??x?.updated_at??'')
    };
  }
  function ruleFor(employeeId,rules){
    const specific=rules.find(x=>x.employeeId===String(employeeId)),global=rules.find(x=>x.employeeId==='*'),base=specific||global||null;
    const threshold=Math.max(1,Number(base?.thresholdMinutes||600));
    const payable=Math.max(threshold,Number(base?.payableFromMinutes||threshold));
    return{thresholdMinutes:threshold,payableFromMinutes:payable,source:specific?'EMPLOYEE':global?'GLOBAL':'DEFAULT',note:base?.note||''};
  }
  function applyCorrection(day,c){
    if(!c)return{...day,corrected:false,correction:null,rawStatus:day.status,rawWorkedMinutes:Number(day.workedMinutes||0),rawPlannedMinutes:Number(day.plannedMinutes||0)};
    const out={...day,corrected:true,correction:c,rawStatus:day.status,rawWorkedMinutes:Number(day.workedMinutes||0),rawPlannedMinutes:Number(day.plannedMinutes||0)};
    if(c.statusOverride)out.status=c.statusOverride;
    if(Number(c.workedMinutesOverride)>=0)out.workedMinutes=Number(c.workedMinutesOverride);
    if(Number(c.plannedMinutesOverride)>=0)out.plannedMinutes=Number(c.plannedMinutesOverride);
    return out;
  }
  async function loadAdjustmentOverlay(range,t){
    const fetcher=window.SH_IikoContext?.fetchWithTimeout||fetch,q=new URLSearchParams({from:range.from,to:range.to});
    const r=await fetcher(`/api/hr/timesheet-adjustments?${q}`,{headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}},30000);
    const j=await r.json().catch(()=>({success:false,message:'Некорректный ответ API корректировок'}));
    if(!r.ok||!j.success)throw new Error(j.message||`HTTP ${r.status}`);
    return j;
  }
  async function mergeAdjustmentOverlay(base,overlay){
    const corrections=new Map((overlay.corrections||[]).map(x=>[`${x.employeeId}|${x.workDate}|${x.contour||'FACTUAL'}`,x]));
    const overtime=new Map((overlay.overtime||[]).map(x=>[`${x.employeeId}|${x.workDate}`,x]));
    const rules=(overlay.rules||[]).map(normalizeRuleRow);
    base.access=overlay.access||base.access||{};
    base.overtimeRules=rules;
    base.factualDays=(base.factualDays||[]).map(day=>{
      let x=applyCorrection(day,corrections.get(`${day.employeeId}|${day.workDate}|FACTUAL`));
      const rule=ruleFor(day.employeeId,rules),worked=Math.max(0,Number(x.workedMinutes||0)),candidate=Math.max(0,worked-rule.thresholdMinutes),payableCandidate=Math.max(0,worked-rule.payableFromMinutes);
      const req=overtime.get(`${day.employeeId}|${day.workDate}`)||null,approvedState=Boolean(req&&['HR_APPROVED','HR_CHANGED'].includes(req.status));
      const approved=approvedState?Math.min(candidate,Math.max(0,Number(req.approvedMinutes||0))):0;
      x={
        ...x,normMinutes:Math.min(worked,rule.thresholdMinutes),overtimeThresholdMinutes:rule.thresholdMinutes,overtimePayableFromMinutes:rule.payableFromMinutes,
        overtimeRuleSource:rule.source,overtimeRuleNote:rule.note,overtimeCandidateMinutes:candidate,overtimePayableCandidateMinutes:payableCandidate,
        unpaidOvertimePotentialMinutes:Math.max(0,candidate-payableCandidate),overtimeStatus:req?.status||'NONE',overtimeRequestedMinutes:Number(req?.requestedMinutes||0),
        approvedOvertimeMinutes:approved,payrollOvertimeMinutes:Math.min(approved,payableCandidate),overtimeManagerReason:req?.managerReason||'',
        overtimeHrComment:req?.hrComment||'',overtimeManager:req?.manager||null,overtimeHr:req?.hr||null,overtimeRequestId:req?.id||'',
        overtimeDayEquivalent:rule.thresholdMinutes>0?approved/rule.thresholdMinutes:0
      };
      return x;
    });
    base.officialDays=(base.officialDays||[]).map(day=>applyCorrection(day,corrections.get(`${day.employeeId}|${day.workDate}|OFFICIAL`)));
    const overlayVersion=JSON.stringify({
      corrections:(overlay.corrections||[]).map(x=>[x.id,x.employeeId,x.workDate,x.contour,x.statusOverride,x.workedMinutesOverride,x.plannedMinutesOverride,x.updatedAt]),
      overtime:(overlay.overtime||[]).map(x=>[x.id,x.employeeId,x.workDate,x.status,x.requestedMinutes,x.approvedMinutes,x.updatedAt]),
      rules:rules.map(x=>[x.employeeId,x.thresholdMinutes,x.payableFromMinutes,x.updatedAt])
    });
    const addon=await digestText(overlayVersion);
    base.snapshotHashes={
      FACTUAL:await digestText(`${base.snapshotHashes?.FACTUAL||''}|${addon}|FACTUAL`),
      OFFICIAL:await digestText(`${base.snapshotHashes?.OFFICIAL||''}|${addon}|OFFICIAL`)
    };
    return base;
  }
  async function api(){
    const range=monthRange($('tsMonth').value),t=await authToken(),q=new URLSearchParams({from:range.from,to:range.to});
    const fetcher=window.SH_IikoContext?.fetchWithTimeout||fetch;
    const r=await fetcher(`/api/hr/timesheet?${q}`,{headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}},90000);
    const j=await r.json().catch(()=>({success:false,message:'Некорректный ответ API'}));
    if(!r.ok||!j.success)throw new Error(j.message||`HTTP ${r.status}`);
    try{
      const overlay=await loadAdjustmentOverlay(range,t);
      return await mergeAdjustmentOverlay(j,overlay);
    }catch(error){
      console.warn('HR adjustment overlay unavailable:',error);
      j.access=j.access||{role:'OWNER',label:'Владелец',canManagerApprove:true,canHrApprove:true,canReopen:true,canCorrect:true,canSetOvertimeRule:true,canViewPayroll:true};
      j.overtimeRules=[];
      j.factualDays=(j.factualDays||[]).map(x=>({...x,rawStatus:x.status,rawWorkedMinutes:Number(x.workedMinutes||0),rawPlannedMinutes:Number(x.plannedMinutes||0),corrected:false,correction:null,normMinutes:Math.min(Number(x.workedMinutes||0),600),overtimeThresholdMinutes:600,overtimePayableFromMinutes:600,overtimeRuleSource:'DEFAULT',overtimeCandidateMinutes:Math.max(0,Number(x.workedMinutes||0)-600),overtimePayableCandidateMinutes:Math.max(0,Number(x.workedMinutes||0)-600),unpaidOvertimePotentialMinutes:0,overtimeStatus:'NONE',overtimeRequestedMinutes:0,approvedOvertimeMinutes:0,payrollOvertimeMinutes:0,overtimeManagerReason:'',overtimeHrComment:'',overtimeRequestId:'',overtimeDayEquivalent:0}));
      j.officialDays=(j.officialDays||[]).map(x=>({...x,rawStatus:x.status,rawWorkedMinutes:0,rawPlannedMinutes:Number(x.plannedMinutes||0),corrected:false,correction:null}));
      return j;
    }
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
  function problemStatuses(){
    if(mode!=='FACTUAL')return new Set([]);
    return new Set(faceIdConnected()?['INCOMPLETE','REVIEW','LEAVE_WITH_WORK']:['REVIEW','LEAVE_WITH_WORK']);
  }
  function dayList(){return mode==='FACTUAL'?(data.factualDays||[]):(data.officialDays||[])}
  function faceIdConnected(){return Array.isArray(data.devices)&&data.devices.length>0}

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
        ABSENT:faceIdConnected()?['Y','', 'absent','Нет']:['—','', 'manual-empty','Факт не введён'],
        INCOMPLETE:['!','', 'absent','Неполная явка'],
        FREE_NO_MARKS:['·','', 'manual-empty','Нет пробивок'],
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
        work:days.filter(x=>['WORK','REVIEW','LEAVE_WITH_WORK'].includes(x.status)&&Number(x.workedMinutes||0)>0).length,
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
      const t=buildEmployeeTotals(rows),noSchedule=rows.filter(x=>x.status==='NO_SCHEDULE').length,connected=faceIdConnected();
      $('tsSummary').innerHTML=[
        ['Сотрудников',employees.length,'по текущему фильтру'],
        ['Факт',hoursLong(t.fact),connected?'Face ID + ручные корректировки':'ручной ввод до подключения Face ID'],
        ['Норма',hoursLong(t.norm),'учитываемые нормативные часы'],
        ['Доп. часы HR',hoursLong(t.overtimeApproved),'только подтверждённые HR'],
        ['Ожидает HR',hoursLong(t.overtimePending),'ещё не подтверждено'],
        ['Неоплач. доп.',hoursLong(t.overtimeUnpaid),'между нормой и порогом оплаты'],
        ['Рабочих дней',t.work,'с фактическим временем'],
        ['Отпуск',t.leave,'дней'],
        connected?['Y / Нет',t.absent,'рабочих дней без отметок']:['Режим учёта','Ручной','Face ID пока не подключён'],
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

  function renderOvertime(){
    const card=document.querySelector('.ts-overtime-card');
    if(!card)return;
    if(mode!=='FACTUAL'){card.hidden=true;return}
    card.hidden=false;
    const ids=new Set(filteredEmployees().map(x=>x.id));
    const rows=(data.factualDays||[]).filter(x=>ids.has(x.employeeId)&&(Number(x.overtimeCandidateMinutes||0)>0||x.overtimeStatus&&x.overtimeStatus!=='NONE')).sort((a,b)=>String(a.workDate).localeCompare(String(b.workDate))||String(a.employeeName).localeCompare(String(b.employeeName),'ru'));
    const approved=rows.filter(x=>x.overtimeStatus==='HR_APPROVED').length,changed=rows.filter(x=>x.overtimeStatus==='HR_CHANGED').length,rejected=rows.filter(x=>x.overtimeStatus==='HR_REJECTED').length,pending=rows.filter(x=>x.overtimeStatus==='MANAGER_SUBMITTED').length,notSent=rows.filter(x=>!x.overtimeStatus||x.overtimeStatus==='NONE').length;
    $('tsOvertimeCount').textContent=`${rows.length} записей`;
    $('tsOvertimeStats').innerHTML=[
      ['Не отправлено',notSent,'manager'],
      ['Ожидает HR',pending,'pending'],
      ['Подтверждено',approved,'approved'],
      ['Изменено HR',changed,'changed'],
      ['Отклонено',rejected,'rejected']
    ].map(x=>`<article class="ts-ot-stat ${x[2]}"><span>${esc(x[0])}</span><strong>${x[1]}</strong></article>`).join('');
    const globalRule=(data.overtimeRules||[]).find(x=>x.employeeId==='*')||{thresholdMinutes:600,payableFromMinutes:600,note:''};
    const access=data.access||{};
    $('tsGlobalOvertimeRule').innerHTML=`
      <div class="ts-global-rule-copy">
        <strong>Общее правило дополнительных часов</strong>
        <small>Используется для сотрудников без индивидуального правила. Индивидуальная настройка в карточке дня имеет приоритет.</small>
      </div>
      <div class="ts-global-rule-fields">
        <label><span>Доп. часы после, ч</span><input id="tsGlobalOtThreshold" type="number" min="0.25" max="24" step="0.25" value="${esc(hoursInput(globalRule.thresholdMinutes))}" ${access.canSetOvertimeRule?'':'disabled'}></label>
        <label><span>Оплачивать после, ч</span><input id="tsGlobalOtPayable" type="number" min="0.25" max="24" step="0.25" value="${esc(hoursInput(globalRule.payableFromMinutes))}" ${access.canSetOvertimeRule?'':'disabled'}></label>
        <label class="ts-global-note"><span>Комментарий</span><input id="tsGlobalOtNote" type="text" maxlength="1000" value="${esc(globalRule.note||'')}" placeholder="Например: стандарт 10 часов" ${access.canSetOvertimeRule?'':'disabled'}></label>
        ${access.canSetOvertimeRule?'<button id="tsSaveGlobalOtRule" type="button" class="hr-link-button">Сохранить правило</button>':'<span class="ts-permission-note">Изменение доступно HR / Owner</span>'}
      </div>`;
    if($('tsSaveGlobalOtRule'))$('tsSaveGlobalOtRule').onclick=()=>{
      const threshold=inputMinutes($('tsGlobalOtThreshold')?.value),payable=inputMinutes($('tsGlobalOtPayable')?.value);
      if(threshold===null||payable===null)return alert('Проверьте общее правило дополнительных часов');
      runAdjustment({action:'SAVE_OVERTIME_RULE',employeeId:'',thresholdMinutes:threshold,payableFromMinutes:payable,note:$('tsGlobalOtNote')?.value||''},'Общее правило дополнительных часов сохранено');
    };
    $('tsOvertimeRows').innerHTML=rows.length?rows.map(x=>`
      <tr>
        <td>${esc(x.workDate)}</td>
        <td class="text-left"><div class="hr-name">${esc(x.employeeName||'—')}</div><div class="hr-sub">${esc(x.roleName||'')}</div></td>
        <td><strong>${esc(hours(x.workedMinutes))}</strong></td>
        <td>${esc(hours(x.overtimeThresholdMinutes))}</td>
        <td><strong>${esc(hours(x.overtimeCandidateMinutes))}</strong></td>
        <td><span class="ts-ot-badge ${overtimeStatusClass(x.overtimeStatus)}">${esc(x.overtimeStatus==='NONE'?'Не отправлено':x.overtimeStatus==='MANAGER_SUBMITTED'?'Отправлено':'Есть решение')}</span>${x.overtimeManagerReason?`<div class="hr-sub ts-ot-reason">${esc(x.overtimeManagerReason)}</div>`:''}</td>
        <td><span class="ts-ot-badge ${overtimeStatusClass(x.overtimeStatus)}">${esc(overtimeStatusLabel(x.overtimeStatus))}</span>${x.overtimeHrComment?`<div class="hr-sub ts-ot-reason">${esc(x.overtimeHrComment)}</div>`:''}</td>
        <td><strong class="${Number(x.payrollOvertimeMinutes||0)>0?'ts-payroll-ot':''}">${esc(hours(x.payrollOvertimeMinutes))}</strong></td>
        <td><button type="button" class="hr-link-button ts-open-day" data-employee-id="${esc(x.employeeId)}" data-date="${esc(x.workDate)}">Открыть</button></td>
      </tr>`).join(''):'<tr><td colspan="9" class="hr-empty">Дополнительных часов за выбранный месяц нет.</td></tr>';
  }

  function renderMode(){
    const factual=mode==='FACTUAL';
    $('tsFactualTab').classList.toggle('active',factual);
    $('tsOfficialTab').classList.toggle('active',!factual);
    renderSummary();renderMatrix();renderIntervals();renderIssues();renderOvertime();
  }
  function render(){renderFilters();renderMode();renderApproval()}

  function findDay(employeeId,date){
    return dayList().find(x=>x.employeeId===employeeId&&x.workDate===date)||null;
  }
  function employeeById(id){return(data.employees||[]).find(x=>x.id===id)||null}

  function detailBox(label,value){
    return `<div class="ts-detail-box"><span>${esc(label)}</span><strong>${esc(value||'—')}</strong></div>`;
  }
  function correctionStatusOptions(current){
    const list=mode==='FACTUAL'
      ?[['','Автоматически'],['WORK','Работа'],['WORK_REST','Работа в выходной'],['ABSENT','Y / Нет'],['REST','İ / Выходной'],['LEAVE','ƏM / Отпуск'],['LEAVE_WITH_WORK','Отпуск + работа'],['REVIEW','Проверить'],['NO_SCHEDULE','График не задан'],['WORK_NO_SCHEDULE','Работа без графика']]
      :[['','Автоматически'],['WORK','Работа'],['WORK_HOLIDAY','Работа в праздник'],['REST','Выходной'],['LEAVE','Отпуск'],['REVIEW','Проверить']];
    return list.map(([v,l])=>`<option value="${esc(v)}" ${String(current||'')===v?'selected':''}>${esc(l)}</option>`).join('');
  }
  function correctionEditor(x){
    const access=data.access||{},c=x.correction||null;
    const workedValue=c&&Number(c.workedMinutesOverride)>=0?hoursInput(c.workedMinutesOverride):'';
    const plannedValue=c&&Number(c.plannedMinutesOverride)>=0?hoursInput(c.plannedMinutesOverride):'';
    return `
      <section class="ts-edit-card">
        <div class="ts-edit-head"><div><span class="ts-kicker">${mode==='FACTUAL'&&!faceIdConnected()?'РУЧНОЙ УЧЁТ ВРЕМЕНИ':'РУЧНАЯ КОРРЕКТИРОВКА'}</span><strong>${c?'Есть ручные данные':mode==='FACTUAL'&&!faceIdConnected()?'Face ID не подключён':'Автоматический расчёт'}</strong></div>${c?'<span class="ts-ot-badge changed">Изменено вручную</span>':''}</div>
        ${mode==='FACTUAL'&&!faceIdConnected()?'<div class="ts-manual-mode-note"><strong>Ручной режим:</strong> введите фактически отработанные часы. Статус можно оставить «Автоматически» — при факте больше 0 система сохранит день как «Работа». После сохранения дополнительные часы пересчитаются автоматически.</div>':''}
        ${c?`<div class="ts-detail-note"><strong>Последняя причина:</strong> ${esc(c.reason||'—')}<br><small>${esc(c.actorLabel||'')} · ${esc(approvalDate(c.updatedAt))}</small></div>`:''}
        <div class="ts-edit-grid">
          <label><span>Статус</span><select id="tsCorrectionStatus" ${access.canCorrect?'':'disabled'}>${correctionStatusOptions(c?.statusOverride||'')}</select></label>
          <label><span>Факт, часов</span><input id="tsCorrectionWorked" type="number" min="0" max="24" step="0.25" value="${esc(workedValue)}" placeholder="Авто: ${esc(hoursInput(x.rawWorkedMinutes??x.workedMinutes))}" ${mode==='FACTUAL'&&access.canCorrect?'':'disabled'}></label>
          <label><span>План, часов</span><input id="tsCorrectionPlanned" type="number" min="0" max="24" step="0.25" value="${esc(plannedValue)}" placeholder="Авто: ${esc(hoursInput(x.rawPlannedMinutes??x.plannedMinutes))}" ${access.canCorrect?'':'disabled'}></label>
        </div>
        <label class="ts-edit-full"><span>Причина изменения *</span><textarea id="tsCorrectionReason" maxlength="1600" placeholder="${mode==='FACTUAL'&&!faceIdConnected()?'Например: фактические часы по смене / ручной табель':'Например: сотрудник забыл отметиться на выходе'}" ${access.canCorrect?'':'disabled'}>${esc(c?.reason||'')}</textarea></label>
        <div class="ts-edit-actions">
          <button id="tsSaveCorrection" type="button" class="hr-primary" ${access.canCorrect?'':'disabled'}>Сохранить корректировку</button>
          ${c?`<button id="tsDeleteCorrection" type="button" class="hr-link-button danger" ${access.canCorrect?'':'disabled'}>Вернуть автоматический расчёт</button>`:''}
        </div>
        ${access.canCorrect?'':'<div class="ts-permission-note">Для изменения нужна роль Manager, HR или Owner.</div>'}
      </section>`;
  }
  function overtimeEditor(x){
    if(mode!=='FACTUAL')return'';
    const access=data.access||{},candidate=Number(x.overtimeCandidateMinutes||0),status=x.overtimeStatus||'NONE',hasRequest=Boolean(x.overtimeRequestId);
    const requested=Number(x.overtimeRequestedMinutes||candidate),approved=Number(x.approvedOvertimeMinutes||x.overtimeRequestedMinutes||candidate);
    return `
      <section class="ts-edit-card ts-overtime-editor">
        <div class="ts-edit-head"><div><span class="ts-kicker">ДОПОЛНИТЕЛЬНЫЕ ЧАСЫ</span><strong>${esc(overtimeStatusLabel(status))}</strong></div><span class="ts-ot-badge ${overtimeStatusClass(status)}">${esc(overtimeStatusLabel(status))}</span></div>
        <div class="ts-detail-grid">
          ${detailBox('Факт',hoursLong(x.workedMinutes))}
          ${detailBox('Дневная норма',hoursLong(x.overtimeThresholdMinutes))}
          ${detailBox('Рассчитано доп.',hoursLong(candidate))}
          ${detailBox('В оплату после HR',hoursLong(x.payrollOvertimeMinutes))}
          ${detailBox('Порог оплаты',hoursLong(x.overtimePayableFromMinutes))}
          ${detailBox('Неоплачиваемый промежуток',hoursLong(x.unpaidOvertimePotentialMinutes))}
        </div>
        <div class="ts-rule-box">
          <div><strong>Правило сотрудника</strong><small>По ТЗ норматив можно менять индивидуально. Если отдельного правила нет, используется норматив графика.</small></div>
          <div class="ts-rule-inputs">
            <label><span>Доп. часы после, ч</span><input id="tsRuleThreshold" type="number" min="0.25" max="24" step="0.25" value="${esc(hoursInput(x.overtimeThresholdMinutes))}" ${access.canSetOvertimeRule?'':'disabled'}></label>
            <label><span>Оплачивать после, ч</span><input id="tsRulePayable" type="number" min="0.25" max="24" step="0.25" value="${esc(hoursInput(x.overtimePayableFromMinutes))}" ${access.canSetOvertimeRule?'':'disabled'}></label>
            ${access.canSetOvertimeRule?'<button id="tsSaveOvertimeRule" type="button" class="hr-link-button">Сохранить правило</button>':''}
          </div>
        </div>
        ${candidate>0||hasRequest?`
          <div class="ts-workflow-block">
            <div class="ts-workflow-title"><span>1</span><div><strong>Менеджер</strong><small>Указывает причину и отправляет HR.</small></div></div>
            <div class="ts-edit-grid two">
              <label><span>Отправить HR, часов</span><input id="tsOvertimeRequested" type="number" min="0" max="24" step="0.25" value="${esc(hoursInput(requested))}" ${access.canManagerApprove?'':'disabled'}></label>
              <label class="wide"><span>Причина дополнительных часов *</span><textarea id="tsOvertimeManagerReason" maxlength="1600" ${access.canManagerApprove?'':'disabled'}>${esc(x.overtimeManagerReason||'')}</textarea></label>
            </div>
            ${access.canManagerApprove&&candidate>0?'<button id="tsSubmitOvertime" type="button" class="hr-link-button">Отправить дополнительные часы HR</button>':''}
          </div>
          <div class="ts-workflow-block">
            <div class="ts-workflow-title"><span>2</span><div><strong>HR</strong><small>Подтверждает, изменяет количество или отклоняет.</small></div></div>
            <div class="ts-edit-grid two">
              <label><span>Подтвердить, часов</span><input id="tsOvertimeApproved" type="number" min="0" max="24" step="0.25" value="${esc(hoursInput(approved))}" ${access.canHrApprove&&status==='MANAGER_SUBMITTED'?'':'disabled'}></label>
              <label class="wide"><span>Комментарий HR</span><textarea id="tsOvertimeHrComment" maxlength="1600" ${access.canHrApprove&&status==='MANAGER_SUBMITTED'?'':'disabled'}>${esc(x.overtimeHrComment||'')}</textarea></label>
            </div>
            <div class="ts-edit-actions">
              ${access.canHrApprove&&status==='MANAGER_SUBMITTED'?'<button id="tsApproveOvertime" type="button" class="hr-primary">Подтвердить HR</button><button id="tsRejectOvertime" type="button" class="hr-link-button danger">Отклонить</button>':''}
              ${access.canReopen&&hasRequest?'<button id="tsResetOvertime" type="button" class="hr-link-button">Сбросить решение</button>':''}
            </div>
          </div>`:candidate<=0?'<div class="ts-detail-note">Дополнительных часов по текущему нормативу нет.</div>':''}
      </section>`;
  }
  async function runAdjustment(payload,successText){
    if(adjustmentBusy)return;
    const keep=drawerDay?{...drawerDay}:null;
    try{
      adjustmentBusy=true;setStatus('Сохраняем изменения…','loading');
      document.querySelectorAll('.ts-drawer-body button').forEach(b=>b.disabled=true);
      const result=await adjustmentApi(payload);
      await load();
      if(keep){
        openDrawer(keep.employeeId,keep.date);
        if(['SAVE_CORRECTION','SUBMIT_OVERTIME','HR_APPROVE_OVERTIME','HR_REJECT_OVERTIME','RESET_OVERTIME'].includes(String(payload?.action||''))){
          requestAnimationFrame(()=>document.querySelector('.ts-overtime-editor')?.scrollIntoView({block:'start',behavior:'smooth'}));
        }
      }
      const suffix=result?.overtimeReset?' Решение Manager/HR по доп. часам сброшено — нужно отправить заново.':'';
      setStatus((successText||'Готово')+suffix,'ok');
    }catch(e){
      console.error(e);setStatus(e?.message||'Ошибка','error');alert(e?.message||'Не удалось сохранить изменение');
    }finally{adjustmentBusy=false}
  }
  function bindDrawerActions(x){
    const employeeId=x.employeeId,workDate=x.workDate,kind=mode;
    if($('tsSaveCorrection'))$('tsSaveCorrection').onclick=()=>{
      const worked=inputMinutes($('tsCorrectionWorked')?.value),planned=inputMinutes($('tsCorrectionPlanned')?.value);
      if($('tsCorrectionWorked')?.value&&worked===null)return alert('Проверьте фактические часы');
      if($('tsCorrectionPlanned')?.value&&planned===null)return alert('Проверьте плановые часы');
      runAdjustment({action:'SAVE_CORRECTION',employeeId,workDate,contour:kind,statusOverride:$('tsCorrectionStatus')?.value||'',workedMinutesOverride:worked,plannedMinutesOverride:planned,reason:$('tsCorrectionReason')?.value||''},'Корректировка сохранена');
    };
    if($('tsDeleteCorrection'))$('tsDeleteCorrection').onclick=()=>runAdjustment({action:'DELETE_CORRECTION',employeeId,workDate,contour:kind},'Автоматический расчёт восстановлен');
    if($('tsSaveOvertimeRule'))$('tsSaveOvertimeRule').onclick=()=>{
      const threshold=inputMinutes($('tsRuleThreshold')?.value),payable=inputMinutes($('tsRulePayable')?.value);
      if(threshold===null||payable===null)return alert('Проверьте пороги дополнительных часов');
      runAdjustment({action:'SAVE_OVERTIME_RULE',employeeId,thresholdMinutes:threshold,payableFromMinutes:payable,note:'Индивидуальное правило из табеля'},'Правило дополнительных часов сохранено');
    };
    if($('tsSubmitOvertime'))$('tsSubmitOvertime').onclick=()=>{
      const requested=inputMinutes($('tsOvertimeRequested')?.value);
      if(requested===null)return alert('Проверьте количество дополнительных часов');
      runAdjustment({action:'SUBMIT_OVERTIME',employeeId,workDate,candidateMinutes:Number(x.overtimeCandidateMinutes||0),requestedMinutes:requested,managerReason:$('tsOvertimeManagerReason')?.value||''},'Дополнительные часы отправлены HR');
    };
    if($('tsApproveOvertime'))$('tsApproveOvertime').onclick=()=>{
      const approved=inputMinutes($('tsOvertimeApproved')?.value);
      if(approved===null)return alert('Проверьте подтверждаемое время');
      runAdjustment({action:'HR_APPROVE_OVERTIME',employeeId,workDate,approvedMinutes:approved,hrComment:$('tsOvertimeHrComment')?.value||''},'Дополнительные часы подтверждены HR');
    };
    if($('tsRejectOvertime'))$('tsRejectOvertime').onclick=()=>runAdjustment({action:'HR_REJECT_OVERTIME',employeeId,workDate,hrComment:$('tsOvertimeHrComment')?.value||''},'Дополнительные часы отклонены HR');
    if($('tsResetOvertime'))$('tsResetOvertime').onclick=()=>runAdjustment({action:'RESET_OVERTIME',employeeId,workDate},'Решение по дополнительным часам сброшено');
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
          ${detailBox('Норма для расчёта',hoursLong(x.normMinutes))}
          ${detailBox('Доп. часы до HR',hoursLong(x.overtimeCandidateMinutes))}
          ${faceIdConnected()?detailBox('Первый вход',localTime(x.firstIn)):detailBox('Источник факта',x.corrected?'Ручной ввод':'Не введён')}
          ${faceIdConnected()?detailBox('Последний выход',localTime(x.lastOut)):detailBox('Face ID','Не подключён')}
          ${detailBox('Источник графика',x.scheduleSource==='EMPLOYEE'?'Индивидуальный':x.scheduleSource==='ROLE'?'Должность':'—')}
          ${faceIdConnected()?detailBox('Ошибок Face ID',String(x.issueCount||0)):detailBox('Режим','Ручной учёт')}
        </div>
        ${x.leaveName?`<div class="ts-detail-note"><strong>Отпуск:</strong> ${esc(x.leaveName)}${x.leaveNote?'<br>'+esc(x.leaveNote):''}</div>`:''}
        ${x.scheduleOverrideNote?`<div class="ts-detail-note"><strong>Комментарий к индивидуальному графику:</strong><br>${esc(x.scheduleOverrideNote)}</div>`:''}
        ${issueItems.length?`<div class="ts-detail-note"><strong>Проблемы Face ID:</strong><br>${issueItems.map(i=>esc(issueLabel(i.code))).join('<br>')}</div>`:''}
        ${x.corrected?`<div class="ts-detail-note"><strong>Автоматические данные до корректировки:</strong><br>Статус: ${esc(x.rawStatus||'—')} · Факт: ${esc(hoursLong(x.rawWorkedMinutes))} · План: ${esc(hoursLong(x.rawPlannedMinutes))}</div>`:''}
        ${correctionEditor(x)}
        ${overtimeEditor(x)}
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
        ${x.corrected?`<div class="ts-detail-note"><strong>Автоматические данные до корректировки:</strong><br>Статус: ${esc(x.rawStatus||'—')} · План: ${esc(hoursLong(x.rawPlannedMinutes))}</div>`:''}
        ${correctionEditor(x)}
      `;
    }
    $('tsDayDrawer').hidden=false;
    document.body.style.overflow='hidden';
    if(x)bindDrawerActions(x);
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
    if(mode==='FACTUAL')headers.push('Рабочих дней','План часов','Факт часов','Норма часов','Доп. часы подтверждено HR','Доп. часы ожидает HR','Неоплачиваемые доп. часы','Доп. дни эквивалент','Отпуск','Y/Нет','Выходные','Проверить');
    else headers.push('Рабочих дней','План часов','Отпуск','Выходные','Работа в праздник');
    const lines=[headers.map(csvValue).join(';')];
    for(const e of employees){
      const map=byEmp.get(e.id)||new Map(),rows=[e.name||'',e.code||'',e.roleName||''];
      const empDays=[...map.values()],totals=buildEmployeeTotals(empDays);
      for(const d of days){
        const date=`${range.year}-${pad(range.month)}-${pad(d)}`,v=dayView(map.get(date));
        rows.push(v.code+(v.sub?` ${v.sub}`:''));
      }
      if(mode==='FACTUAL')rows.push(totals.work,(totals.plan/60).toFixed(2),(totals.fact/60).toFixed(2),(totals.norm/60).toFixed(2),(totals.overtimeApproved/60).toFixed(2),(totals.overtimePending/60).toFixed(2),(totals.overtimeUnpaid/60).toFixed(2),totals.extraDays.toFixed(2),totals.leave,totals.absent,totals.rest,totals.issues);
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
    $('tsOvertimeRows')?.addEventListener('click',e=>{
      const btn=e.target.closest('.ts-open-day');if(btn)openDrawer(btn.dataset.employeeId,btn.dataset.date);
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