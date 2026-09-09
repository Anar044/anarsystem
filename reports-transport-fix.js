(function(){
  'use strict';

  // Final safety layer for OLAP requests.
  // IMPORTANT: only the fields rendered in the AVAILABLE FIELDS list are
  // authoritative. A field restored from an old saved report must never be
  // added to the whitelist by itself.
  const originalFetch = window.fetch.bind(window);
  const clean = v => String(v ?? '').trim();

  function fieldIndex(){
    const byTitle = new Map();
    const byTitleLower = new Map();
    const technical = new Set();

    document.querySelectorAll('#olap-fields .olap-field').forEach(el => {
      const title = clean(el.querySelector('strong')?.textContent || '');
      const name = clean(el.dataset.field || el.querySelector('small')?.textContent || '');
      if(!name) return;

      technical.add(name);

      if(title){
        byTitle.set(title, name);
        byTitleLower.set(title.toLowerCase(), name);
      }
    });

    return { byTitle, byTitleLower, technical };
  }

  function resolve(value, index){
    const v = clean(value);
    if(!v) throw new Error('Пустое OLAP-поле');

    // 1. Real technical identifier from the current iiko field list.
    if(index.technical.has(v)) return v;

    // 2. Display caption from the current iiko field list.
    if(index.byTitle.has(v)) return index.byTitle.get(v);
    const lower = v.toLowerCase();
    if(index.byTitleLower.has(lower)) return index.byTitleLower.get(lower);

    // 3. NEVER send a value that is not in the current iiko field list.
    throw new Error(`Неизвестное OLAP-поле: «${v}». Это поле отсутствует в текущем списке iiko. Удалите его из отчёта и выберите поле заново.`);
  }

  function normalizeBody(body){
    const index = fieldIndex();

    if(!index.technical.size){
      throw new Error('Список OLAP-полей iiko ещё не загружен. Сначала обновите поля.');
    }

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
      body.filters = body.filters.map(f => ({
        ...f,
        field: resolve(f.field, index)
      }));
    } else if(body.filters && typeof body.filters === 'object'){
      const normalized = {};
      for(const [field, filter] of Object.entries(body.filters)){
        normalized[resolve(field, index)] = filter;
      }
      body.filters = normalized;
    }

    return body;
  }

  window.fetch = async function(input, init){
    const url = typeof input === 'string' ? input : (input?.url || '');

    if(url.includes('/api/iiko/olap') && typeof init?.body === 'string'){
      try{
        const body = JSON.parse(init.body);

        if(body.action !== 'fields'){
          const normalized = normalizeBody(body);
          init = {...init, body: JSON.stringify(normalized)};
        }
      }catch(error){
        console.error('[OLAP] Field validation failed:', error);
        throw error;
      }
    }

    return originalFetch(input, init);
  };
})();
