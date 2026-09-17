(()=>{
  'use strict';
  const root=document.documentElement;
  const saved=localStorage.getItem('shReportsTheme');
  root.dataset.theme=saved==='dark'?'dark':'light';

  function addStyles(){
    let link=document.getElementById('dashboard-theme-css');
    if(!link){
      link=document.createElement('link');
      link.id='dashboard-theme-css';
      link.rel='stylesheet';
      link.href='/dashboard.css?v=20260917-8';
      document.head.appendChild(link);
    }
    let brand=document.getElementById('sh-brand-theme');
    if(!brand){
      brand=document.createElement('link');
      brand.id='sh-brand-theme';
      brand.rel='stylesheet';
      brand.href='/smart-horeca-theme.css?v=20260917-5';
      document.head.appendChild(brand);
    }
    if(!document.getElementById('dashboard-shell-theme-fix')){
      const s=document.createElement('style');
      s.id='dashboard-shell-theme-fix';
      s.textContent=`
        html[data-theme="light"] body.dashboard-page,
        html[data-theme="light"] body.dashboard-page .main,
        html[data-theme="light"] body.dashboard-page .content{background:#f5f7fb!important;color:#172532!important}
        html[data-theme="dark"] body.dashboard-page,
        html[data-theme="dark"] body.dashboard-page .main,
        html[data-theme="dark"] body.dashboard-page .content{background:#0b1017!important;color:#f4f7fa!important}
        html[data-theme="light"] body.dashboard-page .topbar{background:rgba(255,255,255,.96)!important;border-color:#e2e8ee!important}
        html[data-theme="dark"] body.dashboard-page .topbar{background:rgba(11,16,23,.94)!important}
      `;
      document.head.appendChild(s);
    }
  }

  addStyles();
  window.addEventListener('DOMContentLoaded',addStyles,{once:true});
})();