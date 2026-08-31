/* QR Menu sync reliability fix + dish photo upload
   Local iiko Server only. Does not touch OLAP.
*/
(function(){
  'use strict';
  const MENU_KEY='horeca_qr_menu_v1';
  const CONNECTION_KEY='iikoConnection';
  let busy=false;

  function connection(){
    try{return JSON.parse(localStorage.getItem(CONNECTION_KEY)||'null');}
    catch{return null;}
  }
  function state(){
    try{return JSON.parse(localStorage.getItem(MENU_KEY)||'null')||{categories:[],dishes:[],active:''};}
    catch{return {categories:[],dishes:[],active:''};}
  }
  function saveState(s){localStorage.setItem(MENU_KEY,JSON.stringify(s));}
  function status(text,ok){
    const el=document.getElementById('saveStatus');
    if(el){el.textContent=text;el.style.color=ok?'#42d392':'#ffb454';}
  }
  function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}

  function render(){
    const s=state();
    const cats=s.categories||[];
    const dishes=s.dishes||[];
    const active=cats.some(c=>String(c.id)===String(s.active))?s.active:(cats[0]?.id||'');
    if(active!==s.active){s.active=active;saveState(s);}

    const catEl=document.getElementById('categories');
    if(catEl){
      catEl.innerHTML=cats.map(c=>{
        const count=dishes.filter(d=>String(d.cat)===String(c.id)).length;
        return `<div class="cat ${String(c.id)===String(active)?'active':''}" data-cat="${esc(c.id)}"><span>☷ &nbsp;${esc(c.name)}${c.source==='iiko'?'<span class="source-badge">iiko</span>':''}</span><span>${count}</span></div>`;
      }).join('') || '<div class="empty">Синхронизируйте меню с iiko.</div>';
      catEl.querySelectorAll('.cat').forEach(el=>el.onclick=()=>{
        const next=state();next.active=el.dataset.cat;saveState(next);render();
      });
    }

    const search=(document.getElementById('searchDish')?.value||'').toLowerCase();
    const visible=dishes.filter(d=>String(d.cat)===String(active)&&(`${d.name||''} ${d.desc||''}`).toLowerCase().includes(search));
    const itemEl=document.getElementById('items');
    if(itemEl){
      itemEl.innerHTML=visible.map(d=>`<div class="item" data-id="${esc(d.id)}"><div class="photo">${d.photo?`<img src="${esc(d.photo)}" alt="${esc(d.name)}">`:'🍽'}</div><div><h4>${esc(d.name)}${d.source==='iiko'?'<span class="source-badge">iiko</span>':''}</h4><p>${esc(d.desc||'Состав не указан')}</p><div class="item-actions"><button class="mini photoBtn" data-id="${esc(d.id)}">📷 ${d.photo?'Изменить фото':'Добавить фото'}</button></div></div><div class="price">${Number(d.price||0).toFixed(2)} ₼</div></div>`).join('') || '<div class="empty">В этой категории нет доступных блюд.</div>';
      itemEl.querySelectorAll('.photoBtn').forEach(btn=>btn.onclick=()=>choosePhoto(btn.dataset.id));
    }

    const preview=document.getElementById('previewBody');
    if(preview){
      preview.innerHTML=cats.map(c=>{
        const ds=dishes.filter(d=>String(d.cat)===String(c.id));
        if(!ds.length)return '';
        return `<div class="p-cat">${esc(c.name)}</div>`+ds.map(d=>`<div class="p-item"><div class="p-photo">${d.photo?`<img src="${esc(d.photo)}" alt="${esc(d.name)}">`:'🍽'}</div><div><b>${esc(d.name)}</b><span>${esc(d.desc||'')}</span></div><div class="p-price">${Number(d.price||0).toFixed(2)} ₼</div></div>`).join('');
      }).join('');
    }
  }

  function choosePhoto(id){
    const input=document.getElementById('qrDishPhotoInput');
    if(!input)return;
    input.dataset.dishId=String(id);
    input.value='';
    input.click();
  }

  function resizeImage(file){
    return new Promise((resolve,reject)=>{
      if(!file||!file.type.startsWith('image/')){reject(new Error('Выберите изображение.'));return;}
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error('Не удалось прочитать файл.'));
      reader.onload=e=>{
        const img=new Image();
        img.onerror=()=>reject(new Error('Не удалось открыть изображение.'));
        img.onload=()=>{
          const max=1200;
          const scale=Math.min(1,max/Math.max(img.width,img.height));
          const canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(img.width*scale));
          canvas.height=Math.max(1,Math.round(img.height*scale));
          const ctx=canvas.getContext('2d');
          ctx.drawImage(img,0,0,canvas.width,canvas.height);
          resolve(canvas.toDataURL('image/jpeg',0.82));
        };
        img.src=e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handlePhotoInput(event){
    const file=event.target.files?.[0];
    const id=event.target.dataset.dishId;
    if(!file||!id)return;
    try{
      status('● Обрабатываем фото блюда...');
      const photo=await resizeImage(file);
      const s=state();
      const dish=(s.dishes||[]).find(d=>String(d.id)===String(id));
      if(!dish){status('⚠ Блюдо не найдено');return;}
      dish.photo=photo;
      dish.photoSource='manual';
      dish.photoUpdatedAt=new Date().toISOString();
      saveState(s);
      render();
      status('● Фото блюда сохранено',true);
      window.dispatchEvent(new CustomEvent('qr-menu-updated'));
    }catch(e){
      console.error('QR Menu photo upload:',e);
      status(`⚠ Фото не сохранено: ${e.message}`);
      alert(`Не удалось добавить фото:\n\n${e.message}`);
    }finally{
      event.target.value='';
    }
  }

  async function sync(){
    if(busy)return;
    const btn=document.getElementById('syncBtn');
    if(!btn)return;
    const c=connection();
    if(!c?.ip||!c?.port||!c?.login||c?.password==null){
      status('⚠ Сначала подключитесь к iiko в Настройках');
      alert('Сначала подключитесь к локальному iiko Server в разделе «Настройки».');
      return;
    }
    busy=true;
    const oldText=btn.textContent;
    btn.disabled=true;btn.textContent='↻ Синхронизация...';
    try{
      status('● Получаем номенклатуру из локального iiko Server...');
      const response=await fetch('/api/iiko/qr-menu',{
        method:'POST',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({ip:c.ip,port:c.port,login:c.login,password:c.password})
      });
      const text=await response.text();
      let data={};
      try{data=text?JSON.parse(text):{};}catch{throw new Error(text||`HTTP ${response.status}`);}
      if(!response.ok||data.success===false)throw new Error(data.message||`HTTP ${response.status}`);

      const products=(data.products||[]).filter(p=>p&&p.deleted!==true&&String(p.type||'').toUpperCase()==='DISH');
      if(!products.length)throw new Error(`iiko вернул 0 доступных блюд. Групп: ${data.categoryCount??(data.categories||[]).length}.`);

      const old=state();
      const oldCats=new Map((old.categories||[]).map(x=>[String(x.iikoId||x.id),x]));
      const oldDishes=new Map((old.dishes||[]).map(x=>[String(x.iikoId||x.id),x]));
      const now=new Date().toISOString();
      const categories=(data.categories||[]).map((c,i)=>{
        const id=String(c.iikoId||c.id);const prev=oldCats.get(id)||{};
        return {...prev,id:`iiko-cat-${id}`,iikoId:id,name:String(c.name||'Без категории'),parentId:c.parentId??null,sortOrder:Number(c.sortOrder??i),source:'iiko',iikoSyncedAt:now};
      });
      const catIds=new Set(categories.map(x=>x.iikoId));
      const dishes=[];
      products.forEach((p,i)=>{
        const id=String(p.iikoId||p.id);const prev=oldDishes.get(id)||{};const catId=String(p.categoryId||prev.iikoCategoryId||'root');
        if(!catIds.has(catId)){
          categories.push({id:`iiko-cat-${catId}`,iikoId:catId,name:String(p.categoryName||'Без категории'),parentId:null,sortOrder:999999,source:'iiko',iikoSyncedAt:now});
          catIds.add(catId);
        }
        const price=p.price==null?Number(prev.price||0):Number(p.price);
        dishes.push({...prev,id:prev.id||`iiko-${id}`,iikoId:id,iikoCategoryId:catId,cat:`iiko-cat-${catId}`,source:'iiko',name:String(p.name||id),price:Number.isFinite(price)?price:0,desc:String(p.description??prev.desc??''),photo:prev.photo||p.image||p.frontImageId||null,photoSource:prev.photo?'manual':(p.image||p.frontImageId?'iiko':'none'),code:String(p.code||''),num:String(p.num||''),defaultIncludedInMenu:true,salePlaceAvailable:p.salePlaceAvailable!==false,excludedSections:Array.isArray(p.excludedSections)?p.excludedSections:null,sortOrder:Number(p.sortOrder??i)});
      });
      categories.sort((a,b)=>a.sortOrder-b.sortOrder);dishes.sort((a,b)=>a.sortOrder-b.sortOrder);
      const next={...old,categories,dishes,active:old.active&&categories.some(c=>c.id===old.active)?old.active:(categories[0]?.id||''),lastIikoSync:now,source:'iiko-nomenclature'};
      saveState(next);
      render();
      status(`● iiko: ${dishes.length} блюд, ${categories.length} групп`,true);
      window.dispatchEvent(new CustomEvent('qr-menu-updated'));
    }catch(e){
      console.error('QR Menu sync fix:',e);
      status(`⚠ Ошибка iiko: ${e.message}`);
      alert(`Не удалось загрузить меню iiko:\n\n${e.message}`);
    }finally{
      busy=false;btn.disabled=false;btn.textContent=oldText;
    }
  }

  function install(){
    const btn=document.getElementById('syncBtn');
    if(!btn)return;
    btn.onclick=sync;
    const search=document.getElementById('searchDish');
    if(search)search.oninput=render;
    let input=document.getElementById('qrDishPhotoInput');
    if(!input){
      input=document.createElement('input');
      input.id='qrDishPhotoInput';
      input.type='file';
      input.accept='image/*';
      input.style.display='none';
      document.body.appendChild(input);
    }
    input.onchange=handlePhotoInput;
    render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
