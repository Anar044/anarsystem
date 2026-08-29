(function(){
  const STORAGE_KEY='iikoConnection';
  const MENU_KEY='horeca_qr_menu_v1';
  function getConnection(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');}catch{return null;}}
  function pickOrganization(c){return c?.organizationId||c?.organizationID||c?.organization?.id||c?.departmentId||c?.departmentID||c?.id||'';}
  function setStatus(text,ok=false){const el=document.getElementById('saveStatus');if(el){el.textContent=text;el.style.color=ok?'#42d392':'#ffb454';}}
  function mergeMenu(data){
    const old=JSON.parse(localStorage.getItem(MENU_KEY)||'null')||{categories:[],active:'',dishes:[]};
    const oldCats=new Map((old.categories||[]).map(x=>[String(x.id),x]));
    const oldDishes=new Map((old.dishes||[]).map(x=>[String(x.iikoId||x.id),x]));
    const categories=(data.categories||[]).map((c,i)=>{const oldCat=oldCats.get(String(c.id))||{};return {...oldCat,id:String(c.id),name:c.name||oldCat.name||'Без категории',sortOrder:c.sortOrder??i};});
    const dishes=(data.products||[]).map((p,i)=>{const oldDish=oldDishes.get(String(p.id))||{};return {...oldDish,id:String(p.id),iikoId:String(p.id),cat:String(p.categoryId||oldDish.cat||''),name:p.name||oldDish.name||'',price:p.price??oldDish.price??0,desc:oldDish.desc||p.description||'',photo:oldDish.photo||p.image||null,sizes:p.sizes||oldDish.sizes||[],sortOrder:p.sortOrder??i};});
    old.categories=categories;old.dishes=dishes;old.active=categories.some(c=>String(c.id)===String(old.active))?old.active:(categories[0]?.id||'');old.lastIikoSync=new Date().toISOString();old.source='iiko-external-menu';localStorage.setItem(MENU_KEY,JSON.stringify(old));return old;
  }
  async function sync(){
    const button=document.getElementById('syncBtn');if(!button)return;
    const c=getConnection();
    if(!c?.ip||!c?.port||!c?.login||c?.password==null){setStatus('⚠ Сначала подключитесь к iiko в настройках');return;}
    const organizationId=pickOrganization(c);
    if(!organizationId){setStatus('⚠ Не найден organizationId в сохранённом подключении iiko');return;}
    const old=button.textContent;button.disabled=true;button.textContent='↻ Синхронизация...';setStatus('● Запрашиваем внешнее меню iiko...');
    try{
      const response=await fetch('/api/iiko/qr-menu',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({ip:c.ip,port:c.port,login:c.login,password:c.password,organizationId})});
      const data=await response.json().catch(()=>({success:false,message:'Некорректный ответ сервера'}));
      if(!response.ok||data.success===false)throw new Error(data.message||`HTTP ${response.status}`);
      if(!data.products?.length)throw new Error('iiko вернул внешнее меню без продаваемых позиций');
      mergeMenu(data);setStatus(`● Синхронизировано: ${data.products.length} блюд, ${data.categories.length} категорий`,true);window.dispatchEvent(new CustomEvent('qr-menu-updated'));
      if(typeof window.renderQRMenu==='function')window.renderQRMenu();
      else setTimeout(()=>location.reload(),50);
    }catch(e){console.error('QR Menu sync',e);setStatus(`⚠ ${e.message}`);}
    finally{button.disabled=false;button.textContent=old;}
  }
  window.qrMenuSync=sync;
  document.addEventListener('DOMContentLoaded',()=>{const b=document.getElementById('syncBtn');if(b)b.onclick=sync;});
})();
