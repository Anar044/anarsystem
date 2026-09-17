(()=>{
  'use strict';
  const root=document.documentElement;
  try{root.dataset.theme=localStorage.getItem('shReportsTheme')==='dark'?'dark':'light'}catch(e){root.dataset.theme='light'}
  const s=document.createElement('style');
  s.id='documents-light-theme-style';
  s.textContent=`
    body[data-protected="true"] #documents-page{padding:28px 30px 50px!important;max-width:1500px!important}
    body[data-protected="true"] .topbar{height:78px!important;padding:0 30px!important}

    html[data-theme="light"] body,
    html[data-theme="light"] body .app-shell,
    html[data-theme="light"] body .main,
    html[data-theme="light"] body #documents-page{background:linear-gradient(180deg,#f8fbfe 0%,#f2f7fb 100%)!important;color:#102942!important}
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

    html[data-theme="light"] body .documents-title,
    html[data-theme="light"] body .documents-card h3,
    html[data-theme="light"] body .document-details-head{color:#102942!important}
    html[data-theme="light"] body .documents-sub,
    html[data-theme="light"] body .documents-card p,
    html[data-theme="light"] body .documents-status,
    html[data-theme="light"] body .documents-note{color:#71859b!important}

    html[data-theme="light"] body .documents-card,
    html[data-theme="light"] body .documents-panel,
    html[data-theme="light"] body .documents-note{background:#fff!important;border-color:#e0e9f0!important;box-shadow:0 10px 26px rgba(28,58,82,.05)!important}
    html[data-theme="light"] body .documents-card:hover{border-color:#bfe8d8!important;box-shadow:0 14px 30px rgba(28,58,82,.075)!important}
    html[data-theme="light"] body .documents-card-icon{color:#05ad73!important}

    html[data-theme="light"] body .documents-toolbar{border-bottom-color:#e2eaf0!important}
    html[data-theme="light"] body .documents-toolbar label{color:#667b90!important}
    html[data-theme="light"] body .documents-toolbar input{background:#fff!important;border-color:#dce6ee!important;color:#17304a!important}
    html[data-theme="light"] body .documents-toolbar input:focus{border-color:#6ed9b2!important;box-shadow:0 0 0 3px rgba(0,193,122,.08)!important;outline:none!important}
    html[data-theme="light"] body .documents-toolbar button{background:#10cc92!important;color:#06291d!important}

    html[data-theme="light"] body .documents-table th{background:#f7fafc!important;color:#667b90!important;border-bottom-color:#e2eaf0!important}
    html[data-theme="light"] body .documents-table td{color:#21384f!important;border-bottom-color:#edf1f4!important}
    html[data-theme="light"] body .documents-table tr:hover td{background:#f0fbf7!important}
    html[data-theme="light"] body .document-status{background:#eafaf4!important;color:#078b5e!important}
    html[data-theme="light"] body .documents-empty{color:#74889c!important}

    html[data-theme="light"] body .document-details{background:#f8fbfd!important;border-color:#e2eaf0!important}
    html[data-theme="light"] body .document-details-head{border-bottom-color:#e2eaf0!important}
    html[data-theme="light"] body .document-details td{color:#60778a!important;border-bottom-color:#edf1f4!important}
    html[data-theme="light"] body .document-details td:last-child{color:#17304a!important}
  `;
  document.head.appendChild(s);
})();
