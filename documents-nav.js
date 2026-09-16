(()=>{
  'use strict';

  // Compatibility helper only. The sidebar itself remains owned by app-shell.js.
  // Keep route-specific fixes here without observers or repeated DOM mutations.
  function currentPath(){return location.pathname.toLowerCase().replace(/\/+$/,'')}

  function normalizeCashNav(){
    const nav=document.querySelector('.sidebar .unified-main-nav');if(!nav)return;
    const cash=nav.querySelector('a[data-unified-nav-item="cash.html"]');if(cash)cash.setAttribute('href','/cash/index.html');
    const path=currentPath(),isCash=path==='/cash'||path.endsWith('/cash.html')||path.endsWith('/cash/index.html');
    if(isCash&&cash)nav.querySelectorAll(':scope > a[data-unified-nav-item]').forEach(a=>a.classList.toggle('active',a===cash));
  }

  function reportsSubnav(){const nav=document.querySelector('.sidebar .unified-main-nav');const group=nav?.querySelector('.reports-nav-group');const sub=group?.querySelector('.documents-subnav');return{nav,group,sub}}
  function activateReport(link){const{nav,group,sub}=reportsSubnav();if(!nav||!group||!sub||!link)return;nav.querySelectorAll(':scope > a[data-unified-nav-item]').forEach(a=>a.classList.remove('active'));sub.querySelectorAll('a[data-unified-nav-item]').forEach(a=>a.classList.toggle('active',a===link));const toggle=group.querySelector('.documents-nav-toggle');group.classList.add('open');toggle?.classList.add('active');toggle?.setAttribute('aria-expanded','true');sub.hidden=false}

  function ensureMenuEngineeringNav(){
    const{group,sub}=reportsSubnav();if(!group||!sub)return null;let link=sub.querySelector('a[data-unified-nav-item="menu-engineering.html"]');
    if(!link){link=document.createElement('a');link.href='/menu-engineering.html';link.dataset.unifiedNavItem='menu-engineering.html';link.innerHTML='<span class="side-icon">◩</span><span>Матрица BCG / Меню-инжиниринг</span>';const abc=sub.querySelector('a[data-unified-nav-item="abc-xyz.html"]');if(abc)abc.insertAdjacentElement('afterend',link);else sub.appendChild(link)}
    const path=currentPath();if(path.endsWith('/menu-engineering')||path.endsWith('/menu-engineering.html'))activateReport(link);return link;
  }

  function ensureWaiterPerformanceNav(){
    const{group,sub}=reportsSubnav();if(!group||!sub)return null;let link=sub.querySelector('a[data-unified-nav-item="waiter-performance.html"]');
    if(!link){link=document.createElement('a');link.href='/waiter-performance.html';link.dataset.unifiedNavItem='waiter-performance.html';link.innerHTML='<span class="side-icon">♙</span><span>Рейтинг официантов / Средний чек</span>';const bcg=sub.querySelector('a[data-unified-nav-item="menu-engineering.html"]');if(bcg)bcg.insertAdjacentElement('afterend',link);else sub.appendChild(link)}
    const path=currentPath();if(path.endsWith('/waiter-performance')||path.endsWith('/waiter-performance.html'))activateReport(link);return link;
  }

  function activateHr(group,link){
    const nav=document.querySelector('.sidebar .unified-main-nav'),sub=group?.querySelector('.documents-subnav'),toggle=group?.querySelector('.documents-nav-toggle');if(!nav||!sub||!toggle||!link)return;
    nav.querySelectorAll(':scope > a[data-unified-nav-item]').forEach(a=>a.classList.remove('active'));
    nav.querySelectorAll(':scope > .documents-nav-group,:scope > .reports-nav-group').forEach(g=>{if(g===group)return;g.classList.remove('open');const t=g.querySelector('.documents-nav-toggle'),s=g.querySelector('.documents-subnav');t?.classList.remove('active');t?.setAttribute('aria-expanded','false');if(s)s.hidden=true});
    sub.querySelectorAll('a[data-unified-nav-item]').forEach(a=>a.classList.toggle('active',a===link));group.classList.add('open');toggle.classList.add('active');toggle.setAttribute('aria-expanded','true');sub.hidden=false;
  }

  function ensureHrNav(){
    const nav=document.querySelector('.sidebar .unified-main-nav');if(!nav)return null;
    const old=nav.querySelector(':scope > a[data-unified-nav-item="hr-employees.html"]');if(old)old.remove();
    let group=nav.querySelector('.hr-nav-group');
    if(!group){
      group=document.createElement('div');group.className='documents-nav-group hr-nav-group';
      group.innerHTML='<button type="button" class="documents-nav-toggle" aria-expanded="false"><span class="documents-nav-toggle-left"><span class="documents-nav-folder">♟</span><span>Сотрудники</span></span><span class="documents-nav-chevron">⌄</span></button><nav class="side-nav nav documents-subnav" hidden><a href="/hr-employees.html" data-unified-nav-item="hr-employees.html"><span class="side-icon">♙</span><span>Справочник сотрудников</span></a><a href="/hr-role-schedules.html" data-unified-nav-item="hr-role-schedules.html"><span class="side-icon">▤</span><span>Графики и должности</span></a><a href="/hr-compensation.html" data-unified-nav-item="hr-compensation.html"><span class="side-icon">₼</span><span>Условия оплаты</span></a><a href="/hr-payroll-adjustments.html" data-unified-nav-item="hr-payroll-adjustments.html"><span class="side-icon">±</span><span>Авансы и корректировки</span></a><a href="/hr-payroll.html" data-unified-nav-item="hr-payroll.html"><span class="side-icon">≋</span><span>Расчёт зарплаты</span></a><a href="/hr-timeclock.html" data-unified-nav-item="hr-timeclock.html"><span class="side-icon">◷</span><span>Учёт времени / Face ID</span></a><a href="/hr-timesheet.html" data-unified-nav-item="hr-timesheet.html"><span class="side-icon">▦</span><span>Табель</span></a><a href="/hr-calendar.html" data-unified-nav-item="hr-calendar.html"><span class="side-icon">▣</span><span>Производственный календарь</span></a></nav>';
      const reports=nav.querySelector('.reports-nav-group');if(reports)reports.insertAdjacentElement('afterend',group);else nav.appendChild(group);
      const toggle=group.querySelector('.documents-nav-toggle'),sub=group.querySelector('.documents-subnav');toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));toggle.classList.toggle('active',open);group.classList.toggle('open',open);sub.hidden=!open});
    }
    const path=currentPath();let link=null;if(path.endsWith('/hr-employees')||path.endsWith('/hr-employees.html'))link=group.querySelector('a[data-unified-nav-item="hr-employees.html"]');if(path.endsWith('/hr-role-schedules')||path.endsWith('/hr-role-schedules.html'))link=group.querySelector('a[data-unified-nav-item="hr-role-schedules.html"]');if(path.endsWith('/hr-compensation')||path.endsWith('/hr-compensation.html'))link=group.querySelector('a[data-unified-nav-item="hr-compensation.html"]');if(path.endsWith('/hr-payroll-adjustments')||path.endsWith('/hr-payroll-adjustments.html'))link=group.querySelector('a[data-unified-nav-item="hr-payroll-adjustments.html"]');if(path.endsWith('/hr-payroll')||path.endsWith('/hr-payroll.html'))link=group.querySelector('a[data-unified-nav-item="hr-payroll.html"]');if(path.endsWith('/hr-timeclock')||path.endsWith('/hr-timeclock.html'))link=group.querySelector('a[data-unified-nav-item="hr-timeclock.html"]');if(path.endsWith('/hr-timesheet')||path.endsWith('/hr-timesheet.html'))link=group.querySelector('a[data-unified-nav-item="hr-timesheet.html"]');if(path.endsWith('/hr-calendar')||path.endsWith('/hr-calendar.html'))link=group.querySelector('a[data-unified-nav-item="hr-calendar.html"]');if(link)activateHr(group,link);return group;
  }

  function ensureCompensationRoleAutoRefresh(){
    const path=currentPath();if(!(path.endsWith('/hr-compensation')||path.endsWith('/hr-compensation.html')))return;
    const role=document.getElementById('hcpRole');if(!role||role.dataset.autoRefreshBound==='1')return;
    role.dataset.autoRefreshBound='1';
    role.addEventListener('change',()=>{
      window.setTimeout(()=>{
        const refresh=document.getElementById('hcpRefresh');
        if(refresh&&!refresh.disabled)refresh.click();
      },0);
    });
  }

  function sync(){normalizeCashNav();ensureMenuEngineeringNav();ensureWaiterPerformanceNav();ensureHrNav();ensureCompensationRoleAutoRefresh();return true}
  sync();

  if(!window.SH_SidebarNav){window.SH_SidebarNav={sync,currentPage(){const path=currentPath();if(path==='/cash'||path.endsWith('/cash.html')||path.endsWith('/cash/index.html'))return'cash.html';if(path.endsWith('/menu-engineering')||path.endsWith('/menu-engineering.html'))return'menu-engineering.html';if(path.endsWith('/waiter-performance')||path.endsWith('/waiter-performance.html'))return'waiter-performance.html';if(path.endsWith('/hr-employees')||path.endsWith('/hr-employees.html'))return'hr-employees.html';if(path.endsWith('/hr-role-schedules')||path.endsWith('/hr-role-schedules.html'))return'hr-role-schedules.html';if(path.endsWith('/hr-compensation')||path.endsWith('/hr-compensation.html'))return'hr-compensation.html';if(path.endsWith('/hr-payroll-adjustments')||path.endsWith('/hr-payroll-adjustments.html'))return'hr-payroll-adjustments.html';if(path.endsWith('/hr-payroll')||path.endsWith('/hr-payroll.html'))return'hr-payroll.html';if(path.endsWith('/hr-timeclock')||path.endsWith('/hr-timeclock.html'))return'hr-timeclock.html';if(path.endsWith('/hr-timesheet')||path.endsWith('/hr-timesheet.html'))return'hr-timesheet.html';if(path.endsWith('/hr-calendar')||path.endsWith('/hr-calendar.html'))return'hr-calendar.html';return null}}}
})();