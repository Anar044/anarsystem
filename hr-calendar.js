(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let data=null,busy=false;

  async function token(){const client=await window.SHAuth?.createClient?.();if(!client)throw new Error('Supabase Auth не готов');const{data,error}=await client.auth.getSession();const t=data?.session?.access_token;if(error||!t)throw new Error('Сессия пользователя не найдена');return t}
  function setStatus(text,kind=''){const el=$('calStatus');if(!el)return;el.textContent=text;el.className=`hr-status ${kind}`.trim()}
  async function api(){const t=await token();const year=$('calYear')?.value||'2026';const r=await fetch(`/api/hr/work-calendar?year=${encodeURIComponent(year)}`,{headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}});const j=await r.json().catch(()=>({success:false,message:'Некорректный ответ API'}));if(!r.ok||!j.success)throw new Error(j.message||`HTTP ${r.status}`);return j}
  function localDate(v){if(!v)return'';try{return new Date(`${v}T00:00:00`).toLocaleDateString('ru-RU',{day:'2-digit',month:'short',year:'numeric'})}catch{return String(v)}}

  function renderSummary(){const s=data?.summary||{};$('calSummary').innerHTML=`
    <article class="hr-summary-card"><span>Рабочих дней</span><strong>${Number(s.workDays||0)}</strong><small>Официальная норма ${esc(data?.year||'')}</small></article>
    <article class="hr-summary-card"><span>Норма часов</span><strong>${Number(s.hours||0)}</strong><small>40-часовая рабочая неделя</small></article>
    <article class="hr-summary-card"><span>Нерабочих дней</span><strong>${Number(s.nonWorkingDays||0)}</strong><small>Выходные, праздники и переносы</small></article>
    <article class="hr-summary-card"><span>Сокращённых дней</span><strong>${Number(s.shortDays||0)}</strong><small>Рабочий день на 1 час меньше</small></article>`}

  function renderMonths(){const rows=data?.months||[];$('calMonthCount').textContent=`${rows.length} месяцев`;$('calMonthRows').innerHTML=rows.map(x=>`<tr><td class="text-left"><div class="hr-name">${esc(x.name)}</div></td><td>${Number(x.calendarDays||0)}</td><td>${Number(x.workDays||0)}</td><td>${Number(x.nonWorkingDays||0)}</td><td>${Number(x.shortDays||0)}</td><td><span class="hr-badge linked">${Number(x.hours||0)} ч</span></td></tr>`).join('')}

  function label(type){if(type==='HOLIDAY')return'Праздник';if(type==='MOURNING')return'День скорби';if(type==='TRANSFERRED_REST')return'Перенос';if(type==='SHORT_WORKDAY')return'Сокращённый день';return type}
  function badge(type){if(type==='SHORT_WORKDAY')return'pending';if(type==='TRANSFERRED_REST')return'fired';return'linked'}
  function renderSpecialDays(){const rows=(data?.days||[]).filter(x=>['HOLIDAY','MOURNING','TRANSFERRED_REST','SHORT_WORKDAY'].includes(x.type));$('calSpecialCount').textContent=`${rows.length} дат`;$('calSpecialDays').innerHTML=rows.length?rows.map(x=>`<article class="hr-calendar-event"><div><span>${esc(localDate(x.date))}</span><strong>${esc(x.name)}</strong></div><div><span class="hr-badge ${badge(x.type)}">${esc(label(x.type))}</span>${x.workHours?`<small>${Number(x.workHours)} ч</small>`:''}</div></article>`).join(''):'<div class="hr-empty">Нет специальных дат</div>'}

  function renderNotes(){const s=data?.summary||{},notes=data?.legalNotes||[];$('calLegalNotes').innerHTML=notes.map((x,i)=>`<article class="hr-rule-card"><span>${String(i+1).padStart(2,'0')}</span><strong>${esc(x)}</strong></article>`).join('')+`<article class="hr-rule-card accent"><span>Σ</span><strong>Суммированный учёт: смена до ${Number(s.maxSummarizedShiftHours||12)} часов, учётный период до ${Number(s.maxAccountingPeriodMonths||12)} месяцев.</strong></article>`}

  function renderSource(){const src=data?.source||{};const a=$('calSource');if(a){a.href=src.url||'#';a.title=[src.title,src.decisionNo?`Решение № ${src.decisionNo}`:''].filter(Boolean).join(' · ')}}
  function render(){renderSummary();renderMonths();renderSpecialDays();renderNotes();renderSource()}

  async function load(){if(busy)return;const err=$('calError');try{busy=true;$('calRefresh').disabled=true;err.hidden=true;setStatus('Загрузка…','loading');data=await api();render();setStatus('Официальный календарь загружен','ok')}catch(e){console.error(e);err.hidden=false;err.textContent=e?.message||String(e);setStatus('Ошибка','error')}finally{busy=false;$('calRefresh').disabled=false}}
  function bind(){$('calRefresh').onclick=load;$('calYear').onchange=load}
  async function init(){bind();await load()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
