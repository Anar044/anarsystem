(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let data={roles:[],counts:{}},busy=false;

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
    const list=activeRoles();$('rsAttendanceRuleCount').textContent=`${list.length} должностей`;
    $('rsAttendanceRuleRows').innerHTML=list.length?list.map(r=>{
      const hours=Math.max(1,Number(r.dailyNormMinutes||480))/60,shift=String(r.shiftType||'DAY').toUpperCase()==='NIGHT'?'NIGHT':'DAY';
      return `<tr data-attendance-role="${esc(r.code)}">
        <td class="text-left"><div class="hr-name">${esc(r.name)}</div><div class="hr-sub">${esc(r.code)}</div></td>
        <td>${Number(r.employeeCount||0)}</td>
        <td><input data-attendance-norm type="number" min="1" max="24" step="0.25" value="${Number(hours.toFixed(2))}"> <span class="hr-muted">ч</span></td>
        <td><select data-attendance-shift><option value="DAY" ${shift==='DAY'?'selected':''}>Дневная</option><option value="NIGHT" ${shift==='NIGHT'?'selected':''}>Ночная</option></select></td>
        <td><span class="hr-attendance-window">${shift==='NIGHT'?'12:00 → 11:59':'05:00 → 04:59'}</span></td>
        <td><button type="button" class="hr-link-button" data-attendance-save>Сохранить</button></td>
      </tr>`;
    }).join(''):'<tr><td colspan="6" class="hr-empty">Должности ещё не синхронизированы.</td></tr>';
    $('rsAttendanceRuleRows').querySelectorAll('[data-attendance-shift]').forEach(sel=>sel.onchange=()=>{
      const badge=sel.closest('[data-attendance-role]')?.querySelector('.hr-attendance-window');
      if(badge)badge.textContent=sel.value==='NIGHT'?'12:00 → 11:59':'05:00 → 04:59';
    });
    $('rsAttendanceRuleRows').querySelectorAll('[data-attendance-save]').forEach(btn=>btn.onclick=()=>saveAttendanceRule(btn.closest('[data-attendance-role]')));
  }
  function render(){renderSummary();renderAttendanceRules()}
  async function load(){
    if(busy)return;try{busy=true;$('rsRefresh').disabled=true;$('rsError').hidden=true;setStatus('Загрузка…','loading');data=await api();render();setStatus('Готово','ok')}
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
  function bind(){$('rsRefresh').onclick=load;$('rsSync').onclick=syncRoles}
  async function init(){bind();await load()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();