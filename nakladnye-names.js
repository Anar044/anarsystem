(function(){'use strict';
const originalFetch=window.fetch.bind(window);
function key(v){return String(v??'').trim().replace(/^\{+|\}+$/g,'').toLowerCase();}
function makeMap(value){const map=new Map();if(!value)return map;for(const [id,name] of Object.entries(value)){const k=key(id),n=String(name??'').trim();if(k&&n)map.set(k,n);}return map;}
function getConnection(body){if(body?.ip&&body?.port&&body?.login&&body?.password)return {ip:body.ip,port:body.port,login:body.login,password:body.password};try{const c=JSON.parse(localStorage.getItem('iikoConnection')||'null');if(c?.ip&&c?.port&&c?.login&&c?.password)return {ip:c.ip,port:c.port,login:c.login,password:c.password};}catch(_){}return null;}
window.fetch=async function(input,init){
  const response=await originalFetch(input,init);
  try{
    const url=typeof input==='string'?input:(input&&input.url)||'';
    if(!url.includes('/api/iiko/incoming-invoices')||!init||String(init.method||'GET').toUpperCase()!=='POST')return response;
    let body=null;try{body=typeof init.body==='string'?JSON.parse(init.body):null;}catch(_){}
    const connection=getConnection(body);if(!connection)return response;
    const data=await response.clone().json();
    if(!data?.success||!Array.isArray(data.documents)||!data.documents.length)return response;
    const refsResponse=await originalFetch('/api/iiko/references',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(connection),cache:'no-store'});
    const refs=await refsResponse.json();
    if(!refs?.success)return response;
    const suppliers=makeMap(refs.suppliers),warehouses=makeMap(refs.warehouses),products=makeMap(refs.products);
    data.documents=data.documents.map(d=>({...d,
      supplierName:suppliers.get(key(d.supplierId))||String(d.supplierName||'').trim()||d.supplierId||'—',
      storeName:warehouses.get(key(d.storeId))||String(d.storeName||'').trim()||d.storeId||'—',
      items:Array.isArray(d.items)?d.items.map(x=>({...x,
        productName:products.get(key(x.productId))||String(x.productName||'').trim()||x.productId||'—',
        storeName:warehouses.get(key(x.storeId))||String(x.storeName||'').trim()||x.storeId||'—'
      })):d.items
    }));
    return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers:response.headers});
  }catch(_){return response;}
};
})();
