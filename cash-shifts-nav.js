(function(){
  function addLink(){
    const nav=document.querySelector('.unified-main-nav,.side-nav');
    if(!nav || nav.querySelector('a[href="cash-shifts.html"]')) return !!nav;
    const link=document.createElement('a');
    link.href='cash-shifts.html';
    if(/cash-shifts(?:\.html)?\/?$/i.test(location.pathname)) link.className='active';
    link.innerHTML='<span class="side-icon">◫</span><span>Кассовые смены</span>';
    const qr=nav.querySelector('a[href="qr-menu.html"]');
    nav.insertBefore(link,qr||null);
    return true;
  }
  function start(){
    if(addLink()) return;
    const observer=new MutationObserver(()=>{if(addLink()) observer.disconnect();});
    observer.observe(document.body,{childList:true,subtree:true});
    setTimeout(()=>observer.disconnect(),10000);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
})();
