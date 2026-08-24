
(function(){
 const root=document.documentElement;
 const saved=localStorage.getItem('shReportsTheme');
 root.dataset.theme=saved==='dark'?'dark':'light';
 window.toggleSHTheme=function(){const next=root.dataset.theme==='dark'?'light':'dark';root.dataset.theme=next;localStorage.setItem('shReportsTheme',next);update();};
 function update(){document.querySelectorAll('[data-theme-label]').forEach(e=>e.textContent=root.dataset.theme==='dark'?'☀️ Светлая тема':'🌙 Тёмная тема');}
 document.addEventListener('DOMContentLoaded',()=>{update(); const menu=document.querySelector('[data-mobile-menu]'), side=document.querySelector('.sidebar'); if(menu&&side) menu.onclick=()=>side.classList.toggle('open');});
})();
