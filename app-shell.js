
(function(){
 const root=document.documentElement;
 const saved=localStorage.getItem('shReportsTheme');
 root.dataset.theme=saved==='dark'?'dark':'light';
 window.toggleSHTheme=function(){const next=root.dataset.theme==='dark'?'light':'dark';root.dataset.theme=next;localStorage.setItem('shReportsTheme',next);update();};
 function update(){document.querySelectorAll('[data-theme-label]').forEach(e=>e.textContent=root.dataset.theme==='dark'?'☀️ Светлая тема':'🌙 Тёмная тема');}
 function loadModernUI(){if(document.getElementById('anarsystem-modern-ui'))return;const link=document.createElement('link');link.id='anarsystem-modern-ui';link.rel='stylesheet';link.href='modern-ui.css?v=3';document.head.appendChild(link);const v3=document.createElement('link');v3.id='anarsystem-modern-ui-v3';v3.rel='stylesheet';v3.href='modern-ui-v3.css?v=1';document.head.appendChild(v3);}
 loadModernUI();
 document.addEventListener('DOMContentLoaded',()=>{update();loadModernUI();const menu=document.querySelector('[data-mobile-menu]'),side=document.querySelector('.sidebar');if(menu&&side)menu.onclick=()=>side.classList.toggle('open');});
})();
