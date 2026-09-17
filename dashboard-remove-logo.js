(()=>{
  'use strict';

  function removeSidebarLogo(){
    const brand=document.querySelector('.sidebar .unified-brand');
    if(!brand)return false;

    brand.dataset.sketchBrand='1';
    brand.innerHTML='<div class="sketch-brand-copy"><strong>Smart<span>Horeca</span></strong><small>Управляй рестораном легко</small></div>';
    brand.style.setProperty('display','block','important');
    brand.style.setProperty('grid-template-columns','1fr','important');
    brand.style.setProperty('padding','8px 10px 22px','important');

    let style=document.getElementById('dashboard-no-logo-style');
    if(!style){
      style=document.createElement('style');
      style.id='dashboard-no-logo-style';
      document.head.appendChild(style);
    }
    style.textContent=`
      body.dashboard-page .sidebar .unified-brand .sketch-brand-mark,
      body.dashboard-page .sidebar .unified-brand img,
      body.dashboard-page .sidebar .unified-brand svg,
      body.dashboard-page .sidebar .unified-brand .brand-logo,
      body.dashboard-page .sidebar .unified-brand [class*="logo"]{display:none!important;background:none!important;background-image:none!important}
      body.dashboard-page .sidebar .unified-brand{display:block!important;grid-template-columns:1fr!important;padding:8px 10px 22px!important;height:auto!important}
      body.dashboard-page .sidebar .unified-brand .sketch-brand-copy{display:flex!important;flex-direction:column!important;align-items:flex-start!important;justify-content:center!important;margin:0!important;padding:0!important}
    `;
    return true;
  }

  removeSidebarLogo();
  document.addEventListener('DOMContentLoaded',removeSidebarLogo,{once:true});
  setTimeout(removeSidebarLogo,100);
  setTimeout(removeSidebarLogo,500);
  setTimeout(removeSidebarLogo,1200);

  const observer=new MutationObserver(()=>removeSidebarLogo());
  observer.observe(document.documentElement,{subtree:true,childList:true});
})();