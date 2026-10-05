(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const employeeId=new URLSearchParams(location.search).get('id')||'';
  let data=null,busy=false,dirty=false,historyLoaded=false;

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
    quotaCategory:'Категория / квота',notes:'Примечание HR'
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

  function renderPay(){
    const c=data?.compensation||{},term=c.term||{},calc=c.calculation||{};
    $('hepPaySource').textContent=c.configured?c.sourceLabel:'Не настроено';
    if(!c.configured){
      $('hepPayContent').innerHTML='<div class="hep-placeholder"><div><strong>Условия оплаты не настроены</strong><p>Задайте условия по должности или индивидуально сотруднику. Карточка автоматически покажет действующий расчёт.</p></div></div>';
      return;
    }
    const official=calc.official||{};
    $('hepPayContent').innerHTML=`
      <div class="hep-money-layout">
        <div class="hep-money-box">
          <h3>Официальная часть — текущая модель</h3>
          <div class="hep-money-line"><span>Gross</span><strong>${money(term.officialGross)}</strong></div>
          <div class="hep-money-line"><span>Официальный Net</span><strong>${money(official.net)}</strong></div>
          <div class="hep-money-line"><span>Действует с</span><strong>${esc(term.effectiveFrom||'—')}</strong></div>
          <div class="hep-money-line"><span>Действует по</span><strong>${esc(term.effectiveTo||'Без ограничения')}</strong></div>
        </div>
        <div class="hep-money-box">
          <h3>Итог текущих условий</h3>
          <div class="hep-money-line"><span>Дополнительная выплата</span><strong>${money(term.additionalAmount)}</strong></div>
          <div class="hep-money-line"><span>Сотрудник получает</span><strong>${money(calc.totalEmployeeReceives)}</strong></div>
          <div class="hep-money-line hep-money-total"><span>Стоимость для ресторана</span><strong>${money(calc.totalEmployerCost)}</strong></div>
        </div>
      </div>
      <div class="hep-placeholder" style="min-height:110px;margin-top:12px"><div><strong>Фактическая зарплата будет отдельным контуром</strong><p>На следующем этапе добавим фактическую и официальную ставку отдельно, месячный/почасовой тип и историю изменений по датам.</p></div></div>`;
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
      const r=await api(`/api/audit-log?entityType=HR_EMPLOYEE_PROFILE&search=${encodeURIComponent(employeeId)}&limit=50`);
      const events=(r.events||[]).filter(x=>String(x.entityId||'')===String(employeeId));
      box.innerHTML=events.map(event=>{
        const changes=(event.changes||[]).filter(c=>!['updatedAt','createdAt'].includes(String(c.field||'')));
        return `<div class="hep-history-item">
          <div class="hep-history-head"><strong>${esc(event.actorName||event.actorEmail||'Пользователь')} · ${esc(event.action||'Изменение')}</strong><span>${esc(new Date(event.createdAt).toLocaleString('ru-RU'))}</span></div>
          <div class="hep-history-changes">${changes.length?changes.map(c=>{
            const label=fieldLabels[c.field]||c.field;
            let oldV=prettyValue(c.oldValue),newV=prettyValue(c.newValue);
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
  }

  function bind(){
    document.querySelectorAll('.hep-tab').forEach(btn=>btn.addEventListener('click',()=>showTab(btn.dataset.tab)));
    Object.keys(profileFields).forEach(id=>$(id)?.addEventListener('input',()=>setDirty(true)));
    Object.keys(profileFields).forEach(id=>$(id)?.addEventListener('change',()=>setDirty(true)));
    $('hepSave').addEventListener('click',save);
    $('hepRefresh').addEventListener('click',()=>{if(dirty&&!confirm('Есть несохранённые изменения. Обновить данные без сохранения?'))return;load()});
    $('hepHistoryRefresh').addEventListener('click',()=>loadHistory(true));
    window.addEventListener('beforeunload',e=>{if(!dirty)return;e.preventDefault();e.returnValue=''});
  }

  async function init(){bind();await load()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
