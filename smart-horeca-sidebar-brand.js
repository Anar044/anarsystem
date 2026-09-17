(()=>{
  'use strict';
  const LOGO='/assets/brand/smarthoreca-logo-sidebar.jpg?v=20260917-3';

  function theme(){
    const saved=localStorage.getItem('shReportsTheme');
    document.documentElement.dataset.theme=saved==='dark'?'dark':'light';
  }

  function install(){
    const side=document.querySelector('.sidebar');
    const brand=side?.querySelector('.unified-brand');
    if(!side||!brand)return false;

    if(!brand.querySelector('.sh-exact-brand-logo')){
      brand.innerHTML=`
        <img class="sh-exact-brand-logo" src="${LOGO}" alt="Smart Horeca">
        <div class="sh-exact-brand-copy">
          <strong><span class="smart">Smart</span><span class="horeca">Horeca</span></strong>
          <small>Управляй рестораном легко</small>
        </div>`;
    }

    let style=document.getElementById('sh-exact-brand-style');
    if(!style){style=document.createElement('style');style.id='sh-exact-brand-style';document.head.appendChild(style)}
    style.textContent=`
      .sidebar .unified-brand{display:grid!important;grid-template-columns:62px minmax(0,1fr)!important;gap:13px!important;align-items:center!important;padding:2px 5px 22px!important;height:auto!important}
      .sidebar .sh-exact-brand-logo{display:block!important;width:62px!important;height:69px!important;object-fit:contain!important;object-position:center!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;box-shadow:none!important;background:transparent!important}
      .sidebar .sh-exact-brand-copy{display:flex!important;flex-direction:column!important;align-items:flex-start!important;justify-content:center!important;min-width:0!important;line-height:1!important}
      .sidebar .sh-exact-brand-copy strong{display:flex!important;align-items:baseline!important;white-space:nowrap!important;font-size:18px!important;font-weight:850!important;letter-spacing:-.45px!important;line-height:1!important}
      .sidebar .sh-exact-brand-copy .smart{color:#f5fbff!important}
      .sidebar .sh-exact-brand-copy .horeca{margin-left:2px!important;background:linear-gradient(90deg,#19d7c4 0%,#62ffb6 100%)!important;-webkit-background-clip:text!important;background-clip:text!important;-webkit-text-fill-color:transparent!important;color:#37edb1!important;filter:drop-shadow(0 0 8px rgba(25,215,196,.16))!important}
      .sidebar .sh-exact-brand-copy small{display:block!important;margin-top:6px!important;color:#9fb0bf!important;font-size:9px!important;font-weight:600!important;line-height:1.25!important;white-space:normal!important}
      .sidebar .sh-theme-toggle{margin-top:14px!important;width:calc(100% - 16px)!important;margin-left:8px!important;margin-right:8px!important;min-height:46px!important;border-radius:12px!important;display:flex!important;align-items:center!important;gap:9px!important;justify-content:flex-start!important;cursor:pointer!important}
      .sidebar .sh-theme-toggle .theme-arrow{margin-left:auto!important;font-size:20px!important}
    `;

    let btn=side.querySelector('.sh-theme-toggle');
    if(!btn){
      btn=document.createElement('button');btn.type='button';btn.className='sh-theme-toggle';
      side.appendChild(btn);
    }
    const refresh=()=>{
      const dark=document.documentElement.dataset.theme==='dark';
      btn.innerHTML=`<span class="theme-icon">${dark?'☀':'◐'}</span><span>${dark?'Светлая тема':'Тёмная тема'}</span><span class="theme-arrow">›</span>`;
    };
    btn.onclick=()=>{
      const next=document.documentElement.dataset.theme==='dark'?'light':'dark';
      localStorage.setItem('shReportsTheme',next);
      document.documentElement.dataset.theme=next;
      refresh();
      window.dispatchEvent(new Event('resize'));
    };
    refresh();
    return true;
  }

  theme();
  install();
  document.addEventListener('DOMContentLoaded',install,{once:true});
  setTimeout(install,100);setTimeout(install,500);setTimeout(install,1200);
  const obs=new MutationObserver(()=>install());
  obs.observe(document.documentElement,{subtree:true,childList:true});
})();