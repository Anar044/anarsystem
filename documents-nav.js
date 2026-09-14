(()=>{
  'use strict';
  // Compatibility stub.
  // The unified sidebar, active state and warehouse submenu are now owned
  // exclusively by app-shell.js before the page is revealed. Keeping this
  // file as a no-op avoids a second CSS/state pass after first paint, which
  // caused the "Склад и справочники" item to flash during navigation.
  if (!window.SH_SidebarNav) {
    window.SH_SidebarNav = {
      sync(){ return true; },
      currentPage(){ return null; }
    };
  }
})();
