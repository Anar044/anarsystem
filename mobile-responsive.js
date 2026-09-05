(function(){
  'use strict';
  if(window.__SH_MOBILE_RESPONSIVE__) return;
  window.__SH_MOBILE_RESPONSIVE__ = true;

  const style = document.createElement('style');
  style.id = 'sh-mobile-responsive';
  style.textContent = `
    /* =========================================================
       SH MOBILE RESPONSIVE UI
       Presentation only — no business/API logic changes.
       ========================================================= */
    @media (max-width: 760px){
      html,body{width:100%;max-width:100%;overflow-x:hidden!important;-webkit-text-size-adjust:100%;}
      body{padding-bottom:74px!important;}
      .app-shell,.app{display:block!important;width:100%!important;min-width:0!important;}
      .main{width:100%!important;min-width:0!important;margin:0!important;}

      /* Mobile top bar */
      .topbar{height:64px!important;min-height:64px!important;padding:0 14px!important;position:sticky!important;top:0!important;z-index:90!important;}
      .topbar .title,.topbar-title{font-size:15px!important;line-height:1.15!important;}
      .topbar .crumb,.topbar-sub{font-size:10px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;max-width:230px!important;}
      .topbar .avatar,.topbar .user-avatar{width:34px!important;height:34px!important;min-width:34px!important;}
      .top-actions{gap:5px!important;}

      /* Hide desktop sidebar and use bottom navigation */
      .sidebar{display:none!important;}
      .sh-mobile-nav{position:fixed!important;left:10px!important;right:10px!important;bottom:10px!important;height:60px!important;display:grid!important;grid-template-columns:repeat(5,1fr)!important;gap:3px!important;padding:5px!important;background:rgba(15,21,29,.97)!important;border:1px solid #273340!important;border-radius:18px!important;box-shadow:0 14px 40px rgba(0,0,0,.42)!important;backdrop-filter:blur(18px)!important;-webkit-backdrop-filter:blur(18px)!important;z-index:9999!important;}
      .sh-mobile-nav a{display:flex!important;min-width:0!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:2px!important;border-radius:12px!important;text-decoration:none!important;color:#7f8b99!important;font-size:8px!important;font-weight:700!important;line-height:1!important;}
      .sh-mobile-nav a.active{background:#15251f!important;color:#42d392!important;}
      .sh-mobile-nav .mnav-icon{font-size:18px!important;line-height:20px!important;}
      .sh-mobile-nav .mnav-label{white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;max-width:100%!important;}

      /* Content widths */
      .content,.page,.app-content,.reports-page,.settings-page{width:100%!important;max-width:none!important;margin:0!important;padding:18px 14px 30px!important;min-width:0!important;}
      .reports-page{padding-top:16px!important;}
      .settings-page{padding:18px 14px 34px!important;}

      /* Dashboard */
      .pagehead,.page-head{display:flex!important;flex-direction:column!important;align-items:stretch!important;gap:13px!important;margin-bottom:15px!important;}
      .pagehead h1,.page-head h1{font-size:30px!important;line-height:1.03!important;letter-spacing:-1px!important;max-width:320px!important;}
      .pagehead p,.page-head p{font-size:12px!important;line-height:1.45!important;margin-top:7px!important;max-width:330px!important;}
      .period{width:100%!important;display:grid!important;grid-template-columns:repeat(3,1fr)!important;padding:3px!important;gap:3px!important;border-radius:12px!important;}
      .period button{min-height:40px!important;padding:8px 5px!important;font-size:12px!important;}
      .kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:9px!important;margin-bottom:10px!important;}
      .kpis .card{min-width:0!important;padding:13px!important;border-radius:14px!important;}
      .khead{font-size:10px!important;gap:5px!important;}
      .kicon{width:28px!important;height:28px!important;min-width:28px!important;border-radius:8px!important;}
      .kvalue{font-size:23px!important;line-height:1.1!important;margin:10px 0 4px!important;overflow-wrap:anywhere!important;}
      .ksub{font-size:9px!important;line-height:1.25!important;}
      .grid,.grid3{grid-template-columns:1fr!important;gap:10px!important;margin-bottom:10px!important;}
      .card,.panel{border-radius:15px!important;min-width:0!important;}
      .grid>.card,.grid3>.card{padding:13px!important;}
      .ctitle{gap:10px!important;align-items:flex-start!important;}
      .ctitle h3{font-size:15px!important;line-height:1.15!important;}
      .ctitle span{font-size:9px!important;text-align:right!important;}
      .chart{height:270px!important;min-height:270px!important;width:100%!important;}
      .smallchart{height:230px!important;min-height:230px!important;width:100%!important;}
      .tablewrap{width:100%!important;overflow-x:auto!important;-webkit-overflow-scrolling:touch!important;}
      .tablewrap table{min-width:620px!important;}
      .insight{padding:10px!important;}

      /* Reports / OLAP */
      .reports-header{display:flex!important;flex-direction:column!important;align-items:stretch!important;gap:12px!important;margin-bottom:14px!important;}
      .reports-header h1{font-size:26px!important;line-height:1.1!important;}
      .olap-toolbar{display:grid!important;grid-template-columns:1fr!important;gap:8px!important;padding:10px!important;}
      .olap-workspace,.olap-grid{display:flex!important;flex-direction:column!important;gap:10px!important;}
      .olap-fields-card,.olap-panel,.olap-main-card,.olap-shell{min-width:0!important;width:100%!important;}
      .olap-fields,.olap-fields-list{max-height:300px!important;}
      .olap-zones{grid-template-columns:1fr!important;gap:8px!important;}
      .olap-report-head{display:flex!important;flex-direction:column!important;align-items:stretch!important;gap:12px!important;margin-bottom:13px!important;}
      .olap-report-title{font-size:23px!important;}
      .olap-report-actions{display:grid!important;grid-template-columns:1fr 1fr!important;gap:7px!important;justify-content:stretch!important;}
      .olap-report-actions label{min-width:0!important;}
      .olap-report-actions input,.olap-report-actions select{width:100%!important;min-width:0!important;}
      .olap-report-actions .olap-primary,.olap-report-actions .olap-excel{width:100%!important;}
      .data-table-wrap,.report-table-wrapper{max-width:100%!important;overflow-x:auto!important;-webkit-overflow-scrolling:touch!important;}

      /* Cash */
      .connected-panel,.shift-summary-panel,.request-panel,.result-panel{width:100%!important;min-width:0!important;padding:13px!important;margin-bottom:9px!important;border-radius:14px!important;}
      .panel-head{display:flex!important;align-items:flex-start!important;gap:9px!important;flex-wrap:wrap!important;}
      .panel-title{font-size:14px!important;}
      .panel-muted{font-size:9px!important;}
      .plugin-meta{grid-template-columns:1fr 1fr!important;}
      .shift-summary-grid{grid-template-columns:1fr 1fr!important;gap:7px!important;}
      .shift-summary-card{min-height:72px!important;padding:10px!important;}
      .shift-summary-card strong{font-size:16px!important;}
      .request-grid{grid-template-columns:1fr!important;gap:8px!important;}
      .request-grid input,.request-grid select{height:40px!important;font-size:12px!important;}
      .request-actions{flex-wrap:wrap!important;}
      .request-actions .primary-btn{min-height:40px!important;font-size:12px!important;}
      .result-headline{grid-template-columns:1fr 1fr!important;}
      .result-stat{padding:10px!important;}
      .data-table{min-width:640px!important;}

      /* Settings */
      .settings-card{padding:18px!important;border-radius:15px!important;}
      .settings-card h1{font-size:25px!important;line-height:1.1!important;}
      .settings-grid{grid-template-columns:1fr!important;gap:13px!important;}
      .form-group input{min-height:44px!important;font-size:14px!important;}
      .remember-login input{width:20px!important;height:20px!important;}
      .settings-card button,.settings-card .primary-btn{min-height:44px!important;}

      /* Prevent long technical strings from breaking the layout */
      pre,.result-output,.raw-details{max-width:100%!important;overflow-x:auto!important;-webkit-overflow-scrolling:touch!important;}
      img,svg,canvas{max-width:100%;}
    }

    @media (max-width:420px){
      .content,.page,.app-content,.reports-page,.settings-page{padding-left:12px!important;padding-right:12px!important;}
      .kpis{grid-template-columns:1fr!important;}
      .pagehead h1,.page-head h1{font-size:28px!important;}
      .chart{height:250px!important;min-height:250px!important;}
      .smallchart{height:215px!important;min-height:215px!important;}
      .olap-report-actions{grid-template-columns:1fr!important;}
      .shift-summary-grid,.result-headline{grid-template-columns:1fr!important;}
      .plugin-meta{grid-template-columns:1fr!important;}
    }
  `;
  document.head.appendChild(style);

  function currentPage(){
    const p = location.pathname.toLowerCase();
    if(p.endsWith('/reports') || p.endsWith('/reports.html')) return 'reports.html';
    if(p.endsWith('/plugin-control') || p.endsWith('/plugin-control.html')) return 'plugin-control.html';
    if(p.endsWith('/qr-menu') || p.endsWith('/qr-menu.html')) return 'qr-menu.html';
    if(p.endsWith('/settings') || p.endsWith('/settings.html')) return 'settings.html';
    return 'index.html';
  }

  function addMobileNav(){
    if(window.innerWidth > 760 || document.querySelector('.sh-mobile-nav')) return;
    const nav = document.createElement('nav');
    nav.className = 'sh-mobile-nav';
    const page = currentPage();
    const items = [
      ['index.html','⌂','Dashboard','index.html'],
      ['reports.html','▥','OLAP','reports.html'],
      ['plugin-control.html','▣','Кассы','plugin-control.html'],
      ['qr-menu.html','▦','QR Menu','qr-menu.html'],
      ['settings.html','⚙','Настройки','settings.html']
    ];
    nav.innerHTML = items.map(x => `<a href="${x[0]}" class="${x[3]===page?'active':''}"><span class="mnav-icon">${x[1]}</span><span class="mnav-label">${x[2]}</span></a>`).join('');
    document.body.appendChild(nav);
  }

  function refresh(){
    const nav=document.querySelector('.sh-mobile-nav');
    if(window.innerWidth<=760){ if(!nav) addMobileNav(); }
    else if(nav) nav.remove();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, {once:true});
  else refresh();
  window.addEventListener('resize', refresh, {passive:true});
})();
