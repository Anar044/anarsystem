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
        <strong><span class="brand-smart">Smart</span><span class="brand-horeca">Horeca</span></strong>
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
        gap:14px!important;
        align-items:center!important;
        padding:2px 8px 23px!important;
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
      body.dashboard-page .sidebar .unified-brand .sketch-brand-copy strong{
        display:flex!important;
        align-items:baseline!important;
        margin:0!important;
        padding:0!important;
        font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif!important;
        font-size:20px!important;
        font-weight:850!important;
        line-height:1!important;
        letter-spacing:-.55px!important;
        white-space:nowrap!important;
        text-shadow:0 1px 14px rgba(255,255,255,.05)!important;
      }
      body.dashboard-page .sidebar .unified-brand .brand-smart{
        color:#f7fbff!important;
      }
      body.dashboard-page .sidebar .unified-brand .brand-horeca{
        margin-left:2px!important;
        color:#37e9c2!important;
        background:linear-gradient(90deg,#1edcff 0%,#42efc5 48%,#7cffb4 100%)!important;
        -webkit-background-clip:text!important;
        background-clip:text!important;
        -webkit-text-fill-color:transparent!important;
        filter:drop-shadow(0 0 8px rgba(54,232,203,.18))!important;
      }
      body.dashboard-page .sidebar .unified-brand .sketch-brand-copy small{
        display:block!important;
        margin-top:7px!important;
        padding:0!important;
        color:#9bb1c2!important;
        font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif!important;
        font-size:10px!important;
        font-weight:600!important;
        line-height:1.25!important;
        letter-spacing:.01em!important;
        white-space:nowrap!important;
        opacity:.95!important;
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