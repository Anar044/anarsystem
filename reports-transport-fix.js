(function(){
  'use strict';
  const originalFetch=window.fetch.bind(window);
  const clean=v=>String(v??'').trim();
  function fieldMap(){
    const map=new Map();
    // The available-field list is authoritative: data-field is the iiko technical name.
    document.querySelectorAll('.olap-field').forEach(el=>{
      const title=clean(el.querySelector('strong')?.textContent||'');
      const technical=clean(el.dataset.field||el.querySelector('small')?.textContent||'');
      if(title&&technical)map.set(title,technical);
    });
    // Selected chips can come from saved reports and may contain a display title.
    // Only add them when the authoritative available-field mapping is missing.
    document.querySelectorAll('.olap-selected-field').forEach(el=>{
      const title=clean(el.querySelector('strong')?.textContent||'');
      const technical=clean(el.dataset.field||'');
      if(title&&technical&&!map.has(title))map.set(title,technical);
    });
    return map;
  }
  function normalizeValue(value,map){const v=clean(value);return map.get(v)||v;}
  window.fetch=async function(input,init){
    try{
      const url=typeof input==='string'?input:(input?.url||'');
      if(url.includes('/api/iiko/olap')&&init?.body&&typeof init.body==='string'){
        const body=JSON.parse(init.body);
        const map=fieldMap();
        if(Array.isArray(body.groupByRowFields))body.groupByRowFields=body.groupByRowFields.map(v=>normalizeValue(v,map));
        if(Array.isArray(body.groupByColumnFields))body.groupByColumnFields=body.groupByColumnFields.map(v=>normalizeValue(v,map));
        if(Array.isArray(body.measures))body.measures=body.measures.map(v=>normalizeValue(v,map));
        if(Array.isArray(body.filters))body.filters=body.filters.map(f=>({...f,field:normalizeValue(f.field,map)}));
        init={...init,body:JSON.stringify(body)};
      }
    }catch(e){console.warn('OLAP transport normalization skipped:',e)}
    return originalFetch(input,init);
  };
})();
