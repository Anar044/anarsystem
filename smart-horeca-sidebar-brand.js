(()=>{
  'use strict';

  const root=document.documentElement;
  const LOGO='/assets/brand/smarthoreca-owner-mark.webp?v=20261028-1';
  let applying=false;

  function readTheme(){
    try{localStorage.setItem('shReportsTheme','dark')}catch(e){}
    return 'dark';
  }

  function ensureStyle(){
    // Space Grotesk matches SH Owner. Font loading must never block the menu.
    if(!document.getElementById('sh-sidebar-space-grotesk-font')){
      const font=document.createElement('link');
      font.id='sh-sidebar-space-grotesk-font';
      font.rel='stylesheet';
      font.href='https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap';
      document.head.appendChild(font);
    }
    if(document.getElementById('sh-exact-brand-style'))return;
    const style=document.createElement('style');
    style.id='sh-exact-brand-style';
    style.textContent=`
      /* Variant B: compact glass brand card. The strong selectors below
         override app-shell's broad .brand span font-size:11px!important;
         otherwise title letters shrink, despite the correct parent style. */
      .sidebar .unified-brand{
        display:grid!important;
        grid-template-columns:54px minmax(0,1fr)!important;
        grid-template-rows:auto!important;
        align-items:center!important;
        justify-items:stretch!important;
        column-gap:12px!important;
        width:100%!important;
        min-width:0!important;
        height:auto!important;
        min-height:84px!important;
        margin:2px 0 15px!important;
        padding:12px!important;
        box-sizing:border-box!important;
        position:relative!important;
        isolation:isolate!important;
        border-radius:17px!important;
        border:1px solid rgba(43,154,210,.42)!important;
        background:linear-gradient(117deg,rgba(17,42,68,.98) 0%,rgba(10,28,46,.94) 57%,rgba(8,47,46,.66) 100%)!important;
        box-shadow:0 8px 25px rgba(0,0,0,.16),inset 0 1px 0 rgba(160,229,255,.09),0 0 14px rgba(0,143,255,.07)!important;
        overflow:hidden!important;
        gap:12px!important;
      }
      .sidebar .unified-brand:before{
        content:none!important;
        display:none!important;
      }
      .sidebar .unified-brand:after{
        content:""!important;
        display:block!important;
        position:absolute!important;
        inset:0!important;
        border-radius:inherit!important;
        pointer-events:none!important;
        z-index:-1!important;
        background:radial-gradient(circle at 10% 55%,rgba(11,160,241,.18),transparent 53%),radial-gradient(circle at 94% 45%,rgba(32,213,156,.10),transparent 52%)!important;
      }
      .sidebar .unified-brand > .sh-exact-brand-logo{
        display:block!important;
        grid-column:1!important;
        width:54px!important;
        height:54px!important;
        min-width:54px!important;
        min-height:54px!important;
        max-width:54px!important;
        max-height:54px!important;
        object-fit:contain!important;
        object-position:center!important;
        align-self:center!important;
        justify-self:center!important;
        flex:none!important;
        position:relative!important;
        margin:0!important;
        padding:0!important;
        border:0!important;
        border-radius:12px!important;
        background:transparent!important;
        box-shadow:0 0 15px rgba(9,175,247,.21),0 0 8px rgba(34,238,162,.10)!important;
      }
      html body[data-protected="true"] .sidebar .unified-brand > .sh-exact-brand-copy{
        display:flex!important;
        grid-column:2!important;
        flex-direction:column!important;
        align-items:flex-start!important;
        justify-content:center!important;
        min-width:0!important;
        width:100%!important;
        max-width:100%!important;
        align-self:center!important;
        justify-self:stretch!important;
        position:relative!important;
        left:auto!important;
        top:auto!important;
        transform:none!important;
        margin:0!important;
        padding:0!important;
        gap:5px!important;
        overflow:hidden!important;
        line-height:1.15!important;
      }
      .sidebar .unified-brand .sh-exact-brand-copy > strong{
        display:flex!important;
        align-items:baseline!important;
        flex-wrap:nowrap!important;
        width:100%!important;
        min-width:0!important;
        max-width:100%!important;
        margin:0!important;
        padding:0!important;
        color:#f4fbff!important;
        font-family:"Space Grotesk",Inter,ui-sans-serif,system-ui,sans-serif!important;
        font-size:16px!important;
        line-height:1.15!important;
        font-weight:700!important;
        letter-spacing:-.65px!important;
        white-space:nowrap!important;
        text-shadow:0 0 11px rgba(66,179,226,.06)!important;
      }
      /* .brand span has its own important font-size in app-shell.css. */
      .sidebar .unified-brand .sh-exact-brand-copy > strong > span{
        display:inline!important;
        position:static!important;
        margin:0!important;
        padding:0!important;
        font:700 16px/1.15 "Space Grotesk",Inter,ui-sans-serif,system-ui,sans-serif!important;
        letter-spacing:-.65px!important;
        white-space:nowrap!important;
      }
      .sidebar .unified-brand .sh-exact-brand-copy > strong > .smart{
        color:#f4fbff!important;
      }
      .sidebar .unified-brand .sh-exact-brand-copy > strong > .horeca{
        margin-left:4px!important;
        color:#42eeca!important;
        background:linear-gradient(90deg,#25c9ff,#4af4bc)!important;
        background-clip:text!important;
        -webkit-background-clip:text!important;
        -webkit-text-fill-color:transparent!important;
      }
      .sidebar .unified-brand .sh-exact-brand-copy > small{
        display:block!important;
        width:100%!important;
        min-width:0!important;
        max-width:100%!important;
        margin:0!important;
        padding:0!important;
        color:#b9d0de!important;
        opacity:1!important;
        font-family:"Space Grotesk",Inter,ui-sans-serif,system-ui,sans-serif!important;
        font-size:10.5px!important;
        line-height:1.35!important;
        font-weight:500!important;
        letter-spacing:-.10px!important;
        white-space:normal!important;
        overflow-wrap:break-word!important;
        word-break:normal!important;
        text-overflow:clip!important;
        overflow:visible!important;
      }
      @media (max-width:760px){
        .sidebar .unified-brand{
          grid-template-columns:54px minmax(0,1fr)!important;
          min-height:84px!important;
        }
      }
      /* Collapsed mode: polished 46px neon tile, no empty glass panel. */
      html body.sh-workspace-page.sh-sidebar-collapsed .sidebar .unified-brand{
        display:flex!important;
        justify-content:center!important;
        align-items:center!important;
        width:100%!important;
        min-height:54px!important;
        height:auto!important;
        margin:0 auto 12px!important;
        padding:5px 0 9px!important;
        border:0!important;
        background:transparent!important;
        box-shadow:none!important;
        overflow:visible!important;
      }
      html body.sh-workspace-page.sh-sidebar-collapsed .sidebar .unified-brand:after{
        display:none!important;
      }
      html body.sh-workspace-page.sh-sidebar-collapsed .sidebar .unified-brand > .sh-exact-brand-logo{
        width:44px!important;
        height:44px!important;
        min-width:44px!important;
        min-height:44px!important;
        max-width:44px!important;
        max-height:44px!important;
        border-radius:11px!important;
        box-shadow:0 0 13px rgba(0,166,238,.18),0 0 8px rgba(25,241,160,.10)!important;
      }
      html body.sh-workspace-page.sh-sidebar-collapsed[data-protected="true"] .sidebar .unified-brand > .sh-exact-brand-copy{
        display:none!important;
      }
      .sidebar .sh-theme-toggle{margin-top:14px!important;width:calc(100% - 16px)!important;margin-left:8px!important;margin-right:8px!important;min-height:46px!important;border-radius:12px!important;display:flex!important;align-items:center!important;gap:9px!important;justify-content:flex-start!important;cursor:pointer!important}
      .sidebar .sh-theme-toggle .theme-arrow{margin-left:auto!important;font-size:20px!important}

      html[data-theme="dark"] body,
      html[data-theme="dark"] body .app-shell,
      html[data-theme="dark"] body .main,
      html[data-theme="dark"] body .app-content{background:#0b1017!important;color:#f4f7fa!important}
      html[data-theme="dark"] body .topbar{background:#0d131b!important;border-bottom:1px solid #23303c!important;color:#f4f7fa!important;box-shadow:none!important}
      html[data-theme="dark"] body .topbar-title{color:#f4f7fa!important}
      html[data-theme="dark"] body .topbar-sub{color:#8997a6!important}
      html[data-theme="dark"] body .cash-network-card,
      html[data-theme="dark"] body .cash-modern-card{background:#111923!important;border-color:#23303c!important;color:#f4f7fa!important;box-shadow:0 12px 35px rgba(0,0,0,.16)!important}
      html[data-theme="dark"] body .cash-network-title h1,
      html[data-theme="dark"] body .cash-modern-head h2,
      html[data-theme="dark"] body .cash-modern-card-title h3{color:#f4f7fa!important}
      html[data-theme="dark"] body .cash-network-title p,
      html[data-theme="dark"] body .cash-modern-head p,
      html[data-theme="dark"] body .cash-selection-note,
      html[data-theme="dark"] body .cash-last-updated,
      html[data-theme="dark"] body .cash-modern-card-title p{color:#8997a6!important}
      html[data-theme="dark"] body .cash-network-kpi{background:#0f1720!important;border-color:#23303c!important;color:#f4f7fa!important}
      html[data-theme="dark"] body .cash-network-kpi span,
      html[data-theme="dark"] body .cash-network-kpi small{color:#8997a6!important}
      html[data-theme="dark"] body .cash-network-kpi strong{color:#f4f7fa!important}
      html[data-theme="dark"] body .cash-network-kpi.expected{background:#10251f!important;border-color:#1f4a37!important}
      html[data-theme="dark"] body .cash-network-kpi.expected strong{color:#42d392!important}
      html[data-theme="dark"] body .cash-network-badge,
      html[data-theme="dark"] body .cash-cash-status{background:rgba(66,211,146,.10)!important;border-color:rgba(66,211,146,.22)!important;color:#72dfac!important}
      html[data-theme="dark"] body .cash-card-statline span,
      html[data-theme="dark"] body .cash-order-filters button{background:#151f2a!important;border-color:#23303c!important;color:#91a0af!important}
      html[data-theme="dark"] body .cash-card-statline b,
      html[data-theme="dark"] body .cash-modern-orders .order-num,
      html[data-theme="dark"] body .cash-modern-orders .order-amount{color:#eef3f7!important}
      html[data-theme="dark"] body .cash-card-statline .accent{color:#42d392!important}
      html[data-theme="dark"] body .cash-order-search{background:#0d141c!important;border-color:#23303c!important;color:#eaf0f5!important}
      html[data-theme="dark"] body .cash-order-filters button.active{background:rgba(66,211,146,.13)!important;border-color:rgba(66,211,146,.30)!important;color:#63d9a0!important}
      html[data-theme="dark"] body .cash-modern-orders th{background:#111a23!important;color:#7f90a2!important;border-color:#23303c!important}
      html[data-theme="dark"] body .cash-modern-orders td{color:#cbd4de!important;border-top-color:#1c2732!important}
      html[data-theme="dark"] body .cash-modern-orders tr.order-row:hover{background:rgba(66,211,146,.055)!important}
      html[data-theme="dark"] body .cash-modern-footer{color:#718092!important;border-top-color:#23303c!important}
      html[data-theme="dark"] body .cm-dialog{background:#111923!important;border-color:#293746!important;color:#f4f7fa!important}
      html[data-theme="dark"] body .cm-head{border-bottom-color:#23303c!important}
      html[data-theme="dark"] body .cm-head h2,
      html[data-theme="dark"] body .cm-section-title{color:#f4f7fa!important}
      html[data-theme="dark"] body .cm-head p{color:#8997a6!important}
      html[data-theme="dark"] body .cm-close{background:#1a2531!important;color:#d9e1e9!important}
      html[data-theme="dark"] body .cm-detail,
      html[data-theme="dark"] body .cm-event,
      html[data-theme="dark"] body .cm-empty{background:#0d151e!important;border-color:#23303c!important}
      html[data-theme="dark"] body .cm-detail span,
      html[data-theme="dark"] body .cm-event span,
      html[data-theme="dark"] body .cm-empty{color:#738193!important}
      html[data-theme="dark"] body .cm-detail strong,
      html[data-theme="dark"] body .cm-event strong{color:#e7edf3!important}
      html[data-theme="dark"] body .cm-table th,
      html[data-theme="dark"] body .cm-table td{border-bottom-color:#23303c!important;color:#cbd4de!important}
      html[data-theme="dark"] body .sh-theme-toggle{background:#0f1720!important;border-color:#2a3947!important;color:#c9dae6!important}
    `;
    document.head.appendChild(style);
  }

  function brandIsExact(brand){
    const img=brand?.querySelector('img.sh-exact-brand-logo');
    return !!img && img.getAttribute('src')===LOGO && !!brand.querySelector('.sh-exact-brand-copy small');
  }

  function removeThemeControl(){
    document.querySelectorAll('.sidebar .sh-theme-toggle,.sidebar .theme-btn,[data-theme-label]').forEach(el=>el.remove());
  }

  function syncButton(){ removeThemeControl(); }

  function setTheme(){
    try{localStorage.setItem('shReportsTheme','dark')}catch(e){}
    root.dataset.theme='dark';
    removeThemeControl();
    window.dispatchEvent(new Event('resize'));
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
            <small data-sh-i18n-source="Управлять бизнесом легко">Управлять бизнесом легко</small>
          </div>`;
      }
      removeThemeControl();
      syncButton();
      return true;
    }finally{applying=false}
  }

  document.addEventListener('click',(event)=>{
    const btn=event.target.closest?.('.sidebar .sh-theme-toggle,.sidebar .theme-btn,[data-theme-label]');
    if(!btn)return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    setTheme();
  },true);

  function start(){
    root.dataset.theme=readTheme();
    removeThemeControl();
    install();
    setTimeout(install,100);
    setTimeout(install,500);
    setTimeout(install,1200);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();