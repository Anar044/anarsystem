(()=>{
  'use strict';
  const root=document.documentElement;
  try{root.dataset.theme=localStorage.getItem('shReportsTheme')==='dark'?'dark':'light'}catch(e){root.dataset.theme='light'}
  const s=document.createElement('style');
  s.id='reports-light-theme-style';
  s.textContent=`
    body[data-protected="true"] .app-content{padding:28px 30px 50px!important}
    body[data-protected="true"] .topbar{height:78px!important;padding:0 30px!important}
    body[data-protected="true"] .reports-page{width:100%!important;max-width:1680px!important;margin:0 auto!important}

    html[data-theme="light"] body,
    html[data-theme="light"] body .app-shell,
    html[data-theme="light"] body .main,
    html[data-theme="light"] body .app-content,
    html[data-theme="light"] body .reports-page{background:linear-gradient(180deg,#f8fbfe 0%,#f2f7fb 100%)!important;color:#102942!important}
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

    html[data-theme="light"] body #olap-builder .olap-shell,
    html[data-theme="light"] body #olap-builder .olap-fields-card,
    html[data-theme="light"] body #olap-builder .olap-main-card,
    html[data-theme="light"] body #olap-builder .olap-zone-card,
    html[data-theme="light"] body #olap-builder .olap-filters-panel,
    html[data-theme="light"] body #olap-builder .olap-result-card{background:#fff!important;border-color:#e0e9f0!important;color:#102942!important;box-shadow:0 10px 26px rgba(28,58,82,.05)!important}
    html[data-theme="light"] body #olap-builder .olap-report-title,
    html[data-theme="light"] body #olap-builder .olap-card-title{color:#102942!important}
    html[data-theme="light"] body #olap-builder .olap-report-subtitle,
    html[data-theme="light"] body #olap-builder .olap-status,
    html[data-theme="light"] body #olap-builder .olap-empty,
    html[data-theme="light"] body #olap-builder .olap-result-empty span{color:#71859b!important}

    html[data-theme="light"] body #olap-builder input,
    html[data-theme="light"] body #olap-builder select{background:#fff!important;border-color:#dce6ee!important;color:#17304a!important}
    html[data-theme="light"] body #olap-builder input:focus,
    html[data-theme="light"] body #olap-builder select:focus{border-color:#6ed9b2!important;box-shadow:0 0 0 3px rgba(0,193,122,.08)!important;outline:none!important}
    html[data-theme="light"] body #olap-builder label,
    html[data-theme="light"] body #olap-builder .olap-date-wrap span,
    html[data-theme="light"] body #olap-builder .olap-saved-wrap span{color:#667b90!important}
    html[data-theme="light"] body #olap-builder .olap-primary{background:#10cc92!important;border-color:#10cc92!important;color:#06291d!important}
    html[data-theme="light"] body #olap-builder .olap-excel{background:#eafaf4!important;border-color:#bdebd9!important;color:#067554!important}
    html[data-theme="light"] body #olap-builder .olap-icon-btn,
    html[data-theme="light"] body #olap-builder .olap-field-actions button,
    html[data-theme="light"] body #olap-builder #olap-add-filter{background:#fff!important;border-color:#dce6ee!important;color:#304a62!important}

    html[data-theme="light"] body #olap-builder .olap-search-wrap{background:#f8fbfd!important;border-color:#dce6ee!important;color:#74889c!important}
    html[data-theme="light"] body #olap-builder .olap-field{background:#f8fbfd!important;border-color:#e2eaf0!important;color:#17304a!important}
    html[data-theme="light"] body #olap-builder .olap-field:hover{background:#f0fbf7!important;border-color:#bfe8d8!important}
    html[data-theme="light"] body #olap-builder .olap-field strong,
    html[data-theme="light"] body #olap-builder .olap-selected-field strong{color:#17304a!important}
    html[data-theme="light"] body #olap-builder .olap-field small,
    html[data-theme="light"] body #olap-builder .olap-selected-field small,
    html[data-theme="light"] body #olap-builder .olap-flags{color:#74889c!important}
    html[data-theme="light"] body #olap-builder .olap-selected{background:#f8fbfd!important;border-color:#dfe8ef!important}
    html[data-theme="light"] body #olap-builder .olap-selected-field{background:#fff!important;border-color:#cfe2db!important;color:#17304a!important}
    html[data-theme="light"] body #olap-builder .olap-selected-field button{background:#eef2f5!important;color:#60778a!important}
    html[data-theme="light"] body #olap-builder .olap-drop-active{background:#eefbf6!important;border-color:#6ed9b2!important}
    html[data-theme="light"] body #olap-builder .olap-filter-editor{background:#f8fbfd!important;border-color:#e2eaf0!important}

    html[data-theme="light"] body #olap-builder #olap-fields::-webkit-scrollbar-track{background:#eef3f6!important}
    html[data-theme="light"] body #olap-builder #olap-fields::-webkit-scrollbar-thumb{background:#aabac6!important;border-color:#eef3f6!important}
    html[data-theme="light"] body #olap-builder #olap-fields::-webkit-scrollbar-thumb:hover{background:#8298a9!important}

    html[data-theme="light"] body .olap-result{color:#17304a!important}
    html[data-theme="light"] body .olap-result .report-header strong{color:#102942!important}
    html[data-theme="light"] body .olap-result .report-header span{background:#fff!important;border-color:#dce6ee!important;color:#60778a!important}
    html[data-theme="light"] body .olap-result .report-table-wrapper{background:#fff!important;border-color:#dfe8ef!important;box-shadow:0 10px 28px rgba(28,58,82,.07)!important}
    html[data-theme="light"] body .olap-result .report-table th{background:#f2f7fa!important;border-bottom-color:#dce6ee!important;color:#60778a!important}
    html[data-theme="light"] body .olap-result .report-table td{background:#fff!important;border-bottom-color:#edf1f4!important;color:#21384f!important}
    html[data-theme="light"] body .olap-result .report-table tr.olap-level-0 td{background:#eaf4f8!important;border-color:#c9dce5!important;color:#17304a!important}
    html[data-theme="light"] body .olap-result .report-table tr.olap-level-0 td:first-child{color:#102942!important}
    html[data-theme="light"] body .olap-result .report-table tr.olap-level-0 td:nth-last-child(-n+2){color:#067554!important}
    html[data-theme="light"] body .olap-result .report-table tr.olap-level-1 td{background:#f3f8fb!important;border-bottom-color:#dce7ed!important}
    html[data-theme="light"] body .olap-result .report-table tr.olap-level-1 td:nth-child(2){color:#17304a!important}
    html[data-theme="light"] body .olap-result .report-table tr.olap-level-1 td:nth-last-child(-n+2){color:#315f8f!important}
    html[data-theme="light"] body .olap-result .report-table tr.olap-level-2 td{background:#fff!important}
    html[data-theme="light"] body .olap-result .report-table tr.olap-level-2 td:nth-child(3){color:#304a62!important}
    html[data-theme="light"] body .olap-result .report-table tr.olap-level-2 td:nth-last-child(-n+2){color:#17304a!important}
    html[data-theme="light"] body .olap-result .report-table .olap-group-toggle{background:#fff!important;border-color:#c8d8e3!important;color:#536d83!important}
    html[data-theme="light"] body .olap-result .report-table .olap-grand-total td{background:#e6f8f1!important;border-top-color:#10b880!important;color:#07543d!important}
    html[data-theme="light"] body .olap-result .report-table .olap-grand-total td:nth-last-child(-n+2){color:#07543d!important}
  `;
  document.head.appendChild(s);
})();
