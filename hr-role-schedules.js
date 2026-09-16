(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dayNames={1:'Понедельник',2:'Вторник',3:'Среда',4:'Четверг',5:'Пятница',6:'Суббота',7:'Воскресенье'};
  const dayShort={1:'Пн',2:'Вт',3:'Ср',4:'Чт',5:'Пт',6:'Сб',7:'Вс'};
  let data={roles:[],schedules:[],counts:{}},busy=false;

  async function token(){const client=await window.SHAuth?.createClient?.();if(!client)throw new Error('Supabase Auth не готов');const{data,error}=await client.auth.getSession();const t=data?.session?.access_token;if(error||!t)throw new Error('Сессия пользователя не найдена');return t}
  async function api(body=null){const t=await token();const opt={headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}};if(body){opt.method='POST';opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body)}const r=await fetch('/api/hr/role-schedules',opt);const j=await r.json().catch(()=>({success:false,message:'Некорректный ответ API'}));if(!r.ok||!j.success)throw new Error(j.message||`HTTP ${r.status}`);return j}
  function setStatus(text,kind=''){const el=$('rsStatus');el.textContent=text;el.className=`hr-status ${kind}`.trim()}
  function roleName(code){const r=(data.roles||[]).find(x=>x.code===code);return r?.name||code||'—'}
  function fmtDate(v){if(!v)return'∞';const [y,m,d]=String(v).split('-');return `${d}.${m}.${y}`}
  function today(){const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`}
  function timeMinutes(v){const m=/^(\d{2}):(\d{2})$/.exec(String(v||''));return m?Number(m[1])*60+Number(m[2]):null}
  function netMinutes(start,end,breakMinutes=0){const a=timeMinutes(start),b=timeMinutes(end);if(a===null||b===null)return 0;let span=b-a;if(span<=0)span+=1440;return Math.max(0,span-Math.max(0,Number(breakMinutes)||0))}
  function durationText(minutes){const n=Math.max(0,Math.round(Number(minutes)||0)),h=Math.floor(n/60),m=n%60;return [h?`${h} ч`:'',m?`${m} мин`:''].filter(Boolean).join(' ')||'0 мин'}
  function hoursText(minutes){const n=Math.max(0,Number(minutes)||0);return Number.isInteger(n/60)?`${n/60} ч`:`${(n/60).toFixed(1)} ч`}

  function renderSummary(){const c=data.counts||{};$('rsSummary').innerHTML=`
    <article class="hr-summary-card"><span>Должности iiko</span><strong>${Number(c.roles||0)}</strong><small>Активные должности</small></article>
    <article class="hr-summary-card"><span>Сотрудники</span><strong>${Number(c.employees||0)}</strong><small>Активные сотрудники с должностью</small></article>
    <article class="hr-summary-card"><span>Шаблоны графиков</span><strong>${Number(c.schedules||0)}</strong><small>Проверенные варианты смен</small></article>
    <article class="hr-summary-card"><span>Без основного графика</span><strong>${Number(c.rolesWithoutDefault||0)}</strong><small>Должности, требующие настройки</small></article>`}

  function renderRoleSelect(){const roles=(data.roles||[]).filter(x=>!x.deleted);const current=$('rsRole').value;$('rsRole').innerHTML=roles.length?roles.map(r=>`<option value="${esc(r.code)}">${esc(r.name)} · ${esc(r.code)}</option>`).join(''):'<option value="">Сначала синхронизируйте должности</option>';if(roles.some(x=>x.code===current))$('rsRole').value=current}

  function renderRoles(){const list=(data.roles||[]).filter(x=>!x.deleted);$('rsRoleCount').textContent=`${list.length} должностей`;$('rsRoleRows').innerHTML=list.length?list.map(r=>`<tr>
    <td class="text-left"><div class="hr-name">${esc(r.name)}</div>${r.id?`<div class="hr-sub">ID ${esc(r.id)}</div>`:''}</td>
    <td><span class="hr-badge">${esc(r.code)}</span></td><td>${Number(r.employeeCount||0)}</td><td>${Number(r.scheduleCount||0)}</td>
    <td>${r.hasDefaultSchedule?'<span class="hr-badge linked">Настроен</span>':'<span class="hr-badge pending">Не настроен</span>'}</td>
    <td><span class="hr-badge active">Из iiko</span></td></tr>`).join(''):'<tr><td colspan="6" class="hr-empty">Должности ещё не синхронизированы.</td></tr>'}

  function scheduleMinutes(s){return (s.dayRules||[]).reduce((sum,r)=>sum+netMinutes(r.shiftStart,r.shiftEnd,r.breakMinutes),0)}
  function fmtPattern(s){if(s.patternType==='CYCLE')return `${s.workDays}/${s.offDays} · суммированный`;const count=(s.weekdays||[]).length;return count===6?'6/1':count===5?'5/2':(s.weekdays||[]).map(x=>dayShort[x]||x).join(', ')}
  function renderSchedules(){const list=(data.schedules||[]).filter(x=>x.active);$('rsScheduleCount').textContent=`${list.length} графиков`;$('rsScheduleRows').innerHTML=list.length?list.map(s=>{
    const weekly=s.patternType==='WEEKLY',minutes=weekly?scheduleMinutes(s):netMinutes(s.shiftStart,s.shiftEnd,s.breakMinutes);
    const shift=weekly?`${(s.weekdays||[]).length} дн. · ${hoursText(minutes)}/нед.`:`${esc(s.shiftStart)}–${esc(s.shiftEnd)} · ${durationText(minutes)}`;
    const accounting=s.accountingMode==='SUMMARIZED'?`Суммированный · ${Number(s.accountingPeriodMonths||1)} мес.`:(s.accountingMode==='NORMAL_6_DAY'?'6-дневная неделя':'Нормальная неделя');
    return `<tr><td class="text-left"><div class="hr-name">${esc(roleName(s.roleCode))}</div><div class="hr-sub">${esc(s.name)}</div></td>
      <td>${esc(fmtPattern(s))}</td><td><span class="hr-badge active">${shift}</span></td><td>${esc(accounting)}</td>
      <td>${esc(fmtDate(s.validFrom))} → ${s.validTo?esc(fmtDate(s.validTo)):'без окончания'}</td>
      <td>${s.isDefault?'<span class="hr-badge linked">Основной</span>':'<span class="hr-badge">Дополнительный</span>'}</td>
      <td><div class="hr-device-actions"><button type="button" class="hr-link-button" data-edit="${esc(s.id)}">Изменить</button><button type="button" class="hr-link-button danger" data-disable="${esc(s.id)}">Отключить</button></div></td></tr>`
  }).join(''):'<tr><td colspan="7" class="hr-empty">Графики ещё не созданы.</td></tr>';
    $('rsScheduleRows').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editSchedule(b.dataset.edit));
    $('rsScheduleRows').querySelectorAll('[data-disable]').forEach(b=>b.onclick=()=>disableSchedule(b.dataset.disable));
  }

  function weekdays(){return [...document.querySelectorAll('#weeklyBox .hr-weekdays input[type="checkbox"]:checked')].map(x=>Number(x.value))}
  function setWeekdays(values){const set=new Set((values||[]).map(Number));document.querySelectorAll('#weeklyBox .hr-weekdays input[type="checkbox"]').forEach(x=>x.checked=set.has(Number(x.value)))}
  function weekdayText(values){const v=values||[];if(v.length===5&&v.every((x,i)=>x===i+1))return'Пн–Пт';if(v.length===6&&v.every((x,i)=>x===i+1))return'Пн–Сб';return v.map(x=>dayShort[x]||x).join(', ')||'Дни не выбраны'}

  function existingDayRuleMap(){const map=new Map();document.querySelectorAll('#rsDayRules [data-day-rule]').forEach(row=>{const day=Number(row.dataset.dayRule);map.set(day,{weekday:day,shiftStart:row.querySelector('[data-day-start]')?.value||$('rsStart').value,shiftEnd:row.querySelector('[data-day-end]')?.value||$('rsEnd').value,breakMinutes:Number(row.querySelector('[data-day-break]')?.value||0)})});return map}
  function renderDayRules(seedRules=null){
    const box=$('rsDayRules');if(!box)return;const old=seedRules?new Map((seedRules||[]).map(r=>[Number(r.weekday),r])):existingDayRuleMap();const days=weekdays();
    box.innerHTML=days.map(day=>{const r=old.get(day)||{shiftStart:$('rsStart').value,shiftEnd:$('rsEnd').value,breakMinutes:Number($('rsBreak').value||0)};return `<div class="hr-day-rule" data-day-rule="${day}"><div class="hr-day-name"><strong>${dayShort[day]}</strong><span>${dayNames[day]}</span></div><label>Начало<input data-day-start type="time" value="${esc(r.shiftStart||$('rsStart').value)}"></label><label>Конец<input data-day-end type="time" value="${esc(r.shiftEnd||$('rsEnd').value)}"></label><label>Перерыв<input data-day-break type="number" min="0" max="600" step="5" value="${Number(r.breakMinutes??$('rsBreak').value??0)}"></label><div class="hr-day-hours" data-day-hours></div></div>`}).join('');
    box.querySelectorAll('input').forEach(x=>{x.addEventListener('input',updateLivePreview);x.addEventListener('change',updateLivePreview)});updateDayHours();
  }
  function collectDayRules(){return [...document.querySelectorAll('#rsDayRules [data-day-rule]')].map(row=>({weekday:Number(row.dataset.dayRule),shiftStart:row.querySelector('[data-day-start]').value,shiftEnd:row.querySelector('[data-day-end]').value,breakMinutes:Number(row.querySelector('[data-day-break]').value||0)}))}
  function updateDayHours(){document.querySelectorAll('#rsDayRules [data-day-rule]').forEach(row=>{const m=netMinutes(row.querySelector('[data-day-start]')?.value,row.querySelector('[data-day-end]')?.value,row.querySelector('[data-day-break]')?.value);const out=row.querySelector('[data-day-hours]');if(out)out.textContent=durationText(m)})}

  function updateLivePreview(){
    const baseNet=netMinutes($('rsStart').value,$('rsEnd').value,$('rsBreak').value);$('rsShiftDuration').textContent=durationText(baseNet);updateDayHours();
    const cycle=$('rsPattern').value==='CYCLE';$('rsPatternHint').textContent=cycle?'Суммированный учёт: итоговая норма проверяется по производственному календарю':'Для каждого выбранного дня можно задать своё время';
    if(cycle){const w=Number($('rsWorkDays').value||0),o=Number($('rsOffDays').value||0),avg=w+o?baseNet*w/(w+o)*7:0;$('rsLiveSummary').textContent=`${w}/${o} · ${$('rsStart').value}–${$('rsEnd').value} · ${durationText(baseNet)} · ≈ ${hoursText(avg)}/нед. · учёт ${Number($('rsAccountingMonths').value||1)} мес.`;return}
    const rules=collectDayRules(),weekly=rules.reduce((sum,r)=>sum+netMinutes(r.shiftStart,r.shiftEnd,r.breakMinutes),0);$('rsLiveSummary').textContent=`${weekdayText(weekdays())} · ${hoursText(weekly)}/нед.`;
  }

  function updatePattern(){const cycle=$('rsPattern').value==='CYCLE';$('weeklyBox').hidden=cycle;$('cycleBox').hidden=!cycle;$('rsAnchor').required=cycle;if(!cycle&&!$('rsDayRules').children.length)renderDayRules();updateLivePreview()}
  function weeklySeed(days,start,end,pause,shortDay=null,shortEnd=''){return days.map(day=>({weekday:day,shiftStart:start,shiftEnd:day===shortDay?shortEnd:end,breakMinutes:pause}))}
  function applyPreset(name){
    if(name==='WEEKLY_5_2'){$('rsPattern').value='WEEKLY';$('rsStart').value='09:00';$('rsEnd').value='18:00';$('rsBreak').value='60';setWeekdays([1,2,3,4,5]);renderDayRules(weeklySeed([1,2,3,4,5],'09:00','18:00',60))}
    if(name==='WEEKLY_6_1'){$('rsPattern').value='WEEKLY';$('rsStart').value='09:00';$('rsEnd').value='17:00';$('rsBreak').value='60';setWeekdays([1,2,3,4,5,6]);renderDayRules(weeklySeed([1,2,3,4,5,6],'09:00','17:00',60,6,'15:00'))}
    if(name==='CYCLE_2_2'){$('rsPattern').value='CYCLE';$('rsWorkDays').value='2';$('rsOffDays').value='2';$('rsAccountingMonths').value='1';if(!$('rsAnchor').value)$('rsAnchor').value=today()}
    if(name==='CYCLE_3_3'){$('rsPattern').value='CYCLE';$('rsWorkDays').value='3';$('rsOffDays').value='3';$('rsAccountingMonths').value='1';if(!$('rsAnchor').value)$('rsAnchor').value=today()}
    updatePattern();
  }

  function render(){renderSummary();renderRoleSelect();renderRoles();renderSchedules();updateLivePreview()}
  function resetForm(){$('rsId').value='';$('rsName').value='';$('rsPattern').value='WEEKLY';$('rsStart').value='09:00';$('rsEnd').value='18:00';$('rsBreak').value='60';$('rsValidFrom').value=today();$('rsValidTo').value='';$('rsWorkDays').value='2';$('rsOffDays').value='2';$('rsAnchor').value=today();$('rsAccountingMonths').value='1';$('rsDefault').checked=false;setWeekdays([1,2,3,4,5]);renderDayRules(weeklySeed([1,2,3,4,5],'09:00','18:00',60));updatePattern()}

  function editSchedule(id){const s=(data.schedules||[]).find(x=>x.id===id);if(!s)return;$('rsId').value=s.id;$('rsRole').value=s.roleCode;$('rsName').value=s.name;$('rsPattern').value=s.patternType;$('rsStart').value=s.shiftStart;$('rsEnd').value=s.shiftEnd;$('rsBreak').value=s.breakMinutes;$('rsValidFrom').value=s.validFrom;$('rsValidTo').value=s.validTo||'';$('rsWorkDays').value=s.workDays||2;$('rsOffDays').value=s.offDays||2;$('rsAnchor').value=s.anchorDate||today();$('rsAccountingMonths').value=s.accountingPeriodMonths||1;$('rsDefault').checked=Boolean(s.isDefault);setWeekdays(s.weekdays||[]);if(s.patternType==='WEEKLY')renderDayRules(s.dayRules||[]);updatePattern();document.querySelector('.hr-schedule-builder')?.scrollIntoView({behavior:'smooth',block:'start'});setStatus('Редактирование графика','loading')}

  async function load(){if(busy)return;try{busy=true;$('rsRefresh').disabled=true;$('rsError').hidden=true;setStatus('Загрузка…','loading');data=await api();render();if(!$('rsValidFrom').value)resetForm();setStatus('Готово','ok')}catch(e){$('rsError').hidden=false;$('rsError').textContent=e.message;setStatus('Ошибка','error')}finally{busy=false;$('rsRefresh').disabled=false}}
  async function syncRoles(){if(busy)return;try{busy=true;$('rsSync').disabled=true;$('rsError').hidden=true;setStatus('Синхронизация iiko…','loading');data=await api({action:'syncRoles'});render();setStatus('Должности синхронизированы','ok')}catch(e){$('rsError').hidden=false;$('rsError').textContent=e.message;setStatus('Ошибка','error')}finally{busy=false;$('rsSync').disabled=false}}
  async function save(ev){ev.preventDefault();try{setStatus('Проверяем и сохраняем…','loading');const body={action:'saveSchedule',id:$('rsId').value,roleCode:$('rsRole').value,name:$('rsName').value,patternType:$('rsPattern').value,shiftStart:$('rsStart').value,shiftEnd:$('rsEnd').value,breakMinutes:Number($('rsBreak').value||0),validFrom:$('rsValidFrom').value,validTo:$('rsValidTo').value,isDefault:$('rsDefault').checked,weekdays:weekdays(),dayRules:collectDayRules(),workDays:Number($('rsWorkDays').value||2),offDays:Number($('rsOffDays').value||2),anchorDate:$('rsAnchor').value,accountingPeriodMonths:Number($('rsAccountingMonths').value||1)};data=await api(body);render();resetForm();setStatus('График проверен и сохранён','ok')}catch(e){$('rsError').hidden=false;$('rsError').textContent=e.message;setStatus('Ошибка','error')}}
  async function disableSchedule(id){const s=(data.schedules||[]).find(x=>x.id===id);if(!confirm(`Отключить график «${s?.name||''}»? История останется в базе.`))return;try{setStatus('Отключаем…','loading');data=await api({action:'disableSchedule',id});render();if($('rsId').value===id)resetForm();setStatus('График отключён','ok')}catch(e){$('rsError').hidden=false;$('rsError').textContent=e.message;setStatus('Ошибка','error')}}

  function bind(){
    $('rsRefresh').onclick=load;$('rsSync').onclick=syncRoles;$('rsReset').onclick=resetForm;$('rsClear').onclick=resetForm;$('rsPattern').onchange=updatePattern;$('rsForm').onsubmit=save;
    document.querySelectorAll('[data-schedule-preset]').forEach(b=>b.onclick=()=>applyPreset(b.dataset.schedulePreset));
    ['rsRole','rsName','rsStart','rsEnd','rsBreak','rsWorkDays','rsOffDays','rsAnchor','rsAccountingMonths','rsValidFrom','rsValidTo','rsDefault'].forEach(id=>{$(id)?.addEventListener('input',updateLivePreview);$(id)?.addEventListener('change',updateLivePreview)});
    document.querySelectorAll('#weeklyBox .hr-weekdays input[type="checkbox"]').forEach(x=>x.addEventListener('change',()=>{renderDayRules();updateLivePreview()}));
  }
  async function init(){bind();resetForm();await load()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
