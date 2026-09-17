(()=>{
  'use strict';
  const root=document.documentElement;
  try{root.dataset.theme=localStorage.getItem('shReportsTheme')==='dark'?'dark':'light'}catch(e){root.dataset.theme='light'}
  const s=document.createElement('style');
  s.id='supplier-balances-light-theme-style';
  s.textContent=`
    body[data-protected="true"] .app-content{padding:0!important}
    body[data-protected="true"] .sup-page{padding:30px 34px 60px!important;max-width:1380px!important}
    body[data-protected="true"] .topbar{height:78px!important;padding:0 30px!important}

    html[data-theme="light"] body,
    html[data-theme="light"] body .app-shell,
    html[data-theme="light"] body .main,
    html[data-theme="light"] body .app-content,
    html[data-theme="light"] body .sup-page{
      background:linear-gradient(180deg,#f8fbfe 0%,#f2f7fb 100%)!important;color:#102942!important;
      --sb-bg:#f4f8fc;--sb-card:#fff;--sb-border:#e0e9f0;--sb-text:#102942;--sb-muted:#71859b;--sb-green:#10cc92;--sb-red:#d94b5d;
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

    html[data-theme="light"] body .sup-hero h1,
    html[data-theme="light"] body .card-head h2,
    html[data-theme="light"] body .sup-note b{color:#102942!important}
    html[data-theme="light"] body .sup-hero p,
    html[data-theme="light"] body .updated,
    html[data-theme="light"] body .card-head span,
    html[data-theme="light"] body .sup-note{color:#71859b!important}
    html[data-theme="light"] body .eyebrow{color:#05ad73!important}
    html[data-theme="light"] body .sup-status{background:#fff!important;border-color:#dce6ee!important;color:#60778a!important}

    html[data-theme="light"] body .sup-toolbar,
    html[data-theme="light"] body .sup-card,
    html[data-theme="light"] body .sup-note{background:#fff!important;border-color:#e0e9f0!important;box-shadow:0 10px 26px rgba(28,58,82,.05)!important}
    html[data-theme="light"] body .field label{color:#667b90!important}
    html[data-theme="light"] body .field input{background:#fff!important;border-color:#dce6ee!important;color:#17304a!important}
    html[data-theme="light"] body .field input:focus{border-color:#6ed9b2!important;box-shadow:0 0 0 3px rgba(0,193,122,.08)!important}
    html[data-theme="light"] body .primary{background:#10cc92!important;border-color:#10cc92!important;color:#06291d!important}

    html[data-theme="light"] body .sup-message{border-color:#cfdce5!important;color:#60778a!important;background:#f8fbfd!important}
    html[data-theme="light"] body .table-wrap th{background:#f7fafc!important;color:#667b90!important;border-bottom-color:#e2eaf0!important}
    html[data-theme="light"] body .table-wrap td{color:#21384f!important;border-bottom-color:#edf1f4!important}
    html[data-theme="light"] body .table-wrap tbody tr:nth-child(even) td{background:#fbfcfd!important}
    html[data-theme="light"] body .table-wrap tbody tr:hover td{background:#f0fbf7!important}
    html[data-theme="light"] body .table-wrap td small{color:#74889c!important}
    html[data-theme="light"] body .table-wrap tfoot th{background:#eef4f7!important;border-color:#dce6ee!important;color:#17304a!important}
    html[data-theme="light"] body .empty{color:#74889c!important}
    html[data-theme="light"] body .sup-note code{color:#536d83!important}
  `;
  document.head.appendChild(s);
})();
