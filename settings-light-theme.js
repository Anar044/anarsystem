(()=>{
  'use strict';
  const root=document.documentElement;
  try{root.dataset.theme=localStorage.getItem('shReportsTheme')==='dark'?'dark':'light'}catch(e){root.dataset.theme='light'}
  if(document.getElementById('settings-light-theme-style'))return;
  const s=document.createElement('style');
  s.id='settings-light-theme-style';
  s.textContent=`
    html[data-theme="light"] body,
    html[data-theme="light"] body .app-shell,
    html[data-theme="light"] body .main,
    html[data-theme="light"] body .app-content{background:linear-gradient(180deg,#f8fbfe 0%,#f2f7fb 100%)!important;color:#102942!important}
    html[data-theme="light"] body .sidebar{background:radial-gradient(circle at 100% 15%,rgba(0,223,244,.09),transparent 28%),linear-gradient(180deg,#041725 0%,#061b2d 55%,#041522 100%)!important;border-right:1px solid #10364a!important;box-shadow:14px 0 36px rgba(5,31,48,.08)!important}
    html[data-theme="light"] body .topbar{background:rgba(255,255,255,.98)!important;border-bottom:1px solid #e1eaf1!important;box-shadow:0 4px 20px rgba(31,59,83,.045)!important;color:#0e2541!important}
    html[data-theme="light"] body .topbar-title{color:#0e2541!important}
    html[data-theme="light"] body .topbar-sub{color:#6c8198!important}
    html[data-theme="light"] body .user-chip,
    html[data-theme="light"] body .period-chip,
    html[data-theme="light"] body .icon-btn{background:#fff!important;border-color:#dce6ee!important;color:#425b70!important}
    html[data-theme="light"] body .settings-page{padding:28px 30px 50px!important}
    html[data-theme="light"] body .settings-card{background:#fff!important;border:1px solid #e0e9f0!important;box-shadow:0 12px 30px rgba(28,58,82,.06)!important;border-radius:16px!important;color:#102942!important}
    html[data-theme="light"] body .settings-card h1{color:#102942!important}
    html[data-theme="light"] body .settings-card .lead,
    html[data-theme="light"] body .settings-note,
    html[data-theme="light"] body .connection-mode-sub{color:#71859b!important;opacity:1!important}
    html[data-theme="light"] body .form-group label,
    html[data-theme="light"] body .connection-mode-title{color:#536b81!important}
    html[data-theme="light"] body .form-group input{background:#fff!important;border:1px solid #dce6ee!important;color:#17304a!important;box-shadow:none!important}
    html[data-theme="light"] body .form-group input:focus{border-color:#6ed9b2!important;box-shadow:0 0 0 3px rgba(0,193,122,.08)!important}
    html[data-theme="light"] body .connection-mode{background:#f8fbfd!important;border-color:#e0e9f0!important}
    html[data-theme="light"] body .chain-toggle{color:#17304a!important}
    html[data-theme="light"] body .chain-hint{color:#078b5e!important}
    html[data-theme="light"] body #connect-iiko{background:#19c991!important;color:#06251a!important;border-color:#19c991!important;box-shadow:0 8px 18px rgba(25,201,145,.15)!important}
    html[data-theme="light"] body #clear-iiko-data{background:#fff!important;color:#b74e58!important;border-color:#efc9cd!important}
    html[data-theme="light"] body .iiko-status{background:#f4f8fb!important;border-color:#dfe7ed!important;color:#61788d!important}
    html[data-theme="light"] body .iiko-identity{background:#f8fbfd!important;border-color:#e0e9f0!important}
    html[data-theme="light"] body .iiko-identity-title{color:#102942!important}
    html[data-theme="light"] body .debug-link{color:#078b5e!important}
  `;
  document.head.appendChild(s);
})();