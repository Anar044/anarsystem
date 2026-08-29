(function(){
  "use strict";

  const STORAGE_KEY = "iikoConnection";
  const MENU_KEY = "horeca_qr_menu_v1";
  let syncing = false;

  function getConnection(){
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
    catch { return null; }
  }

  function saveConnection(connection){
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(connection)); } catch {}
  }

  function pickOrganization(connection){
    return String(
      connection?.organizationId ||
      connection?.organizationID ||
      connection?.selectedOrganizationId ||
      connection?.departmentId ||
      connection?.departmentID ||
      connection?.selectedDepartmentId ||
      connection?.organization?.id ||
      connection?.department?.id ||
      connection?.departmentIds?.[0] ||
      connection?.departments?.[0]?.id ||
      ""
    ).trim();
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
    try{data=text?JSON.parse(text):{};}
    catch{data={success:false,message:text||`HTTP ${response.status}`};}
    if(!response.ok || data.success===false){
      throw new Error(data.message || `HTTP ${response.status}`);
    }
    return data;
  }

  async function ensureOrganization(connection){
    let id=pickOrganization(connection);
    if(id) return {connection,id};

    setStatus("● Получаем идентификатор организации iiko...");
    const response=await fetch("/api/iiko/connect",{
      method:"POST",
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify(connection)
    });
    const data=await parseResponse(response);
    const departments=Array.isArray(data.departments)?data.departments:[];
    if(!departments.length){
      throw new Error("iiko подключён, но организация не найдена.");
    }

    id=String(departments[0].id||"").trim();
    if(!id) throw new Error("iiko не вернул ID организации.");

    connection={...connection,organizationId:id,departmentId:id,departments};
    saveConnection(connection);
    return {connection,id};
  }

  function isForSale(product){
    if(!product || product.isDeleted===true || product.deleted===true) return false;
    if(product.isHidden===true || product.hidden===true) return false;
    if(product.available===false || product.isAvailable===false) return false;
    if(product.inStopList===true || product.isStopList===true || product.stopList===true) return false;
    return true;
  }

  function mergeMenu(data){
    const old=JSON.parse(localStorage.getItem(MENU_KEY)||"null")||{categories:[],active:"",dishes:[]};

    const oldCategories=new Map((old.categories||[]).map(c=>[
      String(c.iikoId||c.id),c
    ]));
    const oldDishes=new Map((old.dishes||[]).map(d=>[
      String(d.iikoId||d.id),d
    ]));

    const categories=(data.categories||[]).map((c,index)=>{
      const iikoId=String(c.id);
      const previous=oldCategories.get(iikoId)||{};
      return {
        ...previous,
        id:`iiko-cat-${iikoId}`,
        iikoId,
        name:String(c.name||previous.name||"Без категории"),
        sortOrder:Number(c.sortOrder??previous.sortOrder??index)
      };
    });

    const categoryIds=new Set(categories.map(c=>c.iikoId));
    const dishes=[];

    for(const [index,p] of (data.products||[]).entries()){
      if(!isForSale(p)) continue;

      const iikoId=String(p.id);
      const previous=oldDishes.get(iikoId)||{};
      const categoryIikoId=String(p.categoryId||previous.iikoCategoryId||"ungrouped");

      if(!categoryIds.has(categoryIikoId)){
        categories.push({
          id:`iiko-cat-${categoryIikoId}`,
          iikoId:categoryIikoId,
          name:"Без категории",
          sortOrder:999999
        });
        categoryIds.add(categoryIikoId);
      }

      const price=p.price==null ? Number(previous.price||0) : Number(p.price);

      dishes.push({
        ...previous,
        id:previous.id||`iiko-${iikoId}`,
        iikoId,
        iikoCategoryId:categoryIikoId,
        cat:`iiko-cat-${categoryIikoId}`,
        name:String(p.name||previous.name||iikoId),
        price:Number.isFinite(price)?price:0,
        // iiko description is used only when the user has not entered his own description.
        desc:previous.desc || String(p.description||""),
        // Keep manually uploaded photo after every sync.
        photo:previous.photo || p.image || null,
        sizes:p.sizes||previous.sizes||[],
        sortOrder:Number(p.sortOrder??previous.sortOrder??index),
        iikoSyncedAt:new Date().toISOString()
      });
    }

    categories.sort((a,b)=>a.sortOrder-b.sortOrder);
    dishes.sort((a,b)=>a.sortOrder-b.sortOrder);

    const active=categories.some(c=>String(c.id)===String(old.active))
      ? old.active
      : (categories[0]?.id||"");

    const next={
      categories,
      active,
      dishes,
      lastIikoSync:new Date().toISOString(),
      source:"iiko-external-menu"
    };

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
      const prepared=await ensureOrganization(connection);

      setStatus("● Запрашиваем внешнее меню iiko...");

      const response=await fetch("/api/iiko/qr-menu",{
        method:"POST",
        headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({
          ip:prepared.connection.ip,
          port:prepared.connection.port,
          login:prepared.connection.login,
          password:prepared.connection.password,
          organizationId:prepared.id,
          externalMenuId:prepared.connection.externalMenuId||""
        })
      });

      const data=await parseResponse(response);
      const products=(data.products||[]).filter(isForSale);

      if(!products.length){
        throw new Error("iiko вернул внешнее меню без доступных для продажи блюд.");
      }

      const result=mergeMenu({...data,products});
      setStatus(`● Синхронизировано из iiko: ${result.dishes.length} блюд, ${result.categories.length} категорий`,true);

      window.dispatchEvent(new CustomEvent("qr-menu-updated"));
      setTimeout(()=>location.reload(),150);
    }catch(error){
      console.error("QR Menu iiko sync:",error);
      setStatus(`⚠ Ошибка iiko: ${error.message}`);
      alert(`Не удалось загрузить меню iiko:\n\n${error.message}`);
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
