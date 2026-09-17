(()=>{
  'use strict';
  const root=document.documentElement;
  try{root.dataset.theme=localStorage.getItem('shReportsTheme')==='dark'?'dark':'light'}catch(e){root.dataset.theme='light'}

  const style=document.createElement('style');
  style.id='cash-shifts-light-theme-style';
  style.textContent=`
    body[data-protected="true"] .cash-shifts-page{padding:26px 30px 48px!important;max-width:1750px!important}
    body[data-protected="true"] .topbar{height:78px!important;padding:0 30px!important}
    body[data-protected="true"] .cs-panel{border-radius:15px!important}
    body[data-protected="true"] .cs-stat{min-height:94px!important;border-radius:12px!important;box-sizing:border-box!important}
    body[data-protected="true"] .cs-field input,
    body[data-protected="true"] .cs-btn{height:40px!important}

    html[data-theme="light"] body,
    html[data-theme="light"] body .app-shell,
    html[data-theme="light"] body .main,
    html[data-theme="light"] body .cash-shifts-page{
      background:linear-gradient(180deg,#f8fbfe 0%,#f2f7fb 100%)!important;
      color:#0c2440!important;
    }
    html[data-theme="light"] body .sidebar{
      background:radial-gradient(circle at 100% 15%,rgba(0,223,244,.09),transparent 28%),linear-gradient(180deg,#041725 0%,#061b2d 55%,#041522 100%)!important;
      border-right:1px solid #10364a!important;
      box-shadow:14px 0 36px rgba(5,31,48,.08)!important;
      padding:18px 14px 16px!important;
    }
    html[data-theme="light"] body .sidebar .nav-title{color:#7692a7!important}
    html[data-theme="light"] body .sidebar .side-nav>a,
    html[data-theme="light"] body .sidebar .documents-nav-toggle{
      color:#c3d2df!important;background:transparent!important;border:1px solid transparent!important;
      border-radius:12px!important;min-height:44px!important;margin:2px 0!important;font-weight:620!important;
    }
    html[data-theme="light"] body .sidebar .side-nav>a:hover,
    html[data-theme="light"] body .sidebar .documents-nav-toggle:hover{
      background:rgba(16,87,102,.28)!important;color:#fff!important;border-color:rgba(44,214,198,.18)!important;
    }
    html[data-theme="light"] body .sidebar .side-nav>a.active,
    html[data-theme="light"] body .sidebar .documents-nav-toggle.active{
      background:linear-gradient(90deg,rgba(0,193,122,.25),rgba(0,223,244,.12))!important;
      color:#7dffd0!important;border-color:rgba(0,223,200,.40)!important;
      box-shadow:inset 3px 0 #19edbd,0 0 22px rgba(0,223,244,.08)!important;
    }
    html[data-theme="light"] body .sidebar .sh-theme-toggle{
      background:#082437!important;border:1px solid #184258!important;color:#c9dae6!important;box-shadow:none!important;
    }
    html[data-theme="light"] body .sidebar .sh-theme-toggle:hover{
      background:#0b3044!important;border-color:#1f6a6b!important;color:#fff!important;
    }

    html[data-theme="light"] body .topbar{
      background:rgba(255,255,255,.98)!important;border-bottom:1px solid #e1eaf1!important;
      box-shadow:0 4px 20px rgba(31,59,83,.045)!important;color:#0e2541!important;
    }
    html[data-theme="light"] body .topbar-title{color:#0e2541!important;font-size:18px!important;font-weight:850!important}
    html[data-theme="light"] body .topbar-sub{color:#6c8198!important}
    html[data-theme="light"] body .icon-btn{background:#fff!important;border-color:#dce6ee!important;color:#425b70!important}

    html[data-theme="light"] body .cs-kicker{color:#05ad73!important}
    html[data-theme="light"] body .cs-title{color:#102942!important}
    html[data-theme="light"] body .cs-sub,
    html[data-theme="light"] body .cs-status{color:#71859b!important}
    html[data-theme="light"] body .cs-status.ok{color:#05ad73!important}
    html[data-theme="light"] body .cs-status.error{color:#d94b5d!important}

    html[data-theme="light"] body .cs-panel,
    html[data-theme="light"] body .cs-stat{
      background:#fff!important;border-color:#e0e9f0!important;
      box-shadow:0 10px 26px rgba(28,58,82,.055)!important;
    }
    html[data-theme="light"] body .cs-field label{color:#71859b!important}
    html[data-theme="light"] body .cs-field input{
      background:#fff!important;border-color:#dce6ee!important;color:#17304a!important;
      box-shadow:none!important;
    }
    html[data-theme="light"] body .cs-field input:focus{
      border-color:#6ed9b2!important;box-shadow:0 0 0 3px rgba(0,193,122,.08)!important;outline:none!important;
    }
    html[data-theme="light"] body .cs-btn{background:#10cc92!important;color:#06291d!important;box-shadow:0 8px 18px rgba(16,204,146,.18)!important}

    html[data-theme="light"] body .cs-stat span{color:#75889b!important}
    html[data-theme="light"] body .cs-stat strong{color:#0a213b!important}
    html[data-theme="light"] body .cs-stat small{color:#7c8fa1!important}

    html[data-theme="light"] body .panel-title{color:#102942!important}
    html[data-theme="light"] body .section-kicker{color:#05ad73!important}
    html[data-theme="light"] body .cs-table-wrap{
      background:#fff!important;border-color:#e0e9f0!important;
    }
    html[data-theme="light"] body .cs-table th{
      background:#f7fafc!important;color:#667b90!important;border-color:#e2eaf0!important;
    }
    html[data-theme="light"] body .cs-table td{
      color:#21384f!important;border-top-color:#edf1f4!important;
    }
    html[data-theme="light"] body .cs-table tbody tr:hover{background:#f0fbf7!important}
    html[data-theme="light"] body .cs-empty{color:#7b8d9d!important}
    html[data-theme="light"] body .cs-id,
    html[data-theme="light"] body .cs-secondary,
    html[data-theme="light"] body .cs-payment-count,
    html[data-theme="light"] body .cs-payment-empty{color:#74889c!important}
    html[data-theme="light"] body .cs-open{background:#fff5e7!important;color:#b66f0d!important}
    html[data-theme="light"] body .cs-closed{background:#eafaf4!important;color:#078b5e!important}
    html[data-theme="light"] body .cs-payment-toggle{
      background:#f8fbfd!important;border-color:#dce6ee!important;color:#304a62!important;
    }
    html[data-theme="light"] body .cs-payment-toggle.is-open{color:#078b5e!important;border-color:#bdebd9!important;background:#eefbf6!important}
    html[data-theme="light"] body .cs-payment-item{background:#f3f7fa!important;color:#304a62!important}
    html[data-theme="light"] body .cs-payment-item .negative{color:#d94b5d!important}
    html[data-theme="light"] body .cs-payment-item .positive{color:#078b5e!important}
  `;
  document.head.appendChild(style);
})();
