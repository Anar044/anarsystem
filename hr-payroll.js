(()=>{'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>`${(Number(v)||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})} ₼`;
const hours=v=>{if(v===null||v===undefined)return'—';const m=Math.max(0,Number(v)||0),h=Math.floor(m/60),r=Math.round(m%60);return r?`${h} ч ${String(r).padStart(2,'0')} мин`:`${h} ч`};
const r=v=>Math.round((Number(v)||0)*100)/100,pct=v=>(Number(v)||0)/100;
let mode='OVERALL',state={payroll:null,adjustments:null,tax:null,settlements:null,rmsPayroll:null,rmsPayrollError:'',models:[]},busy=false,paymentBusy=false,paymentEmployeeId='';

function monthNow(){const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0');return y===2026?`${y}-${m}`:'2026-10'}
async function token(){const c=await window.SHAuth?.createClient?.();if(!c)throw new Error('Supabase Auth не готов');const{data,error}=await c.auth.getSession();const t=data?.session?.access_token;if(error||!t)throw new Error('Сессия пользователя не найдена');return t}
async function fetchJson(url,t){const res=await (window.SH_IikoContext?.fetchWithTimeout||fetch)(url,{headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}},90000),j=await res.json().catch(()=>({success:false,message:'Некорректный ответ API'}));if(!res.ok||!j.success)throw new Error(j.message||`HTTP ${res.status}`);return j}
async function api(){
  const t=await token(),month=$('hrpMonth').value||monthNow();
  const p=await fetchJson(`/api/hr/payroll?month=${encodeURIComponent(month)}`,t);
  const[a,tax,settlements]=await Promise.all([
    fetchJson(`/api/hr/payroll-adjustments?month=${encodeURIComponent(month)}`,t),
    fetchJson(`/api/hr/payroll-tax-settings?month=${encodeURIComponent(month)}`,t),
    fetchJson(`/api/hr/overtime-settlements?month=${encodeURIComponent(month)}`,t)
  ]);
  let rmsPayroll=null,rmsPayrollError='';
  if(p.restaurantScope?.mode==='CHAIN'){
    try{rmsPayroll=await fetchJson(`/api/hr/rms-payroll?month=${encodeURIComponent(month)}`,t)}
    catch(error){rmsPayrollError=error?.message||String(error)}
  }
  return{payroll:p,adjustments:a,tax,settlements,rmsPayroll,rmsPayrollError};
}
async function rmsPayrollPost(body){
  const t=await token(),res=await (window.SH_IikoContext?.fetchWithTimeout||fetch)('/api/hr/rms-payroll',{
    method:'POST',headers:{Authorization:`Bearer ${t}`,Accept:'application/json','Content-Type':'application/json'},
    body:JSON.stringify(body)
  },90000);
  const j=await res.json().catch(()=>({success:false,message:'Некорректный ответ Payroll RMS'}));
  if(!res.ok||!j.success)throw new Error(j.message||`HTTP ${res.status}`);
  return j;
}
async function settlementPost(body){
  const t=await token(),res=await (window.SH_IikoContext?.fetchWithTimeout||fetch)('/api/hr/overtime-settlements',{method:'POST',headers:{Authorization:`Bearer ${t}`,Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(body)},60000);
  const j=await res.json().catch(()=>({success:false,message:'Некорректный ответ API'}));if(!res.ok||!j.success)throw new Error(j.message||`HTTP ${res.status}`);return j;
}
function setStatus(text,kind=''){const e=$('hrpStatus');e.textContent=text;e.className=`hr-status ${kind}`.trim()}
function showError(text=''){const e=$('hrpError');e.hidden=!text;e.textContent=text}

function tier(g,t1,t2,a,b,c){if(g<=t1)return g*pct(a);if(g<=t2)return t1*pct(a)+(g-t1)*pct(b);return t1*pct(a)+(t2-t1)*pct(b)+(g-t2)*pct(c)}
function calcGross(gross,s){
  const g=Math.max(0,Number(gross)||0),taxable=g<=s.incomeTaxThreshold1?Math.max(0,g-s.personalAllowance):g;
  let income=0;
  if(taxable<=s.incomeTaxThreshold1)income=taxable*pct(s.incomeTaxLowPercent);
  else if(taxable<=s.incomeTaxThreshold2)income=s.incomeTaxThreshold1*pct(s.incomeTaxLowPercent)+(taxable-s.incomeTaxThreshold1)*pct(s.incomeTaxMidPercent);
  else income=s.incomeTaxThreshold1*pct(s.incomeTaxLowPercent)+(s.incomeTaxThreshold2-s.incomeTaxThreshold1)*pct(s.incomeTaxMidPercent)+(taxable-s.incomeTaxThreshold2)*pct(s.incomeTaxHighPercent);
  const employee={
    incomeTax:r(income),
    socialInsurance:r(tier(g,s.socialThreshold1,s.socialThreshold2,s.employeeSocialLowPercent,s.employeeSocialMidPercent,s.employeeSocialHighPercent)),
    unemploymentInsurance:r(g*pct(s.employeeUnemploymentPercent)),
    medicalInsurance:r(Math.min(g,s.medicalThreshold)*pct(s.employeeMedicalLowPercent)+Math.max(0,g-s.medicalThreshold)*pct(s.employeeMedicalHighPercent))
  };
  employee.total=r(employee.incomeTax+employee.socialInsurance+employee.unemploymentInsurance+employee.medicalInsurance);
  const employer={
    socialInsurance:r(tier(g,s.socialThreshold1,s.socialThreshold2,s.employerSocialLowPercent,s.employerSocialMidPercent,s.employerSocialHighPercent)),
    unemploymentInsurance:r(g*pct(s.employerUnemploymentPercent)),
    medicalInsurance:r(Math.min(g,s.medicalThreshold)*pct(s.employerMedicalLowPercent)+Math.max(0,g-s.medicalThreshold)*pct(s.employerMedicalHighPercent))
  };
  employer.total=r(employer.socialInsurance+employer.unemploymentInsurance+employer.medicalInsurance);
  return{gross:r(g),taxableIncome:r(taxable),employee,employer,net:r(g-employee.total),totalEmployerCost:r(g+employer.total)}
}
function model(row,adj,tax){
  const term=row.term||null,s=tax.settings||{},tot=adj?.totals||{},meal=adj?.meal||{},accrual=row.accrual||{},proration=row.proration||{},ot=row.overtime||{};
  const monthlyOfficialGross=Number(term?.officialGross||0),monthlyFactualGross=Number(accrual.monthlyFactualGross??(Number(term?.officialGross||0)+Number(term?.additionalAmount||0)));
  const officialGross=Number(accrual.officialAccruedGross??monthlyOfficialGross),factualBaseGross=Number(accrual.factualBaseGross??monthlyFactualGross);
  const additionalGross=Number(accrual.additionalAccruedGross??Math.max(0,factualBaseGross-officialGross)),extraDayPay=Number(accrual.extraDayPay||0);
  const treatment=String(term?.additionalTaxTreatment||'TAXABLE').toUpperCase(),additionalTaxable=treatment==='TAXABLE';
  const taxableRewards=Number(tot.taxableRewards||0),exemptRewards=Number(tot.exemptRewards||0),rewards=Number(tot.rewards||0);
  const advances=Number(tot.advances||0),deductions=Number(tot.deductions||0),drafts=Number(tot.drafts||0);
  const official=calcGross(officialGross,s);
  const additionalTaxBase=officialGross+(additionalTaxable?additionalGross:0);
  const additionalCombined=calcGross(additionalTaxBase,s);
  const combinedTaxGross=additionalTaxBase+taxableRewards;
  const combined=calcGross(combinedTaxGross,s);
  const additionalEmployeeTax=r(Math.max(0,additionalCombined.employee.total-official.employee.total));
  const additionalNet=r(additionalGross-(additionalTaxable?Math.min(additionalGross,additionalEmployeeTax):0));
  const regularBeforeDeductions=r(combined.net+(additionalTaxable?0:additionalGross)+exemptRewards);
  const regularPayable=r(Math.max(0,regularBeforeDeductions-advances-deductions));
  const finalPayable=r(regularPayable+extraDayPay);
  const employerCost=r(combined.totalEmployerCost+(additionalTaxable?0:additionalGross)+exemptRewards+extraDayPay);
  const fullAccrualGross=r(factualBaseGross+rewards+extraDayPay);
  const cap=r(regularBeforeDeductions*.20),overCap=deductions>cap+.009;
  const overtimeMinutes=Number(ot.payableMinutes??row.overtimeApprovedMinutes??0),approvedOvertimeMinutes=Number(ot.approvedMinutes||0),unpaidOvertimeMinutes=Number(ot.unpaidGapMinutes||0),extraDayEquivalent=Number(ot.extraDayEquivalent||0);
  const reasons=[...(row.flags||[])];
  if(drafts>0)reasons.push(`Черновики корректировок: ${drafts}`);
  if(Number(meal.pendingDeduction||0)>0)reasons.push(`Питание к подтверждению: ${money(meal.pendingDeduction)}`);
  if(overCap)reasons.push(`Удержания выше контрольных 20%: ${money(cap)}`);
  let status=row.status||'READY';
  if(!term)status='NO_TERMS';
  else if(status==='REVIEW'||drafts>0||Number(meal.pendingDeduction||0)>0||overCap)status='REVIEW';
  else status='READY';
  return{
    row,adj:adj||{},term,proration,accrual,ot,
    monthlyOfficialGross,monthlyFactualGross,officialGross,additionalGross,additionalNet,extraDayPay,
    rewards,taxableRewards,exemptRewards,advances,deductions,drafts,official,combined,
    regularBeforeDeductions,regularPayable,finalPayable,employerCost,factualBaseGross,fullAccrualGross,
    cap,overCap,overtimeMinutes,approvedOvertimeMinutes,unpaidOvertimeMinutes,extraDayEquivalent,meal,status,reasons
  };
}
function buildModels(p,a,tax){const map=new Map((a.employees||[]).map(x=>[String(x.id),x]));return(p.rows||[]).map(row=>model(row,map.get(String(row.employeeId)),tax||{}))}

function sourceBadge(m){if(m.row.sourceType==='EMPLOYEE')return'<span class="hrp-source employee">Индивидуально</span>';if(m.row.sourceType==='ROLE')return'<span class="hrp-source role">По должности</span>';return'<span class="hrp-status missing">Нет условий</span>'}
function statusBadge(m){if(m.status==='NO_TERMS')return'<span class="hrp-status missing">Нет условий</span>';if(m.status==='REVIEW')return'<span class="hrp-status review">Проверить</span>';return'<span class="hrp-status ready">Готово</span>'}
function employeeCell(m){return`<div class="hr-name">${esc(m.row.employeeName||'—')}</div><div class="hr-sub">${esc(m.row.roleName||'Без должности')} · ${esc(m.row.employeeCode||'')}</div>`}
function reasonCell(m){return esc(m.reasons.join(' · ')||'—')}

function selectedModels(){
  const q=String($('hrpSearch')?.value||'').trim().toLowerCase(),role=$('hrpRole')?.value||'',st=$('hrpState')?.value||'',department=$('hrpDepartmentFilter')?.value||'';
  return state.models.filter(m=>{
    if(q&&!String(`${m.row.employeeName} ${m.row.employeeCode}`).toLowerCase().includes(q))return false;
    if(role&&String(m.row.roleCode||'')!==role)return false;
    if(department&&String(m.row.departmentCode||'').trim().toUpperCase()!==department.toUpperCase())return false;
    if(st&&m.status!==st)return false;
    return true;
  });
}
function renderFilters(){
  const el=$('hrpRole'),current=el.value;
  const roles=[...new Map(state.models.filter(m=>m.row.roleCode).map(m=>[String(m.row.roleCode),m.row.roleName||m.row.roleCode])).entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1]),'ru'));
  el.innerHTML='<option value="">Все должности</option>'+roles.map(([v,n])=>`<option value="${esc(v)}">${esc(n)}</option>`).join('');
  if(roles.some(([v])=>v===current))el.value=current;
  const selector=$('hrpDepartmentFilter'),departments=state.payroll?.departmentPayroll?.departments||[];
  const network=state.payroll?.payrollView==='NETWORK_SUMMARY';
  selector.hidden=!network;
  const previous=selector.value;
  selector.innerHTML='<option value="">Все рестораны сети</option>'+departments.map(d=>`<option value="${esc(d.code)}">${esc(d.name)}</option>`).join('');
  if(network&&departments.some(x=>String(x.code).toUpperCase()===previous.toUpperCase()))selector.value=previous;
}
function renderScopeHeading(){
  const payroll=state.payroll||{},network=payroll.payrollView==='NETWORK_SUMMARY';
  const restaurants=payroll.departmentPayroll?.departments||[];
  $('hrpScopeHeading').innerHTML=network
    ?'<strong>Общий Payroll CHAIN</strong><span>Сводка по '+restaurants.length+' ресторанам. Отдельные начисления и выплаты проводятся в конкретном ресторане.</span>'
    :'<strong>Payroll ресторана</strong><span>Начисления и табель относятся только к выбранному подразделению.</span>';
}
function renderMonthlyNormPreview(){
  const box=$('hrpMonthlyNormPreview'),preview=state.payroll?.monthlyRolePreview;
  if(!box)return;
  box.hidden=state.payroll?.restaurantScope?.mode!=='CHAIN'||!preview;
  if(box.hidden)return;
  const current=$('hrpDepartmentFilter')?.value||'';
  const selected=(state.payroll?.departmentPayroll?.departments||[])
    .find(d=>String(d.code).toUpperCase()===current.toUpperCase());
  const rows=(preview.rows||[]).filter(x=>!selected||String(x.restaurantId)===String(selected.id));
  const office=selected?[]:(preview.officeRows||[]).map(x=>({...x,restaurantName:'Центральный офис'}));
  const all=[...rows,...office];
  const status=x=>({
    PREVIEW_NOT_APPROVED:'Предварительно · ожидает утверждения',
    PREVIEW_OFFICE:'Оклад · предварительно',
    REVIEW_REQUIRED:'Проверить явки',
    NORM_NOT_CONFIGURED:'Не задан календарь должности',
    SALARY_NOT_CONFIGURED:'Нет суммы зарплаты'
  })[x.status]||x.status||'—';
  const html=all.map(x=>`<tr>
    <td class="text-left">${esc(x.restaurantName||x.restaurantId)}</td>
    <td class="text-left">${esc(x.employeeName||x.employeeId)}</td>
    <td>${x.payrollMode==='RESTAURANT_HOURS'?Number(x.normDays):'—'}</td>
    <td>${x.payrollMode==='RESTAURANT_HOURS'?Number((x.dailyNormMinutes/60).toFixed(2)):'—'}</td>
    <td>${x.payrollMode==='OFFICE_FIXED'?'—':hours(x.acceptedMinutes||0)}</td>
    <td>${x.payrollMode==='RESTAURANT_HOURS'?Number(x.equivalentDays).toLocaleString('ru-RU',{maximumFractionDigits:4}):'—'}</td>
    <td><strong>${Number.isFinite(Number(x.totalGross))?money(x.totalGross):'—'}</strong></td>
    <td>${esc(status(x))}</td></tr>`).join('');
  const gross=r(all.reduce((sum,x)=>sum+Number(x.totalGross||0),0));
  const attention=all.filter(x=>!['PREVIEW_NOT_APPROVED','PREVIEW_OFFICE'].includes(x.status)).length;
  $('hrpMonthlyNormRows').innerHTML=html+`<tr class="hrp-network-total">
    <td class="text-left"><strong>ИТОГО · предварительно</strong></td>
    <td>${new Set(all.map(x=>x.employeeId)).size} сотрудников</td><td></td><td></td><td></td><td></td>
    <td><strong>${money(gross)}</strong></td><td>${attention?'Требуют проверки: '+attention:'Без проведения выплат'}</td></tr>`;
}
function renderRmsTaxAllocation(){
  const box=$('hrpRmsTaxAllocation');
  if(!box)return;
  const source=state.rmsPayroll,tax=source?.taxAllocation;
  box.hidden=!source||!tax;
  if(box.hidden)return;
  const totals=tax.network||{},profile=source.taxProfile||{};
  $('hrpRmsTaxSummary').textContent=`${Number(totals.uniqueEmployees||0)} сотрудников · gross ${money(totals.gross)} · net ${money(totals.net)} · профиль ${profile.source||'не задан'}`;
  const lines=tax.lines||[];
  $('hrpRmsTaxRows').innerHTML=lines.map(x=>`<tr>
    <td class="text-left">${esc(x.restaurantId==='NETWORK_OFFICE'?'Центральный офис':x.restaurantId)}</td>
    <td class="text-left">${esc(x.employeeName||x.employeeId)}</td>
    <td>${money(x.gross)}</td><td>${money(x.withheld)}</td>
    <td><strong>${money(x.net)}</strong></td><td>${money(x.employerCost)}</td></tr>`
  ).join('')+`<tr class="hrp-network-total">
    <td class="text-left">ИТОГО CHAIN</td><td>${Number(totals.uniqueEmployees||0)} сотрудников</td>
    <td>${money(totals.gross)}</td><td>${money(totals.withheld)}</td>
    <td><strong>${money(totals.net)}</strong></td><td>${money(totals.employerCost)}</td></tr>`;
}
function renderRmsApprovals(){
  const panel=$('hrpRmsApproval'),source=state.rmsPayroll||null;
  if(!panel)return;
  panel.hidden=state.payroll?.restaurantScope?.mode!=='CHAIN';
  if(panel.hidden)return;
  const error=$('hrpRmsApprovalError');
  error.hidden=!state.rmsPayrollError;
  error.textContent=state.rmsPayrollError||'';
  if(!source){
    $('hrpRmsApprovalSummary').textContent='Новый Payroll недоступен';
    $('hrpRmsApprovalRows').innerHTML='<tr><td colspan="7" class="hr-empty">Не удалось загрузить независимые документы RMS.</td></tr>';
    $('hrpRmsApprovalAttendance').innerHTML='';
    return;
  }
  const current=$('hrpDepartmentFilter')?.value||'';
  const selected=(state.payroll?.departmentPayroll?.departments||[])
    .find(d=>String(d.code).toUpperCase()===current.toUpperCase());
  const rows=(source.restaurants||[]).filter(x=>!selected||String(x.restaurantId)===String(selected.id));
  const ids=new Set(rows.map(x=>String(x.restaurantId)));
  const approved=rows.filter(x=>x.approval?.status==='HR_APPROVED').length;
  const unique=new Set(rows.flatMap(x=>x.rows||[]).map(x=>x.employeeId)).size;
  $('hrpRmsApprovalSummary').textContent=`${approved} из ${rows.length} RMS утверждены · ${unique} уникальных сотрудников · начисления не проведены`;
  const stateLabel=s=>({DRAFT:'Черновик',MANAGER_APPROVED:'Менеджер подтвердил',HR_APPROVED:'HR утвердил',STALE:'Данные изменились — пересчёт'})[s]||s||'Черновик';
  $('hrpRmsApprovalRows').innerHTML=rows.map(x=>{
    const status=x.approval?.status||'DRAFT',actions=[];
    if(source.canManagerApprove&&source.closed&&x.ready&&x.attendanceDays>0&&status!=='HR_APPROVED')
      actions.push(`<button type="button" class="hr-link-button" data-rms-action="MANAGER_APPROVE" data-rms-id="${esc(x.restaurantId)}">Менеджер ✓</button>`);
    if(source.canHrApprove&&source.closed&&x.ready&&status==='MANAGER_APPROVED')
      actions.push(`<button type="button" class="hr-link-button" data-rms-action="HR_APPROVE" data-rms-id="${esc(x.restaurantId)}">HR ✓</button>`);
    if(source.canReopen&&['MANAGER_APPROVED','HR_APPROVED','STALE'].includes(status))
      actions.push(`<button type="button" class="hr-link-button" data-rms-action="REOPEN" data-rms-id="${esc(x.restaurantId)}">Вернуть</button>`);
    return `<tr>
      <td class="text-left">${esc(x.restaurantName||x.restaurantCode||x.restaurantId)}</td>
      <td>${new Set((x.rows||[]).map(e=>e.employeeId)).size}</td>
      <td>${hours((x.rows||[]).reduce((a,e)=>a+Number(e.acceptedMinutes||0),0))}</td>
      <td><strong>${money(x.gross)}</strong></td>
      <td>${x.issueCount||0}</td>
      <td>${esc(stateLabel(status))}</td>
      <td>${actions.join(' ')||'<span class="hr-muted">Только просмотр / требуется проверка</span>'}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="7" class="hr-empty">Нет доступных RMS для утверждения</td></tr>';
  const correctionKeys=new Set((source.corrections||[]).map(x=>
    String(x.restaurant_id)+'|'+String(x.iiko_employee_id)+'|'+String(x.work_date)));
  $('hrpRmsApprovalAttendance').innerHTML=(source.attendance||[]).filter(x=>ids.has(String(x.restaurantId)))
    .map(x=>{
      const date=String(x.workDate),id=String(x.employeeId),restaurant=String(x.restaurantId);
      const corrected=correctionKeys.has(restaurant+'|'+id+'|'+date);
      const status=x.manualCorrection?'Исправлено вручную':x.status==='WORK'?'Закрыта':x.status==='INCOMPLETE'?'Нет ухода':'Смена открыта';
      const documentRow=rows.find(d=>String(d.restaurantId)===restaurant);
      const editable=source.canManage&&documentRow?.approval?.status!=='HR_APPROVED';
      return `<tr>
        <td class="text-left">${esc(x.restaurantName||restaurant)}</td>
        <td class="text-left">${esc(x.employeeName||id)}</td><td>${esc(date)}</td>
        <td>${esc(x.firstIn||'—')}</td><td>${esc(x.lastOut||'—')}</td>
        <td>${hours(x.workedMinutes||0)}</td><td>${esc(status)}</td>
        <td>${editable?`<button class="hr-link-button" type="button" data-rms-action="SAVE_CORRECTION" data-rms-id="${esc(restaurant)}" data-rms-employee="${esc(id)}" data-rms-date="${esc(date)}" data-rms-minutes="${Number(x.workedMinutes||0)}">Исправить</button>
          ${corrected?`<button class="hr-link-button" type="button" data-rms-action="REMOVE_CORRECTION" data-rms-id="${esc(restaurant)}" data-rms-employee="${esc(id)}" data-rms-date="${esc(date)}">Отмена</button>`:''}`:'—'}</td>
      </tr>`;
    }).join('')||'<tr><td colspan="8" class="hr-empty">Нет явок ZKTeco за выбранный месяц</td></tr>';
}
function renderRmsHours(){
  const box=$('hrpRmsHours'),preview=state.payroll?.rmsHours||null;
  if(!box)return;
  box.hidden=state.payroll?.restaurantScope?.mode!=='CHAIN'||!preview;
  if(box.hidden)return;
  const current=$('hrpDepartmentFilter')?.value||'';
  const deptMap=new Map((preview.departments||[]).map(d=>[String(d.restaurantId),d]));
  const selectedDepartment=(state.payroll?.departmentPayroll?.departments||[])
    .find(d=>String(d.code).toUpperCase()===current.toUpperCase());
  const lines=(preview.employeeRows||[]).filter(e=>!current||!selectedDepartment||
    String(e.restaurantId)===String(selectedDepartment.id));
  const fmt=v=>hours(v||0);
  $('hrpRmsHoursCount').textContent=lines.length+' строк · '+Number(preview.network?.uniqueEmployees||0)+' уникальных сотрудников в выбранной сети';
  const html=lines.map(line=>
    `<tr><td class="text-left"><strong>${esc(line.restaurantName||line.restaurantId)}</strong></td>
       <td class="text-left">${esc(line.employeeName||line.employeeId)}</td>
       <td>${Number(line.completeShifts||0)}</td>
       <td>${esc(fmt(line.recordedMinutes))}</td>
       <td>${esc(fmt(line.nonOverlappingMinutes))}</td>
       <td>${Number(line.incompleteShifts||0)}</td>
       <td>${Number(line.overlapShifts||0)}</td></tr>`
  ).join('');
  const deps=(preview.departments||[]).filter(d=>!selectedDepartment||String(d.restaurantId)===String(selectedDepartment.id));
  const total=(name)=>deps.reduce((acc,d)=>acc+Number(d[name]||0),0);
  $('hrpRmsHoursRows').innerHTML=html+ `<tr class="hrp-network-total">
    <td class="text-left">Итого по выбранным RMS</td><td></td>
    <td>${total('completeShifts')}</td>
    <td>${esc(fmt(total('recordedMinutes')))}</td>
    <td>${esc(fmt(total('nonOverlappingMinutes')))}</td>
    <td>${total('incompleteShifts')}</td>
    <td>${total('overlapShifts')}</td></tr>`;
}
function renderDepartmentPayroll(){
  const panel=$('hrpDepartmentPayroll'),snap=state.payroll?.departmentPayroll||null;
  const network=state.payroll?.payrollView==='NETWORK_SUMMARY';
  panel.hidden=!network||!snap;
  if(panel.hidden)return;
  const departments=snap.departments||[],key=v=>String(v||'').trim().toUpperCase();
  const modelRows=state.models||[];
  const byDepartment=new Map();
  for(const m of modelRows){const code=key(m.row.departmentCode);
    if(!byDepartment.has(code))byDepartment.set(code,[]);
    byDepartment.get(code).push(m);
  }
  const totalFor=(models,field)=>r(models.reduce((a,m)=>a+Number(m[field]||0),0));
  $('hrpDepartmentCount').textContent=departments.length+' ресторанов';
  $('hrpDepartmentWarning').hidden=Boolean(snap.reconciled);
  $('hrpDepartmentWarning').textContent=snap.reconciled?'':'Внимание: '+Number(snap.unattributed?.employees||0)+' сотрудников без однозначной привязки к ресторану. Их суммы входят в общий итог, но не распределены между ресторанами.';
  const lines=departments.map(d=>{
    const all=byDepartment.get(key(d.code))||[],t=d.totals||{},status=d.approved?'Утверждён HR':d.status==='MANAGER_APPROVED'?'Утверждён менеджером':'Не утверждён HR';
    return `<tr><td class="text-left"><strong>${esc(d.name)}</strong><small>${esc(d.code)}</small></td>
      <td>${Number(t.employees||0)}</td><td>${money(t.factualBaseGross||0)}</td><td>${money(t.officialGross||0)}</td>
      <td>${money(t.extraDayPay||0)}</td><td class="hrp-final">${money(totalFor(all,'finalPayable'))}</td>
      <td>${money(totalFor(all,'employerCost'))}</td><td>${esc(status)}</td></tr>`;
  });
  const all=state.models||[],t=snap.network||{};
  lines.push(`<tr class="hrp-network-total"><td class="text-left"><strong>ИТОГО ПО СЕТИ</strong></td>
    <td>${Number(t.employees||0)}</td><td>${money(t.factualBaseGross||0)}</td><td>${money(t.officialGross||0)}</td>
    <td>${money(t.extraDayPay||0)}</td><td class="hrp-final">${money(totalFor(all,'finalPayable'))}</td>
    <td>${money(totalFor(all,'employerCost'))}</td><td>Сводка · только просмотр</td></tr>`);
  $('hrpDepartmentRows').innerHTML=lines.join('');
}
function renderSummary(){
  const list=selectedModels(),sum=fn=>r(list.reduce((a,m)=>a+Number(fn(m)||0),0));
  const factualFund=sum(m=>m.factualBaseGross),officialGross=sum(m=>m.officialGross),extraPay=sum(m=>m.extraDayPay),payable=sum(m=>m.finalPayable),cost=sum(m=>m.employerCost);
  $('hrpSummary').innerHTML=[
    ['Сотрудников',list.length,`С условиями: ${list.filter(m=>m.term).length}`],
    ['Фактический фонд',money(factualFund),'База после расчёта неполного месяца'],
    ['Официальный Gross',money(officialGross),'Начислено за расчётные дни'],
    ['Доп. часы отдельно',money(extraPay),'Отдельное начисление и выплата'],
    ['К выплате',money(payable),'Основная + отдельная выплата доп. часов'],
    ['Стоимость ресторану',money(cost),'Начисления + взносы работодателя'],
    ['Долг по доп. часам',money(settlementVisibleRows().reduce((a,x)=>a+Number(x.closingDebt||0),0)),`Сотрудников с долгом: ${settlementVisibleRows().filter(x=>Number(x.closingDebt||0)>0).length}`],
    ['Бухгалтерские проводки',`${Number(state.payroll?.summary?.accountingPosted||0)} / ${Number(state.payroll?.summary?.accountingPosted||0)+Number(state.payroll?.summary?.accountingPending||0)}`,Number(state.payroll?.summary?.accountingPending||0)?'Есть начисления без настроенных счетов':state.payroll?.timesheetApproval?.approved?'Начисления синхронизированы с журналом':'Новые проводки ожидают утверждения табеля HR']
  ].map(x=>`<article class="hr-summary-card"><span>${esc(x[0])}</span><strong>${esc(x[1])}</strong><small>${esc(x[2])}</small></article>`).join('');
}
function renderContext(){
  const p=state.payroll,t=state.tax;
  $('hrpPeriod').textContent=`${p.period?.from||''} — ${p.period?.to||''}`;
  $('hrpTaxProfile').textContent=`${t.mode==='MANUAL'?'Ручной':'Системный'}${t.active?.effectiveFrom?' · с '+t.active.effectiveFrom:''}`;
  $('hrpAttendance').textContent=p.attendance?.mode==='FACE_ID'?`Face ID · устройств: ${Number(p.attendance.activeDevices||0)}`:p.attendance?.mode==='MANUAL'?'Ручные фактические часы':'Face ID пока не подключён';
  $('hrpAttendance').className=p.attendance?.mode==='FACE_ID'?'connected':'not-connected';
  $('hrpOvertime').textContent=p.timesheetApproval?.aggregateView?`Сводка CHAIN · ${Number((p.timesheetApproval.departmentApprovals||[]).filter(x=>x.approved).length)} из ${Number((p.timesheetApproval.departmentApprovals||[]).length)} ресторанов утверждено · для начислений выберите ресторан`:p.timesheetApproval?.approved?`${hours(p.summary?.overtimePayableMinutes||0)} · ${Number(p.summary?.overtimeExtraDays||0).toLocaleString('ru-RU',{maximumFractionDigits:2})} дн. · ${money(p.summary?.overtimeExtraPay||0)}`:(p.timesheetApproval?.stale?'Табель изменён · требуется повторное согласование HR':'Доп. часы заблокированы · табель месяца не утверждён HR');
}
function head(cols){return`<tr>${cols.map(c=>`<th class="${c.left?'text-left':''} ${c.cls||''}">${esc(c.label)}</th>`).join('')}</tr>`}
function daysCell(m,kind='factual'){
  const p=m.proration||{},norm=Number(p.normWorkDays||0),value=kind==='official'?Number(p.officialWorkDays||0):Number(p.factualWorkDays||0);
  const partial=norm>0&&value<norm;
  return `<span class="hrp-days ${partial?'partial':''}">${value} / ${norm}</span>`;
}
function overallRows(list){
  $('hrpTableTitle').textContent='Общий расчёт';
  $('hrpTableSub').textContent='Месячный оклад → расчётные дни → доп. день/часы → итоговая выплата';
  $('hrpTable').className='hrp-table mode-overall';
  $('hrpHead').innerHTML=head([
    {label:'Сотрудник',left:true},{label:'Источник'},{label:'Статус'},{label:'Раб. дни'},{label:'Месячный факт. оклад'},{label:'Начислено факт.'},{label:'Официальный Gross'},
    {label:'Доп. часть'},{label:'Доп. день'},{label:'Оплач. доп. часы'},{label:'Вознаграждения'},{label:'Аванс'},{label:'Удержания'},
    {label:'Основная выплата'},{label:'Отдельно доп. часы'},{label:'Всего к выплате',cls:'accent-head'},{label:'Стоимость ресторану'},{label:'Проверить',left:true}
  ]);
  return list.map(m=>`<tr>
    <td class="text-left">${employeeCell(m)}</td><td>${sourceBadge(m)}</td><td>${statusBadge(m)}</td><td>${m.term?daysCell(m):'—'}</td>
    <td class="hrp-monthly">${m.term?money(m.monthlyFactualGross):'—'}</td><td class="hrp-money">${m.term?money(m.factualBaseGross):'—'}</td>
    <td>${m.term?money(m.officialGross):'—'}</td><td>${m.term?money(m.additionalGross):'—'}</td>
    <td class="${m.extraDayEquivalent?'hrp-overtime':''}">${m.extraDayEquivalent?m.extraDayEquivalent.toLocaleString('ru-RU',{maximumFractionDigits:2})+' дн.':'0'}</td>
    <td class="${m.overtimeMinutes?'hrp-overtime':''}">${m.overtimeMinutes?hours(m.overtimeMinutes):'0 ч'}</td>
    <td class="hrp-plus">${money(m.rewards)}</td><td class="hrp-minus">${money(m.advances)}</td><td class="hrp-minus">${money(m.deductions)}</td>
    <td class="hrp-regular">${m.term?money(m.regularPayable):'—'}</td><td class="hrp-extra-pay">${m.term?money(m.extraDayPay):'—'}</td>
    <td class="hrp-final">${m.term?money(m.finalPayable):'—'}</td><td class="hrp-money">${m.term?money(m.employerCost):'—'}</td>
    <td class="text-left hrp-flags">${reasonCell(m)}</td>
  </tr>`).join('');
}
function factualRows(list){
  $('hrpTableTitle').textContent='Фактическая часть';
  $('hrpTableSub').textContent='Неполный месяц и дополнительный день считаются по формулам из HR ТЗ';
  $('hrpTable').className='hrp-table mode-factual';
  $('hrpHead').innerHTML=head([
    {label:'Сотрудник',left:true},{label:'Месячный факт. оклад'},{label:'Норма дней'},{label:'Расчётные дни'},{label:'Начислено за дни'},
    {label:'Официальный Net'},{label:'Доп. часть Gross'},{label:'Доп. часть Net'},{label:'Вознаграждения'},
    {label:'Оплач. доп. часы'},{label:'Неоплач. промежуток'},{label:'Доп. день'},{label:'Отдельная выплата'},
    {label:'Основная выплата'},{label:'Всего к выплате',cls:'accent-head'},{label:'Статус'}
  ]);
  return list.map(m=>{
    return`<tr>
      <td class="text-left">${employeeCell(m)}</td><td class="hrp-monthly">${m.term?money(m.monthlyFactualGross):'—'}</td>
      <td>${m.term?Number(m.proration?.normWorkDays||0):'—'}</td><td>${m.term?Number(m.proration?.factualWorkDays||0):'—'}</td><td class="hrp-money">${m.term?money(m.factualBaseGross):'—'}</td>
      <td>${m.term?money(m.official.net):'—'}</td><td>${m.term?money(m.additionalGross):'—'}</td><td>${m.term?money(m.additionalNet):'—'}</td>
      <td class="hrp-plus">${money(m.rewards)}</td><td class="${m.overtimeMinutes?'hrp-overtime':''}">${hours(m.overtimeMinutes)}</td>
      <td class="${m.unpaidOvertimeMinutes?'hrp-unpaid-ot':''}">${hours(m.unpaidOvertimeMinutes)}</td>
      <td class="${m.extraDayEquivalent?'hrp-overtime':''}">${m.extraDayEquivalent.toLocaleString('ru-RU',{maximumFractionDigits:2})}</td>
      <td class="hrp-extra-pay">${m.term?money(m.extraDayPay):'—'}</td><td class="hrp-regular">${m.term?money(m.regularPayable):'—'}</td>
      <td class="hrp-final">${m.term?money(m.finalPayable):'—'}</td><td>${statusBadge(m)}</td>
    </tr>`;
  }).join('');
}
function officialRows(list){
  $('hrpTableTitle').textContent='Официальная часть';
  $('hrpTableSub').textContent='Официальный Gross также пропорционален официальным датам приёма/увольнения';
  $('hrpTable').className='hrp-table mode-official';
  $('hrpHead').innerHTML=head([
    {label:'Сотрудник',left:true},{label:'Месячный Gross'},{label:'Раб. дни'},{label:'Начислено Gross'},{label:'Налоговая база'},{label:'Подоходный',cls:'tax-head'},{label:'Соц. сотр.',cls:'tax-head'},
    {label:'Безраб. сотр.',cls:'tax-head'},{label:'Мед. сотр.',cls:'tax-head'},{label:'Удержания сотрудника'},{label:'Официальный Net',cls:'accent-head'},
    {label:'Соц. работ.',cls:'employer-head'},{label:'Безраб. работ.',cls:'employer-head'},{label:'Мед. работ.',cls:'employer-head'},
    {label:'Взносы работодателя'},{label:'Официальная стоимость'}
  ]);
  return list.map(m=>{const o=m.official;return`<tr>
    <td class="text-left">${employeeCell(m)}</td><td class="hrp-monthly">${m.term?money(m.monthlyOfficialGross):'—'}</td><td>${m.term?daysCell(m,'official'):'—'}</td>
    <td class="hrp-money">${m.term?money(o.gross):'—'}</td><td>${m.term?money(o.taxableIncome):'—'}</td>
    <td class="hrp-tax">${m.term?money(o.employee.incomeTax):'—'}</td><td class="hrp-tax">${m.term?money(o.employee.socialInsurance):'—'}</td>
    <td class="hrp-tax">${m.term?money(o.employee.unemploymentInsurance):'—'}</td><td class="hrp-tax">${m.term?money(o.employee.medicalInsurance):'—'}</td>
    <td class="hrp-minus">${m.term?money(o.employee.total):'—'}</td><td class="hrp-final">${m.term?money(o.net):'—'}</td>
    <td class="hrp-employer">${m.term?money(o.employer.socialInsurance):'—'}</td><td class="hrp-employer">${m.term?money(o.employer.unemploymentInsurance):'—'}</td>
    <td class="hrp-employer">${m.term?money(o.employer.medicalInsurance):'—'}</td><td class="hrp-employer">${m.term?money(o.employer.total):'—'}</td>
    <td class="hrp-money">${m.term?money(o.totalEmployerCost):'—'}</td>
  </tr>`}).join('');
}
function renderTable(){
  if(mode==='SETTLEMENTS')return;
  const list=selectedModels();$('hrpCount').textContent=`${list.length} сотрудников`;
  let body='';if(mode==='FACTUAL')body=factualRows(list);else if(mode==='OFFICIAL')body=officialRows(list);else body=overallRows(list);
  $('hrpRows').innerHTML=body||`<tr><td colspan="20" class="hr-empty">Сотрудники не найдены.</td></tr>`;
}
function settlementMethod(v){return({CASH:'Наличные',BANK:'Банк',OTHER:'Другое'})[v]||v||'—'}
function settlementVisibleRows(){
  const q=String($('hrpSearch')?.value||'').trim().toLowerCase(),role=$('hrpRole')?.value||'',department=$('hrpDepartmentFilter')?.value||'';
  return (state.settlements?.rows||[]).filter(x=>{
    const activity=Number(x.openingDebt||0)>0||Number(x.currentAccrued||0)>0||Number(x.currentPaid||0)>0||Number(x.closingDebt||0)>0;
    if(!activity)return false;
    if(q&&!String(`${x.name} ${x.code}`).toLowerCase().includes(q))return false;
    if(role&&String(x.roleCode||'')!==role)return false;
    if(department&&String(x.departmentCode||'').trim().toUpperCase()!==department.toUpperCase())return false;
    return true;
  });
}
function renderSettlements(){
  const box=$('hrpSettlementSummary'),tbody=$('hrpSettlementRows');if(!box||!tbody)return;
  const snap=state.settlements||{summary:{},rows:[],access:{}},rows=settlementVisibleRows(),canSettle=Boolean(snap.access?.canSettlePayroll)&&state.payroll?.restaurantScope?.mode!=='CHAIN'&&state.payroll?.payrollView!=='NETWORK_SUMMARY';
  const sum={openingDebt:r(rows.reduce((a,x)=>a+Number(x.openingDebt||0),0)),accrued:r(rows.reduce((a,x)=>a+Number(x.currentAccrued||0),0)),paid:r(rows.reduce((a,x)=>a+Number(x.currentPaid||0),0)),closingDebt:r(rows.reduce((a,x)=>a+Number(x.closingDebt||0),0)),withDebt:rows.filter(x=>Number(x.closingDebt||0)>0).length};
  $('hrpSettlementCount').textContent=`${rows.length} сотрудников с движением`;
  box.innerHTML=[
    ['Долг на начало',money(sum.openingDebt||0),'Перенесено из прошлых месяцев'],
    ['Начислено',money(sum.accrued||0),'Доплата текущего месяца'],
    ['Выплачено',money(sum.paid||0),'Отдельные выплаты текущего месяца'],
    ['Остаток долга',money(sum.closingDebt||0),`Сотрудников с долгом: ${Number(sum.withDebt||0)}`]
  ].map(x=>`<article><span>${esc(x[0])}</span><strong>${esc(x[1])}</strong><small>${esc(x[2])}</small></article>`).join('');
  tbody.innerHTML=rows.length?rows.map(x=>{
    const payments=(x.payments||[]).map(p=>`<div class="hrp-payment-chip"><span>${esc(p.date)} · ${esc(money(p.amount))} · ${esc(settlementMethod(p.method))}${p.accountName?' · '+esc(p.accountName):''}</span>${p.reference?`<small>${esc(p.reference)}</small>`:''}${canSettle?`<button type="button" class="hrp-cancel-payment" data-payment-id="${esc(p.id)}" title="Отменить выплату">×</button>`:''}</div>`).join('');
    return`<tr>
      <td class="text-left"><div class="hr-name">${esc(x.name||'—')}</div><div class="hr-sub">${esc(x.roleName||'')} · ${esc(x.code||'')}</div></td>
      <td>${money(x.openingDebt)}</td>
      <td class="hrp-plus">${money(x.currentAccrued)}</td>
      <td class="hrp-overtime">${hours(x.currentPayableMinutes||0)}</td>
      <td>${Number(x.currentExtraDays||0).toLocaleString('ru-RU',{maximumFractionDigits:2})}</td>
      <td class="hrp-payment-paid">${money(x.currentPaid)}</td>
      <td class="${Number(x.closingDebt||0)>0?'hrp-debt':'hrp-debt-zero'}">${money(x.closingDebt)}</td>
      <td class="text-left"><div class="hrp-payment-history">${payments||'<span class="hr-muted">Нет выплат</span>'}</div></td>
      <td>${canSettle&&Number(x.closingDebt||0)>0?`<button type="button" class="hr-primary hrp-pay-debt" data-employee-id="${esc(x.id)}">Выплатить</button>`:''}</td>
    </tr>`;
  }).join(''):`<tr><td colspan="9" class="hr-empty"><div class="hrp-empty-settlement"><strong>Начислений, выплат и долга по дополнительным часам пока нет.</strong><span>Пока Face ID не подключён, цикл можно проверить вручную: Табель → открыть день → ввести фактические часы → Manager → HR → вернуться в Payroll.</span><a class="hr-link-button" href="/hr-timesheet">Открыть табель и создать тестовый факт</a></div></td></tr>`;
}
function defaultPaymentDate(month){
  const today=new Date().toISOString().slice(0,10);
  if(today.startsWith(month+'-'))return today;
  const a=month.split('-').map(Number),last=new Date(Date.UTC(a[0],a[1],0)).getUTCDate();
  return month+'-'+String(last).padStart(2,'0');
}
function paymentRow(){return (state.settlements?.rows||[]).find(x=>String(x.id)===String(paymentEmployeeId))||null}
function updatePaymentAccountSelector(){
  const row=paymentRow(),method=$('hrpPaymentMethod').value,field=$('hrpPaymentBankField'),select=$('hrpPaymentBankAccount');
  field.hidden=method!=='BANK';
  if(method!=='BANK')return;
  const banks=row?.paymentAccounts?.banks||[],def=banks.find(x=>x.isDefault)||banks[0]||null;
  select.innerHTML=banks.length?banks.map(x=>`<option value="${esc(x.id)}">${esc(x.name||x.id)}${x.isDefault?' — по умолчанию':''}</option>`).join(''):'<option value="">Банковские счета не настроены</option>';
  if(def)select.value=String(def.id);
}
function openPayment(employeeId){
  const row=(state.settlements?.rows||[]).find(x=>String(x.id)===String(employeeId));if(!row)return;
  paymentEmployeeId=String(employeeId);
  $('hrpPaymentEmployee').innerHTML=`<strong>${esc(row.name||'—')}</strong><span>${esc(row.roleName||'')} · ${esc(row.code||'')}</span>`;
  $('hrpPaymentDebt').textContent=money(row.closingDebt||0);
  $('hrpPaymentDate').value=defaultPaymentDate($('hrpMonth').value||monthNow());
  $('hrpPaymentAmount').value=Number(row.closingDebt||0).toFixed(2);
  $('hrpPaymentAmount').max=Number(row.closingDebt||0).toFixed(2);
  $('hrpPaymentMethod').value='CASH';$('hrpPaymentReference').value='';$('hrpPaymentNote').value='';updatePaymentAccountSelector();
  $('hrpPaymentModal').hidden=false;document.body.style.overflow='hidden';
}
function closePayment(){paymentEmployeeId='';$('hrpPaymentModal').hidden=true;document.body.style.overflow=''}
async function savePayment(){
  if(paymentBusy||!paymentEmployeeId)return;
  const amount=Number($('hrpPaymentAmount').value||0),paymentDate=$('hrpPaymentDate').value;
  if(!paymentDate||!Number.isFinite(amount)||amount<=0)return alert('Укажите дату и сумму выплаты.');
  try{
    paymentBusy=true;$('hrpPaymentSave').disabled=true;setStatus('Сохраняем выплату…','loading');
    const method=$('hrpPaymentMethod').value,bankAccountId=method==='BANK'?$('hrpPaymentBankAccount').value:'';
    if(method==='BANK'&&!bankAccountId)throw new Error('Выберите банковский счёт для выплаты.');
    const out=await settlementPost({action:'RECORD_PAYMENT',month:$('hrpMonth').value||monthNow(),employeeId:paymentEmployeeId,paymentDate,amount,paymentMethod:method,bankAccountId,reference:$('hrpPaymentReference').value||'',note:$('hrpPaymentNote').value||''});
    state.settlements=out;renderSummary();renderSettlements();closePayment();setStatus('Готово','ok');
  }catch(e){console.error(e);alert(e?.message||'Не удалось зарегистрировать выплату');setStatus('Ошибка','error')}
  finally{paymentBusy=false;$('hrpPaymentSave').disabled=false}
}
async function cancelPayment(paymentId){
  if(paymentBusy||!paymentId)return;
  const reason=prompt('Причина отмены выплаты (необязательно):')??null;if(reason===null)return;
  try{
    paymentBusy=true;setStatus('Отменяем выплату…','loading');
    const out=await settlementPost({action:'CANCEL_PAYMENT',month:$('hrpMonth').value||monthNow(),paymentId,reason});
    state.settlements=out;renderSummary();renderSettlements();setStatus('Готово','ok');
  }catch(e){console.error(e);alert(e?.message||'Не удалось отменить выплату');setStatus('Ошибка','error')}
  finally{paymentBusy=false}
}

function renderTabs(){
  const settlements=mode==='SETTLEMENTS';
  document.querySelectorAll('.hrp-tab').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  if($('hrpMainCard'))$('hrpMainCard').hidden=settlements;
  if($('hrpSettlementCard'))$('hrpSettlementCard').hidden=!settlements;
  if($('hrpState'))$('hrpState').hidden=settlements;
  const explain=document.querySelector('.hrp-explain');if(explain)explain.hidden=settlements;
  document.querySelector('.hrp-filter-card')?.classList.toggle('settlement-mode',settlements);
}
function render(){renderFilters();renderScopeHeading();renderRmsApprovals();renderRmsTaxAllocation();renderMonthlyNormPreview();renderRmsHours();renderDepartmentPayroll();renderSummary();renderContext();renderTabs();renderTable();renderSettlements()}
function onFilter(){renderSummary();renderTable();renderSettlements();renderRmsApprovals();renderMonthlyNormPreview();renderRmsHours()}
async function load(){
  if(busy)return;
  try{
    busy=true;$('hrpRefresh').disabled=true;showError();setStatus('Загрузка…','loading');
    const d=await api();state={...d,models:buildModels(d.payroll,d.adjustments,d.tax)};render();setStatus('Готово','ok');
  }catch(e){console.error(e);showError(e?.message||String(e));setStatus('Ошибка','error')}
  finally{busy=false;$('hrpRefresh').disabled=false}
}
async function updateRmsPayroll(evt){
  const button=evt.target.closest('[data-rms-action]');if(!button||busy)return;
  const action=button.dataset.rmsAction,restaurantId=button.dataset.rmsId,month=$('hrpMonth').value;
  const body={action,restaurantId,month};
  if(action==='SAVE_CORRECTION'||action==='REMOVE_CORRECTION'){
    body.employeeId=button.dataset.rmsEmployee;body.workDate=button.dataset.rmsDate;
    if(action==='SAVE_CORRECTION'){
      const raw=prompt('Фактически отработанные минуты в этом RMS за день:',button.dataset.rmsMinutes||'0');
      if(raw===null)return;
      body.workedMinutes=Number(raw);
      const reason=prompt('Причина исправления явки (не менее 10 символов):');
      if(reason===null)return;
      body.reason=reason;
    }else if(!confirm('Отменить эту ручную корректировку явки?'))return;
  }else if(!confirm('Подтвердить действие '+action+' для выбранного RMS?'))return;
  try{
    busy=true;button.disabled=true;showError('');setStatus('Обновление Payroll RMS…','loading');
    await rmsPayrollPost(body);
    const t=await token();
    state.rmsPayroll=await fetchJson('/api/hr/rms-payroll?month='+encodeURIComponent(month),t);
    state.rmsPayrollError='';renderRmsApprovals();setStatus('Payroll RMS обновлён','ok');
  }catch(e){console.error(e);showError(e?.message||String(e));setStatus('Ошибка','error')}
  finally{busy=false;button.disabled=false}
}
function bind(){
  $('hrpRefresh').onclick=load;$('hrpMonth').onchange=load;
  $('hrpSearch').oninput=onFilter;$('hrpRole').onchange=onFilter;$('hrpState').onchange=onFilter;$('hrpDepartmentFilter').onchange=onFilter;
  document.querySelectorAll('.hrp-tab').forEach(b=>b.onclick=()=>{mode=b.dataset.mode||'OVERALL';renderTabs();renderTable();renderSettlements()});
  $('hrpSettlementRows')?.addEventListener('click',e=>{
    const pay=e.target.closest('.hrp-pay-debt');if(pay){openPayment(pay.dataset.employeeId);return}
    const cancel=e.target.closest('.hrp-cancel-payment');if(cancel)cancelPayment(cancel.dataset.paymentId);
  });
  document.querySelectorAll('[data-payment-close]').forEach(x=>x.addEventListener('click',closePayment));
  $('hrpPaymentMethod').onchange=updatePaymentAccountSelector;
  $('hrpPaymentSave').onclick=savePayment;
  $('hrpRmsApproval')?.addEventListener('click',updateRmsPayroll);
}
function init(){$('hrpMonth').value=monthNow();bind();load()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();