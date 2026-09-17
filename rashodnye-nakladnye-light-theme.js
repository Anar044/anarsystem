(()=>{
  'use strict';
  const root=document.documentElement;
  try{root.dataset.theme=localStorage.getItem('shReportsTheme')==='dark'?'dark':'light'}catch(e){root.dataset.theme='light'}
  const s=document.createElement('style');
  s.id='rashodnye-light-theme-style';
  s.textContent=`
    body[data-protected="true"] #outgoing-page{padding:28px 30px 50px!important;max-width:1680px!important;margin:0 auto!important}
    body[data-protected="true"] .topbar{height:78px!important;padding:0 30px!important}

    html[data-theme="light"] body,
    html[data-theme="light"] body .app-shell,
    html[data-theme="light"] body .main,
    html[data-theme="light"] body #outgoing-page{background:linear-gradient(180deg,#f8fbfe 0%,#f2f7fb 100%)!important;color:#102942!important}
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

    html[data-theme="light"] body .oi-title,
    html[data-theme="light"] body .oi-card-head,
    html[data-theme="light"] body .oi-details-head strong,
    html[data-theme="light"] body .oi-dialog-head strong{color:#102942!important}
    html[data-theme="light"] body .oi-sub,
    html[data-theme="light"] body .oi-status,
    html[data-theme="light"] body .oi-hint{color:#71859b!important}

    html[data-theme="light"] body .oi-filter,
    html[data-theme="light"] body .oi-kpi,
    html[data-theme="light"] body .oi-card,
    html[data-theme="light"] body .oi-details,
    html[data-theme="light"] body .oi-dialog{background:#fff!important;border-color:#e0e9f0!important;box-shadow:0 10px 26px rgba(28,58,82,.055)!important;color:#102942!important}
    html[data-theme="light"] body .oi-filter label,
    html[data-theme="light"] body .oi-form label{color:#667b90!important}
    html[data-theme="light"] body .oi-filter input,
    html[data-theme="light"] body .oi-filter select,
    html[data-theme="light"] body .oi-form input,
    html[data-theme="light"] body .oi-form textarea{background:#fff!important;border-color:#dce6ee!important;color:#17304a!important}
    html[data-theme="light"] body .oi-filter input:focus,
    html[data-theme="light"] body .oi-form input:focus,
    html[data-theme="light"] body .oi-form textarea:focus{border-color:#6ed9b2!important;box-shadow:0 0 0 3px rgba(0,193,122,.08)!important}

    html[data-theme="light"] body .oi-btn{background:#fff!important;border-color:#dce6ee!important;color:#304a62!important}
    html[data-theme="light"] body .oi-btn.primary{background:#10cc92!important;border-color:#10cc92!important;color:#06291d!important}
    html[data-theme="light"] body .oi-btn.danger{background:#fff1f3!important;border-color:#f1cbd2!important;color:#c24c5d!important}
    html[data-theme="light"] body .oi-status.success{color:#078b5e!important}
    html[data-theme="light"] body .oi-status.error{color:#c84d5d!important}

    html[data-theme="light"] body .oi-kpi span{color:#75889b!important}
    html[data-theme="light"] body .oi-kpi strong{color:#0a213b!important}
    html[data-theme="light"] body .oi-card-head{border-bottom-color:#e2eaf0!important}
    html[data-theme="light"] body .oi-table th{color:#667b90!important;border-bottom-color:#e2eaf0!important}
    html[data-theme="light"] body .oi-table td{color:#21384f!important;border-bottom-color:#edf1f4!important}
    html[data-theme="light"] body .oi-table tbody tr:hover{background:#f0fbf7!important}
    html[data-theme="light"] body .oi-pill{background:#eafaf4!important;color:#078b5e!important}
    html[data-theme="light"] body .oi-pill.new{background:#fff7e9!important;color:#a96b14!important}
    html[data-theme="light"] body .oi-pill.deleted{background:#fff0f3!important;color:#c94f60!important}
    html[data-theme="light"] body .oi-empty{color:#74889c!important}

    html[data-theme="light"] body .oi-grid>div{background:#f8fbfd!important}
    html[data-theme="light"] body .oi-grid span{color:#71859b!important}
    html[data-theme="light"] body .oi-grid strong{color:#17304a!important}
    html[data-theme="light"] body .oi-items th{color:#667b90!important}
    html[data-theme="light"] body .oi-items td{color:#21384f!important;border-bottom-color:#edf1f4!important}

    html[data-theme="light"] body .oi-editor{background:rgba(20,35,49,.28)!important}
    html[data-theme="light"] body .oi-dialog-head{border-bottom-color:#e6edf2!important}
    html[data-theme="light"] body .oi-item-editor{border-color:#e2eaf0!important;background:#f8fbfd!important}
  `;
  document.head.appendChild(s);
})();
