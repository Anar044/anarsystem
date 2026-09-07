(function(){'use strict';
const originalFetch=window.fetch.bind(window);
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
    const refsResponse=await originalFetch('/api/iiko/references',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(connection)});
    const refs=await refsResponse.json();
    if(!refs?.success)return response;
    const suppliers=refs.suppliers||{};const warehouses=refs.warehouses||{};const products=refs.products||{};
    data.documents=data.documents.map(d=>({...d,
      supplierName:suppliers[String(d.supplierId||'')]||d.supplierName||d.supplierId||'—',
      storeName:warehouses[String(d.storeId||'')]||d.storeName||d.storeId||'—',
      items:Array.isArray(d.items)?d.items.map(x=>({...x,
        productName:products[String(x.productId||'')]||x.productName||x.productId||'—',
        storeName:warehouses[String(x.storeId||'')]||x.storeName||x.storeId||'—'
      })):d.items
    }));
    return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers:response.headers});
  }catch(_){return response;}
};
})();
