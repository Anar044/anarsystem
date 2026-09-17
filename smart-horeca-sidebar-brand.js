(()=>{
  'use strict';
  const LOGO='/assets/brand/smarthoreca-logo-sidebar.jpg?v=20260917-3';
  let applying=false;
  let observer=null;

  function applyTheme(){
    try{
      const saved=localStorage.getItem('shReportsTheme');
      document.documentElement.dataset.theme=saved==='dark'?'dark':'light';
    }catch(e){
      document.documentElement.dataset.theme='light';
    }
  }

  function ensureStyle(){
    if(document.getElementById('sh-exact-brand-style'))return;
    const style=document.createElement('style');
    style.id='sh-exact-brand-style';
    style.textContent=`
      .sidebar .unified-brand{display:grid!important;grid-template-columns:62px minmax(0,1fr)!important;gap:14px!important;align-items:center!important;padding:2px 8px 23px!important;height:auto!important}
      .sidebar .sh-exact-brand-logo{display:block!important;width:62px!important;height:69px!important;object-fit:contain!important;object-position:center!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;box-shadow:none!important;background:transparent!important}
      .sidebar .sh-exact-brand-copy{display:flex!important;flex-direction:column!important;align-items:flex-start!important;justify-content:center!important;min-width:0!important;margin:0!important;padding:0!important;line-height:1!important}
      .sidebar .sh-exact-brand-copy strong{display:flex!important;align-items:baseline!important;margin:0!important;padding:0!important;white-space:nowrap!important;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif!important;font-size:20px!important;font-weight:850!important;letter-spacing:-.55px!important;line-height:1!important;text-shadow:0 1px 14px rgba(255,255,255,.05)!important}
      .sidebar .sh-exact-brand-copy .smart{color:#f7fbff!important}
      .sidebar .sh-exact-brand-copy .horeca{margin-left:2px!important;color:#37e9c2!important;background:linear-gradient(90deg,#1edcff 0%,#42efc5 48%,#7cffb4 100%)!important;-webkit-background-clip:text!important;background-clip:text!important;-webkit-text-fill-color:transparent!important;filter:drop-shadow(0 0 8px rgba(54,232,203,.18))!important}
      .sidebar .sh-exact-brand-copy small{display:block!important;margin-top:7px!important;padding:0!important;color:#9bb1c2!important;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif!important;font-size:10px!important;font-weight:600!important;line-height:1.25!important;letter-spacing:.01em!important;white-space:nowrap!important;opacity:.95!important}
      .sidebar .sh-theme-toggle{margin-top:14px!important;width:calc(100% - 16px)!important;margin-left:8px!important;margin-right:8px!important;min-height:46px!important;border-radius:12px!important;display:flex!important;align-items:center!important;gap:9px!important;justify-content:flex-start!important;cursor:pointer!important}
      .sidebar .sh-theme-toggle .theme-arrow{margin-left:auto!important;font-size:20px!important}
      html[data-theme="dark"] body{background:#0b1017!important}
      html[data-theme="dark"] body .app-shell,
      html[data-theme="dark"] body .main,
      html[data-theme="dark"] body .app-content{background:#0b1017!important}
    `;
    document.head.appendChild(style);
  }

  function brandIsExact(brand){
    const img=brand?.querySelector('img.sh-exact-brand-logo');
    return !!img && img.getAttribute('src')===LOGO;
  }

  function install(){
    if(applying)return false;
    const side=document.querySelector('.sidebar');
    const brand=side?.querySelector('.unified-brand');
    if(!side||!brand)return false;

    applying=true;
    try{
      ensureStyle();

      if(!brandIsExact(brand)){
        brand.innerHTML=`
          <img class="sh-exact-brand-logo" src="${LOGO}" alt="Smart Horeca">
          <div class="sh-exact-brand-copy">
            <strong><span class="smart">Smart</span><span class="horeca">Horeca</span></strong>
            <small>Управляй рестораном легко</small>
          </div>`;
      }

      let btn=side.querySelector('.sh-theme-toggle');
      if(!btn){
        btn=document.createElement('button');
        btn.type='button';
        btn.className='sh-theme-toggle';
        side.appendChild(btn);
      }

      const refresh=()=>{
        const dark=document.documentElement.dataset.theme==='dark';
        btn.innerHTML=`<span class="theme-icon">${dark?'☀':'◐'}</span><span>${dark?'Светлая тема':'Тёмная тема'}</span><span class="theme-arrow">›</span>`;
      };

      btn.onclick=(event)=>{
        event.preventDefault();
        event.stopPropagation();
        const next=document.documentElement.dataset.theme==='dark'?'light':'dark';
        try{localStorage.setItem('shReportsTheme',next)}catch(e){}
        document.documentElement.dataset.theme=next;
        refresh();
        window.dispatchEvent(new Event('resize'));
        document.dispatchEvent(new CustomEvent('sh-theme-change',{detail:{theme:next}}));
      };

      refresh();
      return true;
    }finally{
      applying=false;
    }
  }

  function watchSidebar(){
    const side=document.querySelector('.sidebar');
    if(!side||observer)return;
    observer=new MutationObserver(()=>{
      if(applying)return;
      const brand=side.querySelector('.unified-brand');
      if(brand && !brandIsExact(brand))queueMicrotask(install);
    });
    observer.observe(side,{subtree:true,childList:true});
  }

  function start(){
    install();
    watchSidebar();
    setTimeout(()=>{install();watchSidebar();},100);
    setTimeout(()=>{install();watchSidebar();},500);
    setTimeout(()=>{install();watchSidebar();},1200);
  }

  applyTheme();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();