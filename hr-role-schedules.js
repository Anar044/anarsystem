(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let data={roles:[],schedules:[],counts:{}},busy=false;

  async function token(){const client=await window.SHAuth?.createClient?.();if(!client)throw new Error('Supabase Auth не готов');const{data,error}=await client.auth.getSession();const t=data?.session?.access_token;if(error||!t)throw new Error('Сессия пользователя не найдена');return t}
  async function api(body=null){const t=await token();const opt={headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}};if(body){opt.method='POST';opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body)}const r=await fetch('/api/hr/role-schedules',opt);const j=await r.json().catch(()=>({success:false,message:'Некорректный ответ API'}));if(!r.ok||!j.success)throw new Error(j.message||`HTTP ${r.status}`);return j}
  function setStatus(text,kind=''){const el=$('rsStatus');el.textContent=text;el.className=`hr-status ${kind}`.trim()}
  function roleName(code){const r=(data.roles||[]).find(x=>x.code===code);return r?.name||code||'—'}
  function fmtDate(v){if(!v)return'∞';const [y,m,d]=String(v).split('-');return `${d}.${m}.${y}`}
  function fmtPattern(s){if(s.patternType==='CYCLE')return `${s.workDays}/${s.offDays}${s.anchorDate?' · от '+fmtDate(s.anchorDate):''}`;const names={1:'Пн',2:'Вт',3:'Ср',4:'Чт',5:'Пт',6:'Сб',7:'Вс'};return (s.weekdays||[]).map(x=>names[x]||x).join(', ')}

  function renderSummary(){const c=data.counts||{};$('rsSummary').innerHTML=`
    <article class="hr-summary-card"><span>Должности iiko</span><strong>${Number(c.roles||0)}</strong><small>Активные должности</small></article>
    <article class="hr-summary-card"><span>Сотрудники</span><strong>${Number(c.employees||0)}</strong><small>Активные сотрудники с должностью</small></article>
    <article class="hr-summary-card"><span>Шаблоны графиков</span><strong>${Number(c.schedules||0)}</strong><small>Активные варианты смен</small></article>
    <article class="hr-summary-card"><span>Без основного графика</span><strong>${Number(c.rolesWithoutDefault||0)}</strong><small>Должности, требующие настройки</small></article>`}
  }

  function renderRoleSelect(){const roles=(data.roles||[]).filter(x=>!x.deleted);const current=$('rsRole').value;$('rsRole').innerHTML=roles.length?roles.map(r=>`<option value="${esc(r.code)}">${esc(r.name)} · ${esc(r.code)}</option>`).join(''):'<option value="">Сначала синхронизируйте должности</option>';if(roles.some(x=>x.code===current))$('rsRole').value=current}

  function renderRoles(){const list=(data.roles||[]).filter(x=>!x.deleted);$('rsRoleCount').textContent=`${list.length} должностей`;$('rsRoleRows').innerHTML=list.length?list.map(r=>`<tr>
    <td class="text-left"><div class="hr-name">${esc(r.name)}</div>${r.id?`<div class="hr-sub">ID ${esc(r.id)}</div>`:''}</td>
    <td><span class="hr-badge">${esc(r.code)}</span></td>
    <td>${Number(r.employeeCount||0)}</td>
    <td>${Number(r.scheduleCount||0)}</td>
    <td>${r.hasDefaultSchedule?'<span class="hr-badge linked">Настроен</span>':'<span class="hr-badge pending">Не настроен</span>'}</td>
    <td><span class="hr-badge active">Из iiko</span></td>
  </tr>`).join(''):'<tr><td colspan="6" class="hr-empty">Должности ещё не синхронизированы. Нажмите «Синхронизировать из iiko».</td></tr>'}

  function renderSchedules(){const list=(data.schedules||[]).filter(x=>x.active);$('rsScheduleCount').textContent=`${list.length} графиков`;$('rsScheduleRows').innerHTML=list.length?list.map(s=>`<tr>
    <td class="text-left"><div class="hr-name">${esc(roleName(s.roleCode))}</div><div class="hr-sub">${esc(s.name)}</div></td>
    <td>${esc(fmtPattern(s))}</td>
    <td><span class="hr-badge active">${esc(s.shiftStart)}–${esc(s.shiftEnd)}</span></td>
    <td>${Number(s.breakMinutes||0)} мин</td>
    <td>${esc(fmtDate(s.validFrom))} → ${s.validTo?esc(fmtDate(s.validTo)):'без окончания'}</td>
    <td>${s.isDefault?'<span class="hr-badge linked">Основной</span>':'<span class="hr-badge">Дополнительный</span>'}</td>
    <td><div class="hr-device-actions"><button type="button" class="hr-link-button" data-edit="${esc(s.id)}">Изменить</button><button type="button" class="hr-link-button danger" data-disable="${esc(s.id)}">Отключить</button></div></td>
  </tr>`).join(''):'<tr><td colspan="7" class="hr-empty">Графики ещё не созданы.</td></tr>';
    $('rsScheduleRows').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editSchedule(b.dataset.edit));
    $('rsScheduleRows').querySelectorAll('[data-disable]').forEach(b=>b.onclick=()=>disableSchedule(b.dataset.disable));
  }

  function render(){renderSummary();renderRoleSelect();renderRoles();renderSchedules()}
  function weekdays(){return [...document.querySelectorAll('#weeklyBox input[type="checkbox"]:checked')].map(x=>Number(x.value))}
  function setWeekdays(values){const set=new Set((values||[]).map(Number));document.querySelectorAll('#weeklyBox input[type="checkbox"]').forEach(x=>x.checked=set.has(Number(x.value)))}
  function updatePattern(){const cycle=$('rsPattern').value==='CYCLE';$('weeklyBox').hidden=cycle;$('cycleBox').hidden=!cycle;$('rsAnchor').required=cycle}
  function today(){const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`}

  function resetForm(){
    $('rsId').value='';$('rsName').value='';$('rsPattern').value='WEEKLY';$('rsStart').value='09:00';$('rsEnd').value='18:00';$('rsBreak').value='60';$('rsValidFrom').value=today();$('rsValidTo').value='';$('rsWorkDays').value='2';$('rsOffDays').value='2';$('rsAnchor').value=today();$('rsDefault').checked=false;setWeekdays([1,2,3,4,5]);updatePattern();
  }

  function editSchedule(id){const s=(data.schedules||[]).find(x=>x.id===id);if(!s)return;$('rsId').value=s.id;$('rsRole').value=s.roleCode;$('rsName').value=s.name;$('rsPattern').value=s.patternType;$('rsStart').value=s.shiftStart;$('rsEnd').value=s.shiftEnd;$('rsBreak').value=s.breakMinutes;$('rsValidFrom').value=s.validFrom;$('rsValidTo').value=s.validTo||'';$('rsWorkDays').value=s.workDays||2;$('rsOffDays').value=s.offDays||2;$('rsAnchor').value=s.anchorDate||today();$('rsDefault').checked=Boolean(s.isDefault);setWeekdays(s.weekdays||[]);updatePattern();document.querySelector('.hr-schedule-form')?.scrollIntoView({behavior:'smooth',block:'center'});setStatus('Редактирование графика','loading')}

  async function load(){if(busy)return;try{busy=true;$('rsRefresh').disabled=true;$('rsError').hidden=true;setStatus('Загрузка…','loading');data=await api();render();if(!$('rsValidFrom').value)resetForm();setStatus('Готово','ok')}catch(e){$('rsError').hidden=false;$('rsError').textContent=e.message;setStatus('Ошибка','error')}finally{busy=false;$('rsRefresh').disabled=false}}
  async function syncRoles(){if(busy)return;try{busy=true;$('rsSync').disabled=true;$('rsError').hidden=true;setStatus('Синхронизация iiko…','loading');data=await api({action:'syncRoles'});render();setStatus('Должности синхронизированы','ok')}catch(e){$('rsError').hidden=false;$('rsError').textContent=e.message;setStatus('Ошибка','error')}finally{busy=false;$('rsSync').disabled=false}}
  async function save(ev){ev.preventDefault();try{setStatus('Сохраняем график…','loading');const body={action:'saveSchedule',id:$('rsId').value,roleCode:$('rsRole').value,name:$('rsName').value,patternType:$('rsPattern').value,shiftStart:$('rsStart').value,shiftEnd:$('rsEnd').value,breakMinutes:Number($('rsBreak').value||0),validFrom:$('rsValidFrom').value,validTo:$('rsValidTo').value,isDefault:$('rsDefault').checked,weekdays:weekdays(),workDays:Number($('rsWorkDays').value||2),offDays:Number($('rsOffDays').value||2),anchorDate:$('rsAnchor').value};data=await api(body);render();resetForm();setStatus('График сохранён','ok')}catch(e){$('rsError').hidden=false;$('rsError').textContent=e.message;setStatus('Ошибка','error')}}
  async function disableSchedule(id){const s=(data.schedules||[]).find(x=>x.id===id);if(!confirm(`Отключить график «${s?.name||''}»? История останется в базе.`))return;try{setStatus('Отключаем…','loading');data=await api({action:'disableSchedule',id});render();if($('rsId').value===id)resetForm();setStatus('График отключён','ok')}catch(e){$('rsError').hidden=false;$('rsError').textContent=e.message;setStatus('Ошибка','error')}}

  function bind(){$('rsRefresh').onclick=load;$('rsSync').onclick=syncRoles;$('rsReset').onclick=resetForm;$('rsPattern').onchange=updatePattern;$('rsForm').onsubmit=save}
  async function init(){bind();resetForm();await load()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
