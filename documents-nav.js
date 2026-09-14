(()=>{
  'use strict';

  // Compatibility layer for pages that still include documents-nav.js.
  // app-shell.js is the only owner of sidebar structure and active/open state.
  function sync(){
    window.SH_SidebarNav?.sync?.();
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',sync,{once:true});
  }else{
    queueMicrotask(sync);
  }
  window.addEventListener('pageshow',sync,{passive:true});
})();
