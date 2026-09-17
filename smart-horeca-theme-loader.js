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
  link.href='/smart-horeca-theme.css?v=20260917-6';
  document.head.appendChild(link);
})();
