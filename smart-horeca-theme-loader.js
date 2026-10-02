(()=>{
  'use strict';
  const root=document.documentElement;
  const initKey='shThemeV2Initialized';
  try{
    localStorage.setItem('shReportsTheme','dark');
    localStorage.setItem(initKey,'1');
  }catch(e){}
  root.dataset.theme='dark';
  const old=document.getElementById('sh-brand-theme');
  if(old)old.remove();
  const link=document.createElement('link');
  link.id='sh-brand-theme';
  link.rel='stylesheet';
  link.href='/smart-horeca-theme.css?v=20260917-6';
  document.head.appendChild(link);
})();
