(()=>{
  'use strict';
  const root=document.documentElement;
  try{root.dataset.theme=localStorage.getItem('shReportsTheme')==='dark'?'dark':'light'}catch(e){root.dataset.theme='light'}

  if(!document.querySelector('link[href*="assets-advanced.css"]')){
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href='/assets-advanced.css?v=20260915-1';
    document.head.appendChild(link);
  }

  const style=document.createElement('style');
  style.id='assets-light-theme-style';
  style.textContent=`
    body[data-protected="true"] .asset-page{padding:28px 30px 60px!important;max-width:1650px!important}
    body[data-protected="true"] .topbar{height:78px!important;padding:0 30px!important}

    html[data-theme="light"] body,
    html[data-theme="light"] body .app-shell,
    html[data-theme="light"] body .main,
    html[data-theme="light"] body .asset-page{
      background:linear-gradient(180deg,#f8fbfe 0%,#f2f7fb 100%)!important;
      color:#102942!important;
      --a-bg:#f4f8fc;--a-card:#fff;--a-card2:#f8fbfd;--a-border:#e0e9f0;--a-border2:#d5e1e9;
      --a-text:#102942;--a-muted:#71859b;--a-green:#10cc92;--a-red:#d94b5d;--a-amber:#c98927;
    }
    html[data-theme="light"] body .sidebar{
      background:radial-gradient(circle at 100% 15%,rgba(0,223,244,.09),transparent 28%),linear-gradient(180deg,#041725 0%,#061b2d 55%,#041522 100%)!important;
      border-right:1px solid #10364a!important;box-shadow:14px 0 36px rgba(5,31,48,.08)!important;padding:18px 14px 16px!important;
    }
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

    html[data-theme="light"] body .asset-hero h1,
    html[data-theme="light"] body .section-head h2,
    html[data-theme="light"] body .modal-head h2,
    html[data-theme="light"] body .detail-grid h3,
    html[data-theme="light"] body .advanced-head h3,
    html[data-theme="light"] body .asset-meta-form h4,
    html[data-theme="light"] body .asset-files-section h4{color:#102942!important}
    html[data-theme="light"] body .asset-hero p,
    html[data-theme="light"] body .section-head span,
    html[data-theme="light"] body .modal-head p,
    html[data-theme="light"] body .asset-sub,
    html[data-theme="light"] body .advanced-head p{color:#71859b!important}
    html[data-theme="light"] body .eyebrow{color:#05ad73!important}
    html[data-theme="light"] body .primary,
    html[data-theme="light"] body .small-primary{background:#10cc92!important;border-color:#10cc92!important;color:#06291d!important}
    html[data-theme="light"] body .ghost{background:#fff!important;border-color:#dce6ee!important;color:#304a62!important}
    html[data-theme="light"] body .ghost:hover{border-color:#bfe8d8!important;color:#17304a!important}
    html[data-theme="light"] body .ghost.danger{background:#fff1f3!important;border-color:#f1cbd2!important;color:#c24c5d!important}

    html[data-theme="light"] body .asset-kpis article,
    html[data-theme="light"] body .asset-card,
    html[data-theme="light"] body .asset-advanced-panel{
      background:#fff!important;border-color:#e0e9f0!important;box-shadow:0 10px 26px rgba(28,58,82,.055)!important;color:#102942!important;
    }
    html[data-theme="light"] body .asset-kpis article.accent{background:#eefbf6!important;border-color:#ccefe1!important}
    html[data-theme="light"] body .asset-kpis span,
    html[data-theme="light"] body .health-metrics span{color:#75889b!important}
    html[data-theme="light"] body .asset-kpis strong,
    html[data-theme="light"] body .health-metrics strong{color:#0a213b!important}
    html[data-theme="light"] body .asset-kpis small{color:#7c8fa1!important}

    html[data-theme="light"] body .controls input,
    html[data-theme="light"] body .controls select,
    html[data-theme="light"] body .asset-form input,
    html[data-theme="light"] body .asset-form select,
    html[data-theme="light"] body .asset-form textarea,
    html[data-theme="light"] body .event-form input,
    html[data-theme="light"] body .event-form select,
    html[data-theme="light"] body .event-form textarea,
    html[data-theme="light"] body .asset-meta-form input,
    html[data-theme="light"] body .file-upload-form input,
    html[data-theme="light"] body .file-upload-form select{
      background:#fff!important;border-color:#dce6ee!important;color:#17304a!important;
    }
    html[data-theme="light"] body .controls input:focus,
    html[data-theme="light"] body .controls select:focus,
    html[data-theme="light"] body .asset-form input:focus,
    html[data-theme="light"] body .asset-form select:focus,
    html[data-theme="light"] body .asset-form textarea:focus,
    html[data-theme="light"] body .event-form input:focus,
    html[data-theme="light"] body .event-form select:focus,
    html[data-theme="light"] body .event-form textarea:focus{border-color:#6ed9b2!important;box-shadow:0 0 0 3px rgba(0,193,122,.08)!important}

    html[data-theme="light"] body .asset-table th{color:#667b90!important;border-bottom-color:#e2eaf0!important}
    html[data-theme="light"] body .asset-table td{color:#21384f!important;border-bottom-color:#edf1f4!important}
    html[data-theme="light"] body .asset-table tbody tr:hover{background:#f0fbf7!important}
    html[data-theme="light"] body .asset-name{color:#102942!important}
    html[data-theme="light"] body .row-actions button{background:#fff!important;border-color:#dce6ee!important;color:#536d83!important}
    html[data-theme="light"] body .empty{color:#74889c!important;border-color:#cfdce5!important}
    html[data-theme="light"] body .status-badge{background:#eafaf4!important;border-color:#bdebd9!important;color:#078b5e!important}
    html[data-theme="light"] body .status-badge.REPAIR{background:#fff6e9!important;border-color:#f0d7ac!important;color:#a96b14!important}
    html[data-theme="light"] body .status-badge.DISPOSED,
    html[data-theme="light"] body .status-badge.SOLD{background:#f1f4f7!important;border-color:#d9e1e7!important;color:#697a8a!important}

    html[data-theme="light"] body .modal{background:rgba(20,35,49,.28)!important}
    html[data-theme="light"] body .modal-box{background:#fff!important;border-color:#dfe8ef!important;color:#102942!important;box-shadow:0 24px 70px rgba(25,49,67,.20)!important}
    html[data-theme="light"] body .close{color:#60778a!important}
    html[data-theme="light"] body .field label{color:#60778a!important}
    html[data-theme="light"] body .field small{color:#8193a3!important}
    html[data-theme="light"] body .modal-actions{border-top-color:#e6edf2!important}
    html[data-theme="light"] body .calc-preview{background:#eefbf6!important;border-color:#ccefe1!important}
    html[data-theme="light"] body .calc-preview div span{color:#718b80!important}
    html[data-theme="light"] body .calc-preview div strong{color:#102942!important}
    html[data-theme="light"] body .detail-kpis article,
    html[data-theme="light"] body .detail-grid section,
    html[data-theme="light"] body .detail-grid aside,
    html[data-theme="light"] body .timeline-item{background:#f8fbfd!important;border-color:#e2eaf0!important}
    html[data-theme="light"] body .detail-kpis span,
    html[data-theme="light"] body .timeline-top span,
    html[data-theme="light"] body .timeline-item p,
    html[data-theme="light"] body .fact span{color:#71859b!important}
    html[data-theme="light"] body .detail-kpis strong,
    html[data-theme="light"] body .timeline-top strong,
    html[data-theme="light"] body .fact b{color:#17304a!important}
    html[data-theme="light"] body .fact{border-bottom-color:#e7edf2!important}
    html[data-theme="light"] body .timeline-empty{border-color:#cfdce5!important;color:#74889c!important}

    html[data-theme="light"] body .health-metrics article,
    html[data-theme="light"] body .asset-meta-form,
    html[data-theme="light"] body .asset-files-section,
    html[data-theme="light"] body .photo-placeholder,
    html[data-theme="light"] body .document-item{
      background:#f8fbfd!important;border-color:#e2eaf0!important;color:#17304a!important;
    }
    html[data-theme="light"] body .health-recommendation{background:#eefbf6!important;border-color:#ccefe1!important}
    html[data-theme="light"] body .health-recommendation.replace{background:#fff7ea!important;border-color:#efd8b3!important}
    html[data-theme="light"] body .health-recommendation.service{background:#fff2f4!important;border-color:#efcdd3!important}
    html[data-theme="light"] body .health-recommendation.archived{background:#f2f5f7!important;border-color:#dce4ea!important}
    html[data-theme="light"] body .health-recommendation p,
    html[data-theme="light"] body .health-dates,
    html[data-theme="light"] body .health-recommendation>small,
    html[data-theme="light"] body .files-title small,
    html[data-theme="light"] body .photo-item>small,
    html[data-theme="light"] body .document-item small,
    html[data-theme="light"] body .files-empty{color:#71859b!important}
    html[data-theme="light"] body .health-dates b,
    html[data-theme="light"] body .document-item b{color:#17304a!important}
    html[data-theme="light"] body .document-item button{background:#fff!important;border-color:#dce6ee!important;color:#536d83!important}
    html[data-theme="light"] body .files-empty{border-color:#cfdce5!important;background:#fff!important}
  `;
  document.head.appendChild(style);
})();
