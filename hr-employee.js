(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const employeeId=new URLSearchParams(location.search).get('id')||'';
  let data=null,busy=false,dirty=false,historyLoaded=false,leaveData=null,leaveLoaded=false,leaveBusy=false;

  const profileFields={
    hepFin:'fin',hepSsn:'ssn',hepBirthDate:'birthDate',hepPhonePrimary:'phonePrimary',hepPhoneSecondary:'phoneSecondary',hepEmail:'emailPersonal',hepAddress:'address',
    hepEmergencyName:'emergencyContactName',hepEmergencyRelation:'emergencyContactRelation',hepEmergencyPhone:'emergencyContactPhone',
    hepEducationLevel:'educationLevel',hepEducationInstitution:'educationInstitution',hepSpecialty:'specialty',
    hepEmploymentType:'employmentType',hepWorkCapacity:'workCapacityPercent',hepFactualHire:'factualHireDate',hepFactualFire:'factualFireDate',
    hepOfficialHire:'officialHireDate',hepOfficialFire:'officialFireDate',hepOfficialEmployer:'officialEmployerName',hepOfficialVoen:'officialEmployerVoen',
    hepQuotaCategory:'quotaCategory',hepNotes:'notes'
  };

  const fieldLabels={
    fin:'FIN',ssn:'SSN',birthDate:'Дата рождения',phonePrimary:'Основной телефон',phoneSecondary:'Доп. телефон',emailPersonal:'Личный e-mail',address:'Адрес',
    emergencyContactName:'Экстренный контакт',emergencyContactRelation:'Кем приходится',emergencyContactPhone:'Телефон экстренного контакта',
    educationLevel:'Уровень образования',educationInstitution:'Учебное заведение',specialty:'Специальность',
    employmentType:'Тип занятости',workCapacityPercent:'Рабочая нагрузка',factualHireDate:'Фактически работает с',factualFireDate:'Фактически до',
    officialHireDate:'Официально принят',officialFireDate:'Официально уволен',officialEmployerName:'Работодатель / юр. лицо',officialEmployerVoen:'VÖEN',
    quotaCategory:'Категория / квота',notes:'Примечание HR',
    factualRateType:'Тип фактической ставки',factualRate:'Фактическая ставка',officialRateType:'Тип официальной ставки',officialRate:'Официальная ставка',effectiveFrom:'Действует с',effectiveTo:'Действует по',
    entitledDays:'Начислено дней',adjustmentDays:'Корректировка дней',manualActivated:'Ручная активация',typeCode:'Вид отпуска',contour:'Контур отпуска',dateFrom:'Отпуск с',dateTo:'Отпуск по',days:'Дней отпуска',status:'Статус отпуска'
  };

  async function token(){
    const client=await window.SHAuth?.createClient?.();
    if(!client)throw new Error('Supabase Auth не готов');
    const{data,error}=await client.auth.getSession();
    const t=data?.session?.access_token;
    if(error||!t)throw new Error('Сессия пользователя не найдена');
    return t;
  }
  function setError(message=''){const el=$('hepError');if(!el)return;el.hidden=!message;el.textContent=message||''}
  function setSaveState(text,kind=''){const el=$('hepSaveState');if(!el)return;el.textContent=text;el.className=`hr-status ${kind}`.trim()}
  function money(v){return new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0))+' ₼'}
  function initials(name){const p=String(name||'').trim().split(/\s+/).filter(Boolean);return (p[0]?.[0]||'')+(p[1]?.[0]||'')||'—'}
  function val(v){return v===null||v===undefined||v===''?'—':String(v)}
  function prettyValue(v){
    if(v===null||v===undefined||v==='')return '—';
    if(typeof v==='boolean')return v?'Да':'Нет';
    if(typeof v==='object')return JSON.stringify(v);
    return String(v);
  }
  function employmentLabel(v){return({MAIN:'Основной сотрудник',PART_TIME:'Неполная ставка',SECONDARY:'Совместитель',OTHER:'Другое'})[v]||v||'—'}
  function quotaLabel(v){return({NONE:'Нет',MINOR:'Несовершеннолетний',DISABILITY:'Инвалидность',OTHER:'Другая особая категория'})[v]||v||'—'}
  function rateTypeLabel(v){return String(v||'MONTHLY').toUpperCase()==='HOURLY'?'Почасовая':'Месячная'}
  function isoToday(){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baku',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}catch{return new Date().toISOString().slice(0,10)}}
  function addDays(v,days){const d=new Date(`${v}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
  function setDirty(next){
    dirty=Boolean(next);
    if(dirty)setSaveState('Есть несохранённые изменения','loading');
    else if(!busy)setSaveState('Готово','ok');
  }

  async function api(path,options={},timeout=60000){
    const t=await token(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const response=await (window.SH_IikoContext?.fetchWithTimeout
        ? window.SH_IikoContext.fetchWithTimeout(path,{...options,headers:{Authorization:`Bearer ${t}`,Accept:'application/json','Content-Type':'application/json',...(options.headers||{})}},timeout)
        : fetch(path,{...options,signal:controller.signal,headers:{Authorization:`Bearer ${t}`,Accept:'application/json','Content-Type':'application/json',...(options.headers||{})}}));
      const result=await response.json().catch(()=>({success:false,message:'Сервер вернул некорректный ответ'}));
      if(!response.ok||result?.success===false)throw new Error(result?.message||`HTTP ${response.status}`);
      return result;
    }finally{clearTimeout(timer)}
  }

  function fillProfile(p={}){
    for(const [id,key] of Object.entries(profileFields)){
      const el=$(id);if(!el)continue;
      let value=p[key]??'';
      if(id==='hepEmploymentType')value=value||'MAIN';
      if(id==='hepQuotaCategory')value=value||'NONE';
      if(id==='hepWorkCapacity')value=Number(value||100);
      el.value=value;
    }
  }

  function collectProfile(){
    const out={};
    for(const [id,key] of Object.entries(profileFields)){const el=$(id);if(el)out[key]=id==='hepWorkCapacity'?Number(el.value||100):el.value}
    return out;
  }

  function renderHero(){
    const e=data?.employee||{};
    $('hepName').textContent=e.name||'Сотрудник';
    $('hepAvatar').textContent=initials(e.name);
    const fired=Boolean(e.deleted||e.fireDate);
    const badge=$('hepEmployeeStatus');badge.textContent=fired?'Уволен':'Активен';badge.className=`hr-badge ${fired?'fired':'active'}`;
    $('hepHeroSub').innerHTML=[
      `<span>Табельный № <b>${esc(e.code||'—')}</b></span>`,
      `<span>Должность <b>${esc(e.roleName||e.roleCode||'—')}</b></span>`,
      `<span>Подразделение <b>${esc(e.departmentCode||'—')}</b></span>`,
      `<span>ID <b>${esc(e.id||'—')}</b></span>`
    ].join('');
  }

  function renderWork(){
    const e=data?.employee||{};
    $('hepShCode').textContent=val(e.code);
    $('hepShRole').textContent=val(e.roleName||e.roleCode);
    $('hepShDepartment').textContent=val(e.departmentCode);
    $('hepShHire').textContent=val(e.hireDate);
    $('hepShFire').textContent=val(e.fireDate);
    $('hepFaceId').textContent=e.attendanceExternalId?`${e.attendanceProvider||'DEVICE'} · ${e.attendanceExternalId}`:'Не связан';
  }

  function renderLegacyPay(){
    const card=$('hepLegacyPayCard'),host=$('hepLegacyPay');
    if(!card||!host)return;
    const c=data?.compensation||{},term=c.term||{},calc=c.calculation||{},official=calc.official||{};
    card.hidden=!c.configured;
    if(!c.configured){host.innerHTML='';return}
    host.innerHTML=`<div class="hep-legacy-note">Старая модель: <b>${esc(c.sourceLabel||'Условия оплаты')}</b>. Официальный Gross: <b>${money(term.officialGross)}</b>, дополнительная выплата: <b>${money(term.additionalAmount)}</b>, рассчитанный Net: <b>${money(official.net)}</b>. Эти значения показываются только для справки и не переносятся автоматически в новую схему.</div>`;
  }

  function currentPayMarkup(term){
    if(!term)return '<div class="hep-pay-empty">Новые условия оплаты ещё не заведены. Ниже можно создать первую запись.</div>';
    const preview=term.officialPayrollPreview;
    const factualUnit=term.factualRateType==='HOURLY'?'₼ / час':'₼ / месяц';
    const officialUnit=term.officialRateType==='HOURLY'?'₼ / час':'₼ / месяц';
    const officialMini=term.officialRateType==='MONTHLY'&&preview
      ? `<div><span>Net</span><strong>${money(preview.net)}</strong></div><div><span>Удержания</span><strong>${money(preview.employee?.total)}</strong></div><div><span>Стоимость</span><strong>${money(preview.totalEmployerCost)}</strong></div>`
      : '<div><span>Net</span><strong>По табелю</strong></div><div><span>Налоги</span><strong>В Payroll</strong></div><div><span>Расчёт</span><strong>По часам</strong></div>';
    return `<div class="hep-pay-current">
      <div class="hep-pay-current-card factual">
        <div class="hep-pay-active-line"><span>ДЕЙСТВУЕТ СЕЙЧАС</span><b>с ${esc(term.effectiveFrom)}</b></div>
        <h3>Фактическая зарплата</h3><p>Внутренняя ставка сотрудника</p>
        <div class="hep-pay-rate-value"><strong>${money(term.factualRate).replace(' ₼','')}</strong><span>${esc(factualUnit)}</span></div>
        <div class="hep-pay-mini"><div><span>Тип</span><strong>${esc(rateTypeLabel(term.factualRateType))}</strong></div><div><span>Валюта</span><strong>AZN</strong></div><div><span>Контур</span><strong>Фактический</strong></div></div>
        <div class="hep-pay-period"><span>Период текущей ставки</span><b>${esc(term.effectiveFrom)} → ${esc(term.effectiveTo||'без ограничения')}</b></div>
      </div>
      <div class="hep-pay-current-card official">
        <div class="hep-pay-active-line"><span>ДЕЙСТВУЕТ СЕЙЧАС</span><b>с ${esc(term.effectiveFrom)}</b></div>
        <h3>Официальная зарплата</h3><p>Gross ставка для белого Payroll</p>
        <div class="hep-pay-rate-value"><strong>${money(term.officialRate).replace(' ₼','')}</strong><span>${esc(officialUnit)}</span></div>
        <div class="hep-pay-mini">${officialMini}</div>
        <div class="hep-pay-period"><span>Период текущей ставки</span><b>${esc(term.effectiveFrom)} → ${esc(term.effectiveTo||'без ограничения')}</b></div>
      </div>
    </div>`;
  }

  function renderPayHistory(){
    const host=$('hepPayHistory');if(!host)return;
    const rows=Array.isArray(payTerms?.history)?payTerms.history:[];
    const currentId=payTerms?.current?.id||'';
    if(!rows.length){host.innerHTML='<div class="hep-pay-empty">История ставок пока пустая.</div>';return}
    host.innerHTML=`<table class="hep-pay-table"><thead><tr><th>Период</th><th>Фактическая</th><th>Официальная</th><th>Комментарий</th><th>Статус</th></tr></thead><tbody>${rows.map(x=>`
      <tr class="${x.id===currentId?'current':''}">
        <td><strong>${esc(x.effectiveFrom)}</strong><div class="audit-secondary">→ ${esc(x.effectiveTo||'без ограничения')}</div></td>
        <td><strong>${money(x.factualRate)}</strong><div class="audit-secondary">${esc(rateTypeLabel(x.factualRateType))}</div></td>
        <td><strong>${money(x.officialRate)}</strong><div class="audit-secondary">${esc(rateTypeLabel(x.officialRateType))}</div></td>
        <td>${esc(x.note||'—')}</td>
        <td><span class="hep-pay-pill ${x.id===currentId?'current':''}">${x.id===currentId?'Действует':'История'}</span></td>
      </tr>`).join('')}</tbody></table>`;
  }

  function primePayForm(){
    const current=payTerms?.current;
    if(!$('hepPayEffectiveFrom'))return;
    const today=isoToday();
    $('hepPayEffectiveFrom').value=current?.effectiveFrom===today?addDays(today,1):today;
    $('hepFactualRateType').value=current?.factualRateType||'MONTHLY';
    $('hepFactualRate').value=current?.factualRate??'';
    $('hepOfficialRateType').value=current?.officialRateType||'MONTHLY';
    $('hepOfficialRate').value=current?.officialRate??'';
    $('hepPayNote').value='';
  }

  function renderPay(){
    const host=$('hepPayContent');if(!host)return;
    const c=data?.compensation||{},term=c.term||{},calc=c.calculation||{},official=calc.official||{};
    if($('hepPaySource'))$('hepPaySource').textContent=c.configured?(c.sourceLabel||'Payroll'):'Не настроено';
    if(!c.configured){
      host.innerHTML='<div class="hep-pay-empty">Условия оплаты ещё не настроены. Откройте раздел «Условия оплаты» и задайте ставку сотруднику или его должности.</div>';
      return;
    }
    const factualGross=Number(term.officialGross||0)+Number(term.additionalAmount||0);
    const method=({CASH:'Наличные',BANK:'Банк',OTHER:'Другое'})[term.additionalPaymentMethod]||term.additionalPaymentMethod||'—';
    host.innerHTML=`<div class="hep-pay-current">
      <div class="hep-pay-current-card factual">
        <div class="hep-pay-active-line"><span>ДЕЙСТВУЕТ СЕЙЧАС</span><b>${esc(c.sourceLabel||'Условия оплаты')}</b></div>
        <h3>Фактическая зарплата</h3><p>Общая внутренняя зарплата сотрудника</p>
        <div class="hep-pay-rate-value"><strong>${money(factualGross).replace(' ₼','')}</strong><span>₼ / месяц</span></div>
        <div class="hep-pay-mini"><div><span>Официальная часть</span><strong>${money(term.officialGross)}</strong></div><div><span>Доп. часть</span><strong>${money(term.additionalAmount)}</strong></div><div><span>Выплата доп.</span><strong>${esc(method)}</strong></div></div>
        <div class="hep-pay-period"><span>Период</span><b>${esc(term.effectiveFrom||'—')} → ${esc(term.effectiveTo||'без ограничения')}</b></div>
      </div>
      <div class="hep-pay-current-card official">
        <div class="hep-pay-active-line"><span>ОФИЦИАЛЬНО</span><b>Gross</b></div>
        <h3>Белая зарплата</h3><p>Официальный Gross и расчёт налогов</p>
        <div class="hep-pay-rate-value"><strong>${money(term.officialGross).replace(' ₼','')}</strong><span>₼ / месяц</span></div>
        <div class="hep-pay-mini"><div><span>Net</span><strong>${money(official.net||0)}</strong></div><div><span>Удержания</span><strong>${money(official.employee?.total||0)}</strong></div><div><span>Стоимость работодателя</span><strong>${money(official.totalEmployerCost||0)}</strong></div></div>
        <div class="hep-pay-period"><span>Источник</span><b>${esc(c.sourceType==='ROLE'?'Условия должности':'Индивидуальные условия')}</b></div>
      </div>
    </div>`;
  }
  function leaveTypeName(code){
    const x=(leaveData?.types||[]).find(t=>String(t.code)===String(code));
    return x?.name||code||'—';
  }
  function contourLabel(v){return String(v||'').toUpperCase()==='OFFICIAL'?'Официальный':'Фактический'}
  function daysLabel(v){const n=Number(v||0);return new Intl.NumberFormat('ru-RU',{minimumFractionDigits:n%1?2:0,maximumFractionDigits:2}).format(n)+' дн.'}
  function inclusiveDays(from,to){
    if(!from||!to||to<from)return 0;
    const a=new Date(`${from}T00:00:00Z`),b=new Date(`${to}T00:00:00Z`);
    return Math.floor((b-a)/86400000)+1;
  }

  function renderLeaveSummary(){
    const host=$('hepLeaveSummary');if(!host)return;
    const factual=leaveData?.contours?.FACTUAL,official=leaveData?.contours?.OFFICIAL;
    const card=(x,label,cls)=>{
      if(!x)return '';
      const auto=x.autoActivated;
      const activation=auto?'Право активно':(x.eligibleDate?`Авто с ${x.eligibleDate}`:'Дата приёма не задана');
      return `<div class="hep-leave-summary-card ${cls}">
        <div class="hep-leave-summary-head"><div><h3>${esc(label)}</h3><p>Дата приёма: ${esc(x.hireDate||'—')}</p></div><span class="hep-leave-activation ${auto?'active':'wait'}">${esc(activation)}</span></div>
        <div class="hep-leave-summary-stats">
          <div><span>Начислено</span><strong>${esc(daysLabel(x.totals?.entitled))}</strong></div>
          <div><span>Использовано</span><strong>${esc(daysLabel(x.totals?.used))}</strong></div>
          <div><span>Остаток</span><strong>${esc(daysLabel(x.totals?.remaining))}</strong></div>
          <div><span>К компенсации</span><strong>${esc(daysLabel(x.terminationCompensationDays))}</strong></div>
        </div>
        <div class="hep-leave-summary-note">При увольнении в показатель «к компенсации» входят положительные остатки компенсируемых видов. Дни «По стажу» сюда не включаются.</div>
      </div>`;
    };
    host.innerHTML=card(factual,'Фактический контур','factual')+card(official,'Официальный контур','official');
  }

  function renderLeaveLedger(contour){
    const host=$(contour==='FACTUAL'?'hepLeaveFactual':'hepLeaveOfficial');if(!host)return;
    const x=leaveData?.contours?.[contour];
    if(!x){host.innerHTML='<div class="hep-pay-empty">Нет данных.</div>';return}
    host.innerHTML=`<table class="hep-leave-table">
      <thead><tr><th>Вид отпуска</th><th>Начислено</th><th>Корректировка</th><th>Использовано</th><th>Остаток</th><th>Активация</th><th>Примечание</th><th></th></tr></thead>
      <tbody>${(x.rows||[]).map(row=>`
        <tr data-leave-row data-contour="${esc(contour)}" data-type="${esc(row.typeCode)}">
          <td class="hep-leave-row-name"><strong>${esc(row.typeName)}</strong><span>${row.terminationCompensable?'Учитывается при компенсации':'Не входит в компенсацию при увольнении'}</span></td>
          <td><input data-field="entitled" type="number" min="0" step="0.01" value="${esc(row.entitledDays)}"></td>
          <td><input data-field="adjustment" type="number" step="0.01" value="${esc(row.adjustmentDays)}"></td>
          <td class="days">${esc(daysLabel(row.usedDays))}</td>
          <td class="days ${Number(row.remainingDays)<0?'negative':''}">${esc(daysLabel(row.remainingDays))}</td>
          <td><label class="hep-leave-switch"><input data-field="manual" type="checkbox" ${row.manualActivated?'checked':''}> Активировать HR</label><div class="audit-secondary">${row.activated?'Доступен':'Ожидает 6 месяцев'}</div></td>
          <td><input data-field="note" type="text" maxlength="1000" value="${esc(row.note||'')}" placeholder="Комментарий"></td>
          <td><button type="button" class="hr-link-button hep-leave-save" data-leave-save>Сохранить</button></td>
        </tr>`).join('')}</tbody>
    </table>`;
  }

  function renderLeaveHistory(){
    const host=$('hepLeaveHistory');if(!host)return;
    const year=Number(leaveData?.year||$('hepLeaveYear')?.value||new Date().getFullYear());
    const rows=(leaveData?.entries||[]).filter(x=>String(x.dateFrom||'').startsWith(String(year)));
    if(!rows.length){host.innerHTML=`<div class="hep-pay-empty">За ${esc(year)} год записей отпуска пока нет.</div>`;return}
    host.innerHTML=`<table class="hep-leave-history-table"><thead><tr><th>Период</th><th>Контур</th><th>Вид</th><th>Дней</th><th>Кто внёс</th><th>Комментарий</th><th>Статус</th><th></th></tr></thead>
      <tbody>${rows.map(x=>`<tr class="${x.status==='CANCELLED'?'cancelled':''}">
        <td><strong>${esc(x.dateFrom)} → ${esc(x.dateTo)}</strong></td>
        <td>${esc(contourLabel(x.contour))}</td>
        <td>${esc(leaveTypeName(x.typeCode))}</td>
        <td><strong>${esc(daysLabel(x.days))}</strong></td>
        <td>${esc(x.actorLabel||'—')}</td>
        <td>${esc(x.note||'—')}</td>
        <td><span class="hep-leave-status-pill ${x.status==='CANCELLED'?'cancelled':'approved'}">${x.status==='CANCELLED'?'Отменён':'Подтверждён'}</span></td>
        <td>${x.status==='CANCELLED'?'':`<button type="button" class="hr-link-button hep-leave-cancel" data-leave-cancel="${esc(x.id)}">Отменить</button>`}</td>
      </tr>`).join('')}</tbody></table>`;
  }

  function primeLeaveForm(){
    if(!$('hepLeaveType'))return;
    const types=leaveData?.types||[];
    $('hepLeaveType').innerHTML=types.map(x=>`<option value="${esc(x.code)}">${esc(x.name)}</option>`).join('');
    const extra1=types.find(x=>x.code==='EXTRA_1'),extra2=types.find(x=>x.code==='EXTRA_2');
    if($('hepLeaveExtra1'))$('hepLeaveExtra1').value=extra1?.name||'Дополнительный вид 1';
    if($('hepLeaveExtra2'))$('hepLeaveExtra2').value=extra2?.name||'Дополнительный вид 2';
    if(!$('hepLeaveFrom').value)$('hepLeaveFrom').value=isoToday();
    if(!$('hepLeaveTo').value)$('hepLeaveTo').value=$('hepLeaveFrom').value;
    if(!$('hepLeaveDays').value)$('hepLeaveDays').value=inclusiveDays($('hepLeaveFrom').value,$('hepLeaveTo').value)||1;
  }

  function renderLeaves(){
    if(!leaveLoaded)return;
    if($('hepLeaveYear'))$('hepLeaveYear').value=leaveData?.year||new Date().getFullYear();
    renderLeaveSummary();renderLeaveLedger('FACTUAL');renderLeaveLedger('OFFICIAL');renderLeaveHistory();primeLeaveForm();
  }

  async function loadLeaves(force=false){
    if(leaveLoaded&&!force)return;
    if(leaveBusy)return;
    const year=Number($('hepLeaveYear')?.value||new Date().getFullYear());
    try{
      leaveBusy=true;
      if($('hepLeaveStatus')){$('hepLeaveStatus').textContent='Загрузка…';$('hepLeaveStatus').className='hr-status loading'}
      leaveData=await api(`/api/hr/employee-leaves?id=${encodeURIComponent(employeeId)}&year=${encodeURIComponent(year)}`);
      leaveLoaded=true;renderLeaves();
      if($('hepLeaveStatus')){$('hepLeaveStatus').textContent='Готово';$('hepLeaveStatus').className='hr-status ok'}
    }catch(e){
      console.error(e);
      if($('hepLeaveSummary'))$('hepLeaveSummary').innerHTML=`<div class="hr-error">${esc(e?.message||String(e))}</div>`;
      if($('hepLeaveStatus')){$('hepLeaveStatus').textContent='Ошибка';$('hepLeaveStatus').className='hr-status error'}
    }finally{leaveBusy=false}
  }

  async function saveLeaveBalance(row){
    if(leaveBusy||!row)return;
    const contour=row.dataset.contour,typeCode=row.dataset.type,year=Number($('hepLeaveYear').value);
    const body={
      action:'saveBalance',employeeId,year,contour,typeCode,
      entitledDays:Number(row.querySelector('[data-field="entitled"]')?.value||0),
      adjustmentDays:Number(row.querySelector('[data-field="adjustment"]')?.value||0),
      manualActivated:Boolean(row.querySelector('[data-field="manual"]')?.checked),
      note:row.querySelector('[data-field="note"]')?.value||''
    };
    const button=row.querySelector('[data-leave-save]');
    try{
      leaveBusy=true;if(button)button.disabled=true;
      await api('/api/hr/employee-leaves',{method:'POST',body:JSON.stringify(body)});
      leaveLoaded=false;historyLoaded=false;await loadLeaves(true);
      if($('hepLeaveStatus')){$('hepLeaveStatus').textContent='Остаток сохранён';$('hepLeaveStatus').className='hr-status ok'}
    }catch(e){
      if($('hepLeaveStatus')){$('hepLeaveStatus').textContent=e?.message||'Ошибка';$('hepLeaveStatus').className='hr-status error'}
    }finally{leaveBusy=false;if(button)button.disabled=false}
  }

  function syncLeaveDays(){
    const n=inclusiveDays($('hepLeaveFrom')?.value,$('hepLeaveTo')?.value);
    if(n>0&&$('hepLeaveDays'))$('hepLeaveDays').value=n;
  }

  async function addLeave(){
    if(leaveBusy)return;
    const body={
      action:'addLeave',employeeId,contour:$('hepLeaveContour').value,typeCode:$('hepLeaveType').value,
      dateFrom:$('hepLeaveFrom').value,dateTo:$('hepLeaveTo').value,days:Number($('hepLeaveDays').value||0),note:$('hepLeaveNote').value
    };
    try{
      leaveBusy=true;$('hepLeaveAdd').disabled=true;$('hepLeaveStatus').textContent='Сохранение…';$('hepLeaveStatus').className='hr-status loading';
      await api('/api/hr/employee-leaves',{method:'POST',body:JSON.stringify(body)});
      $('hepLeaveNote').value='';leaveLoaded=false;historyLoaded=false;await loadLeaves(true);
      $('hepLeaveStatus').textContent='Отпуск добавлен';$('hepLeaveStatus').className='hr-status ok';
    }catch(e){
      console.error(e);$('hepLeaveStatus').textContent=e?.message||'Ошибка';$('hepLeaveStatus').className='hr-status error';
    }finally{leaveBusy=false;$('hepLeaveAdd').disabled=false}
  }

  async function cancelLeave(leaveId){
    if(leaveBusy||!leaveId)return;
    if(!confirm('Отменить эту запись отпуска? Использованные дни будут возвращены в остаток.'))return;
    try{
      leaveBusy=true;
      await api('/api/hr/employee-leaves',{method:'POST',body:JSON.stringify({action:'cancelLeave',employeeId,leaveId})});
      leaveLoaded=false;historyLoaded=false;await loadLeaves(true);
      $('hepLeaveStatus').textContent='Отпуск отменён';$('hepLeaveStatus').className='hr-status ok';
    }catch(e){$('hepLeaveStatus').textContent=e?.message||'Ошибка';$('hepLeaveStatus').className='hr-status error'}
    finally{leaveBusy=false}
  }

  async function saveLeaveTypeName(typeCode,inputId){
    const name=$(inputId)?.value?.trim();if(!name)return;
    try{
      await api('/api/hr/employee-leaves',{method:'POST',body:JSON.stringify({action:'saveTypeName',employeeId,typeCode,name})});
      leaveLoaded=false;historyLoaded=false;await loadLeaves(true);
      $('hepLeaveStatus').textContent='Название вида отпуска сохранено';$('hepLeaveStatus').className='hr-status ok';
    }catch(e){$('hepLeaveStatus').textContent=e?.message||'Ошибка';$('hepLeaveStatus').className='hr-status error'}
  }

  function renderSchedule(){
    const s=data?.schedule||{};
    if(!s.configured||!s.schedule){
      $('hepScheduleContent').innerHTML='<div class="hep-placeholder"><div><strong>Основной график не назначен</strong><p>Для должности сотрудника нет активного основного графика на текущую дату.</p></div></div>';
      return;
    }
    const x=s.schedule,days=['','Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    const mode=x.patternType==='CYCLE'?`${x.workDays}/${x.offDays}`:(x.weekdays||[]).map(d=>days[d]||d).join(', ');
    const shift=`${x.shiftStart||'—'}–${x.shiftEnd||'—'}${x.breakMinutes?` · перерыв ${x.breakMinutes} мин`:''}`;
    $('hepScheduleContent').innerHTML=`
      <div class="hep-schedule">
        <div class="hep-schedule-cell"><span>Шаблон</span><strong>${esc(x.name||'—')}</strong></div>
        <div class="hep-schedule-cell"><span>Режим</span><strong>${esc(mode||'—')}</strong></div>
        <div class="hep-schedule-cell"><span>Смена</span><strong>${esc(shift)}</strong></div>
        <div class="hep-schedule-cell"><span>Период</span><strong>${esc(x.validFrom||'—')} → ${esc(x.validTo||'без ограничения')}</strong></div>
      </div>`;
  }

  function render(){
    renderHero();fillProfile(data?.profile||{});renderWork();renderPay();setDirty(false);
  }

  async function load(){
    if(!employeeId){setError('В ссылке не указан ID сотрудника.');$('hepSave').disabled=true;return}
    if(busy)return;
    try{
      busy=true;$('hepSave').disabled=true;$('hepRefresh').disabled=true;setError('');setSaveState('Загрузка…','loading');
      data=await api(`/api/hr/employee-profile?id=${encodeURIComponent(employeeId)}`);
      render();setSaveState('Готово','ok');
    }catch(e){console.error(e);setError(e?.message||String(e));setSaveState('Ошибка','error')}
    finally{busy=false;$('hepSave').disabled=false;$('hepRefresh').disabled=false}
  }

  async function save(){
    if(!employeeId||busy)return;
    try{
      busy=true;$('hepSave').disabled=true;setError('');setSaveState('Сохранение…','loading');
      data=await api('/api/hr/employee-profile',{method:'POST',body:JSON.stringify({action:'saveProfile',employeeId,profile:collectProfile()})});
      render();historyLoaded=false;setSaveState('Сохранено','ok');
    }catch(e){console.error(e);setError(e?.message||String(e));setSaveState('Ошибка','error')}
    finally{busy=false;$('hepSave').disabled=false}
  }

  async function loadHistory(force=false){
    if(historyLoaded&&!force)return;
    const box=$('hepHistory');box.innerHTML='<div class="hr-muted">Загрузка истории…</div>';
    try{
      const r=await api(`/api/audit-log?search=${encodeURIComponent(employeeId)}&limit=150`);
      const events=(r.events||[]).filter(x=>String(x.entityId||'')===String(employeeId)&&['HR_EMPLOYEE_PROFILE','HR_EMPLOYEE_PAY_TERM','HR_EMPLOYEE_LEAVE_BALANCE','HR_EMPLOYEE_LEAVE','HR_EMPLOYEE_ATTENDANCE_RULE'].includes(String(x.entityType||'')));
      box.innerHTML=events.map(event=>{
        const changes=(event.changes||[]).filter(c=>!['updatedAt','createdAt'].includes(String(c.field||'')));
        return `<div class="hep-history-item">
          <div class="hep-history-head"><strong>${esc(event.actorName||event.actorEmail||'Пользователь')} · ${esc(event.entityType==='HR_EMPLOYEE_PAY_TERM'?'Оплата':event.entityType==='HR_EMPLOYEE_LEAVE_BALANCE'?'Остаток отпуска':event.entityType==='HR_EMPLOYEE_LEAVE'?'Отпуск':event.entityType==='HR_EMPLOYEE_ATTENDANCE_RULE'?'Учёт времени':'Карточка')} · ${esc(event.action||'Изменение')}</strong><span>${esc(new Date(event.createdAt).toLocaleString('ru-RU'))}</span></div>
          <div class="hep-history-changes">${changes.length?changes.map(c=>{
            const label=fieldLabels[c.field]||c.field;
            let oldV=prettyValue(c.oldValue),newV=prettyValue(c.newValue);
            if(c.field==='factualRateType'||c.field==='officialRateType'){oldV=rateTypeLabel(c.oldValue);newV=rateTypeLabel(c.newValue)}
            if(c.field==='factualRate'||c.field==='officialRate'){oldV=money(c.oldValue);newV=money(c.newValue)}
            if(c.field==='employmentType'){oldV=employmentLabel(c.oldValue);newV=employmentLabel(c.newValue)}
            if(c.field==='quotaCategory'){oldV=quotaLabel(c.oldValue);newV=quotaLabel(c.newValue)}
            if(c.field==='workCapacityPercent'){oldV=`${prettyValue(c.oldValue)}%`;newV=`${prettyValue(c.newValue)}%`}
            if(c.field==='typeCode'){oldV=leaveTypeName(c.oldValue);newV=leaveTypeName(c.newValue)}
            if(c.field==='contour'){oldV=contourLabel(c.oldValue);newV=contourLabel(c.newValue)}
            if(c.field==='status'){const st=v=>v==='CANCELLED'?'Отменён':v==='APPROVED'?'Подтверждён':prettyValue(v);oldV=st(c.oldValue);newV=st(c.newValue)}
            if(['entitledDays','adjustmentDays','days'].includes(c.field)){oldV=daysLabel(c.oldValue);newV=daysLabel(c.newValue)}
            return `<div class="hep-history-change"><strong>${esc(label)}</strong><b title="${esc(oldV)}">${esc(oldV)}</b><span class="hep-history-arrow">→</span><b title="${esc(newV)}">${esc(newV)}</b></div>`;
          }).join(''):'<div class="hr-muted">Нет изменённых полей.</div>'}</div>
        </div>`;
      }).join('')||'<div class="hep-placeholder"><div><strong>История пока пустая</strong><p>После изменения карточки здесь появятся пользователь, поле, старое и новое значение.</p></div></div>';
      historyLoaded=true;
    }catch(e){box.innerHTML=`<div class="hr-error">${esc(e?.message||String(e))}</div>`}
  }

  function showTab(name){
    document.querySelectorAll('.hep-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
    document.querySelectorAll('.hep-panel').forEach(p=>p.hidden=p.dataset.panel!==name);
    if(name==='history')loadHistory();

    if(name==='leave')loadLeaves();
  }

  function bind(){
    document.querySelectorAll('.hep-tab').forEach(btn=>btn.addEventListener('click',()=>showTab(btn.dataset.tab)));
    Object.keys(profileFields).forEach(id=>$(id)?.addEventListener('input',()=>setDirty(true)));
    Object.keys(profileFields).forEach(id=>$(id)?.addEventListener('change',()=>setDirty(true)));
    $('hepSave').addEventListener('click',save);
    $('hepRefresh').addEventListener('click',()=>{if(dirty&&!confirm('Есть несохранённые изменения. Обновить данные без сохранения?'))return;load()});
    $('hepHistoryRefresh').addEventListener('click',()=>loadHistory(true));
    $('hepLeaveRefresh')?.addEventListener('click',()=>{leaveLoaded=false;loadLeaves(true)});
    $('hepLeaveYear')?.addEventListener('change',()=>{leaveLoaded=false;loadLeaves(true)});
    $('hepLeaveFrom')?.addEventListener('change',syncLeaveDays);
    $('hepLeaveTo')?.addEventListener('change',syncLeaveDays);
    $('hepLeaveAdd')?.addEventListener('click',addLeave);
    $('hepLeaveExtra1Save')?.addEventListener('click',()=>saveLeaveTypeName('EXTRA_1','hepLeaveExtra1'));
    $('hepLeaveExtra2Save')?.addEventListener('click',()=>saveLeaveTypeName('EXTRA_2','hepLeaveExtra2'));
    $('hepLeaveFactual')?.addEventListener('click',e=>{const b=e.target.closest('[data-leave-save]');if(b)saveLeaveBalance(b.closest('[data-leave-row]'))});
    $('hepLeaveOfficial')?.addEventListener('click',e=>{const b=e.target.closest('[data-leave-save]');if(b)saveLeaveBalance(b.closest('[data-leave-row]'))});
    $('hepLeaveHistory')?.addEventListener('click',e=>{const b=e.target.closest('[data-leave-cancel]');if(b)cancelLeave(b.dataset.leaveCancel)});
    window.addEventListener('beforeunload',e=>{if(!dirty)return;e.preventDefault();e.returnValue=''});
  }

  async function init(){bind();await load()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
