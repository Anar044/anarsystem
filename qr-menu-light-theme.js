(()=>{
  'use strict';
  const root=document.documentElement;
  try{root.dataset.theme=localStorage.getItem('shReportsTheme')==='dark'?'dark':'light'}catch(e){root.dataset.theme='light'}
  const s=document.createElement('style');
  s.id='qr-menu-light-theme-style';
  s.textContent=`
    body[data-protected="true"] .qr-page{padding:28px 30px 50px!important;max-width:1600px!important}
    body[data-protected="true"] .topbar{height:78px!important;padding:0 30px!important}

    html[data-theme="light"] body,
    html[data-theme="light"] body .app,
    html[data-theme="light"] body .main,
    html[data-theme="light"] body .qr-page{
      background:linear-gradient(180deg,#f8fbfe 0%,#f2f7fb 100%)!important;color:#102942!important;
      --qr-bg:#f4f8fc;--qr-card:#fff;--qr-card2:#f8fbfd;--qr-input:#fff;--qr-border:#e0e9f0;--qr-border2:#dce6ee;--qr-text:#102942;--qr-muted:#71859b;--qr-green:#10cc92;
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
    html[data-theme="light"] body .topbar .title{color:#0e2541!important;font-size:18px!important;font-weight:850!important}
    html[data-theme="light"] body .topbar .crumb{color:#6c8198!important}
    html[data-theme="light"] body .topbar .crumb span{color:#536d83!important}
    html[data-theme="light"] body .control{background:#10cc92!important;border-color:#10cc92!important;color:#06291d!important}

    html[data-theme="light"] body .qr-head h1,
    html[data-theme="light"] body .q-card h3,
    html[data-theme="light"] body .item h4,
    html[data-theme="light"] body .settings-head h2,
    html[data-theme="light"] body .modal-head h3{color:#102942!important}
    html[data-theme="light"] body .qr-head p,
    html[data-theme="light"] body .item p,
    html[data-theme="light"] body .hint{color:#71859b!important}
    html[data-theme="light"] body .qbtn{background:#fff!important;border-color:#dce6ee!important;color:#304a62!important}
    html[data-theme="light"] body .qbtn:hover{border-color:#bfe8d8!important;color:#17304a!important}
    html[data-theme="light"] body .qbtn.primary{background:#10cc92!important;border-color:#10cc92!important;color:#06291d!important}

    html[data-theme="light"] body .q-card,
    html[data-theme="light"] body .item,
    html[data-theme="light"] body .info-preview{background:#fff!important;border-color:#e0e9f0!important;box-shadow:0 10px 26px rgba(28,58,82,.045)!important;color:#102942!important}
    html[data-theme="light"] body .cat{color:#536d83!important}
    html[data-theme="light"] body .cat:hover{background:#f0fbf7!important}
    html[data-theme="light"] body .cat.active{background:#eafaf4!important;border-color:#bdebd9!important;color:#067554!important}
    html[data-theme="light"] body .cat span{color:#74889c!important}
    html[data-theme="light"] body .add-cat{border-color:#cfdce5!important;color:#71859b!important}
    html[data-theme="light"] body .menu-toolbar input{background:#fff!important;border-color:#dce6ee!important;color:#17304a!important}
    html[data-theme="light"] body .menu-toolbar input:focus{border-color:#6ed9b2!important;box-shadow:0 0 0 3px rgba(0,193,122,.08)!important}
    html[data-theme="light"] body .photo{background:#f0f4f7!important;color:#71859b!important}
    html[data-theme="light"] body .price{color:#17304a!important}
    html[data-theme="light"] body .mini{background:#fff!important;border-color:#dce6ee!important;color:#536d83!important}
    html[data-theme="light"] body .source-badge{background:#eafaf4!important;color:#078b5e!important}
    html[data-theme="light"] body .status{background:#eafaf4!important;color:#078b5e!important}
    html[data-theme="light"] body .empty{border-color:#cfdce5!important;color:#74889c!important}

    html[data-theme="light"] body .settings-modal,
    html[data-theme="light"] body .modal{background:rgba(20,35,49,.28)!important}
    html[data-theme="light"] body .settings-panel,
    html[data-theme="light"] body .modal-box{background:#fff!important;border-color:#dfe8ef!important;color:#102942!important;box-shadow:0 24px 70px rgba(25,49,67,.20)!important}
    html[data-theme="light"] body .setting-section{border-top-color:#e7edf2!important}
    html[data-theme="light"] body .setting-section h4,
    html[data-theme="light"] body .field label{color:#667b90!important}
    html[data-theme="light"] body .field input,
    html[data-theme="light"] body .field textarea,
    html[data-theme="light"] body .field select{background:#fff!important;border-color:#dce6ee!important;color:#17304a!important}
    html[data-theme="light"] body .field input:focus,
    html[data-theme="light"] body .field textarea:focus,
    html[data-theme="light"] body .field select:focus{border-color:#6ed9b2!important;box-shadow:0 0 0 3px rgba(0,193,122,.08)!important}
    html[data-theme="light"] body .close{color:#60778a!important}
    html[data-theme="light"] body .switch-row{color:#304a62!important}
    html[data-theme="light"] body .upload-box{background:#f8fbfd!important;border-color:#cfdce5!important}
    html[data-theme="light"] body .settings-actions{background:#fff!important}
    html[data-theme="light"] body .modal-actions{border-top-color:#e7edf2!important}

    html[data-theme="light"] body .info-preview{color:#536d83!important}
    html[data-theme="light"] body .preview-banner{background:#eafaf4!important;color:#17304a!important}
    html[data-theme="light"] body .preview-banner strong{color:#078b5e!important}
  `;
  document.head.appendChild(s);
})();
