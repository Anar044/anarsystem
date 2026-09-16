(()=>{
  'use strict';

  // Compatibility helper only. The sidebar itself remains owned by app-shell.js.
  // Keep route-specific fixes here without observers or repeated DOM mutations.
  function currentPath(){
    return location.pathname.toLowerCase().replace(/\/+$/,'');
  }

  function normalizeCashNav(){
    const nav=document.querySelector('.sidebar .unified-main-nav');
    if(!nav)return;

    const cash=nav.querySelector('a[data-unified-nav-item="cash.html"]');
    if(cash)cash.setAttribute('href','/cash/index.html');

    const path=currentPath();
    const isCash=path==='/cash'||path.endsWith('/cash.html')||path.endsWith('/cash/index.html');
    if(isCash&&cash){
      nav.querySelectorAll(':scope > a[data-unified-nav-item]').forEach(a=>a.classList.toggle('active',a===cash));
    }
  }

  function reportsSubnav(){
    const nav=document.querySelector('.sidebar .unified-main-nav');
    const group=nav?.querySelector('.reports-nav-group');
    const sub=group?.querySelector('.documents-subnav');
    return{nav,group,sub};
  }

  function activateReport(link){
    const {nav,group,sub}=reportsSubnav();
    if(!nav||!group||!sub||!link)return;
    nav.querySelectorAll(':scope > a[data-unified-nav-item]').forEach(a=>a.classList.remove('active'));
    sub.querySelectorAll('a[data-unified-nav-item]').forEach(a=>a.classList.toggle('active',a===link));
    const toggle=group.querySelector('.documents-nav-toggle');
    group.classList.add('open');
    toggle?.classList.add('active');
    toggle?.setAttribute('aria-expanded','true');
    sub.hidden=false;
  }

  function ensureMenuEngineeringNav(){
    const {nav,group,sub}=reportsSubnav();
    if(!nav||!group||!sub)return null;

    let link=sub.querySelector('a[data-unified-nav-item="menu-engineering.html"]');
    if(!link){
      link=document.createElement('a');
      link.href='/menu-engineering.html';
      link.dataset.unifiedNavItem='menu-engineering.html';
      link.innerHTML='<span class="side-icon">◩</span><span>Матрица BCG / Меню-инжиниринг</span>';
      const abc=sub.querySelector('a[data-unified-nav-item="abc-xyz.html"]');
      if(abc)abc.insertAdjacentElement('afterend',link);
      else sub.appendChild(link);
    }

    const path=currentPath();
    if(path.endsWith('/menu-engineering')||path.endsWith('/menu-engineering.html'))activateReport(link);
    return link;
  }

  function ensureWaiterPerformanceNav(){
    const {nav,group,sub}=reportsSubnav();
    if(!nav||!group||!sub)return null;

    let link=sub.querySelector('a[data-unified-nav-item="waiter-performance.html"]');
    if(!link){
      link=document.createElement('a');
      link.href='/waiter-performance.html';
      link.dataset.unifiedNavItem='waiter-performance.html';
      link.innerHTML='<span class="side-icon">♙</span><span>Рейтинг официантов / Средний чек</span>';
      const bcg=sub.querySelector('a[data-unified-nav-item="menu-engineering.html"]');
      if(bcg)bcg.insertAdjacentElement('afterend',link);
      else sub.appendChild(link);
    }

    const path=currentPath();
    if(path.endsWith('/waiter-performance')||path.endsWith('/waiter-performance.html'))activateReport(link);
    return link;
  }

  function ensureHrNav(){
    const nav=document.querySelector('.sidebar .unified-main-nav');
    if(!nav)return null;
    let link=nav.querySelector('a[data-unified-nav-item="hr-employees.html"]');
    if(!link){
      link=document.createElement('a');
      link.href='/hr-employees.html';
      link.dataset.unifiedNavItem='hr-employees.html';
      link.innerHTML='<span class="side-icon">♟</span><span>Сотрудники</span>';
      const reports=nav.querySelector('.reports-nav-group');
      if(reports)reports.insertAdjacentElement('afterend',link);
      else nav.appendChild(link);
    }
    const path=currentPath();
    const active=path.endsWith('/hr-employees')||path.endsWith('/hr-employees.html');
    if(active){
      nav.querySelectorAll(':scope > a[data-unified-nav-item]').forEach(a=>a.classList.toggle('active',a===link));
      nav.querySelectorAll('.documents-nav-group,.reports-nav-group').forEach(group=>{
        const toggle=group.querySelector('.documents-nav-toggle');
        const sub=group.querySelector('.documents-subnav');
        group.classList.remove('open');
        toggle?.classList.remove('active');
        toggle?.setAttribute('aria-expanded','false');
        if(sub)sub.hidden=true;
      });
    }
    return link;
  }

  function sync(){
    normalizeCashNav();
    ensureMenuEngineeringNav();
    ensureWaiterPerformanceNav();
    ensureHrNav();
    return true;
  }

  sync();

  if(!window.SH_SidebarNav){
    window.SH_SidebarNav={
      sync,
      currentPage(){
        const path=currentPath();
        if(path==='/cash'||path.endsWith('/cash.html')||path.endsWith('/cash/index.html'))return'cash.html';
        if(path.endsWith('/menu-engineering')||path.endsWith('/menu-engineering.html'))return'menu-engineering.html';
        if(path.endsWith('/waiter-performance')||path.endsWith('/waiter-performance.html'))return'waiter-performance.html';
        if(path.endsWith('/hr-employees')||path.endsWith('/hr-employees.html'))return'hr-employees.html';
        return null;
      }
    };
  }
})();
