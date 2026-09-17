(()=>{
  'use strict';

  const SRC='/assets/brand/smarthoreca-logo-sidebar.jpg?v=20260917-3';

  function installExactSidebarLogo(){
    const brand=document.querySelector('.sidebar .unified-brand');
    if(!brand)return false;

    const current=brand.querySelector('img.sh-user-exact-logo');
    if(current && current.getAttribute('src')===SRC)return true;

    brand.dataset.sketchBrand='1';
    brand.innerHTML=`
      <img class="sh-user-exact-logo" src="${SRC}" alt="Smart Horeca">
      <div class="sketch-brand-copy">
        <strong>Smart<span>Horeca</span></strong>
        <small>Управляй рестораном легко</small>
      </div>`;

    let style=document.getElementById('dashboard-exact-logo-style');
    if(!style){
      style=document.createElement('style');
      style.id='dashboard-exact-logo-style';
      document.head.appendChild(style);
    }
    style.textContent=`
      body.dashboard-page .sidebar .unified-brand{
        display:grid!important;
        grid-template-columns:62px minmax(0,1fr)!important;
        gap:11px!important;
        align-items:center!important;
        padding:2px 5px 22px!important;
        height:auto!important;
      }
      body.dashboard-page .sidebar .unified-brand .sh-user-exact-logo{
        display:block!important;
        width:62px!important;
        height:69px!important;
        object-fit:contain!important;
        object-position:center!important;
        margin:0!important;
        padding:0!important;
        border:0!important;
        border-radius:0!important;
        box-shadow:none!important;
        background:transparent!important;
      }
      body.dashboard-page .sidebar .unified-brand .sketch-brand-copy{
        display:flex!important;
        flex-direction:column!important;
        align-items:flex-start!important;
        justify-content:center!important;
        min-width:0!important;
        margin:0!important;
        padding:0!important;
      }
    `;
    return true;
  }

  installExactSidebarLogo();
  document.addEventListener('DOMContentLoaded',installExactSidebarLogo,{once:true});
  setTimeout(installExactSidebarLogo,100);
  setTimeout(installExactSidebarLogo,500);
  setTimeout(installExactSidebarLogo,1200);

  const sidebar=document.querySelector('.sidebar');
  if(sidebar){
    new MutationObserver(()=>{
      const brand=sidebar.querySelector('.unified-brand');
      if(brand && !brand.querySelector('img.sh-user-exact-logo'))installExactSidebarLogo();
    }).observe(sidebar,{subtree:true,childList:true});
  }
})();