(function(){
  'use strict';

  // Final safety layer: never send a display caption to iiko as an OLAP field.
  // Every identifier must exist in the authoritative field list returned by iiko.
  const originalFetch = window.fetch.bind(window);
  const clean = v => String(v ?? '').trim();

  function fieldIndex(){
    const byTitle = new Map();
    const technical = new Set();

    document.querySelectorAll('.olap-field').forEach(el => {
      const title = clean(el.querySelector('strong')?.textContent || '');
      const name = clean(el.dataset.field || el.querySelector('small')?.textContent || '');
      if(!name) return;
      technical.add(name);
      if(title) byTitle.set(title, name);
    });

    document.querySelectorAll('.olap-selected-field').forEach(el => {
      const title = clean(el.querySelector('strong')?.textContent || '');
      const name = clean(el.dataset.field || '');
      if(!name) return;
      technical.add(name);
      if(title && !byTitle.has(title)) byTitle.set(title, name);
    });

    return { byTitle, technical };
  }

  function resolve(value, index){
    const v = clean(value);
    if(!v) throw new Error('Пустое OLAP-поле');

    // Already a real technical identifier.
    if(index.technical.has(v)) return v;

    // Human-readable caption -> real technical identifier.
    if(index.byTitle.has(v)) return index.byTitle.get(v);

    // Do not guess. A field not present in the authoritative iiko list is invalid.
    throw new Error(`Неизвестное OLAP-поле: «${v}». Выберите поле из списка iiko.`);
  }

  window.fetch = async function(input, init){
    const url = typeof input === 'string' ? input : (input?.url || '');

    if(url.includes('/api/iiko/olap') && typeof init?.body === 'string'){
      try{
        const body = JSON.parse(init.body);
        if(body.action !== 'fields'){
          const index = fieldIndex();

          if(Array.isArray(body.groupByRowFields)){
            body.groupByRowFields = body.groupByRowFields.map(v => resolve(v, index));
          }
          if(Array.isArray(body.groupByColumnFields)){
            body.groupByColumnFields = body.groupByColumnFields.map(v => resolve(v, index));
          }
          if(Array.isArray(body.aggregateFields)){
            body.aggregateFields = body.aggregateFields.map(v => resolve(v, index));
          }
          if(Array.isArray(body.measures)){
            body.measures = body.measures.map(v => resolve(v, index));
          }
          if(Array.isArray(body.filters)){
            body.filters = body.filters.map(f => ({...f, field: resolve(f.field, index)}));
          } else if(body.filters && typeof body.filters === 'object'){
            const normalized = {};
            for(const [field, filter] of Object.entries(body.filters)){
              normalized[resolve(field, index)] = filter;
            }
            body.filters = normalized;
          }

          init = {...init, body: JSON.stringify(body)};
        }
      }catch(error){
        console.error('[OLAP] Field validation failed:', error);
        throw error;
      }
    }

    return originalFetch(input, init);
  };
})();
