(()=>{
  'use strict';
  const root=document.documentElement;

  function installStyle(){
    if(document.getElementById('cash-runtime-theme-fix-style'))return;
    const s=document.createElement('style');
    s.id='cash-runtime-theme-fix-style';
    s.textContent=`
      /* Match Dashboard brand spacing exactly enough even if app-shell flex rules win */
      body .sidebar .sh-exact-brand-copy{margin-left:12px!important;transform:none!important}

      /* Dark theme must be explicit because app-shell can remove the page's original inline CSS */
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
    document.head.appendChild(s);
  }

  function syncButton(){
    const btn=document.querySelector('.sidebar .sh-theme-toggle');
    if(!btn)return;
    btn.onclick=null;
    const dark=root.dataset.theme==='dark';
    btn.innerHTML=`<span class="theme-icon">${dark?'☀':'◐'}</span><span>${dark?'Светлая тема':'Тёмная тема'}</span><span class="theme-arrow">›</span>`;
  }

  function setTheme(next){
    try{localStorage.setItem('shReportsTheme',next)}catch(e){}
    root.dataset.theme=next;
    syncButton();
    window.dispatchEvent(new Event('resize'));
  }

  document.addEventListener('click',(e)=>{
    const btn=e.target.closest?.('.sidebar .sh-theme-toggle');
    if(!btn)return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    setTheme(root.dataset.theme==='dark'?'light':'dark');
  },true);

  installStyle();
  try{root.dataset.theme=localStorage.getItem('shReportsTheme')==='dark'?'dark':'light'}catch(e){}
  syncButton();
  document.addEventListener('DOMContentLoaded',()=>{installStyle();syncButton()},{once:true});
  setTimeout(syncButton,250);
  setTimeout(syncButton,900);
})();