(function(){
  "use strict";

  const STORAGE_KEY = "iikoConnection";
  const MENU_KEY = "horeca_qr_menu_v1";
  let syncing = false;

  function getConnection(){
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
    catch { return null; }
  }

  function setStatus(text, ok=false){
    const el=document.getElementById("saveStatus");
    if(el){
      el.textContent=text;
      el.style.color=ok ? "#42d392" : "#ffb454";
    }
  }

  async function parseResponse(response){
    const text=await response.text();
    let data={};
    try{ data=text ? JSON.parse(text) : {}; }
    catch{ data={success:false,message:text || `HTTP ${response.status}`}; }
    if(!response.ok || data.success===false){
      throw new Error(data.message || data.error || `HTTP ${response.status}`);
    }
    return data;
  }

  function isDish(product){
    return product && product.deleted!==true && String(product.type||"").toUpperCase()==="DISH";
  }

  function mergeMenu(data){
    const old=JSON.parse(localStorage.getItem(MENU_KEY)||"null")||{categories:[],active:"",dishes:[]};
    const oldCategories=new Map((old.categories||[]).map(c=>[String(c.iikoId||c.id),c]));
    const oldDishes=new Map((old.dishes||[]).map(d=>[String(d.iikoId||d.id),d]));
    const now=new Date().toISOString();

    const categories=(data.categories||[]).map((c,index)=>{
      const iikoId=String(c.iikoId||c.id);
      const previous=oldCategories.get(iikoId)||{};
      return {
        ...previous,
        id:`iiko-cat-${iikoId}`,
        iikoId,
        name:String(previous.name || c.name || "Без категории"),
        sortOrder:Number(previous.sortOrder ?? c.sortOrder ?? index),
        iikoSyncedAt:now
      };
    });

    const categoryIds=new Set(categories.map(c=>c.iikoId));
    const dishes=[];

    for(const [index,p] of (data.products||[]).entries()){
      if(!isDish(p)) continue;

      const iikoId=String(p.id);
      const previous=oldDishes.get(iikoId)||{};
      const categoryIikoId=String(p.categoryId||previous.iikoCategoryId||"root");

      if(!categoryIds.has(categoryIikoId)){
        categories.push({
          id:`iiko-cat-${categoryIikoId}`,
          iikoId:categoryIikoId,
          name:categoryIikoId==="root" ? "Без категории" : "Группа iiko",
          sortOrder:999999,
          iikoSyncedAt:now
        });
        categoryIds.add(categoryIikoId);
      }

      const price=p.price==null ? Number(previous.price||0) : Number(p.price);

      dishes.push({
        ...previous,
        id:previous.id || `iiko-${iikoId}`,
        iikoId,
        iikoCategoryId:categoryIikoId,
        cat:`iiko-cat-${categoryIikoId}`,
        name:String(p.name || previous.name || iikoId),
        price:Number.isFinite(price) ? price : 0,
        desc:previous.desc || String(p.description || ""),
        photo:previous.photo || p.image || null,
        code:String(p.code || previous.code || ""),
        num:String(p.num || previous.num || ""),
        defaultIncludedInMenu:Boolean(p.defaultIncludedInMenu),
        sizes:p.sizes || previous.sizes || [],
        sortOrder:Number(previous.sortOrder ?? p.sortOrder ?? index),
        iikoSyncedAt:now
      });
    }

    categories.sort((a,b)=>a.sortOrder-b.sortOrder);
    dishes.sort((a,b)=>a.sortOrder-b.sortOrder);

    const active=categories.some(c=>String(c.id)===String(old.active)) ? old.active : (categories[0]?.id||"");
    const next={...old,categories,active,dishes,lastIikoSync:now,source:"iiko-nomenclature"};
    localStorage.setItem(MENU_KEY,JSON.stringify(next));
    return next;
  }

  async function sync(){
    if(syncing) return;
    const button=document.getElementById("syncBtn");
    if(!button) return;

    const connection=getConnection();
    if(!connection?.ip || !connection?.port || !connection?.login || connection?.password==null){
      setStatus("⚠ Сначала подключитесь к iiko в Настройках");
      alert("Сначала подключитесь к iiko Server в разделе «Настройки».");
      return;
    }

    syncing=true;
    const oldText=button.textContent;
    button.disabled=true;
    button.textContent="↻ Синхронизация...";

    try{
      setStatus("● Подключаемся к iiko Server...");

      const old=JSON.parse(localStorage.getItem(MENU_KEY)||"null")||{categories:[]};
      const categories=(old.categories||[]).map(c=>({
        id:c.id,
        iikoId:c.iikoId || c.id,
        name:c.name
      }));

      setStatus("● Получаем номенклатуру iiko...");

      const response=await fetch("/api/iiko/nomenclature",{
        method:"POST",
        headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({
          ip:connection.ip,
          port:connection.port,
          login:connection.login,
          password:connection.password,
          categories
        })
      });

      const data=await parseResponse(response);
      const products=(data.products||[]).filter(isDish);
      if(!products.length) throw new Error("iiko не вернул ни одного элемента типа DISH.");

      const result=mergeMenu({...data,products});
      setStatus(`● iiko: ${result.dishes.length} блюд, ${result.categories.length} групп`,true);
      window.dispatchEvent(new CustomEvent("qr-menu-updated"));
      setTimeout(()=>location.reload(),150);
    }catch(error){
      console.error("QR Menu iiko nomenclature sync:",error);
      setStatus(`⚠ Ошибка iiko: ${error.message}`);
      alert(`Не удалось загрузить номенклатуру iiko:\n\n${error.message}`);
    }finally{
      syncing=false;
      button.disabled=false;
      button.textContent=oldText;
    }
  }

  window.qrMenuSync=sync;
  function install(){
    const button=document.getElementById("syncBtn");
    if(button) button.onclick=sync;
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",install,{once:true});
  else install();
})();
