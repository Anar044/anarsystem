(()=>{
  'use strict';
  const root=document.documentElement;
  try{root.dataset.theme=localStorage.getItem('shReportsTheme')==='dark'?'dark':'light'}catch(e){root.dataset.theme='light'}

  const style=document.createElement('style');
  style.id='nomenclature-light-theme-style';
  style.textContent=`
    body[data-protected="true"] .nom-page{padding:28px 32px 48px!important;max-width:1600px!important}
    body[data-protected="true"] .topbar{height:78px!important;padding:0 30px!important}

    html[data-theme="light"] body,
    html[data-theme="light"] body .app-shell,
    html[data-theme="light"] body .main,
    html[data-theme="light"] body .nom-page{
      background:linear-gradient(180deg,#f8fbfe 0%,#f2f7fb 100%)!important;
      color:#102942!important;
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
    html[data-theme="light"] body .user-chip{color:#102942!important}

    html[data-theme="light"] body .nom-head h1{color:#102942!important}
    html[data-theme="light"] body .nom-head p{color:#71859b!important}
    html[data-theme="light"] body .nom-status{
      background:#fff!important;border-color:#dfe8ef!important;color:#71859b!important;
      box-shadow:0 8px 22px rgba(28,58,82,.045)!important;
    }
    html[data-theme="light"] body .nom-status.ok{color:#078b5e!important;border-color:#c9efdf!important;background:#eefbf6!important}
    html[data-theme="light"] body .nom-status.err{color:#c84d5d!important;border-color:#f2cfd5!important;background:#fff4f6!important}

    html[data-theme="light"] body .nom-tabs button{
      background:#fff!important;border-color:#dfe8ef!important;color:#667b90!important;
      box-shadow:0 4px 14px rgba(28,58,82,.035)!important;
    }
    html[data-theme="light"] body .nom-tabs button:hover{border-color:#bfe8d8!important;color:#17304a!important}
    html[data-theme="light"] body .nom-tabs button.active{
      background:#eafaf4!important;border-color:#bdebd9!important;color:#067554!important;
      box-shadow:inset 0 0 0 1px rgba(5,173,115,.06)!important;
    }

    html[data-theme="light"] body .toolbar input,
    html[data-theme="light"] body .toolbar select,
    html[data-theme="light"] body .assign-row select,
    html[data-theme="light"] body .detail-card input,
    html[data-theme="light"] body .detail-card select,
    html[data-theme="light"] body .detail-card textarea,
    html[data-theme="light"] body .chart-summary input,
    html[data-theme="light"] body .ingredient-row input{
      background:#fff!important;border-color:#dce6ee!important;color:#17304a!important;
    }
    html[data-theme="light"] body .toolbar input:focus,
    html[data-theme="light"] body .toolbar select:focus,
    html[data-theme="light"] body .assign-row select:focus,
    html[data-theme="light"] body .detail-card input:focus,
    html[data-theme="light"] body .detail-card select:focus,
    html[data-theme="light"] body .detail-card textarea:focus,
    html[data-theme="light"] body .ingredient-row input:focus{
      border-color:#6ed9b2!important;box-shadow:0 0 0 3px rgba(0,193,122,.08)!important;outline:none!important;
    }
    html[data-theme="light"] body .check{color:#667b90!important}
    html[data-theme="light"] body .btn.secondary{background:#fff!important;border-color:#dce6ee!important;color:#304a62!important}
    html[data-theme="light"] body .btn.primary{background:#10cc92!important;border-color:#10cc92!important;color:#06291d!important}
    html[data-theme="light"] body .btn.danger{background:#fff1f3!important;border-color:#f1cbd2!important;color:#c24c5d!important}

    html[data-theme="light"] body .table-card,
    html[data-theme="light"] body .assign-card,
    html[data-theme="light"] body .detail-card,
    html[data-theme="light"] body .nom-tree,
    html[data-theme="light"] body .nom-items-head{
      background:#fff!important;border-color:#e0e9f0!important;
      box-shadow:0 10px 26px rgba(28,58,82,.05)!important;
      color:#102942!important;
    }
    html[data-theme="light"] body .table-card th{
      background:#f7fafc!important;color:#667b90!important;border-bottom-color:#e2eaf0!important;
    }
    html[data-theme="light"] body .table-card td{
      color:#21384f!important;border-bottom-color:#edf1f4!important;
    }
    html[data-theme="light"] body .table-card tr:hover td{background:#f0fbf7!important}
    html[data-theme="light"] body .muted{color:#74889c!important}
    html[data-theme="light"] body .status-live{background:#eafaf4!important;color:#078b5e!important}
    html[data-theme="light"] body .status-del{background:#fff0f3!important;color:#c94f60!important}

    html[data-theme="light"] body .assign-card h3,
    html[data-theme="light"] body .detail-card h3,
    html[data-theme="light"] body .chart-item strong{color:#102942!important}
    html[data-theme="light"] body .scale-detail,
    html[data-theme="light"] body .size-line,
    html[data-theme="light"] body .chart-item,
    html[data-theme="light"] body .editor-items,
    html[data-theme="light"] body .ingredient-row{border-color:#e7edf2!important}

    html[data-theme="light"] body .nom-tree-head{
      background:#f7fafc!important;border-bottom-color:#e2eaf0!important;color:#102942!important;
    }
    html[data-theme="light"] body .nom-tree-head span{color:#74889c!important}
    html[data-theme="light"] body .nom-tree-search{
      background:#f8fbfd!important;border-color:#dce6ee!important;color:#74889c!important;
    }
    html[data-theme="light"] body .nom-tree-search input{color:#17304a!important}
    html[data-theme="light"] body .nom-tree-node{color:#536d83!important}
    html[data-theme="light"] body .nom-tree-node:hover{background:#f0fbf7!important;color:#17304a!important}
    html[data-theme="light"] body .nom-tree-node.selected{
      background:#eafaf4!important;color:#067554!important;box-shadow:inset 2px 0 #10cc92!important;
    }
    html[data-theme="light"] body .tree-chevron,
    html[data-theme="light"] body .tree-count,
    html[data-theme="light"] body .nom-breadcrumb,
    html[data-theme="light"] body .nom-items-meta{color:#74889c!important}
    html[data-theme="light"] body .folder{color:#70889b!important}
    html[data-theme="light"] body .nom-tree-node.selected .folder{color:#05ad73!important}
    html[data-theme="light"] body .nom-items-title{color:#102942!important}
    html[data-theme="light"] body .nom-pagination{
      background:#f7fafc!important;border-top-color:#e2eaf0!important;color:#74889c!important;
    }
    html[data-theme="light"] body .nom-pagination button{
      background:#fff!important;border-color:#dce6ee!important;color:#536d83!important;
    }
    html[data-theme="light"] body .nom-pagination button:hover{border-color:#6ed9b2!important;color:#17304a!important}
    html[data-theme="light"] body .nom-pagination button.active{background:#10cc92!important;border-color:#10cc92!important;color:#06291d!important}

    html[data-theme="light"] body .modal-back{background:rgba(20,35,49,.28)!important}
    html[data-theme="light"] body .modal,
    html[data-theme="light"] body .chart-editor{
      background:#fff!important;border-color:#dfe8ef!important;color:#102942!important;
      box-shadow:0 24px 70px rgba(25,49,67,.20)!important;
    }
    html[data-theme="light"] body .modal-head,
    html[data-theme="light"] body .chart-editor .modal-head,
    html[data-theme="light"] body .chart-editor .modal-foot{
      background:#f8fbfd!important;border-color:#e6edf2!important;
    }
    html[data-theme="light"] body .modal-head h2,
    html[data-theme="light"] body .chart-editor .modal-head h2,
    html[data-theme="light"] body .chart-section-head h3{color:#102942!important}
    html[data-theme="light"] body .chart-kicker{color:#05ad73!important}
    html[data-theme="light"] body .chart-summary{background:#e2eaf0!important;border-color:#e2eaf0!important}
    html[data-theme="light"] body .chart-summary>div{background:#fff!important}
    html[data-theme="light"] body .chart-summary span,
    html[data-theme="light"] body .chart-section-head p,
    html[data-theme="light"] body .chart-editor .form-grid label,
    html[data-theme="light"] body .wide-label,
    html[data-theme="light"] body .ingredients-head{color:#71859b!important}
    html[data-theme="light"] body .chart-section{border-bottom-color:#e7edf2!important}

    html[data-theme="light"] body .nom-page .toolbar>.check{
      background:#fff!important;border-color:#dce6ee!important;color:#667b90!important;
    }
    html[data-theme="light"] body .nom-page .toolbar>.check:hover{background:#f8fbfd!important;border-color:#bfe8d8!important;color:#17304a!important}
    html[data-theme="light"] body .nom-page .toolbar>.check input{
      background:#fff!important;border-color:#9babb8!important;
    }
    html[data-theme="light"] body .nom-page .toolbar>.check input:checked{background:#10cc92!important;border-color:#10cc92!important}
    html[data-theme="light"] body .nom-page .toolbar>.check:has(input:checked){background:#eafaf4!important;border-color:#bdebd9!important;color:#067554!important}
  `;
  document.head.appendChild(style);
})();
