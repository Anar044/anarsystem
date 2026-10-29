/* Public QR Menu guest presentation only.
   No POST requests, POS operations, payment, or order creation.
   Basket = local viewing list to show a waiter, not an order. */
(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const state={menu:null,design:null,active:null,qty:1,selected:new Map(),favorites:new Set(),search:''};
  const clean=x=>String(x??'');
  const priceText=(amount,currency)=>new Intl.NumberFormat('ru-RU',{
    minimumFractionDigits:0,maximumFractionDigits:2
  }).format(Number(amount)||0)+' '+clean(currency||'AZN');
  function dish(id){return (state.menu?.dishes||[]).find(d=>clean(d.id)===clean(id)&&d.isAvailable!==false)}
  function setDrawer(open,type){
    const sheet=type==='search'?$('qrSearchOverlay'):$('qrBasketOverlay');
    if(!sheet)return;
    sheet.hidden=!open;document.body.classList.toggle('qr-guest-modal-open',open);
    if(open&&type==='search')$('qrMenuQuery')?.focus();
  }
  function totals(){
    let count=0;
    for(const r of state.selected.values())count+=r.qty;
    const badge=$('qrSelectedCount');if(badge)badge.textContent=String(count);
    const label=$('qrSelectedLabel');if(label)label.textContent=count?'Выбрано':'Ваш выбор';
  }
  function updateFavorites(){
    document.querySelectorAll('[data-qr-fav]').forEach(b=>{
      const active=state.favorites.has(clean(b.dataset.qrFav));
      b.setAttribute('aria-pressed',String(active));
      b.textContent=active?'♥':'♡';
      b.setAttribute('aria-label',active?'Убрать из избранного':'Добавить в избранное');
    });
    const b=$('qrDetailHeart');
    if(b&&state.active){const active=state.favorites.has(clean(state.active.id));b.setAttribute('aria-pressed',String(active));b.textContent=active?'♥':'♡'}
  }
  function toggleFavorite(id){
    id=clean(id);if(state.favorites.has(id))state.favorites.delete(id);else state.favorites.add(id);
    updateFavorites();
  }
  function addItem(id,qty=1){
    const item=dish(id);if(!item)return;
    const k=clean(id),prev=state.selected.get(k)?.qty||0;
    state.selected.set(k,{item,qty:Math.min(99,prev+qty)});
    totals();renderBasket();
  }
  function renderBasket(){
    const host=$('qrBasketItems');if(!host)return;
    const selected=[...state.selected.entries()];
    if(!selected.length){
      host.innerHTML='<p class="qr-search-empty">Пока ничего не выбрано. Нажмите «+» у блюда, чтобы добавить его в список.</p>';
      $('qrBasketTotals').hidden=true;return;
    }
    $('qrBasketTotals').hidden=false;
    const text=v=>clean(v).replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[s]));
    host.innerHTML=selected.map(([id,{item,qty}])=>'<div class="qr-basket-item">'+
      '<div><strong>'+text(item.name)+'</strong><div><span>'+text(priceText(item.price,item.currency))+' за 1</span></div></div>'+
      '<div class="qr-basket-actions"><button type="button" data-qr-minus="'+text(id)+'" aria-label="Уменьшить количество">−</button>'+
      '<strong>'+qty+'</strong><button type="button" data-qr-plus="'+text(id)+'" aria-label="Увеличить количество">+</button></div></div>').join('');
    const currencies=new Set(selected.map(([,row])=>clean(row.item.currency||'AZN')));
    const currency=currencies.size===1?[...currencies][0]:null;
    const total=selected.reduce((sum,[,row])=>sum+Number(row.item.price||0)*row.qty,0);
    $('qrBasketTotal').textContent=currency?priceText(total,currency):'—';
    $('qrBasketNotice').textContent=currency
      ?'Это список выбранных блюд, а не оформленный заказ. Покажите его официанту.'
      :'Выбраны блюда в разных валютах. Сумму уточните у официанта. Заказ не отправлен.';
  }
  function changeItem(id,change){
    const row=state.selected.get(clean(id));if(!row)return;
    const next=row.qty+change;
    if(next<=0)state.selected.delete(clean(id));else row.qty=Math.min(99,next);
    totals();renderBasket();
  }
  function filterMenu(q){
    state.search=clean(q).toLocaleLowerCase('ru-RU').trim();
    let shown=0;
    document.querySelectorAll('#content .qr-dish-grid').forEach(grid=>{
      let visible=0;
      grid.querySelectorAll('.dish').forEach(card=>{
        const name=clean(card.dataset.searchName).toLocaleLowerCase('ru-RU');
        const show=!state.search||name.includes(state.search);
        card.hidden=!show;if(show)visible++;
      });
      grid.hidden=visible===0;shown+=visible;
      const heading=grid.previousElementSibling;
      if(heading?.classList.contains('cat'))heading.hidden=visible===0;
    });
    const empty=$('qrSearchEmpty');if(empty)empty.hidden=shown>0;
  }
  function updateQuantity(){
    if($('qrDetailQty'))$('qrDetailQty').textContent=String(state.qty);
    if($('qrDetailAdd')&&state.active){
      const cost=Number(state.active.price||0)*state.qty;
      $('qrDetailAdd').textContent='Добавить · '+priceText(cost,state.active.currency);
    }
  }
  const api={
    onMenuLoaded(menu,design){
      state.menu=menu||{};state.design=design||{};
      const image=(state.menu.dishes||[]).find(d=>d.isAvailable!==false&&d.photo)?.photo;
      // Presentation fallback only. Never overwrite an uploaded restaurant hero.
      if(!design?.hero&&image){
        const holder=$('heroPhoto');
        if(holder&&!holder.querySelector('img')){
          const img=document.createElement('img');
          img.src=image;img.alt='Блюдо ресторана';img.loading='eager';img.decoding='async';
          img.referrerPolicy='no-referrer';
          holder.appendChild(img);holder.classList.add('show');
        }
      }
      const nav=$('catNav');
      nav?.querySelectorAll('a').forEach((el,index)=>{
        if(index===0)el.classList.add('active');
        el.addEventListener('click',()=>{
          nav.querySelectorAll('a').forEach(a=>a.classList.remove('active'));
          el.classList.add('active');
        });
      });
      updateFavorites();totals();renderBasket();
    },
    onDishOpen(item){
      state.active=item;state.qty=1;
      updateQuantity();updateFavorites();
    },
    onDishClose(){state.active=null;state.qty=1;}
  };
  window.SHQRGuest=api;
  function bind(){
    $('qrSearchOpen')?.addEventListener('click',()=>setDrawer(true,'search'));
    $('qrSearchClose')?.addEventListener('click',()=>setDrawer(false,'search'));
    $('qrBasketOpen')?.addEventListener('click',()=>{renderBasket();setDrawer(true,'basket')});
    $('qrBasketClose')?.addEventListener('click',()=>setDrawer(false,'basket'));
    $('qrMenuQuery')?.addEventListener('input',e=>filterMenu(e.target.value));
    $('qrMenuQuery')?.addEventListener('keydown',e=>{
      if(e.key==='Enter'){setDrawer(false,'search');$('content')?.scrollIntoView({behavior:'smooth',block:'start'})}
    });
    $('qrSearchOverlay')?.addEventListener('click',e=>{if(e.target.id==='qrSearchOverlay')setDrawer(false,'search')});
    $('qrBasketOverlay')?.addEventListener('click',e=>{if(e.target.id==='qrBasketOverlay')setDrawer(false,'basket')});
    $('qrDetailMinus')?.addEventListener('click',()=>{state.qty=Math.max(1,state.qty-1);updateQuantity()});
    $('qrDetailPlus')?.addEventListener('click',()=>{state.qty=Math.min(99,state.qty+1);updateQuantity()});
    $('qrDetailAdd')?.addEventListener('click',()=>{
      if(!state.active)return;addItem(state.active.id,state.qty);
      if(typeof closeDish==='function')closeDish();
    });
    $('qrDetailHeart')?.addEventListener('click',()=>{if(state.active)toggleFavorite(state.active.id)});
    $('qrGuestInfo')?.addEventListener('click',()=>{
      const info=$('aboutBlock');
      if(info&&info.style.display!=='none')info.scrollIntoView({behavior:'smooth',block:'center'});
      else $('footerName')?.scrollIntoView({behavior:'smooth',block:'center'});
    });
    document.addEventListener('click',e=>{
      const fav=e.target.closest?.('[data-qr-fav]');
      const add=e.target.closest?.('[data-qr-add]');
      const minus=e.target.closest?.('[data-qr-minus]');
      const plus=e.target.closest?.('[data-qr-plus]');
      if(!fav&&!add&&!minus&&!plus)return;
      e.preventDefault();e.stopImmediatePropagation();
      if(fav)toggleFavorite(fav.dataset.qrFav);
      else if(add)addItem(add.dataset.qrAdd);
      else if(minus)changeItem(minus.dataset.qrMinus,-1);
      else if(plus)changeItem(plus.dataset.qrPlus,1);
    },true);
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'){setDrawer(false,'search');setDrawer(false,'basket');}
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);
  else bind();
})();
