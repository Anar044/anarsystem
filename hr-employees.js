(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let data={items:[],roles:[],counts:{}},busy=false;

  async function token(){
    const client=await window.SHAuth?.createClient?.();
    if(!client)throw new Error('Supabase Auth не готов');
    const{data,error}=await client.auth.getSession();
    const t=data?.session?.access_token;
    if(error||!t)throw new Error('Сессия пользователя не найдена');
    return t;
  }
  function setStatus(text,kind=''){const el=$('hrStatus');if(!el)return;el.textContent=text;el.className=`hr-status ${kind}`.trim()}
  function fullName(x){return [x.lastName,x.firstName,x.middleName].filter(Boolean).join(' ')||x.name||x.code||'Без имени'}
  function isFired(x){return Boolean(x.deleted||x.fireDate)}
  function filtered(){
    const q=String($('hrSearch')?.value||'').trim().toLowerCase();
    const role=$('hrRoleFilter')?.value||'';
    const status=$('hrStatusFilter')?.value||'';
    return (data.items||[]).filter(x=>{
      if(role&&x.roleCode!==role)return false;
      if(status==='ACTIVE'&&isFired(x))return false;
      if(status==='FIRED'&&!isFired(x))return false;
      if(q&&!([fullName(x),x.code,x.roleName,x.departmentCode].join(' ').toLowerCase().includes(q)))return false;
      return true;
    });
  }
  function renderSummary(){
    const c=data.counts||{};
    $('hrSummary').innerHTML=`
      <article class="hr-summary-card"><span>Всего в справочнике</span><strong>${Number(c.total||0)}</strong><small>Синхронизировано из SH</small></article>
      <article class="hr-summary-card"><span>Активные сотрудники</span><strong>${Number(c.active||0)}</strong><small>Без даты увольнения</small></article>
      <article class="hr-summary-card"><span>Face ID связаны</span><strong>${Number(c.linkedToAttendance||0)}</strong><small>Будет заполняться после подключения устройства</small></article>
      <article class="hr-summary-card"><span>Источник явок</span><strong class="hr-text-value">Не подключён</strong><small>Запланирован внешний attendance-adapter</small></article>`;
  }
  function renderRoles(){
    const select=$('hrRoleFilter');if(!select)return;
    const current=select.value;
    select.innerHTML='<option value="">Все должности</option>'+[...(data.roles||[])].sort((a,b)=>String(a.name||a.code).localeCompare(String(b.name||b.code),'ru')).map(r=>`<option value="${esc(r.code)}">${esc(r.name||r.code)}</option>`).join('');
    if([...select.options].some(o=>o.value===current))select.value=current;
  }
  function renderRows(){
    const rows=filtered(),tbody=$('hrTable').querySelector('tbody');
    tbody.innerHTML=rows.map(x=>{
      const fired=isFired(x),linked=Boolean(x.attendanceExternalId);
      return`<tr>
        <td class="text-left"><div class="hr-name">${esc(fullName(x))}</div><div class="hr-sub">ID: ${esc(x.id)}</div></td>
        <td>${esc(x.code||'—')}</td>
        <td class="text-left"><b>${esc(x.roleName||x.roleCode||'—')}</b><div class="hr-sub">${esc(x.roleCode||'')}</div></td>
        <td>${esc(x.departmentCode||'—')}</td>
        <td>${esc(x.hireDate||'—')}</td>
        <td>${esc(x.fireDate||'—')}</td>
        <td>${linked?`<span class="hr-badge linked">${esc(x.attendanceProvider||'DEVICE')} · ${esc(x.attendanceExternalId)}</span>`:'<span class="hr-badge pending">Не связан</span>'}</td>
        <td><span class="hr-badge ${fired?'fired':'active'}">${fired?'Уволен':'Активен'}</span></td>
      </tr>`;
    }).join('')||'<tr><td colspan="8" class="hr-empty">Сотрудники не найдены</td></tr>';
    $('hrRowCount').textContent=`${rows.length} сотрудников`;
  }
  function render(){renderSummary();renderRoles();renderRows()}

  async function load(){
    if(busy)return;
    const error=$('hrError');
    try{
      busy=true;$('hrRefresh').disabled=true;error.hidden=true;setStatus('Синхронизация…','loading');
      const t=await token();
      const response=await fetch('/api/hr/employees',{headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}});
      const result=await response.json().catch(()=>({success:false,message:'Сервер вернул некорректный ответ'}));
      if(!response.ok||!result.success)throw new Error(result.message||`HTTP ${response.status}`);
      data=result;render();
      setStatus(`Синхронизировано · ${result.counts?.active||0} активных`,'ok');
    }catch(e){
      console.error(e);error.hidden=false;error.textContent=e?.message||String(e);setStatus('Ошибка','error');
    }finally{busy=false;$('hrRefresh').disabled=false}
  }
  function bind(){
    $('hrRefresh').onclick=load;
    $('hrSearch').addEventListener('input',renderRows);
    $('hrRoleFilter').addEventListener('change',renderRows);
    $('hrStatusFilter').addEventListener('change',renderRows);
  }
  async function init(){bind();await load()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
