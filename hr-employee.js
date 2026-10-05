(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const employeeId=new URLSearchParams(location.search).get('id')||'';
  let data=null,busy=false,dirty=false,historyLoaded=false,payTerms=null,payLoaded=false,payBusy=false;

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
    factualRateType:'Тип фактической ставки',factualRate:'Фактическая ставка',officialRateType:'Тип официальной ставки',officialRate:'Официальная ставка',effectiveFrom:'Действует с',effectiveTo:'Действует по'
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
        <h3>Фактическая зарплата</h3><p>Внутренняя ставка сотрудника</p>
        <div class="hep-pay-rate-value"><strong>${money(term.factualRate).replace(' ₼','')}</strong><span>${esc(factualUnit)}</span></div>
        <div class="hep-pay-mini"><div><span>Тип</span><strong>${esc(rateTypeLabel(term.factualRateType))}</strong></div><div><span>Валюта</span><strong>AZN</strong></div><div><span>Контур</span><strong>Фактический</strong></div></div>
        <div class="hep-pay-period"><span>Действует</span><b>${esc(term.effectiveFrom)} → ${esc(term.effectiveTo||'без ограничения')}</b></div>
      </div>
      <div class="hep-pay-current-card official">
        <h3>Официальная зарплата</h3><p>Gross ставка для белого Payroll</p>
        <div class="hep-pay-rate-value"><strong>${money(term.officialRate).replace(' ₼','')}</strong><span>${esc(officialUnit)}</span></div>
        <div class="hep-pay-mini">${officialMini}</div>
        <div class="hep-pay-period"><span>Действует</span><b>${esc(term.effectiveFrom)} → ${esc(term.effectiveTo||'без ограничения')}</b></div>
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
    if(!$('hepPayContent'))return;
    $('hepPaySource').textContent=payLoaded?'Smart Horeca · v2':'Загрузка…';
    if(!payLoaded){
      $('hepPayContent').innerHTML='<div class="hep-pay-empty">Откройте вкладку «Оплата», чтобы загрузить фактическую и официальную ставку.</div>';
      renderLegacyPay();
      return;
    }
    $('hepPayContent').innerHTML=currentPayMarkup(payTerms?.current||null);
    renderPayHistory();
    renderLegacyPay();
  }

  async function loadPayTerms(force=false){
    if(payLoaded&&!force)return;
    if(payBusy)return;
    try{
      payBusy=true;
      if($('hepPayStatus')){$('hepPayStatus').textContent='Загрузка…';$('hepPayStatus').className='hr-status loading'}
      payTerms=await api(`/api/hr/employee-pay-terms?id=${encodeURIComponent(employeeId)}`);
      payLoaded=true;renderPay();primePayForm();
      if($('hepPayStatus')){$('hepPayStatus').textContent='Готово';$('hepPayStatus').className='hr-status ok'}
    }catch(e){
      console.error(e);
      if($('hepPayContent'))$('hepPayContent').innerHTML=`<div class="hr-error">${esc(e?.message||String(e))}</div>`;
      if($('hepPayStatus')){$('hepPayStatus').textContent='Ошибка';$('hepPayStatus').className='hr-status error'}
    }finally{payBusy=false}
  }

  async function savePayTerm(){
    if(payBusy||!employeeId)return;
    const body={
      action:'saveTerm',employeeId,
      effectiveFrom:$('hepPayEffectiveFrom').value,
      factualRateType:$('hepFactualRateType').value,
      factualRate:Number($('hepFactualRate').value||0),
      officialRateType:$('hepOfficialRateType').value,
      officialRate:Number($('hepOfficialRate').value||0),
      note:$('hepPayNote').value
    };
    if(!body.effectiveFrom){$('hepPayStatus').textContent='Укажите дату начала';$('hepPayStatus').className='hr-status error';return}
    try{
      payBusy=true;$('hepPaySave').disabled=true;$('hepPayStatus').textContent='Сохранение…';$('hepPayStatus').className='hr-status loading';
      payTerms=await api('/api/hr/employee-pay-terms',{method:'POST',body:JSON.stringify(body)});
      payLoaded=true;historyLoaded=false;renderPay();primePayForm();
      $('hepPayStatus').textContent='Новые условия сохранены';$('hepPayStatus').className='hr-status ok';
    }catch(e){
      console.error(e);$('hepPayStatus').textContent=e?.message||'Ошибка';$('hepPayStatus').className='hr-status error';
    }finally{payBusy=false;$('hepPaySave').disabled=false}
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
    renderHero();fillProfile(data?.profile||{});renderWork();renderPay();renderSchedule();setDirty(false);
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
      const r=await api(`/api/audit-log?search=${encodeURIComponent(employeeId)}&limit=100`);
      const events=(r.events||[]).filter(x=>String(x.entityId||'')===String(employeeId)&&['HR_EMPLOYEE_PROFILE','HR_EMPLOYEE_PAY_TERM'].includes(String(x.entityType||'')));
      box.innerHTML=events.map(event=>{
        const changes=(event.changes||[]).filter(c=>!['updatedAt','createdAt'].includes(String(c.field||'')));
        return `<div class="hep-history-item">
          <div class="hep-history-head"><strong>${esc(event.actorName||event.actorEmail||'Пользователь')} · ${esc(event.entityType==='HR_EMPLOYEE_PAY_TERM'?'Оплата':'Карточка')} · ${esc(event.action||'Изменение')}</strong><span>${esc(new Date(event.createdAt).toLocaleString('ru-RU'))}</span></div>
          <div class="hep-history-changes">${changes.length?changes.map(c=>{
            const label=fieldLabels[c.field]||c.field;
            let oldV=prettyValue(c.oldValue),newV=prettyValue(c.newValue);
            if(c.field==='factualRateType'||c.field==='officialRateType'){oldV=rateTypeLabel(c.oldValue);newV=rateTypeLabel(c.newValue)}
            if(c.field==='factualRate'||c.field==='officialRate'){oldV=money(c.oldValue);newV=money(c.newValue)}
            if(c.field==='employmentType'){oldV=employmentLabel(c.oldValue);newV=employmentLabel(c.newValue)}
            if(c.field==='quotaCategory'){oldV=quotaLabel(c.oldValue);newV=quotaLabel(c.newValue)}
            if(c.field==='workCapacityPercent'){oldV=`${prettyValue(c.oldValue)}%`;newV=`${prettyValue(c.newValue)}%`}
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
    if(name==='pay')loadPayTerms();
  }

  function bind(){
    document.querySelectorAll('.hep-tab').forEach(btn=>btn.addEventListener('click',()=>showTab(btn.dataset.tab)));
    Object.keys(profileFields).forEach(id=>$(id)?.addEventListener('input',()=>setDirty(true)));
    Object.keys(profileFields).forEach(id=>$(id)?.addEventListener('change',()=>setDirty(true)));
    $('hepSave').addEventListener('click',save);
    $('hepRefresh').addEventListener('click',()=>{if(dirty&&!confirm('Есть несохранённые изменения. Обновить данные без сохранения?'))return;load()});
    $('hepHistoryRefresh').addEventListener('click',()=>loadHistory(true));
    $('hepPaySave')?.addEventListener('click',savePayTerm);
    $('hepPayRefresh')?.addEventListener('click',()=>loadPayTerms(true));
    window.addEventListener('beforeunload',e=>{if(!dirty)return;e.preventDefault();e.returnValue=''});
  }

  async function init(){bind();await load()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
