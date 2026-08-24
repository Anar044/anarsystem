(function(){
  document.write(`
  <header class="legacy-nav">
    <nav>
      <a class="logo" href="index.html">SH_<span>Reports</span></a>
      <div class="links">
        <a href="index.html">Обзор</a>
        <a href="reports.html">OLAP отчёты</a>
      </div>
      <button class="theme-toggle" id="legacyThemeToggle" type="button">🌙</button>
    </nav>
  </header>`);
  const root=document.documentElement;
  const saved=localStorage.getItem('shReportsTheme');
  const system=window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  function apply(theme){root.dataset.theme=theme;const b=document.getElementById('legacyThemeToggle');if(b)b.textContent=theme==='dark'?'☀️':'🌙';localStorage.setItem('shReportsTheme',theme)}
  apply(saved || (system?'dark':'light'));
  setTimeout(()=>{const b=document.getElementById('legacyThemeToggle');if(b)b.addEventListener('click',()=>apply(root.dataset.theme==='dark'?'light':'dark'))},0);
})();
