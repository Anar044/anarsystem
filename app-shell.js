(function(){
 const root=document.documentElement;
 const saved=localStorage.getItem('shReportsTheme');
 root.dataset.theme=saved==='dark'?'dark':'light';
 function update(){document.querySelectorAll('[data-theme-label]').forEach(e=>e.textContent=root.dataset.theme==='dark'?'☀️ Светлая тема':'🌙 Тёмная тема');}
 window.toggleSHTheme=function(){const next=root.dataset.theme==='dark'?'light':'dark';root.dataset.theme=next;localStorage.setItem('shReportsTheme',next);update();};
 function loadModernUI(){
   if(document.body.classList.contains('horeca-dashboard')||document.body.classList.contains('reports-modern'))return;
   if(document.getElementById('anarsystem-modern-ui'))return;
   const link=document.createElement('link');link.id='anarsystem-modern-ui';link.rel='stylesheet';link.href='modern-ui.css?v=3';document.head.appendChild(link);
   const v3=document.createElement('link');v3.id='anarsystem-modern-ui-v3';v3.rel='stylesheet';v3.href='modern-ui-v3.css?v=1';document.head.appendChild(v3);
 }
 function loadReportsModern(){
   if(!location.pathname.endsWith('/reports.html')&&!location.pathname.endsWith('/reports'))return;
   document.body.classList.add('reports-modern');
   if(!document.getElementById('reports-modern-css')){const link=document.createElement('link');link.id='reports-modern-css';link.rel='stylesheet';link.href='reports-modern.css?v=2';document.head.appendChild(link);}
   const sidebar=document.querySelector('.sidebar');
   if(sidebar&&!sidebar.dataset.modernized){
     const section=sidebar.querySelector('.nav-section');
     const nav=sidebar.querySelector('.side-nav');
     if(section)section.textContent='Основное';
     if(nav)nav.innerHTML='<a href="index.html"><span class="side-icon">⌂</span>Dashboard</a><a class="active" href="reports.html"><span class="side-icon">▥</span>OLAP Отчёты</a><a href="plugin-control.html"><span class="side-icon">▣</span>Кассы</a><a href="plugin-events.html"><span class="side-icon">⇄</span>События плагина</a>';
     const oldSpacer=sidebar.querySelector('.sidebar-spacer');
     if(oldSpacer){oldSpacer.insertAdjacentHTML('beforebegin','<div class="nav-section reports-management-title" style="margin-top:22px">Управление</div><nav class="side-nav reports-management-nav"><a href="reports.html"><span class="side-icon">◒</span>Аналитика</a><a href="reports.html"><span class="side-icon">◇</span>Конструктор OLAP</a><a href="reports.html"><span class="side-icon">₼</span>Финансы</a><a href="settings.html"><span class="side-icon">⚙</span>Настройки</a></nav>');}
     sidebar.dataset.modernized='1';
   }
 }
 loadModernUI();
 document.addEventListener('DOMContentLoaded',()=>{
   update();
   loadModernUI();
   loadReportsModern();
   const menu=document.querySelector('[data-mobile-menu]'),side=document.querySelector('.sidebar');
   if(menu&&side)menu.onclick=()=>side.classList.toggle('open');
 });
})();
