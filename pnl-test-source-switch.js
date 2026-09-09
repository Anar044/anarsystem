// Temporary test switch for P&L revenue source.
// This does not modify the original /api/iiko/pnl endpoint.
// During this test, browser requests to /api/iiko/pnl are routed to
// /api/iiko/pnl-test-sales-revenue, where "Торговая выручка" is taken
// from SALES OLAP as "Торговая выручка без учета скидок".
(()=>{
  const nativeFetch=window.fetch.bind(window);
  window.fetch=(input,init)=>{
    const raw=typeof input==='string'?input:(input&&input.url)||'';
    try{
      const url=new URL(raw,location.href);
      if(url.pathname==='/api/iiko/pnl'){
        url.pathname='/api/iiko/pnl-test-sales-revenue';
        return nativeFetch(url.toString(),init);
      }
    }catch{}
    return nativeFetch(input,init);
  };
})();
