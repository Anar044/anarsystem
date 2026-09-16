(()=>{
  'use strict';
  const root=document.documentElement;
  const initKey='shThemeV2Initialized';
  if(!localStorage.getItem(initKey)){
    localStorage.setItem('shReportsTheme','light');
    localStorage.setItem(initKey,'1');
  }
  root.dataset.theme=localStorage.getItem('shReportsTheme')==='dark'?'dark':'light';

  const old=document.getElementById('sh-brand-theme');
  if(old)old.remove();
  const link=document.createElement('link');
  link.id='sh-brand-theme';
  link.rel='stylesheet';
  link.href='/smart-horeca-theme.css?v=20260917-2';
  document.head.appendChild(link);

  if(!document.getElementById('sh-light-shell-fixes')){
    const style=document.createElement('style');
    style.id='sh-light-shell-fixes';
    style.textContent=`
      html[data-theme="light"] .side-nav a,html[data-theme="light"] .nav a{color:#64798b!important}
      html[data-theme="light"] .side-nav a:hover,html[data-theme="light"] .nav a:hover{background:#f3f8fb!important;color:#173445!important;border-color:#dde8ee!important}
      html[data-theme="light"] .side-nav a.active,html[data-theme="light"] .nav a.active{background:linear-gradient(135deg,#e8faf3,#eef9ff)!important;color:#087553!important;border-color:#bdebd9!important;box-shadow:inset 3px 0 #00c17a,0 6px 18px rgba(0,193,122,.07)!important}
      html[data-theme="light"] .documents-nav-toggle{color:#64798b!important}
      html[data-theme="light"] .documents-nav-toggle:hover{background:#f3f8fb!important;color:#173445!important;border-color:#dde8ee!important}
      html[data-theme="light"] .documents-nav-toggle.active{background:linear-gradient(135deg,#e8faf3,#eef9ff)!important;color:#087553!important;border-color:#bdebd9!important;box-shadow:inset 3px 0 #00c17a!important}
      html[data-theme="light"] .documents-subnav{border-left-color:#dfe8ee!important}
      html[data-theme="light"] .nav-title{color:#8da0af!important}
    `;
    document.head.appendChild(style);
  }
})();