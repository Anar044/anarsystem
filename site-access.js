(function(){
  'use strict';

  const PAGE_RULES={
    'index.html':['dashboard.view'],
    'ai-assistant.html':['assistant.use'],
    'cash.html':['cash.view'],
    'cash-shifts.html':['cash_shifts.view'],
    'nomenclature.html':['inventory.nomenclature.view'],
    'stock-balances.html':['inventory.stock.view'],
    'stock-movements.html':['inventory.movements.view'],
    'assets.html':['inventory.assets.view'],
    'ai-documents.html':['inventory.ai_documents'],
    'nakladnye.html':['inventory.incoming.view'],
    'rashodnye-nakladnye.html':['inventory.outgoing.view'],
    'akty-spisaniya.html':['inventory.writeoff.view'],
    'vnutrennie-peremescheniya.html':['inventory.transfer.view'],
    'finance.html':['finance.view'],
    'reports.html':['reports.olap'],
    'abc-xyz.html':['reports.abc_xyz'],
    'menu-engineering.html':['reports.menu_engineering'],
    'waiter-performance.html':['reports.waiters'],
    'supplier-balances.html':['reports.supplier_balances'],
    'food-cost.html':['reports.food_cost'],
    'labor-cost.html':['reports.labor_cost'],
    'pnl.html':['reports.pnl'],
    'hr-employees.html':['hr.employees.view'],
    'hr-role-schedules.html':['hr.schedules.view'],
    'hr-compensation.html':['hr.compensation.view'],
    'hr-payroll-adjustments.html':['hr.payroll.view'],
    'hr-payroll.html':['hr.payroll.view'],
    'hr-timeclock.html':['hr.attendance.view'],
    'hr-timesheet.html':['hr.timesheet.view'],
    'hr-calendar.html':['hr.schedules.view'],
    'qr-menu.html':['qr.manage'],
    'audit-log.html':['audit.view'],
    'settings.html':['settings.view'],
    'site-users.html':['access.manage']
  };

  const PROCUREMENT_RULES={
    catalog:['procurement.request.create'],
    requests:['procurement.request.view_own','procurement.request.view_all'],
    approvals:['procurement.approve'],
    sourcing:['procurement.sourcing'],
    orders:['procurement.po.manage'],
    receiving:['procurement.receive'],
    analytics:['procurement.analytics'],
    norms:['procurement.norms.manage'],
    settings:['procurement.settings.manage']
  };

  let context=null,loading=null;

  function pageName(){
    const path=location.pathname.toLowerCase().replace(/\/+$/,'');
    if(path.endsWith('/cash'))return'cash.html';
    const last=path.split('/').pop()||'index.html';
    return last.includes('.')?last:last+'.html';
  }

  function rulesForLocation(){
    const page=pageName();
    if(page==='procurement.html'){
      const view=new URLSearchParams(location.search).get('view')||'catalog';
      return PROCUREMENT_RULES[view]||PROCUREMENT_RULES.catalog;
    }
    return PAGE_RULES[page]||[];
  }

  function can(permission){
    if(!context?.allowed)return false;
    const set=new Set(context.permissions||[]);
    return set.has('*')||set.has(permission);
  }

  function canAny(list){
    if(!Array.isArray(list)||!list.length)return true;
    return list.some(can);
  }

  async function token(){
    const sb=await window.SHAuth?.createClient?.();
    const {data}=await sb?.auth?.getSession?.()||{};
    return data?.session?.access_token||'';
  }

  function permissionFromElement(el){
    const raw=el?.dataset?.permission||el?.dataset?.procurementPermission||'';
    if(!raw)return[];
    return raw.split(/[|,]/).map(x=>x.trim()).filter(Boolean);
  }

  function applyVisibility(root=document){
    if(!context?.allowed)return;
    root.querySelectorAll?.('[data-permission],[data-procurement-permission]').forEach(el=>{
      const list=permissionFromElement(el);
      el.hidden=!canAny(list);
      if(el.hidden)el.setAttribute('aria-hidden','true');else el.removeAttribute('aria-hidden');
    });

    root.querySelectorAll?.('.documents-nav-group,.reports-nav-group').forEach(group=>{
      const sub=group.querySelector('.documents-subnav');
      if(!sub)return;
      const visible=[...sub.querySelectorAll('a')].some(a=>!a.hidden);
      if(!visible)group.hidden=true;
    });
  }

  function denyScreen(message){
    document.documentElement.style.visibility='visible';
    const old=document.getElementById('sh-access-denied');if(old)return;
    document.body.innerHTML='';
    const box=document.createElement('div');
    box.id='sh-access-denied';
    box.innerHTML='<div class="sh-access-denied-card"><div class="sh-access-denied-icon">🔒</div><h1>Нет доступа</h1><p>'+String(message||'Для этого раздела у вашей учётной записи нет разрешения.')+'</p><div class="sh-access-denied-actions"><a href="/index.html">На главную</a><button type="button">Выйти</button></div></div>';
    const style=document.createElement('style');
    style.textContent='#sh-access-denied{min-height:100vh;display:grid;place-items:center;background:#0b1017;color:#eaf0f5;font-family:Inter,system-ui,sans-serif;padding:24px}.sh-access-denied-card{width:min(520px,100%);border:1px solid #263746;border-radius:16px;background:#101923;padding:28px;text-align:center;box-shadow:0 20px 60px #0008}.sh-access-denied-icon{font-size:34px}.sh-access-denied-card h1{margin:12px 0 8px}.sh-access-denied-card p{color:#8fa0b0;line-height:1.5}.sh-access-denied-actions{display:flex;justify-content:center;gap:10px;margin-top:20px}.sh-access-denied-actions a,.sh-access-denied-actions button{border:1px solid #304355;border-radius:9px;background:#14202b;color:#eaf0f5;padding:10px 15px;text-decoration:none;cursor:pointer}.sh-access-denied-actions a{background:#35d39a;color:#07150f;border-color:#35d39a}';
    document.head.appendChild(style);document.body.appendChild(box);
    box.querySelector('button').onclick=()=>window.SHAuth?.signOut?.();
  }

  function guardCurrentPage(){
    const rules=rulesForLocation();
    if(!rules.length)return true;
    if(canAny(rules))return true;
    denyScreen('У вашей роли нет права открывать этот раздел.');
    return false;
  }

  async function load(){
    if(loading)return loading;
    loading=(async()=>{
      try{
        const t=await token();
        if(!t)throw new Error('Сессия пользователя не найдена.');
        const response=await fetch('/api/access/me',{headers:{Authorization:'Bearer '+t,Accept:'application/json'},cache:'no-store'});
        const data=await response.json().catch(()=>({}));
        context=data?.access||{allowed:false,reason:data?.reason||'UNKNOWN'};
        window.SH_ACCESS_CONTEXT=context;
        document.dispatchEvent(new CustomEvent('sh-access-ready',{detail:context}));
        if(!context.allowed){
          denyScreen(context.reason==='NO_MEMBERSHIP'?'Этой учётной записи ещё не предоставлен доступ к Smart Horeca. Обратитесь к владельцу или администратору.':'Доступ к Smart Horeca отключён.');
          return context;
        }
        guardCurrentPage();applyVisibility(document);
        return context;
      }catch(error){
        console.error('Smart Horeca access error',error);
        denyScreen(error?.message||'Не удалось проверить права доступа.');
        return{allowed:false,reason:'ERROR'};
      }
    })();
    return loading;
  }

  const observer=new MutationObserver(mutations=>{
    if(!context?.allowed)return;
    for(const m of mutations)for(const n of m.addedNodes)if(n.nodeType===1)applyVisibility(n);
  });
  if(document.documentElement)observer.observe(document.documentElement,{subtree:true,childList:true});

  window.SHAccess={load,can,canAny,applyVisibility,get context(){return context},rulesForLocation};

  if(window.SH_CURRENT_USER)load();
  document.addEventListener('sh-auth-ready',()=>load(),{once:true});
})();