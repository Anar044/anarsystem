(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let data={roles:[],counts:{},canEditSharedRules:false},monthly={norms:[],restaurants:[],roles:[],canEdit:false},busy=false;

  async function token(){
    const client=await window.SHAuth?.createClient?.();if(!client)throw new Error('Supabase Auth не готов');
    const{data,error}=await client.auth.getSession();const t=data?.session?.access_token;
    if(error||!t)throw new Error('Сессия пользователя не найдена');return t;
  }
  async function api(body=null){
    const t=await token(),opt={headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}};
    if(body){opt.method='POST';opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body)}
    const r=await (window.SH_IikoContext?.fetchWithTimeout||fetch)('/api/hr/role-schedules',opt,60000);
    const j=await r.json().catch(()=>({success:false,message:'Некорректный ответ API'}));
    if(!r.ok||!j.success)throw new Error(j.message||`HTTP ${r.status}`);return j;
  }
  async function monthlyApi(body=null){
    const t=await token(),month=$('rsPayrollMonth')?.value||new Date().toISOString().slice(0,7);
    const options={headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}};
    let url='/api/hr/monthly-role-norms?month='+encodeURIComponent(month);
    if(body){url='/api/hr/monthly-role-norms';options.method='POST';options.headers['Content-Type']='application/json';options.body=JSON.stringify(body)}
    const response=await (window.SH_IikoContext?.fetchWithTimeout||fetch)(url,options,60000);
    const j=await response.json().catch(()=>({success:false,message:'Некорректный ответ норм Payroll'}));
    if(!response.ok||!j.success)throw new Error(j.message||`HTTP ${response.status}`);
    return j;
  }
  function setStatus(text,kind=''){const el=$('rsStatus');if(!el)return;el.textContent=text;el.className=`hr-status ${kind}`.trim()}
  function activeRoles(){return(data.roles||[]).filter(x=>!x.deleted)}
  function renderSummary(){
    const roles=activeRoles(),employees=roles.reduce((a,r)=>a+Number(r.employeeCount||0),0),day=roles.filter(r=>String(r.shiftType||'DAY').toUpperCase()!=='NIGHT').length,night=roles.length-day;
    $('rsSummary').innerHTML=[
      ['Должности',roles.length,'активные должности'],
      ['Сотрудники',employees,'активные сотрудники с должностью'],
      ['Дневная смена',day,'05:00 → 04:59'],
      ['Ночная смена',night,'12:00 → 11:59']
    ].map(x=>`<article class="hr-summary-card"><span>${esc(x[0])}</span><strong>${esc(x[1])}</strong><small>${esc(x[2])}</small></article>`).join('');
  }
  function renderAttendanceRules(){
    const list=activeRoles(),editable=Boolean(data.canEditSharedRules);$('rsAttendanceRuleCount').textContent=`${list.length} должностей`;
    $('rsAttendanceRuleRows').innerHTML=list.length?list.map(r=>{
      const hours=Math.max(1,Number(r.dailyNormMinutes||480))/60,shift=String(r.shiftType||'DAY').toUpperCase()==='NIGHT'?'NIGHT':'DAY';
      return `<tr data-attendance-role="${esc(r.code)}">
        <td class="text-left"><div class="hr-name">${esc(r.name)}</div><div class="hr-sub">${esc(r.code)}</div></td>
        <td>${Number(r.employeeCount||0)}</td>
        <td><input data-attendance-norm type="number" min="1" max="24" step="0.25" value="${Number(hours.toFixed(2))}" ${editable?'':'disabled'}> <span class="hr-muted">ч</span></td>
        <td><select data-attendance-shift ${editable?'':'disabled'}><option value="DAY" ${shift==='DAY'?'selected':''}>Дневная</option><option value="NIGHT" ${shift==='NIGHT'?'selected':''}>Ночная</option></select></td>
        <td><span class="hr-attendance-window">${shift==='NIGHT'?'12:00 → 11:59':'05:00 → 04:59'}</span></td>
        <td>${editable?'<button type="button" class="hr-link-button" data-attendance-save>Сохранить</button>':'<span class="hr-muted" title="Общие нормы меняет HR всей сети">Только просмотр</span>'}</td>
      </tr>`;
    }).join(''):'<tr><td colspan="6" class="hr-empty">Должности ещё не синхронизированы.</td></tr>';
    $('rsAttendanceRuleRows').querySelectorAll('[data-attendance-shift]').forEach(sel=>sel.onchange=()=>{
      const badge=sel.closest('[data-attendance-role]')?.querySelector('.hr-attendance-window');
      if(badge)badge.textContent=sel.value==='NIGHT'?'12:00 → 11:59':'05:00 → 04:59';
    });
    $('rsAttendanceRuleRows').querySelectorAll('[data-attendance-save]').forEach(btn=>btn.onclick=()=>saveAttendanceRule(btn.closest('[data-attendance-role]')));
  }
  function renderMonthlySelectors(){
    const restaurant=$('rsPayrollRestaurant'),role=$('rsPayrollRole');
    const previousRestaurant=restaurant.value,previousRole=role.value;
    restaurant.innerHTML=(monthly.restaurants||[]).map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
    if((monthly.restaurants||[]).some(x=>x.id===previousRestaurant))restaurant.value=previousRestaurant;
    role.innerHTML=(monthly.roles||[]).map(x=>`<option value="${esc(x.code)}">${esc(x.name)}</option>`).join('');
    if((monthly.roles||[]).some(x=>x.code===previousRole))role.value=previousRole;
    $('rsPayrollSave').disabled=!monthly.canEdit||!restaurant.value||!role.value;
    renderMonthlyRuleInputs();
  }
  function updateMonthlyInfo(){
    const office=$('rsPayrollRestaurant').value==='NETWORK_OFFICE';
    $('rsPayrollDaysWrap').hidden=office;$('rsPayrollHoursWrap').hidden=office;
    const days=Number($('rsPayrollDays').value||0),hours=Number($('rsPayrollHours').value||0);
    $('rsPayrollInfo').textContent=office
      ?'Офис: месячный оклад из условий оплаты. Время ресторана не используется. Налоги и кадровые корректировки отдельно.'
      :`Норма: ${days} дней × ${hours} ч = ${Number((days*hours).toFixed(2))} ч в месяц. Фактические часы RMS делим на норму часов рабочего дня.`;
  }
  function renderMonthlyRuleInputs(){
    const id=$('rsPayrollRestaurant').value,role=$('rsPayrollRole').value;
    const existing=(monthly.norms||[]).find(n=>n.restaurantId===id&&n.roleCode===role);
    if(existing&&id!=='NETWORK_OFFICE'){
      $('rsPayrollDays').value=String(existing.normDays||26);
      $('rsPayrollHours').value=String(Number(existing.dailyNormMinutes||600)/60);
    }else{
      $('rsPayrollDays').value='26';$('rsPayrollHours').value='10';
    }
    updateMonthlyInfo();
  }
  function renderMonthlyRows(){
    const where=new Map((monthly.restaurants||[]).map(x=>[x.id,x.name]));
    const roles=new Map((monthly.roles||[]).map(x=>[x.code,x.name]));
    $('rsPayrollRows').innerHTML=(monthly.norms||[]).map(n=>
      `<tr><td class="text-left">${esc(where.get(n.restaurantId)||n.restaurantId)}</td>
         <td class="text-left">${esc(roles.get(n.roleCode)||n.roleCode)}</td>
         <td>${n.payrollMode==='OFFICE_FIXED'?'Офисный оклад':'Ресторан · по часам'}</td>
         <td>${n.payrollMode==='OFFICE_FIXED'?'—':Number(n.normDays)}</td>
         <td>${n.payrollMode==='OFFICE_FIXED'?'—':Number((n.dailyNormMinutes/60).toFixed(2))}</td>
         <td>${n.payrollMode==='OFFICE_FIXED'?'—':Number((n.plannedMinutes/60).toFixed(2))}</td></tr>`
    ).join('')||'<tr><td colspan="6" class="hr-empty">На выбранный месяц нормы ещё не заданы. Для расчёта зарплаты ресторана нужно сохранить норму его должности.</td></tr>';
  }
  function renderMonthly(){renderMonthlySelectors();renderMonthlyRows();}
  function render(){renderSummary();renderAttendanceRules();renderMonthly();$('rsSync').disabled=!data.canEditSharedRules;$('rsSync').title=data.canEditSharedRules?'':'Синхронизация общих должностей доступна уполномоченному HR всей сети';}
  async function load(){
    if(busy)return;try{busy=true;$('rsRefresh').disabled=true;$('rsError').hidden=true;setStatus('Загрузка…','loading');data=await api();monthly=await monthlyApi();render();setStatus('Готово','ok')}
    catch(e){$('rsError').hidden=false;$('rsError').textContent=e.message;setStatus('Ошибка','error')}
    finally{busy=false;$('rsRefresh').disabled=false}
  }
  async function syncRoles(){
    if(busy)return;try{busy=true;$('rsSync').disabled=true;$('rsError').hidden=true;setStatus('Синхронизация Smart Horeca…','loading');data=await api({action:'syncRoles'});render();setStatus('Должности синхронизированы','ok')}
    catch(e){$('rsError').hidden=false;$('rsError').textContent=e.message;setStatus('Ошибка','error')}
    finally{busy=false;$('rsSync').disabled=false}
  }
  async function saveAttendanceRule(row){
    if(!row)return;try{
      const roleCode=row.dataset.attendanceRole,hours=Number(row.querySelector('[data-attendance-norm]').value||0),shiftType=row.querySelector('[data-attendance-shift]').value;
      if(!Number.isFinite(hours)||hours<=0||hours>24)throw new Error('Норма рабочего дня должна быть от 1 до 24 часов.');
      setStatus('Сохраняем…','loading');
      data=await api({action:'saveAttendanceRule',roleCode,dailyNormMinutes:Math.round(hours*60),shiftType});
      render();setStatus('Норма и тип смены сохранены','ok');
    }catch(e){$('rsError').hidden=false;$('rsError').textContent=e.message;setStatus('Ошибка','error')}
  }
  async function reloadMonthly(){
    try{monthly=await monthlyApi();renderMonthly();setStatus('Месячные нормы загружены','ok')}
    catch(e){$('rsError').hidden=false;$('rsError').textContent=e.message;setStatus('Ошибка календаря','error')}
  }
  async function saveMonthlyNorm(){
    if(busy||!monthly.canEdit)return;
    const month=$('rsPayrollMonth').value,restaurantId=$('rsPayrollRestaurant').value,roleCode=$('rsPayrollRole').value;
    const office=restaurantId==='NETWORK_OFFICE';
    const normDays=Number($('rsPayrollDays').value),dailyHours=Number($('rsPayrollHours').value);
    if(!office&&(!Number.isInteger(normDays)||normDays<1||normDays>31||!Number.isFinite(dailyHours)||dailyHours<.25||dailyHours>24))
      return setStatus('Введите от 1 до 31 дня и от 0,25 до 24 часов в день','error');
    try{
      busy=true;$('rsPayrollSave').disabled=true;$('rsError').hidden=true;setStatus('Сохраняем месячный календарь…','loading');
      monthly=await monthlyApi({action:'SAVE',month,restaurantId,roleCode,
        payrollMode:office?'OFFICE_FIXED':'RESTAURANT_HOURS',
        normDays:office?0:normDays,dailyNormMinutes:office?0:Math.round(dailyHours*60)});
      renderMonthly();setStatus('Месячная норма должности сохранена','ok');
    }catch(e){$('rsError').hidden=false;$('rsError').textContent=e.message;setStatus('Ошибка','error')}
    finally{busy=false;$('rsPayrollSave').disabled=!monthly.canEdit}
  }
  function bind(){
    $('rsRefresh').onclick=load;$('rsSync').onclick=syncRoles;
    $('rsPayrollMonth').onchange=reloadMonthly;
    $('rsPayrollRestaurant').onchange=renderMonthlyRuleInputs;
    $('rsPayrollRole').onchange=renderMonthlyRuleInputs;
    $('rsPayrollDays').oninput=updateMonthlyInfo;
    $('rsPayrollHours').oninput=updateMonthlyInfo;
    $('rsPayrollSave').onclick=saveMonthlyNorm;
  }
  async function init(){$('rsPayrollMonth').value=new Date().toISOString().slice(0,7);bind();await load()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();