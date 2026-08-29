(function(){
  "use strict";

  const STORAGE_KEY = "iikoConnection";
  const MENU_KEY = "horeca_qr_menu_v1";
  const PUBLISH_KEY = "horeca_qr_menu_public_v1";
  let syncing = false;
  let publishing = false;

  function getConnection(){
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
    catch { return null; }
  }

  function getOrganizationId(connection){
    const candidates = [
      connection?.organizationId,
      connection?.organizationID,
      connection?.departmentId,
      connection?.departmentID,
      connection?.iikoOrganizationId,
      connection?.iikoOrganizationID,
      connection?.organization?.id,
      connection?.department?.id
    ];
    return candidates.find(v => v !== undefined && v !== null && String(v).trim() !== "")?.toString().trim() || "";
  }

  function getRestaurantName(connection){
    return String(
      connection?.organizationName ||
      connection?.departmentName ||
      connection?.restaurantName ||
      connection?.organization?.name ||
      connection?.department?.name ||
      "Мой ресторан"
    ).trim() || "Мой ресторан";
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
      return {...previous,id:`iiko-cat-${iikoId}`,iikoId,name:String(previous.name || c.name || "Без категории"),sortOrder:Number(previous.sortOrder ?? c.sortOrder ?? index),iikoSyncedAt:now};
    });

    const categoryIds=new Set(categories.map(c=>c.iikoId));
    const dishes=[];
    for(const [index,p] of (data.products||[]).entries()){
      if(!isDish(p)) continue;
      const iikoId=String(p.id);
      const previous=oldDishes.get(iikoId)||{};
      const categoryIikoId=String(p.categoryId||previous.iikoCategoryId||"root");
      if(!categoryIds.has(categoryIikoId)){
        categories.push({id:`iiko-cat-${categoryIikoId}`,iikoId:categoryIikoId,name:categoryIikoId==="root"?"Без категории":"Группа iiko",sortOrder:999999,iikoSyncedAt:now});
        categoryIds.add(categoryIikoId);
      }
      const price=p.price==null ? Number(previous.price||0) : Number(p.price);
      dishes.push({...previous,id:previous.id || `iiko-${iikoId}`,iikoId,iikoCategoryId:categoryIikoId,cat:`iiko-cat-${categoryIikoId}`,name:String(p.name || previous.name || iikoId),price:Number.isFinite(price)?price:0,desc:previous.desc || String(p.description || ""),photo:previous.photo || p.image || null,code:String(p.code || previous.code || ""),num:String(p.num || previous.num || ""),defaultIncludedInMenu:Boolean(p.defaultIncludedInMenu),sizes:p.sizes || previous.sizes || [],sortOrder:Number(previous.sortOrder ?? p.sortOrder ?? index),iikoSyncedAt:now});
    }
    categories.sort((a,b)=>a.sortOrder-b.sortOrder);
    dishes.sort((a,b)=>a.sortOrder-b.sortOrder);
    const active=categories.some(c=>String(c.id)===String(old.active))?old.active:(categories[0]?.id||"");
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
      const categories=(old.categories||[]).map(c=>({id:c.id,iikoId:c.iikoId || c.id,name:c.name}));
      setStatus("● Получаем номенклатуру iiko...");
      const response=await fetch("/api/iiko/nomenclature",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({ip:connection.ip,port:connection.port,login:connection.login,password:connection.password,categories})});
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
      syncing=false;button.disabled=false;button.textContent=oldText;
    }
  }

  async function publish(){
    if(publishing) return;
    const button=document.getElementById("publishBtn");
    if(!button) return;

    const connection=getConnection();
    const organizationId=getOrganizationId(connection);
    const state=JSON.parse(localStorage.getItem(MENU_KEY)||"null");

    if(!organizationId){
      alert("Не найден ID организации iiko. Сначала подключите iiko в «Настройки» и убедитесь, что ID организации отображается в блоке идентификатора.");
      return;
    }
    if(!state || !Array.isArray(state.dishes) || !Array.isArray(state.categories)){
      alert("QR Menu пока пуст. Сначала загрузите меню из iiko.");
      return;
    }

    const confirmed=confirm("Опубликовать текущее меню ресторана на сервере?\n\nПосле публикации гости смогут открыть его по QR-коду.");
    if(!confirmed) return;

    publishing=true;
    const oldText=button.textContent;
    button.disabled=true;
    button.textContent="Публикация...";

    try{
      setStatus("● Публикуем QR Menu на сервере...");
      const response=await fetch("/api/qr-menu/publish",{
        method:"POST",
        headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({
          organizationId,
          restaurantName:getRestaurantName(connection),
          menu:{categories:state.categories,dishes:state.dishes}
        })
      });
      const result=await parseResponse(response);

      const publication={
        organizationId,
        publicId:result.publicId,
        publicUrl:result.publicUrl,
        version:result.version,
        updatedAt:result.updatedAt
      };
      localStorage.setItem(PUBLISH_KEY,JSON.stringify(publication));

      setStatus(`● Опубликовано: версия ${result.version}`,true);
      renderPublicQr(result.publicUrl);

      alert(`Меню опубликовано!\n\nПубличная ссылка:\n${result.publicUrl}`);
    }catch(error){
      console.error("QR Menu publish:",error);
      setStatus(`⚠ Ошибка публикации: ${error.message}`);
      alert(`Не удалось опубликовать меню:\n\n${error.message}`);
    }finally{
      publishing=false;button.disabled=false;button.textContent=oldText;
    }
  }

  function renderPublicQr(url){
    const box=document.getElementById("qrbox");
    if(!box || !url) return;
    const imageUrl="https://api.qrserver.com/v1/create-qr-code/?size=150x150&margin=8&data="+encodeURIComponent(url);
    box.innerHTML=`<img src="${imageUrl}" alt="QR Menu" style="width:150px;height:150px;display:block;border-radius:10px">`;
    box.title=url;

    const hint=box.parentElement?.querySelector?.('.hint');
    if(hint) hint.innerHTML=`Опубликовано. <a href="${url}" target="_blank" rel="noopener" style="color:#42d392">Открыть публичное меню</a>`;
  }

  function restorePublication(){
    try{
      const p=JSON.parse(localStorage.getItem(PUBLISH_KEY)||"null");
      if(p?.publicUrl) renderPublicQr(p.publicUrl);
    }catch{}
  }

  window.qrMenuSync=sync;
  window.qrMenuPublish=publish;

  function install(){
    const syncButton=document.getElementById("syncBtn");
    const publishButton=document.getElementById("publishBtn");
    if(syncButton) syncButton.onclick=sync;
    if(publishButton) publishButton.onclick=publish;
    restorePublication();
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",install,{once:true});
  else install();
})();
