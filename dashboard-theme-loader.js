(()=>{
  'use strict';
  const root=document.documentElement;
  root.dataset.theme=localStorage.getItem('shReportsTheme')==='dark'?'dark':'light';

  function installBrand(){
    const brand=document.querySelector('.sidebar .unified-brand');
    if(!brand||brand.dataset.sketchBrand==='1')return;
    brand.dataset.sketchBrand='1';
    brand.innerHTML='<div class="sketch-brand-logo" aria-label="SmartHoreca"></div>';
  }

  function installThemeToggle(){
    const side=document.querySelector('.sidebar');
    if(!side||side.querySelector('.sh-theme-toggle'))return;
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='sh-theme-toggle';
    btn.innerHTML='<span class="theme-icon">☀</span><span data-theme-label>Светлая тема</span><span class="theme-arrow">›</span>';
    btn.onclick=()=>window.toggleSHTheme?.();
    side.appendChild(btn);
  }

  function addStyles(){
    let link=document.getElementById('dashboard-theme-css');
    if(!link){link=document.createElement('link');link.id='dashboard-theme-css';link.rel='stylesheet';document.head.appendChild(link)}
    link.href='/dashboard.css?v=20260917-10';

    let brand=document.getElementById('sh-brand-theme');
    if(!brand){brand=document.createElement('link');brand.id='sh-brand-theme';brand.rel='stylesheet';document.head.appendChild(brand)}
    brand.href='/smart-horeca-theme.css?v=20260917-7';

    let s=document.getElementById('dashboard-sketch-style');
    if(!s){s=document.createElement('style');s.id='dashboard-sketch-style';document.head.appendChild(s)}
    s.textContent=`
      :root{--sk-bg:#f4f8fc;--sk-card:#fff;--sk-text:#0c2440;--sk-muted:#6f839c;--sk-border:#dfe8f0;--sk-green:#06c889;--sk-cyan:#14c8ef;--sk-blue:#3986ff;--sk-orange:#ffb438;--sk-red:#ff5d69;--sk-purple:#9d63e8;--sk-side:#041725;--sk-side-2:#062238}
      html[data-theme="light"] body.dashboard-page,
      html[data-theme="light"] body.dashboard-page .app-shell,
      html[data-theme="light"] body.dashboard-page .main,
      html[data-theme="light"] body.dashboard-page .content{background:linear-gradient(180deg,#f8fbfe 0,#f2f7fb 100%)!important;color:var(--sk-text)!important}

      /* dark branded sidebar */
      html[data-theme="light"] body.dashboard-page .sidebar{background:radial-gradient(circle at 100% 15%,rgba(0,223,244,.09),transparent 28%),linear-gradient(180deg,var(--sk-side) 0%,#061b2d 55%,#041522 100%)!important;border-right:1px solid #10364a!important;box-shadow:14px 0 36px rgba(5,31,48,.08)!important;padding:18px 14px 16px!important}
      html[data-theme="light"] body.dashboard-page .sidebar .unified-brand{padding:2px 4px 22px!important;height:auto!important;display:block!important}
      .sketch-brand-logo{width:100%!important;height:92px!important;background:url('/smart-horeca-brand.svg?v=3') left center/contain no-repeat!important;filter:drop-shadow(0 7px 16px rgba(0,223,244,.08))}
      html[data-theme="light"] body.dashboard-page .sidebar .nav-title{color:#7692a7!important;font-size:10px!important;font-weight:800!important;letter-spacing:.14em!important;margin:2px 10px 9px!important}
      html[data-theme="light"] body.dashboard-page .sidebar .side-nav>a,
      html[data-theme="light"] body.dashboard-page .sidebar .documents-nav-toggle{color:#c3d2df!important;background:transparent!important;border:1px solid transparent!important;border-radius:12px!important;min-height:44px!important;margin:2px 0!important;font-weight:620!important}
      html[data-theme="light"] body.dashboard-page .sidebar .side-nav>a:hover,
      html[data-theme="light"] body.dashboard-page .sidebar .documents-nav-toggle:hover{background:rgba(16,87,102,.28)!important;color:#fff!important;border-color:rgba(44,214,198,.18)!important}
      html[data-theme="light"] body.dashboard-page .sidebar .side-nav>a.active,
      html[data-theme="light"] body.dashboard-page .sidebar .documents-nav-toggle.active{background:linear-gradient(90deg,rgba(0,193,122,.25),rgba(0,223,244,.12))!important;color:#7dffd0!important;border:1px solid rgba(0,223,200,.40)!important;box-shadow:inset 3px 0 #19edbd,0 0 22px rgba(0,223,244,.08)!important}
      html[data-theme="light"] body.dashboard-page .sidebar .documents-subnav{border-left-color:#1b4658!important}
      html[data-theme="light"] body.dashboard-page .sidebar .documents-subnav a{color:#8fa8ba!important}
      html[data-theme="light"] body.dashboard-page .sidebar .documents-subnav a.active{color:#70f7c2!important}
      html[data-theme="light"] body.dashboard-page .sidebar .sh-theme-toggle{margin-top:14px!important;width:100%!important;background:#082437!important;border:1px solid #184258!important;color:#c9dae6!important;border-radius:12px!important;min-height:46px!important;box-shadow:none!important}
      html[data-theme="light"] body.dashboard-page .sidebar .sh-theme-toggle:hover{background:#0b3044!important;border-color:#1f6a6b!important;color:#fff!important}
      .sh-theme-toggle .theme-arrow{margin-left:auto;font-size:21px;color:#718da0}

      /* header */
      html[data-theme="light"] body.dashboard-page .topbar{height:78px!important;background:rgba(255,255,255,.98)!important;border-bottom:1px solid #e1eaf1!important;box-shadow:0 4px 20px rgba(31,59,83,.045)!important;color:var(--sk-text)!important;padding:0 30px!important}
      html[data-theme="light"] body.dashboard-page .topbar .title{font-size:18px!important;font-weight:850!important;color:#0e2541!important}
      html[data-theme="light"] body.dashboard-page .topbar .crumb{color:#6c8198!important}
      html[data-theme="light"] body.dashboard-page .topbar .avatar{background:#0b352d!important;border-color:#d8e5e8!important;color:#fff!important}
      html[data-theme="light"] body.dashboard-page .asset-notify-btn{background:#fff!important;border-color:#dbe6ed!important;color:#3d5d73!important}

      /* page hero */
      html[data-theme="light"] body.dashboard-page .content{padding:26px 30px 48px!important;max-width:1660px!important}
      html[data-theme="light"] body.dashboard-page .pagehead{align-items:center!important;margin-bottom:12px!important}
      html[data-theme="light"] body.dashboard-page .pagehead h1{font-size:31px!important;letter-spacing:-.9px!important;color:#0c2440!important;font-weight:900!important}
      html[data-theme="light"] body.dashboard-page .pagehead h1:before{content:'▥';display:inline-grid;place-items:center;width:31px;height:31px;margin-right:10px;color:#0ac98b;font-size:22px;vertical-align:2px}
      html[data-theme="light"] body.dashboard-page .pagehead p{color:#72869d!important;font-size:13px!important}
      html[data-theme="light"] body.dashboard-page .dash-status{color:#688099!important;font-size:11px!important;margin:0 0 16px 3px!important}
      html[data-theme="light"] body.dashboard-page .dash-status::first-letter{color:#08c98a!important}
      html[data-theme="light"] body.dashboard-page .period-range input{height:46px!important;width:170px!important;border:1px solid #dce6ee!important;background:#fff!important;color:#0f2741!important;border-radius:11px!important;box-shadow:0 8px 20px rgba(31,59,83,.05)!important;font-weight:650!important}
      html[data-theme="light"] body.dashboard-page .period-range span{color:#8094a6!important}
      html[data-theme="light"] body.dashboard-page .period-range button{height:46px!important;border-radius:11px!important;background:linear-gradient(135deg,#17db9e,#0fc989)!important;color:#052f24!important;border:0!important;font-weight:850!important;padding:0 22px!important;box-shadow:0 10px 22px rgba(0,193,122,.18)!important}

      /* KPI cards like approved sketch */
      html[data-theme="light"] body.dashboard-page .kpis{gap:14px!important;margin-bottom:16px!important}
      html[data-theme="light"] body.dashboard-page .kpis .card{position:relative!important;min-height:145px!important;padding:19px 20px 16px!important;background:#fff!important;border:1px solid #e0e9f0!important;border-radius:14px!important;box-shadow:0 10px 26px rgba(28,58,82,.07)!important;overflow:hidden!important}
      html[data-theme="light"] body.dashboard-page .kpis .card:before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;border-radius:14px 0 0 14px;background:var(--accent,#17c98a)}
      html[data-theme="light"] body.dashboard-page .kpis .card:nth-child(1){--accent:#13cdea}
      html[data-theme="light"] body.dashboard-page .kpis .card:nth-child(2){--accent:#23d89a}
      html[data-theme="light"] body.dashboard-page .kpis .card:nth-child(3){--accent:#3b86ff}
      html[data-theme="light"] body.dashboard-page .kpis .card:nth-child(4){--accent:#26ca86}
      html[data-theme="light"] body.dashboard-page .kpis .khead{font-size:12px!important;color:#243b54!important;font-weight:700!important}
      html[data-theme="light"] body.dashboard-page .kpis .kicon{width:42px!important;height:42px!important;border-radius:12px!important;background:#eafaf4!important;color:#08a86f!important;border:1px solid #d2f2e4!important;font-size:16px!important}
      html[data-theme="light"] body.dashboard-page .kpis .kvalue{font-size:31px!important;color:#071b36!important;font-weight:900!important;margin:14px 0 8px!important;letter-spacing:-.4px!important}
      html[data-theme="light"] body.dashboard-page .kpis .ksub{color:#778ba2!important;font-size:10.5px!important}
      html[data-theme="light"] body.dashboard-page .kpis .up{color:#12c789!important}

      /* Equipment */
      html[data-theme="light"] body.dashboard-page .asset-dash-card{background:#fff!important;border:1px solid #e0e9f0!important;border-radius:15px!important;box-shadow:0 10px 26px rgba(28,58,82,.06)!important;padding:14px 16px!important;margin:0 0 16px!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-title h3{color:#102942!important;font-size:15px!important;font-weight:850!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-title h3:before{content:'⚙';margin-right:8px;color:#23405d}
      html[data-theme="light"] body.dashboard-page .asset-dash-title span{color:#71859b!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-title a{color:#05ad73!important;font-weight:800!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-metrics{gap:10px!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-metric{min-height:74px!important;background:#f8fbfd!important;border:1px solid #dfe8ef!important;border-radius:12px!important;color:#10263d!important;padding:11px 13px!important;box-shadow:none!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-metric span{color:#75889b!important;font-size:9.5px!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-metric strong{color:#0a213b!important;font-size:19px!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-metric.warn{background:#fff9ef!important;border-color:#f3d79a!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-metric.danger{background:#fff4f5!important;border-color:#f0c8ce!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-alert{background:#fff9ef!important;border-color:#f0d596!important;color:#183047!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-alert b{color:#16304b!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-alert span{color:#8191a1!important}

      /* charts & data panels */
      html[data-theme="light"] body.dashboard-page .grid>.card,
      html[data-theme="light"] body.dashboard-page .grid3>.card,
      html[data-theme="light"] body.dashboard-page .content>.card{background:#fff!important;border:1px solid #e0e9f0!important;border-radius:15px!important;color:#102942!important;box-shadow:0 10px 26px rgba(28,58,82,.06)!important}
      html[data-theme="light"] body.dashboard-page .ctitle h3{color:#102942!important;font-size:15px!important;font-weight:850!important}
      html[data-theme="light"] body.dashboard-page .ctitle span{color:#70849a!important}
      html[data-theme="light"] body.dashboard-page .chart,
      html[data-theme="light"] body.dashboard-page .smallchart{background:#fff!important}
      html[data-theme="light"] body.dashboard-page .insight{background:#f8fbfd!important;border-color:#dfe8ef!important}
      html[data-theme="light"] body.dashboard-page .insight b{color:#17304a!important}
      html[data-theme="light"] body.dashboard-page .insight p{color:#75889b!important}
      html[data-theme="light"] body.dashboard-page .progress{background:#e7edf2!important}
      html[data-theme="light"] body.dashboard-page table{background:#fff!important;color:#1a3148!important}
      html[data-theme="light"] body.dashboard-page th{background:#f7fafc!important;color:#667b90!important;border-color:#e2eaf0!important}
      html[data-theme="light"] body.dashboard-page td{color:#21384f!important;border-color:#e8eef3!important}
      html[data-theme="light"] body.dashboard-page .badge{background:#e9faf4!important;color:#078b5e!important}

      /* dark theme remains available */
      html[data-theme="dark"] body.dashboard-page,
      html[data-theme="dark"] body.dashboard-page .main,
      html[data-theme="dark"] body.dashboard-page .content{background:#0b1017!important;color:#f4f7fa!important}
    `;
  }

  function sync(){addStyles();installBrand();installThemeToggle();requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')))}
  sync();
  document.addEventListener('DOMContentLoaded',sync,{once:true});
  setTimeout(sync,150);
  setTimeout(sync,600);
  const observer=new MutationObserver(m=>{if(m.some(x=>x.type==='attributes'&&x.attributeName==='data-theme'))sync()});
  observer.observe(root,{attributes:true,attributeFilter:['data-theme']});
})();