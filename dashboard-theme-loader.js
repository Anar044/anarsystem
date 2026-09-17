(()=>{
  'use strict';
  const root=document.documentElement;
  const saved=localStorage.getItem('shReportsTheme');
  root.dataset.theme=saved==='dark'?'dark':'light';

  function addStyles(){
    let link=document.getElementById('dashboard-theme-css');
    if(!link){
      link=document.createElement('link');
      link.id='dashboard-theme-css';
      link.rel='stylesheet';
      document.head.appendChild(link);
    }
    link.href='/dashboard.css?v=20260917-9';

    let brand=document.getElementById('sh-brand-theme');
    if(!brand){
      brand=document.createElement('link');
      brand.id='sh-brand-theme';
      brand.rel='stylesheet';
      document.head.appendChild(brand);
    }
    brand.href='/smart-horeca-theme.css?v=20260917-6';

    let s=document.getElementById('dashboard-shell-theme-fix');
    if(!s){
      s=document.createElement('style');
      s.id='dashboard-shell-theme-fix';
      document.head.appendChild(s);
    }
    s.textContent=`
      html[data-theme="light"] body.dashboard-page,
      html[data-theme="light"] body.dashboard-page .main,
      html[data-theme="light"] body.dashboard-page .content,
      html[data-theme="light"] body.dashboard-page .app-shell{background:#f5f7fb!important;color:#172532!important}

      html[data-theme="light"] body.dashboard-page .topbar{background:rgba(255,255,255,.97)!important;border-color:#e2e8ee!important;color:#172532!important;box-shadow:0 4px 18px rgba(20,40,52,.035)!important}
      html[data-theme="light"] body.dashboard-page .title,
      html[data-theme="light"] body.dashboard-page .pagehead h1,
      html[data-theme="light"] body.dashboard-page .ctitle h3,
      html[data-theme="light"] body.dashboard-page .asset-dash-title h3{color:#172532!important}
      html[data-theme="light"] body.dashboard-page .crumb,
      html[data-theme="light"] body.dashboard-page .pagehead p,
      html[data-theme="light"] body.dashboard-page .dash-status,
      html[data-theme="light"] body.dashboard-page .khead,
      html[data-theme="light"] body.dashboard-page .ksub,
      html[data-theme="light"] body.dashboard-page .ctitle span{color:#718396!important}

      html[data-theme="light"] body.dashboard-page .card,
      html[data-theme="light"] body.dashboard-page .panel,
      html[data-theme="light"] body.dashboard-page .kpis .card,
      html[data-theme="light"] body.dashboard-page .grid>.card,
      html[data-theme="light"] body.dashboard-page .grid3>.card,
      html[data-theme="light"] body.dashboard-page .content>.card{background:#fff!important;border-color:#e2e8ee!important;color:#172532!important;box-shadow:0 10px 28px rgba(24,48,64,.06)!important}
      html[data-theme="light"] body.dashboard-page .kvalue{color:#172532!important}
      html[data-theme="light"] body.dashboard-page .kicon{background:#e9faf4!important;color:#00aa6c!important;border-color:#d7f3e7!important}

      html[data-theme="light"] body.dashboard-page .period-range input,
      html[data-theme="light"] body.dashboard-page input,
      html[data-theme="light"] body.dashboard-page select,
      html[data-theme="light"] body.dashboard-page textarea{background:#fff!important;color:#172532!important;border-color:#dce5ec!important}
      html[data-theme="light"] body.dashboard-page .period-range span{color:#91a1af!important}
      html[data-theme="light"] body.dashboard-page .period-range button{background:#37d095!important;color:#073326!important;border-color:#37d095!important}

      html[data-theme="light"] body.dashboard-page .insight,
      html[data-theme="light"] body.dashboard-page .asset-dash-metric,
      html[data-theme="light"] body.dashboard-page .asset-dash-alert{background:#f8fafc!important;border-color:#e2e8ee!important;color:#172532!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-metric.warn,
      html[data-theme="light"] body.dashboard-page .asset-dash-alert.warn{background:#fffaf0!important;border-color:#eedba8!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-metric.danger,
      html[data-theme="light"] body.dashboard-page .asset-dash-alert.danger{background:#fff5f6!important;border-color:#f0cfd4!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-metric span,
      html[data-theme="light"] body.dashboard-page .asset-dash-alert span,
      html[data-theme="light"] body.dashboard-page .insight p{color:#78899a!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-metric strong,
      html[data-theme="light"] body.dashboard-page .asset-dash-alert b,
      html[data-theme="light"] body.dashboard-page .insight b{color:#172532!important}
      html[data-theme="light"] body.dashboard-page .asset-notify-btn{background:#fff!important;border-color:#dfe7ed!important;color:#506677!important}
      html[data-theme="light"] body.dashboard-page .asset-notify-menu{background:#fff!important;border-color:#dfe7ed!important;color:#20313e!important}

      html[data-theme="light"] body.dashboard-page table{color:#172532!important}
      html[data-theme="light"] body.dashboard-page th{color:#7b8b9a!important;border-color:#e6edf2!important}
      html[data-theme="light"] body.dashboard-page td{color:#30414e!important;border-color:#edf1f4!important}
      html[data-theme="light"] body.dashboard-page .badge{background:#e7faf2!important;color:#079563!important}
      html[data-theme="light"] body.dashboard-page .progress{background:#e6edf1!important}

      html[data-theme="dark"] body.dashboard-page,
      html[data-theme="dark"] body.dashboard-page .main,
      html[data-theme="dark"] body.dashboard-page .content,
      html[data-theme="dark"] body.dashboard-page .app-shell{background:#0b1017!important;color:#f4f7fa!important}
      html[data-theme="dark"] body.dashboard-page .topbar{background:rgba(11,16,23,.94)!important}
    `;
  }

  function syncTheme(){
    addStyles();
    requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
  }

  addStyles();
  window.addEventListener('DOMContentLoaded',syncTheme,{once:true});
  const obs=new MutationObserver(m=>{
    if(m.some(x=>x.type==='attributes'&&x.attributeName==='data-theme'))syncTheme();
  });
  obs.observe(root,{attributes:true,attributeFilter:['data-theme']});
})();