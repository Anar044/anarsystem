(function(){
  'use strict';
  // Kept only for backward-compatible HTML includes.
  // Sidebar deduplication and active state now belong to app-shell.js.
  function sync(){ window.SH_SidebarNav?.sync?.(); }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',sync,{once:true});else queueMicrotask(sync);
})();
