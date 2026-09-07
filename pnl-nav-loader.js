(function(){
  'use strict';

  function fileName(href){
    return String(href||'').split('#')[0].split('?')[0].split('/').pop().toLowerCase();
  }

  function isPnlLink(el){
    return el && el.tagName === 'A' && fileName(el.getAttribute('href')) === 'pnl.html';
  }

  function findMainNav(sidebar){
    const navs=[...sidebar.querySelectorAll('nav')];
    return navs.find(nav => nav.querySelector('a[href]') && (
      [...nav.querySelectorAll('a[href]')].some(a => fileName(a.getAttribute('href')) === 'index.html') ||
      /Dashboard/i.test(nav.textContent||'')
    )) || navs[0] || null;
  }

  function makeLink(template){
    let link;
    if(template){
      link=template.cloneNode(true);
      link.classList.remove('active');
      link.removeAttribute('aria-current');
    }else{
      link=document.createElement('a');
      link.innerHTML='<span class="side-icon">▤</span><span>Прибыли и убытки</span>';
    }
    link.href='pnl.html';
    link.classList.add('pnl-direct-nav-link');
    const spans=link.querySelectorAll('span');
    if(spans.length){
      spans[0].textContent='▤';
      if(spans.length>1) spans[spans.length-1].textContent='Прибыли и убытки';
    }else{
      link.textContent='Прибыли и убытки';
    }
    if(location.pathname.toLowerCase().endsWith('/pnl.html') || location.pathname.toLowerCase().endsWith('/pnl')){
      link.classList.add('active');
      link.setAttribute('aria-current','page');
    }
    return link;
  }

  function addPnlLink(){
    const sidebar=document.querySelector('.sidebar');
    if(!sidebar) return;
    if([...sidebar.querySelectorAll('a[href]')].some(isPnlLink)) return;

    const nav=findMainNav(sidebar);
    if(!nav) return;

    const links=[...nav.querySelectorAll(':scope > a[href]')];
    const template=links.find(a=>fileName(a.getAttribute('href'))==='reports.html') || links[0];
    const link=makeLink(template);
    const cash=links.find(a=>fileName(a.getAttribute('href'))==='plugin-control.html');
    const olap=links.find(a=>fileName(a.getAttribute('href'))==='reports.html');

    if(cash) nav.insertBefore(link,cash);
    else if(olap && olap.nextSibling) nav.insertBefore(link,olap.nextSibling);
    else nav.appendChild(link);
  }

  function boot(){
    addPnlLink();
    const observer=new MutationObserver(addPnlLink);
    observer.observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
