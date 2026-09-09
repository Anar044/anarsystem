(function(){
  'use strict';

  const originalFetch = window.fetch.bind(window);

  function clean(v){ return String(v ?? '').trim(); }

  function technicalOf(field){
    if(!field || typeof field !== 'object') return '';
    return clean(
      field.technicalName ||
      field.technical_name ||
      field.field ||
      field.key ||
      field.code ||
      field.id ||
      ''
    );
  }

  function titleOf(field, technical){
    return clean(
      field.title ||
      field.caption ||
      field.label ||
      field.displayName ||
      field.display_name ||
      field.name ||
      technical
    );
  }

  function normalizeField(field){
    if(!field || typeof field !== 'object' || Array.isArray(field)) return field;

    const technical = technicalOf(field);
    if(!technical) return field;

    const title = titleOf(field, technical);

    return {
      ...field,
      name: technical,
      technicalName: technical,
      title
    };
  }

  function normalizeFieldsCollection(value){
    if(Array.isArray(value)) return value.map(normalizeField);
    if(value && typeof value === 'object'){
      const out = {};
      for(const [key,item] of Object.entries(value)) out[key] = normalizeField(item);
      return out;
    }
    return value;
  }

  async function fixFieldsResponse(response){
    try{
      const data = await response.clone().json();
      if(!data || typeof data !== 'object') return response;

      if(data.fields) data.fields = normalizeFieldsCollection(data.fields);
      if(data.columns) data.columns = normalizeFieldsCollection(data.columns);
      if(data.dimensions) data.dimensions = normalizeFieldsCollection(data.dimensions);
      if(data.measures) data.measures = normalizeFieldsCollection(data.measures);

      // Backend also returns raw iiko metadata. Normalize common field collections there.
      if(data.raw && typeof data.raw === 'object'){
        if(data.raw.fields) data.raw.fields = normalizeFieldsCollection(data.raw.fields);
        if(data.raw.columns) data.raw.columns = normalizeFieldsCollection(data.raw.columns);
        if(data.raw.dimensions) data.raw.dimensions = normalizeFieldsCollection(data.raw.dimensions);
        if(data.raw.measures) data.raw.measures = normalizeFieldsCollection(data.raw.measures);
      }

      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    }catch(_){
      return response;
    }
  }

  window.fetch = async function(input, init){
    const url = typeof input === 'string' ? input : (input?.url || '');

    if(!url.includes('/api/iiko/olap')){
      return originalFetch(input, init);
    }

    try{
      const rawBody = init?.body;
      if(typeof rawBody === 'string'){
        const body = JSON.parse(rawBody);
        if(body.action === 'fields'){
          const response = await originalFetch(input, init);
          return await fixFieldsResponse(response);
        }
      }
    }catch(_){ }

    return originalFetch(input, init);
  };
})();
