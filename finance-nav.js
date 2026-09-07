(function(){
  'use strict';
  function add(){
    const nav=document.querySelector('.unified-main-nav,.side-nav');
    if(!nav)return false;
    let a=nav.querySelector('a[href="finance.html"]');
    if(!a){
      a=document.createElement('a');
      a.href='finance.html';
      a.innerHTML='<span class="side-icon">₽</span><span>Финансы</span>';
    }
    const dashboard=nav.querySelector('a[href="index.html"]');
    if(dashboard && a!==dashboard.nextElementSibling) nav.insertBefore(a,dashboard.nextElementSibling);
    else if(!dashboard && !a.parentNode) nav.appendChild(a);
    const active=/finance(?:\.html)?\/?$/i.test(location.pathname);
    a.classList.toggle('active',active);
    if(active)nav.querySelectorAll('a').forEach(x=>{if(x!==a)x.classList.remove('active')});
    return true;
  }
  function start(){
    let n=0;
    function run(){
      add();
      if(++n<30)setTimeout(run,200);
    }
    run();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
