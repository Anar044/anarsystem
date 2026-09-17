(()=>{
  'use strict';

  let style=document.getElementById('dashboard-theme-parity-style');
  if(!style){
    style=document.createElement('style');
    style.id='dashboard-theme-parity-style';
    document.head.appendChild(style);
  }

  style.textContent=`
    /* Structural parity: light and dark must keep exactly the same geometry. */
    body.dashboard-page .topbar{
      height:78px!important;
      min-height:78px!important;
      padding:0 30px!important;
      display:flex!important;
      align-items:center!important;
      box-sizing:border-box!important;
    }
    body.dashboard-page .topbar .topbar-spacer{flex:1 1 auto!important;min-width:12px!important}
    body.dashboard-page .topbar .avatar{
      flex:0 0 auto!important;
      margin-left:10px!important;
    }
    body.dashboard-page .dashboard-user-meta{
      display:flex!important;
      flex-direction:column!important;
      align-items:flex-start!important;
      justify-content:center!important;
      gap:0!important;
      min-width:0!important;
      width:auto!important;
      max-width:200px!important;
      margin-left:8px!important;
      line-height:1.15!important;
      flex:0 1 auto!important;
    }
    body.dashboard-page .dashboard-user-meta strong,
    body.dashboard-page .dashboard-user-meta span{
      display:block!important;
      width:100%!important;
      max-width:190px!important;
      overflow:hidden!important;
      text-overflow:ellipsis!important;
      white-space:nowrap!important;
      box-sizing:border-box!important;
    }
    body.dashboard-page .dashboard-user-meta strong{
      font-size:12px!important;
      font-weight:800!important;
      line-height:1.2!important;
    }
    body.dashboard-page .dashboard-user-meta span{
      margin-top:3px!important;
      font-size:9.5px!important;
      line-height:1.2!important;
    }

    body.dashboard-page .content{
      padding:26px 30px 48px!important;
      max-width:1660px!important;
      width:100%!important;
      box-sizing:border-box!important;
    }
    body.dashboard-page .pagehead{
      align-items:center!important;
      margin-bottom:12px!important;
    }
    body.dashboard-page .pagehead h1{
      font-size:31px!important;
      line-height:1.15!important;
      letter-spacing:-.9px!important;
      margin-bottom:8px!important;
    }
    body.dashboard-page .pagehead p{font-size:13px!important}
    body.dashboard-page .dash-status{
      font-size:11px!important;
      margin:0 0 16px 3px!important;
    }

    body.dashboard-page .period-range{
      display:flex!important;
      align-items:center!important;
      gap:10px!important;
    }
    body.dashboard-page .period-range input{
      width:170px!important;
      min-width:170px!important;
      height:46px!important;
      box-sizing:border-box!important;
    }
    body.dashboard-page .period-range button{
      height:46px!important;
      min-height:46px!important;
      padding:0 22px!important;
      box-sizing:border-box!important;
    }

    body.dashboard-page .kpis{
      gap:14px!important;
      margin-bottom:16px!important;
      align-items:stretch!important;
    }
    body.dashboard-page .kpis .card{
      min-height:145px!important;
      height:auto!important;
      padding:19px 20px 16px!important;
      border-radius:14px!important;
      box-sizing:border-box!important;
    }
    body.dashboard-page .kpis .khead{
      min-height:42px!important;
      display:flex!important;
      align-items:center!important;
      justify-content:space-between!important;
    }
    body.dashboard-page .kpis .kicon{
      width:42px!important;
      min-width:42px!important;
      height:42px!important;
      flex:0 0 42px!important;
      border-radius:12px!important;
      display:inline-flex!important;
      align-items:center!important;
      justify-content:center!important;
      box-sizing:border-box!important;
    }
    body.dashboard-page .kpis .kvalue{
      font-size:31px!important;
      line-height:1!important;
      margin:14px 0 8px!important;
    }
    body.dashboard-page .kpis .ksub{font-size:10.5px!important}

    body.dashboard-page .asset-dash-card{
      padding:14px 16px!important;
      margin:0 0 16px!important;
      border-radius:15px!important;
      box-sizing:border-box!important;
    }
    body.dashboard-page .asset-dash-metrics{gap:10px!important}
    body.dashboard-page .asset-dash-metric{
      min-height:74px!important;
      padding:11px 13px!important;
      border-radius:12px!important;
      box-sizing:border-box!important;
    }
    body.dashboard-page .asset-dash-alert{
      box-sizing:border-box!important;
    }

    body.dashboard-page .grid,
    body.dashboard-page .grid3{
      box-sizing:border-box!important;
    }
    body.dashboard-page .grid>.card,
    body.dashboard-page .grid3>.card,
    body.dashboard-page .content>.card{
      border-radius:15px!important;
      box-sizing:border-box!important;
    }

    @media(max-width:1100px){
      body.dashboard-page .content{padding-left:20px!important;padding-right:20px!important}
    }
    @media(max-width:760px){
      body.dashboard-page .topbar{padding:0 18px!important}
      body.dashboard-page .content{padding:20px 16px 36px!important}
      body.dashboard-page .dashboard-user-meta{max-width:150px!important}
      body.dashboard-page .dashboard-user-meta strong,
      body.dashboard-page .dashboard-user-meta span{max-width:145px!important}
    }
  `;
})();
