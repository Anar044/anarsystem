(function(){
  'use strict';

  // IMPORTANT: iiko /resto/api/v2/reports/olap/columns returns an object
  // whose KEYS are the real OLAP field identifiers and whose `name` is only
  // the human-readable iikoOffice caption. Never use the caption as a field id.
  const originalFetch = window.fetch.bind(window);

  const clean = v => String(v ?? '').trim();

  function makeField(technicalName, meta){
    if(!technicalName || !meta || typeof meta !== 'object' || Array.isArray(meta)) return null;

    const technical = clean(technicalName);
    if(!technical) return null;

    const title = clean(
      meta.name ||
      meta.title ||
      meta.caption ||
      meta.label ||
      meta.displayName ||
      meta.display_name ||
      technical
    );

    return {
      ...meta,
      name: technical,
      field: technical,
      key: technical,
      id: technical,
      technicalName: technical,
      title,
      type: clean(meta.type || meta.dataType || meta.data_type || meta.kind || 'unknown'),
      aggregationAllowed: meta.aggregationAllowed === true || meta.allowAggregation === true || meta.canAggregate === true,
      groupingAllowed: meta.groupingAllowed !== false,
      filteringAllowed: meta.filteringAllowed !== false,
      isMeasure: meta.isMeasure === true || meta.measure === true || meta.aggregationAllowed === true
    };
  }

  function fieldsFromRaw(raw){
    const out = [];
    const seen = new Set();

    function add(technical, meta){
      const field = makeField(technical, meta);
      if(!field) return;
      const key = field.name.toLowerCase();
      if(seen.has(key)) return;
      seen.add(key);
      out.push(field);
    }

    // Authoritative iiko format:
    // { "OpenDate.Typed": { name: "Учетный день", ... }, ... }
    if(raw && typeof raw === 'object' && !Array.isArray(raw)){
      const nestedKeys = ['fields','columns','dimensions','measures','fieldDefinitions'];
      for(const key of nestedKeys){
        const collection = raw[key];
        if(!collection) continue;
        if(Array.isArray(collection)){
          for(const item of collection){
            if(!item || typeof item !== 'object') continue;
            const technical = clean(item.technicalName || item.field || item.key || item.code || item.id);
            if(technical) add(technical, item);
          }
        }else if(typeof collection === 'object'){
          for(const [technical, meta] of Object.entries(collection)) add(technical, meta);
        }
      }

      // Most iiko installations return the fields directly at the root.
      for(const [technical, meta] of Object.entries(raw)){
        if(['fields','columns','dimensions','measures','fieldDefinitions','data','items'].includes(technical)) continue;
        if(meta && typeof meta === 'object' && !Array.isArray(meta)) add(technical, meta);
      }
    }

    return out;
  }

  function authoritativeFields(data){
    // Prefer the original iiko `raw` object because its keys are the only
    // source that unambiguously identify the technical OLAP field.
    const fromRaw = fieldsFromRaw(data?.raw);
    if(fromRaw.length) return fromRaw;

    // Fallback: accept already-normalized backend fields ONLY when they carry
    // an explicit technical identifier. Do not invent one from the caption.
    const source = Array.isArray(data?.fields) ? data.fields : [];
    return source.map(item => {
      if(!item || typeof item !== 'object') return null;
      const technical = clean(item.technicalName || item.field || item.key || item.code || item.id || item.name);
      if(!technical) return null;
      return makeField(technical, item);
    }).filter(Boolean);
  }

  async function processFieldsResponse(response){
    try{
      const data = await response.clone().json();
      if(!data || typeof data !== 'object') return response;

      const fields = authoritativeFields(data);
      if(!fields.length) return response;

      data.fields = fields;
      data.fieldCount = fields.length;

      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    }catch(error){
      console.warn('[OLAP] authoritative field mapping skipped:', error);
      return response;
    }
  }

  window.fetch = async function(input, init){
    const url = typeof input === 'string' ? input : (input?.url || '');
    if(!url.includes('/api/iiko/olap')) return originalFetch(input, init);

    try{
      if(typeof init?.body === 'string'){
        const body = JSON.parse(init.body);
        if(body.action === 'fields'){
          const response = await originalFetch(input, init);
          return processFieldsResponse(response);
        }
      }
    }catch(error){
      console.warn('[OLAP] field response processing skipped:', error);
    }

    return originalFetch(input, init);
  };
})();
