(()=>{
  'use strict';
  const apply=()=>{
    const mark=document.querySelector('.sketch-brand-mark');
    if(!mark)return false;
    mark.style.setProperty('background','#071724 url("/smart-horeca-user-logo.svg?v=2") center/cover no-repeat','important');
    return true;
  };
  apply();
  document.addEventListener('DOMContentLoaded',apply,{once:true});
  setTimeout(apply,120);
  setTimeout(apply,500);
})();
