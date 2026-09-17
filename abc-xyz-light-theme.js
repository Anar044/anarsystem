(()=>{
  'use strict';
  const root=document.documentElement;
  try{root.dataset.theme=localStorage.getItem('shReportsTheme')==='dark'?'dark':'light'}catch(e){root.dataset.theme='light'}
  const s=document.createElement('style');
  s.id='abc-xyz-light-theme-style';
  s.textContent=`
    body[data-protected="true"] .app-content{padding:0!important}
    body[data-protected="true"] .abc-page{padding:28px 30px 50px!important;max-width:1800px!important}
    body[data-protected="true"] .topbar{height:78px!important;padding:0 30px!important}

    html[data-theme="light"] body,
    html[data-theme="light"] body .app-shell,
    html[data-theme="light"] body .main,
    html[data-theme="light"] body .app-content,
    html[data-theme="light"] body .abc-page{
      background:linear-gradient(180deg,#f8fbfe 0%,#f2f7fb 100%)!important;color:#102942!important;
      --abc-border:#e0e9f0;--abc-muted:#71859b;--abc-card:#fff;--abc-card2:#f8fbfd;--abc-text:#102942;
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

    html[data-theme="light"] body .abc-head h1,
    html[data-theme="light"] body .card-title,
    html[data-theme="light"] body .filter-title,
    html[data-theme="light"] body .legend-row b,
    html[data-theme="light"] body .abc-summary-title{color:#102942!important}
    html[data-theme="light"] body .abc-head p,
    html[data-theme="light"] body .row-count,
    html[data-theme="light"] body .category-cell{color:#71859b!important}
    html[data-theme="light"] body .status-pill{background:#fff!important;border-color:#dce6ee!important;color:#60778a!important}
    html[data-theme="light"] body .status-pill.ok{color:#078b5e!important}
    html[data-theme="light"] body .status-pill.loading{color:#a96b14!important}
    html[data-theme="light"] body .status-pill.error{color:#c84d5d!important}
    html[data-theme="light"] body .primary-btn{background:#10cc92!important;border-color:#10cc92!important;color:#06291d!important}
    html[data-theme="light"] body .secondary-btn{background:#fff!important;border-color:#dce6ee!important;color:#304a62!important}

    html[data-theme="light"] body .filter-card,
    html[data-theme="light"] body .distribution-card,
    html[data-theme="light"] body .table-card,
    html[data-theme="light"] body .abc-summary-card,
    html[data-theme="light"] body .legend-row{background:#fff!important;border-color:#e0e9f0!important;box-shadow:0 10px 26px rgba(28,58,82,.05)!important;color:#102942!important}
    html[data-theme="light"] body .filter-grid label,
    html[data-theme="light"] body .xyz-metric,
    html[data-theme="light"] body .thresholds label{color:#667b90!important}
    html[data-theme="light"] body .filter-grid select,
    html[data-theme="light"] body .filter-grid input,
    html[data-theme="light"] body .xyz-metric select,
    html[data-theme="light"] body .thresholds input,
    html[data-theme="light"] body .search-wrap input{background:#fff!important;border-color:#dce6ee!important;color:#17304a!important}
    html[data-theme="light"] body .filter-grid select:focus,
    html[data-theme="light"] body .filter-grid input:focus,
    html[data-theme="light"] body .xyz-metric select:focus,
    html[data-theme="light"] body .thresholds input:focus,
    html[data-theme="light"] body .search-wrap input:focus{border-color:#6ed9b2!important;box-shadow:0 0 0 3px rgba(0,193,122,.08)!important;outline:none!important}
    html[data-theme="light"] body .filter-bottom{border-top-color:#e7edf2!important}
    html[data-theme="light"] body .check{color:#304a62!important}
    html[data-theme="light"] body .date-range span{color:#8193a3!important}

    html[data-theme="light"] body .abc-summary-grid>div{background:#f8fbfd!important;border-color:#e2eaf0!important}
    html[data-theme="light"] body .abc-summary-grid strong{color:#17304a!important}
    html[data-theme="light"] body .abc-summary-grid span{color:#71859b!important}
    html[data-theme="light"] body .tab{background:#f8fbfd!important;border-color:#dfe8ef!important;color:#71859b!important}
    html[data-theme="light"] body .tab.active{background:#fff!important;color:#102942!important;border-top-color:#10cc92!important}

    html[data-theme="light"] body .dist-track{background:#e9eff3!important}
    html[data-theme="light"] body .dist-value{color:#536d83!important}
    html[data-theme="light"] body .table-toolbar{border-bottom-color:#e7edf2!important}
    html[data-theme="light"] body .search-wrap button{background:#fff!important;border-color:#dce6ee!important;color:#536d83!important}
    html[data-theme="light"] body table{color:#21384f!important}
    html[data-theme="light"] body th,
    html[data-theme="light"] body td{border-bottom-color:#edf1f4!important;border-right-color:#f0f3f6!important}
    html[data-theme="light"] body thead th{background:#f2f7fa!important;color:#60778a!important}
    html[data-theme="light"] body tbody td{color:#21384f!important}
    html[data-theme="light"] body tbody tr:hover td{background:#f0fbf7!important}
    html[data-theme="light"] body tfoot th,
    html[data-theme="light"] body tfoot td{background:#eef4f7!important;color:#17304a!important}
    html[data-theme="light"] body .group-cell{color:#536d83!important}
    html[data-theme="light"] body .matrix-badge{background:#eef2f5!important;border-color:#d6e0e7!important;color:#536d83!important}
    html[data-theme="light"] body .error-box{background:#fff2f4!important;border-color:#efcdd3!important;color:#c84d5d!important}
  `;
  document.head.appendChild(s);
})();
