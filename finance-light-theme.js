(()=>{
  'use strict';
  const root=document.documentElement;
  try{root.dataset.theme=localStorage.getItem('shReportsTheme')==='dark'?'dark':'light'}catch(e){root.dataset.theme='light'}

  if(!document.querySelector('link[href*="finance.css"]')){
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href='/finance.css?v=12';
    document.head.appendChild(link);
  }

  const s=document.createElement('style');
  s.id='finance-light-theme-style';
  s.textContent=`
    body[data-protected="true"] .finance-page{padding:28px 30px 60px!important;max-width:1540px!important}
    body[data-protected="true"] .topbar{height:78px!important;padding:0 30px!important}

    html[data-theme="light"] body,
    html[data-theme="light"] body .app-shell,
    html[data-theme="light"] body .main,
    html[data-theme="light"] body .finance-page{
      background:linear-gradient(180deg,#f8fbfe 0%,#f2f7fb 100%)!important;color:#102942!important;
      --fin-bg:#f4f8fc;--fin-card:#fff;--fin-card2:#f8fbfd;--fin-border:#e0e9f0;--fin-text:#102942;--fin-muted:#71859b;--fin-green:#10cc92;--fin-red:#d94b5d;
    }
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
    html[data-theme="light"] body .user-chip{color:#102942!important}

    html[data-theme="light"] body .fin-hero h1,
    html[data-theme="light"] body .fin-panel-head h2,
    html[data-theme="light"] body .fin-group-head h3,
    html[data-theme="light"] body .fin-modal-head h2,
    html[data-theme="light"] body .fin-modal-section-head h3{color:#102942!important}
    html[data-theme="light"] body .fin-hero p,
    html[data-theme="light"] body .fin-panel-head p,
    html[data-theme="light"] body .fin-status,
    html[data-theme="light"] body .fin-modal-head p,
    html[data-theme="light"] body .fin-modal-section-head span{color:#71859b!important}
    html[data-theme="light"] body .fin-kicker,
    html[data-theme="light"] body .fin-section-kicker{color:#05ad73!important}

    html[data-theme="light"] body .fin-source,
    html[data-theme="light"] body .fin-panel,
    html[data-theme="light"] body .fin-summary>div,
    html[data-theme="light"] body .fin-account-group{background:#fff!important;border-color:#e0e9f0!important;box-shadow:0 10px 26px rgba(28,58,82,.05)!important;color:#102942!important}
    html[data-theme="light"] body .fin-source small,
    html[data-theme="light"] body .fin-summary small,
    html[data-theme="light"] body .fin-group-head small,
    html[data-theme="light"] body .fin-account-main small,
    html[data-theme="light"] body .fin-account-right small,
    html[data-theme="light"] body .fin-account-ops{color:#74889c!important}
    html[data-theme="light"] body .fin-source>span{background:#10cc92!important}

    html[data-theme="light"] body .date-row input,
    html[data-theme="light"] body .fin-account-controls input{background:#fff!important;border-color:#dce6ee!important;color:#17304a!important}
    html[data-theme="light"] body .date-row input:focus,
    html[data-theme="light"] body .fin-account-controls input:focus{border-color:#6ed9b2!important;box-shadow:0 0 0 3px rgba(0,193,122,.08)!important;outline:none!important}
    html[data-theme="light"] body .fin-date label{color:#667b90!important}
    html[data-theme="light"] body .fin-btn{background:#10cc92!important;color:#06291d!important}
    html[data-theme="light"] body .fin-status.ok{color:#078b5e!important}
    html[data-theme="light"] body .fin-status.error{color:#c84d5d!important}

    html[data-theme="light"] body .fin-summary span{color:#75889b!important}
    html[data-theme="light"] body .fin-summary strong{color:#0a213b!important}
    html[data-theme="light"] body .fin-summary>div:nth-child(1) strong{color:#078b5e!important}
    html[data-theme="light"] body .fin-summary>div:nth-child(2) strong{color:#4b74d9!important}
    html[data-theme="light"] body .fin-summary>div:nth-child(3) strong{color:#8b63c6!important}
    html[data-theme="light"] body .fin-summary>div:nth-child(4) strong{color:#c85e70!important}

    html[data-theme="light"] body .fin-group-head{background:#f7fafc!important;border-bottom-color:#e2eaf0!important}
    html[data-theme="light"] body .fin-group-icon{background:#eafaf4!important;color:#078b5e!important}
    html[data-theme="light"] body .fin-account-card{background:#f8fbfd!important;border-color:#e2eaf0!important;color:#17304a!important}
    html[data-theme="light"] body .fin-account-card:hover,
    html[data-theme="light"] body .fin-account-card:focus{background:#f0fbf7!important;border-color:#bfe8d8!important}
    html[data-theme="light"] body .fin-account-right strong{color:#078b5e!important}
    html[data-theme="light"] body .fin-arrow{color:#8193a3!important}

    html[data-theme="light"] body .fin-table-wrap{background:#fff!important;border-color:#e0e9f0!important}
    html[data-theme="light"] body .fin-table th{background:#f7fafc!important;color:#667b90!important}
    html[data-theme="light"] body .fin-table td{color:#21384f!important;border-top-color:#edf1f4!important}
    html[data-theme="light"] body .fin-table td small,
    html[data-theme="light"] body .fin-table .muted,
    html[data-theme="light"] body .fin-empty{color:#74889c!important}
    html[data-theme="light"] body .fin-table-account{color:#17304a!important}
    html[data-theme="light"] body .fin-table-account:hover{color:#078b5e!important}
    html[data-theme="light"] body .fin-op{background:#eef2f5!important;color:#617486!important}
    html[data-theme="light"] body .fin-op.in{background:#eafaf4!important;color:#078b5e!important}
    html[data-theme="light"] body .fin-op.out{background:#fff0f3!important;color:#c94f60!important}
    html[data-theme="light"] body .fin-table .plus{color:#078b5e!important}
    html[data-theme="light"] body .fin-table .minus{color:#c94f60!important}

    html[data-theme="light"] body .fin-modal-backdrop{background:rgba(20,35,49,.28)!important}
    html[data-theme="light"] body .fin-modal-card{background:#fff!important;border-color:#dfe8ef!important;color:#102942!important;box-shadow:0 24px 70px rgba(25,49,67,.20)!important}
    html[data-theme="light"] body .fin-modal-close{background:#f8fbfd!important;border-color:#dce6ee!important;color:#60778a!important}
    html[data-theme="light"] body .fin-modal-balance{background:#eefbf6!important;border-color:#ccefe1!important}
    html[data-theme="light"] body .fin-modal-balance span,
    html[data-theme="light"] body .fin-modal-balance small{color:#71859b!important}
    html[data-theme="light"] body .fin-modal-balance strong{color:#078b5e!important}
    html[data-theme="light"] body .fin-modal-kpis>div{background:#f8fbfd!important;border-color:#e2eaf0!important}
    html[data-theme="light"] body .fin-modal-kpis span{color:#71859b!important}
    html[data-theme="light"] body .fin-modal-kpis b{color:#17304a!important}
    html[data-theme="light"] body .fin-modal-kpis>div:first-child b{color:#078b5e!important}
    html[data-theme="light"] body .fin-modal-kpis>div:nth-child(2) b{color:#c94f60!important}
  `;
  document.head.appendChild(s);
})();
