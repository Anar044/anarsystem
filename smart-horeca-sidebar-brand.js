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
    if(document.getElementById('sh-exact-brand-style'))return;
    const style=document.createElement('style');
    style.id='sh-exact-brand-style';
    style.textContent=`
      /* Smart Horeca / SH Owner shared identity. The panel is scoped to the
         sidebar: no changes to documents, access, nav or other modules. */
      .sidebar .unified-brand{
        display:grid!important;
        grid-template-columns:64px minmax(0,1fr)!important;
        column-gap:11px!important;
        row-gap:0!important;
        align-items:center!important;
        width:100%!important;
        min-width:0!important;
        min-height:104px!important;
        height:auto!important;
        margin:3px 0 15px!important;
        padding:11px 9px 13px!important;
        box-sizing:border-box!important;
        border:1px solid rgba(93,143,167,.22)!important;
        border-radius:16px!important;
        background:linear-gradient(130deg,rgba(22,40,58,.76),rgba(13,27,36,.24))!important;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.04)!important;
        gap:11px!important;
      }
      .sidebar .unified-brand:before{display:none!important;content:none!important}
      .sidebar .sh-exact-brand-logo{
        display:block!important;
        width:64px!important;
        height:64px!important;
        min-width:64px!important;
        min-height:64px!important;
        max-width:64px!important;
        object-fit:contain!important;
        object-position:center!important;
        margin:0!important;
        padding:0!important;
        border:0!important;
        border-radius:13px!important;
        box-shadow:0 0 17px rgba(10,175,238,.13)!important;
        background:transparent!important;
      }
      html body[data-protected="true"] .sidebar .unified-brand .sh-exact-brand-copy{
        display:flex!important;
        flex-direction:column!important;
        align-items:flex-start!important;
        justify-content:center!important;
        min-width:0!important;
        max-width:100%!important;
        margin:0!important;
        padding:0!important;
        position:static!important;
        left:auto!important;
        transform:none!important;
        overflow:visible!important;
        line-height:1.1!important;
      }
      .sidebar .sh-exact-brand-copy strong{
        display:flex!important;
        align-items:baseline!important;
        max-width:100%!important;
        margin:0!important;
        padding:0!important;
        white-space:nowrap!important;
        overflow:visible!important;
        font-family:"Space Grotesk",Inter,ui-sans-serif,system-ui,sans-serif!important;
        font-size:15px!important;
        font-weight:700!important;
        letter-spacing:-.62px!important;
        line-height:1.08!important;
        text-shadow:0 1px 14px rgba(255,255,255,.06)!important;
      }
      .sidebar .sh-exact-brand-copy .smart{color:#f7fbff!important}
      .sidebar .sh-exact-brand-copy .horeca{
        margin-left:3px!important;
        color:#37e9c2!important;
        background:linear-gradient(90deg,#16ceff 0%,#43efc6 60%,#8cffba 100%)!important;
        -webkit-background-clip:text!important;
        background-clip:text!important;
        -webkit-text-fill-color:transparent!important;
        filter:drop-shadow(0 0 8px rgba(54,232,203,.14))!important;
      }
      .sidebar .sh-exact-brand-copy small{
        display:block!important;
        width:100%!important;
        max-width:100%!important;
        margin:8px 0 0!important;
        padding:0!important;
        color:#afc5d4!important;
        font-family:"Space Grotesk",Inter,ui-sans-serif,system-ui,sans-serif!important;
        font-size:10.6px!important;
        font-weight:500!important;
        line-height:1.4!important;
        letter-spacing:-.06px!important;
        white-space:normal!important;
        overflow-wrap:normal!important;
        overflow:visible!important;
        text-overflow:clip!important;
        opacity:1!important;
      }
      /* The compact 70px mode keeps its icon and never takes 104px of space. */
      body.sh-workspace-page.sh-sidebar-collapsed .sidebar .unified-brand{
        margin:0 auto 12px!important;
        min-height:0!important;
        border-color:transparent!important;
        background:transparent!important;
        box-shadow:none!important;
        padding:4px 0 10px!important;
      }
      body.sh-workspace-page.sh-sidebar-collapsed .sidebar .sh-exact-brand-logo{
        min-width:40px!important;min-height:40px!important;
        box-shadow:0 0 11px rgba(12,186,226,.12)!important;
      }
      @media(max-width:760px){
        .sidebar .unified-brand{grid-template-columns:64px minmax(0,1fr)!important;min-height:94px!important}
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