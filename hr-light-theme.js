(()=>{
  'use strict';
  const root=document.documentElement;
  try{root.dataset.theme=localStorage.getItem('shReportsTheme')==='dark'?'dark':'light'}catch(e){root.dataset.theme='light'}

  function install(){
    if(document.getElementById('hr-light-theme-style'))return;
    const s=document.createElement('style');
    s.id='hr-light-theme-style';
    s.textContent=`
      html[data-theme="light"] body,
      html[data-theme="light"] body .app-shell,
      html[data-theme="light"] body .main,
      html[data-theme="light"] body .app-content{background:linear-gradient(180deg,#f8fbfe 0%,#f2f7fb 100%)!important;color:#102942!important}
      html[data-theme="light"] body .sidebar{background:radial-gradient(circle at 100% 15%,rgba(0,223,244,.09),transparent 28%),linear-gradient(180deg,#041725 0%,#061b2d 55%,#041522 100%)!important;border-right:1px solid #10364a!important;box-shadow:14px 0 36px rgba(5,31,48,.08)!important}
      html[data-theme="light"] body .topbar{background:rgba(255,255,255,.98)!important;border-bottom:1px solid #e1eaf1!important;box-shadow:0 4px 20px rgba(31,59,83,.045)!important;color:#0e2541!important}
      html[data-theme="light"] body .topbar-title{color:#0e2541!important}
      html[data-theme="light"] body .topbar-sub{color:#6c8198!important}

      html[data-theme="light"] body .hr-page{color:#102942!important}
      html[data-theme="light"] body .hr-head h1{color:#102942!important}
      html[data-theme="light"] body .hr-head p,
      html[data-theme="light"] body .hr-card-sub,
      html[data-theme="light"] body .hr-muted,
      html[data-theme="light"] body .hr-next p{color:#71859b!important}

      html[data-theme="light"] body .hr-source-card,
      html[data-theme="light"] body .hr-summary-card,
      html[data-theme="light"] body .hr-card{background:#fff!important;border-color:#e0e9f0!important;box-shadow:0 10px 26px rgba(28,58,82,.055)!important}
      html[data-theme="light"] body .hr-source-card.active:before{background:#19c991!important}
      html[data-theme="light"] body .hr-source-card span,
      html[data-theme="light"] body .hr-summary-card span{color:#74899d!important}
      html[data-theme="light"] body .hr-source-card strong,
      html[data-theme="light"] body .hr-summary-card strong,
      html[data-theme="light"] body .hr-card-title,
      html[data-theme="light"] body .hr-name{color:#102942!important}
      html[data-theme="light"] body .hr-source-card small,
      html[data-theme="light"] body .hr-summary-card small,
      html[data-theme="light"] body .hr-sub{color:#7b8ea1!important}

      html[data-theme="light"] body .hr-status{background:#f4f8fb!important;border-color:#dfe7ed!important;color:#6c8198!important}
      html[data-theme="light"] body .hr-status.ok{background:#eafaf4!important;border-color:#c9efdf!important;color:#078b5e!important}
      html[data-theme="light"] body .hr-status.loading{color:#a87513!important;background:#fff8e8!important;border-color:#f3dfaa!important}
      html[data-theme="light"] body .hr-status.error{color:#c84e59!important;background:#fff1f2!important;border-color:#f3c8cc!important}

      html[data-theme="light"] body .hr-toolbar label,
      html[data-theme="light"] body .hr-form-grid label,
      html[data-theme="light"] body .hr-schedule-form label,
      html[data-theme="light"] body .hr-schedule-extra>label{color:#6f8499!important}
      html[data-theme="light"] body .hr-toolbar input,
      html[data-theme="light"] body .hr-toolbar select,
      html[data-theme="light"] body .hr-form-grid input,
      html[data-theme="light"] body .hr-form-grid select,
      html[data-theme="light"] body .hr-schedule-form input,
      html[data-theme="light"] body .hr-schedule-form select,
      html[data-theme="light"] body .hr-schedule-extra input{background:#fff!important;border-color:#dce6ee!important;color:#17304a!important}
      html[data-theme="light"] body .hr-toolbar input:focus,
      html[data-theme="light"] body .hr-toolbar select:focus,
      html[data-theme="light"] body .hr-form-grid input:focus,
      html[data-theme="light"] body .hr-form-grid select:focus,
      html[data-theme="light"] body .hr-schedule-form input:focus,
      html[data-theme="light"] body .hr-schedule-form select:focus{border-color:#6ed9b2!important;box-shadow:0 0 0 3px rgba(0,193,122,.08)!important}

      html[data-theme="light"] body .hr-table-scroll{border-color:#e1e9ef!important}
      html[data-theme="light"] body .hr-table-scroll table{background:#fff!important}
      html[data-theme="light"] body .hr-table-scroll th{background:#f7fafc!important;color:#667b90!important;border-bottom-color:#e2eaf0!important}
      html[data-theme="light"] body .hr-table-scroll td{color:#21384f!important;border-bottom-color:#edf1f4!important}
      html[data-theme="light"] body .hr-table-scroll tr:hover td{background:#f0fbf7!important}
      html[data-theme="light"] body .hr-badge{background:#f3f7fa!important;border-color:#dce5ec!important;color:#71859b!important}
      html[data-theme="light"] body .hr-badge.active,
      html[data-theme="light"] body .hr-badge.linked{background:#eafaf4!important;border-color:#c9efdf!important;color:#078b5e!important}
      html[data-theme="light"] body .hr-badge.pending{background:#fff8e8!important;border-color:#f3dfaa!important;color:#a87513!important}

      html[data-theme="light"] body .hr-flow span,
      html[data-theme="light"] body .hr-device-card,
      html[data-theme="light"] body .hr-schedule-section,
      html[data-theme="light"] body .hr-default-switch,
      html[data-theme="light"] body .hr-schedule-footer{background:#f8fbfd!important;border-color:#e1e9ef!important;color:#21384f!important}
      html[data-theme="light"] body .hr-device-card strong,
      html[data-theme="light"] body .hr-schedule-section-head strong,
      html[data-theme="light"] body .hr-switch-copy b,
      html[data-theme="light"] body .hr-live-summary strong{color:#17304a!important}
      html[data-theme="light"] body .hr-device-card span,
      html[data-theme="light"] body .hr-device-card small,
      html[data-theme="light"] body .hr-schedule-section-head small,
      html[data-theme="light"] body .hr-switch-copy small,
      html[data-theme="light"] body .hr-live-summary span{color:#71859b!important}
      html[data-theme="light"] body .hr-link-button,
      html[data-theme="light"] body .hr-presets button{background:#f4f8fb!important;border-color:#dce5ec!important;color:#61788d!important}
      html[data-theme="light"] body .hr-token-panel{background:#eefbf6!important;border-color:#ccefe1!important}
      html[data-theme="light"] body .hr-token-panel strong{color:#17304a!important}
      html[data-theme="light"] body .hr-token-panel code{background:#fff!important;border-color:#dce6ee!important;color:#078b5e!important}
      html[data-theme="light"] body .hr-weekdays label{background:#fff!important;border-color:#dce6ee!important;color:#6d8196!important}
      html[data-theme="light"] body .hr-weekdays label:has(input:checked){background:#eafaf4!important;border-color:#bdebd9!important;color:#067554!important}
      html[data-theme="light"] body .hr-duration-card{background:#eefbf6!important;border-color:#ccefe1!important}
      html[data-theme="light"] body .hr-duration-card strong{color:#078b5e!important}

      html[data-theme="light"] body .hr-primary{background:#19c991!important;color:#06251a!important;box-shadow:0 8px 18px rgba(25,201,145,.16)!important}
      html[data-theme="light"] body .hr-error{background:#fff1f2!important;border-color:#f3c8cc!important;color:#c84e59!important}
    `;
    document.head.appendChild(s);
  }
  install();
})();