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
      /* HYBRID PREMIUM LIGHT: bright shell + dark analytics */
      html[data-theme="light"] body.dashboard-page,
      html[data-theme="light"] body.dashboard-page .main,
      html[data-theme="light"] body.dashboard-page .content,
      html[data-theme="light"] body.dashboard-page .app-shell{
        background:#eef3f7!important;color:#122331!important
      }
      html[data-theme="light"] body.dashboard-page .topbar{
        background:#ffffff!important;border-color:#d9e3ea!important;color:#122331!important;
        box-shadow:0 4px 18px rgba(21,44,58,.05)!important
      }
      html[data-theme="light"] body.dashboard-page .title,
      html[data-theme="light"] body.dashboard-page .pagehead h1,
      html[data-theme="light"] body.dashboard-page .asset-dash-title h3{
        color:#102330!important;font-weight:850!important
      }
      html[data-theme="light"] body.dashboard-page .crumb,
      html[data-theme="light"] body.dashboard-page .pagehead p,
      html[data-theme="light"] body.dashboard-page .dash-status{
        color:#5d7182!important
      }

      /* KPI: deep graphite with crisp white numbers */
      html[data-theme="light"] body.dashboard-page .kpis .card{
        position:relative!important;overflow:hidden!important;
        background:linear-gradient(145deg,#0b1620 0%,#101d29 100%)!important;
        border:1px solid #1f3443!important;color:#f7fbff!important;
        box-shadow:0 12px 30px rgba(14,36,50,.14)!important
      }
      html[data-theme="light"] body.dashboard-page .kpis .card:before{
        content:""!important;position:absolute!important;left:0!important;right:0!important;top:0!important;height:2px!important;
        background:linear-gradient(90deg,#1a9fff,#00dff4,#00c17a)!important;opacity:.9!important
      }
      html[data-theme="light"] body.dashboard-page .kpis .khead{color:#9db0c1!important;font-weight:650!important}
      html[data-theme="light"] body.dashboard-page .kpis .kvalue{color:#ffffff!important;font-weight:900!important;text-shadow:0 1px 0 rgba(0,0,0,.15)!important}
      html[data-theme="light"] body.dashboard-page .kpis .ksub{color:#8ea4b7!important}
      html[data-theme="light"] body.dashboard-page .kpis .kicon{
        background:linear-gradient(145deg,#12362f,#0d2b2b)!important;color:#59f0b0!important;
        border:1px solid #2d705d!important;box-shadow:inset 0 0 16px rgba(0,193,122,.08)!important
      }

      /* Analytics charts stay dark and sharp */
      html[data-theme="light"] body.dashboard-page .grid>.card,
      html[data-theme="light"] body.dashboard-page .grid3>.card{
        background:linear-gradient(145deg,#0d1823,#111f2b)!important;
        border:1px solid #203544!important;color:#f4f8fb!important;
        box-shadow:0 12px 30px rgba(14,36,50,.12)!important
      }
      html[data-theme="light"] body.dashboard-page .grid .ctitle h3,
      html[data-theme="light"] body.dashboard-page .grid3 .ctitle h3{color:#f7fbff!important;font-weight:800!important}
      html[data-theme="light"] body.dashboard-page .grid .ctitle span,
      html[data-theme="light"] body.dashboard-page .grid3 .ctitle span{color:#8ea4b7!important}
      html[data-theme="light"] body.dashboard-page .grid .dash-empty,
      html[data-theme="light"] body.dashboard-page .grid3 .dash-empty{color:#9db0c1!important}

      /* Operational cards/forms stay light */
      html[data-theme="light"] body.dashboard-page .content>.card,
      html[data-theme="light"] body.dashboard-page .asset-dash-card,
      html[data-theme="light"] body.dashboard-page .panel{
        background:#ffffff!important;border:1px solid #dbe5eb!important;color:#142735!important;
        box-shadow:0 10px 28px rgba(22,45,60,.07)!important
      }
      html[data-theme="light"] body.dashboard-page .asset-dash-title h3{color:#142735!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-title span{color:#617586!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-metric,
      html[data-theme="light"] body.dashboard-page .asset-dash-alert{
        background:#f7f9fb!important;border-color:#dbe4ea!important;color:#142735!important
      }
      html[data-theme="light"] body.dashboard-page .asset-dash-metric strong,
      html[data-theme="light"] body.dashboard-page .asset-dash-alert b{color:#112432!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-metric span,
      html[data-theme="light"] body.dashboard-page .asset-dash-alert span{color:#637788!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-metric.warn,
      html[data-theme="light"] body.dashboard-page .asset-dash-alert.warn{background:#fff9ee!important;border-color:#e9ca82!important}
      html[data-theme="light"] body.dashboard-page .asset-dash-metric.danger,
      html[data-theme="light"] body.dashboard-page .asset-dash-alert.danger{background:#fff3f4!important;border-color:#e9c2c8!important}

      /* Date range and controls: clean white, strong contrast */
      html[data-theme="light"] body.dashboard-page .period-range input,
      html[data-theme="light"] body.dashboard-page input,
      html[data-theme="light"] body.dashboard-page select,
      html[data-theme="light"] body.dashboard-page textarea{
        background:#ffffff!important;color:#122331!important;border:1px solid #cfdbe3!important;
        box-shadow:0 4px 12px rgba(21,44,58,.04)!important
      }
      html[data-theme="light"] body.dashboard-page .period-range span{color:#718493!important}
      html[data-theme="light"] body.dashboard-page .period-range button{
        background:linear-gradient(135deg,#27cf91,#20bf83)!important;color:#062f23!important;
        border:1px solid #20bf83!important;font-weight:800!important;box-shadow:0 8px 18px rgba(0,193,122,.16)!important
      }

      /* Autoanalysis inside dark analytics */
      html[data-theme="light"] body.dashboard-page .grid3 .insight{
        background:#132330!important;border-color:#274151!important;color:#f2f7fa!important
      }
      html[data-theme="light"] body.dashboard-page .grid3 .insight b{color:#f7fbff!important}
      html[data-theme="light"] body.dashboard-page .grid3 .insight p{color:#93a8ba!important}
      html[data-theme="light"] body.dashboard-page .grid3 .progress{background:#243744!important}

      /* Tables remain light and readable */
      html[data-theme="light"] body.dashboard-page .content>.card table{color:#172a38!important;background:#fff!important}
      html[data-theme="light"] body.dashboard-page .content>.card th{color:#566b7b!important;background:#f6f8fa!important;border-color:#dde6ec!important;font-weight:750!important}
      html[data-theme="light"] body.dashboard-page .content>.card td{color:#223746!important;border-color:#e5ecf1!important}
      html[data-theme="light"] body.dashboard-page .badge{background:#e5f8f1!important;color:#07895d!important}

      html[data-theme="light"] body.dashboard-page .asset-notify-btn{background:#fff!important;border-color:#d4dfe6!important;color:#425969!important}
      html[data-theme="light"] body.dashboard-page .asset-notify-menu{background:#fff!important;border-color:#d7e1e8!important;color:#20313e!important;box-shadow:0 18px 46px rgba(22,42,55,.16)!important}

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