(()=>{
  'use strict';
  const root=document.documentElement;
  root.dataset.theme=localStorage.getItem('shReportsTheme')==='dark'?'dark':'light';

  function add(){
    let s=document.getElementById('cash-light-theme-style');
    if(!s){s=document.createElement('style');s.id='cash-light-theme-style';document.head.appendChild(s)}
    s.textContent=`
      body[data-protected="true"] .cash-page{max-width:1500px!important}
      body[data-protected="true"] .app-content{padding:26px 30px 48px!important}
      body[data-protected="true"] .topbar{height:78px!important;padding:0 30px!important}
      body[data-protected="true"] .cash-modern{gap:16px!important}
      body[data-protected="true"] .cash-network-card{border-radius:15px!important;padding:20px!important}
      body[data-protected="true"] .cash-network-kpis{gap:10px!important}
      body[data-protected="true"] .cash-network-kpi{min-height:94px!important;border-radius:12px!important;padding:15px 16px!important;box-sizing:border-box!important}
      body[data-protected="true"] .cash-cards{gap:14px!important}
      body[data-protected="true"] .cash-modern-card{border-radius:15px!important}
      body[data-protected="true"] .cash-modern-card-head{padding:17px 18px 14px!important}
      body[data-protected="true"] .cash-order-tools{padding:12px 15px!important}

      html[data-theme="light"] body,
      html[data-theme="light"] body .app-shell,
      html[data-theme="light"] body .main,
      html[data-theme="light"] body .app-content{background:linear-gradient(180deg,#f8fbfe 0%,#f2f7fb 100%)!important;color:#0c2440!important}
      html[data-theme="light"] body .sidebar{background:radial-gradient(circle at 100% 15%,rgba(0,223,244,.09),transparent 28%),linear-gradient(180deg,#041725 0%,#061b2d 55%,#041522 100%)!important;border-right:1px solid #10364a!important;box-shadow:14px 0 36px rgba(5,31,48,.08)!important;padding:18px 14px 16px!important}
      html[data-theme="light"] body .sidebar .nav-title{color:#7692a7!important}
      html[data-theme="light"] body .sidebar .side-nav>a,
      html[data-theme="light"] body .sidebar .documents-nav-toggle{color:#c3d2df!important;background:transparent!important;border:1px solid transparent!important;border-radius:12px!important;min-height:44px!important;margin:2px 0!important;font-weight:620!important}
      html[data-theme="light"] body .sidebar .side-nav>a:hover,
      html[data-theme="light"] body .sidebar .documents-nav-toggle:hover{background:rgba(16,87,102,.28)!important;color:#fff!important;border-color:rgba(44,214,198,.18)!important}
      html[data-theme="light"] body .sidebar .side-nav>a.active,
      html[data-theme="light"] body .sidebar .documents-nav-toggle.active{background:linear-gradient(90deg,rgba(0,193,122,.25),rgba(0,223,244,.12))!important;color:#7dffd0!important;border-color:rgba(0,223,200,.40)!important;box-shadow:inset 3px 0 #19edbd,0 0 22px rgba(0,223,244,.08)!important}
      html[data-theme="light"] body .sidebar .sh-theme-toggle{background:#082437!important;border:1px solid #184258!important;color:#c9dae6!important;box-shadow:none!important}
      html[data-theme="light"] body .sidebar .sh-theme-toggle:hover{background:#0b3044!important;border-color:#1f6a6b!important;color:#fff!important}

      html[data-theme="light"] body .topbar{background:rgba(255,255,255,.98)!important;border-bottom:1px solid #e1eaf1!important;box-shadow:0 4px 20px rgba(31,59,83,.045)!important;color:#0e2541!important}
      html[data-theme="light"] body .topbar-title{color:#0e2541!important;font-size:18px!important;font-weight:850!important}
      html[data-theme="light"] body .topbar-sub{color:#6c8198!important}
      html[data-theme="light"] body .icon-btn{background:#fff!important;border-color:#dce6ee!important;color:#425b70!important}

      html[data-theme="light"] body .cash-network-card{background:#fff!important;border:1px solid #e0e9f0!important;box-shadow:0 10px 26px rgba(28,58,82,.06)!important}
      html[data-theme="light"] body .cash-network-title .eyebrow{color:#05ad73!important}
      html[data-theme="light"] body .cash-network-title h1{color:#102942!important}
      html[data-theme="light"] body .cash-network-title p{color:#71859b!important}
      html[data-theme="light"] body .cash-network-badge{background:#eafaf4!important;border-color:#c9efdf!important;color:#078b5e!important}
      html[data-theme="light"] body .cash-network-kpi{background:#f8fbfd!important;border:1px solid #dfe8ef!important;color:#10263d!important}
      html[data-theme="light"] body .cash-network-kpi span,
      html[data-theme="light"] body .cash-network-kpi small{color:#75889b!important}
      html[data-theme="light"] body .cash-network-kpi strong{color:#0a213b!important}
      html[data-theme="light"] body .cash-network-kpi.expected{background:#eefbf6!important;border-color:#ccefe1!important}
      html[data-theme="light"] body .cash-network-kpi.expected strong{color:#06a96f!important}
      html[data-theme="light"] body .cash-modern-head h2{color:#102942!important}
      html[data-theme="light"] body .cash-modern-head p,
      html[data-theme="light"] body .cash-selection-note,
      html[data-theme="light"] body .cash-last-updated{color:#71859b!important}
      html[data-theme="light"] body .cash-modern-loading{background:#fff!important;border-color:#e0e9f0!important;color:#71859b!important}
      html[data-theme="light"] body .cash-modern-card{background:#fff!important;border-color:#e0e9f0!important;box-shadow:0 10px 26px rgba(28,58,82,.05)!important}
      html[data-theme="light"] body .cash-modern-card:hover{border-color:#bfe8d8!important;box-shadow:0 14px 32px rgba(28,58,82,.08)!important}
      html[data-theme="light"] body .cash-modern-card-head{border-bottom-color:#e7edf2!important}
      html[data-theme="light"] body .cash-modern-card-title h3{color:#102942!important}
      html[data-theme="light"] body .cash-modern-card-title p{color:#74889c!important}
      html[data-theme="light"] body .cash-cash-status{background:#eafaf4!important;color:#078b5e!important}
      html[data-theme="light"] body .cash-card-statline span{background:#f3f7fa!important;color:#6e8297!important}
      html[data-theme="light"] body .cash-card-statline b{color:#183047!important}
      html[data-theme="light"] body .cash-card-statline .accent{color:#05ad73!important}
      html[data-theme="light"] body .cash-order-tools{border-bottom-color:#e7edf2!important}
      html[data-theme="light"] body .cash-order-search{background:#fff!important;border-color:#dce6ee!important;color:#17304a!important}
      html[data-theme="light"] body .cash-order-search:focus{border-color:#6ed9b2!important;box-shadow:0 0 0 3px rgba(0,193,122,.08)!important}
      html[data-theme="light"] body .cash-order-filters button{background:#f4f8fb!important;border-color:#dfe7ed!important;color:#6c8198!important}
      html[data-theme="light"] body .cash-order-filters button.active{background:#eafaf4!important;border-color:#bdebd9!important;color:#067554!important}
      html[data-theme="light"] body .cash-modern-orders th{background:#f7fafc!important;color:#667b90!important;border-color:#e2eaf0!important}
      html[data-theme="light"] body .cash-modern-orders td{border-top-color:#edf1f4!important;color:#21384f!important}
      html[data-theme="light"] body .cash-modern-orders tr.order-row:hover{background:#f0fbf7!important}
      html[data-theme="light"] body .cash-modern-orders .order-num,
      html[data-theme="light"] body .cash-modern-orders .order-amount{color:#102942!important}
      html[data-theme="light"] body .cash-modern-empty{color:#7b8d9d!important}
      html[data-theme="light"] body .cash-modern-footer{color:#74889c!important;border-top-color:#e7edf2!important}

      html[data-theme="light"] body .cm-backdrop{background:rgba(20,35,49,.28)!important}
      html[data-theme="light"] body .cm-dialog{background:#fff!important;border-color:#dfe8ef!important;box-shadow:0 24px 70px rgba(25,49,67,.20)!important;color:#102942!important}
      html[data-theme="light"] body .cm-head{border-bottom-color:#e6edf2!important}
      html[data-theme="light"] body .cm-head h2,
      html[data-theme="light"] body .cm-section-title{color:#102942!important}
      html[data-theme="light"] body .cm-head p{color:#71859b!important}
      html[data-theme="light"] body .cm-close{background:#f2f6f9!important;color:#476074!important}
      html[data-theme="light"] body .cm-detail,
      html[data-theme="light"] body .cm-event,
      html[data-theme="light"] body .cm-empty{background:#f8fbfd!important;border:1px solid #e5edf2!important}
      html[data-theme="light"] body .cm-detail span,
      html[data-theme="light"] body .cm-event span,
      html[data-theme="light"] body .cm-empty{color:#71859b!important}
      html[data-theme="light"] body .cm-detail strong,
      html[data-theme="light"] body .cm-event strong{color:#17304a!important}
      html[data-theme="light"] body .cm-table th{color:#71859b!important}
      html[data-theme="light"] body .cm-table th,
      html[data-theme="light"] body .cm-table td{border-bottom-color:#e7edf2!important;color:#21384f!important}
    `;
  }
  add();
})();