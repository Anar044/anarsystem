/* QR guest view, reference video v2. No API calls or order submission.
   "Selected" is an ephemeral reading list to show a waiter, never a placed order. */
(()=>{
  "use strict";
  const $=id=>document.getElementById(id);
  const selected=new Map(),favorites=new Set();
  let dishes=[],design={},active=null,qty=1,controlsReady=false;
  const key=id=>String(id??"");
  const fmt=(num,currency)=>new Intl.NumberFormat("ru-RU",{minimumFractionDigits:0,maximumFractionDigits:2})
    .format(Number(num)||0)+" "+String(currency||"AZN");
  function available(id){return dishes.find(x=>key(x.id)===key(id)&&x.isAvailable!==false)}
  function count(){let n=0;for(const item of selected.values())n+=item.qty;return n}
  function totals(){
    let amount=0;const currencies=new Set();
    for(const {item,qty} of selected.values()){
      amount+=Number(item.price||0)*qty;currencies.add(String(item.currency||"AZN"));
    }
    return{amount,currency:currencies.size===1?[...currencies][0]:null};
  }
  function paintDock(){
    const button=$("floatBasket");if(!button)return;
    const n=count();const sum=totals();
    const label=button.querySelector(".shqr-basket-amount");
    const badge=button.querySelector(".shqr-basket-count");
    if(label)label.textContent=n&&design.showPrices!==false&&sum.currency?fmt(sum.amount,sum.currency):"Ваш выбор";
    if(badge)badge.textContent=String(n);
    button.setAttribute("aria-label",n?"Выбрано блюд: "+n+". Открыть список":"Открыть список выбранных блюд");
  }
  function paintFavorites(){
    for(const btn of document.querySelectorAll(".shqr-fav")){
      const liked=favorites.has(key(btn.dataset.dish));
      btn.setAttribute("aria-pressed",String(liked));
      btn.setAttribute("aria-label",liked?"Убрать из избранного":"Добавить в избранное");
      btn.textContent=liked?"♥":"♡";
    }
    const b=$("shqrDetailFavorite");
    if(b&&active){
      const liked=favorites.has(key(active.id));
      b.setAttribute("aria-pressed",String(liked));
      b.textContent=liked?"♥":"♡";
    }
  }
  function toggleFavorite(id){
    const k=key(id);
    if(favorites.has(k))favorites.delete(k);else favorites.add(k);
    paintFavorites();
  }
  function choose(id,amount=1){
    const item=available(id);if(!item)return;
    const k=key(id);const old=selected.get(k)?.qty||0;
    selected.set(k,{item,qty:Math.min(99,old+amount)});
    paintDock();paintBasket();
  }
  function change(id,delta){
    const k=key(id),row=selected.get(k);if(!row)return;
    const next=row.qty+delta;
    if(next<=0)selected.delete(k);else row.qty=Math.min(99,next);
    paintDock();paintBasket();
  }
  function syncDetailPrice(){
    const amount=$("shqrDetailAdd"),q=$("shqrDetailQty");if(!amount||!active)return;
    q.textContent=String(qty);
    amount.textContent=design.showPrices!==false
      ?"Выбрать · "+fmt((Number(active.price)||0)*qty,active.currency)
      :"Выбрать";
  }
  function detailControls(){
    const card=$("detailOverlay")?.querySelector(".detail-card");
    if(!card||$("shqrDetailAdd"))return;
    card.setAttribute("role","dialog");
    card.setAttribute("aria-modal","true");
    card.setAttribute("aria-labelledby","detailName");
    const heart=document.createElement("button");
    heart.id="shqrDetailFavorite";heart.type="button";heart.className="shqr-detail-heart";
    heart.setAttribute("aria-label","Добавить в избранное");heart.textContent="♡";
    heart.addEventListener("click",()=>{if(active)toggleFavorite(active.id)});
    card.appendChild(heart);
    const wrap=document.createElement("div");wrap.className="shqr-qty";
    wrap.setAttribute("aria-label","Количество выбранных блюд");
    const minus=document.createElement("button");minus.type="button";minus.textContent="−";
    minus.setAttribute("aria-label","Уменьшить количество");
    const val=document.createElement("output");val.id="shqrDetailQty";val.textContent="1";
    val.setAttribute("aria-live","polite");
    const plus=document.createElement("button");plus.type="button";plus.textContent="+";
    plus.setAttribute("aria-label","Увеличить количество");
    minus.onclick=()=>{qty=Math.max(1,qty-1);syncDetailPrice()};
    plus.onclick=()=>{qty=Math.min(99,qty+1);syncDetailPrice()};
    wrap.append(minus,val,plus);
    const select=document.createElement("button");select.id="shqrDetailAdd";
    select.type="button";select.className="shqr-detail-select";
    select.onclick=()=>{
      if(!active)return;
      choose(active.id,qty);
      if(typeof window.SHQRGuestClose==="function")window.SHQRGuestClose();
    };
    const bottom=card.querySelector(".detail-bottom");
    bottom?.append(wrap,select);
  }
  function showBasket(show){
    const overlay=$("shqrBasketOverlay");if(!overlay)return;
    overlay.hidden=!show;document.body.classList.toggle("shqr-modal-open",show);
    if(show)paintBasket();
  }
  function paintBasket(){
    const body=$("shqrBasketItems");if(!body)return;
    body.replaceChildren();
    if(!selected.size){
      const empty=document.createElement("p");empty.className="shqr-basket-note";
      empty.textContent="Пока ничего не выбрано. Нажмите «+» на фотографии блюда.";
      body.appendChild(empty);
    }
    for(const [k,{item,qty:countQty}] of selected){
      const row=document.createElement("div");row.className="shqr-basket-item";
      const info=document.createElement("div");const name=document.createElement("strong");
      name.textContent=item.name||"Блюдо";info.append(name);
      if(design.showPrices!==false){
        const pr=document.createElement("small");pr.textContent=fmt(item.price,item.currency)+" за 1";
        info.append(pr);
      }
      const actions=document.createElement("div");actions.className="shqr-basket-item-actions";
      const minus=document.createElement("button"),plus=document.createElement("button"),q=document.createElement("span");
      minus.type="button";plus.type="button";minus.textContent="−";plus.textContent="+";
      q.textContent=String(countQty);
      minus.setAttribute("aria-label","Уменьшить: "+name.textContent);
      plus.setAttribute("aria-label","Увеличить: "+name.textContent);
      minus.onclick=()=>change(k,-1);plus.onclick=()=>change(k,1);
      actions.append(minus,q,plus);row.append(info,actions);body.append(row);
    }
    const cost=$("shqrBasketCost");const summary=$("shqrBasketSummary"),t=totals();
    if(summary)summary.hidden=!selected.size||design.showPrices===false;
    if(cost)cost.textContent=t.currency?fmt(t.amount,t.currency):"Разные валюты";
  }
  function installBasket(){
    if($("shqrBasketOverlay"))return;
    const overlay=document.createElement("div");
    overlay.id="shqrBasketOverlay";overlay.className="shqr-basket-overlay";overlay.hidden=true;
    const sheet=document.createElement("section");sheet.className="shqr-basket-sheet";
    sheet.setAttribute("role","dialog");sheet.setAttribute("aria-modal","true");
    sheet.setAttribute("aria-labelledby","shqrBasketHeading");
    const head=document.createElement("div");head.className="shqr-basket-head";
    const title=document.createElement("h2");title.id="shqrBasketHeading";title.textContent="Ваш выбор";
    const close=document.createElement("button");close.type="button";close.textContent="×";
    close.setAttribute("aria-label","Закрыть список");close.onclick=()=>showBasket(false);
    head.append(title,close);sheet.append(head);
    const list=document.createElement("div");list.id="shqrBasketItems";list.className="shqr-basket-items";
    sheet.append(list);
    const total=document.createElement("div");total.id="shqrBasketSummary";total.className="shqr-basket-total";
    const totalLabel=document.createElement("span");totalLabel.textContent="Итого выбранного";
    const cost=document.createElement("strong");cost.id="shqrBasketCost";
    total.append(totalLabel,cost);sheet.append(total);
    const note=document.createElement("p");note.className="shqr-basket-note";
    note.textContent="Это список для показа официанту. Заказ не отправляется на кассу и не оформляется автоматически.";
    sheet.append(note);overlay.append(sheet);document.body.append(overlay);
    overlay.addEventListener("click",event=>{if(event.target===overlay)showBasket(false)});
  }
  function installDock(){
    const dock=document.querySelector(".guest-float");if(!dock||$("floatBasket"))return;
    const b=document.createElement("button");b.id="floatBasket";b.type="button";
    const amount=document.createElement("span");amount.className="shqr-basket-amount";amount.textContent="Ваш выбор";
    const countEl=document.createElement("span");countEl.className="shqr-basket-count";countEl.textContent="0";
    b.append(amount,countEl);b.onclick=()=>showBasket(true);
    dock.insertBefore(b,$("floatMenu"));
    const menu=$("floatMenu");menu?.setAttribute("aria-label","Перейти к категориям");
    installBasket();paintDock();
  }
  function installCardButtons(){
    for(const card of document.querySelectorAll("#content .dish")){
      const photo=card.querySelector(".photo");
      if(!photo||photo.querySelector(".shqr-fav"))continue;
      const id=card.dataset.dishId;
      const fav=document.createElement("button"),add=document.createElement("button");
      fav.type="button";fav.className="shqr-fav";fav.dataset.dish=id;
      fav.setAttribute("aria-pressed","false");fav.textContent="♡";
      add.type="button";add.className="shqr-add";add.textContent="+";
      add.setAttribute("aria-label","Добавить блюдо в выбранное");
      fav.addEventListener("click",e=>{e.stopPropagation();toggleFavorite(id)});
      add.addEventListener("click",e=>{e.stopPropagation();choose(id,1)});
      // Keyboard activation of nested controls must not open the dish card.
      for(const b of [fav,add])b.addEventListener("keydown",e=>e.stopPropagation());
      photo.append(fav,add);
    }
    paintFavorites();
  }
  function onLoaded(list,settings){
    dishes=(Array.isArray(list)?list:[]).filter(x=>x.isAvailable!==false);
    design=settings||{};
    installDock();installCardButtons();detailControls();paintDock();
    // The feature image is a genuinely published dish photo, not a stock photo.
  }
  function onDishOpen(item,settings){
    active=item;design=settings||design;qty=1;
    detailControls();syncDetailPrice();paintFavorites();
  }
  function onDishClose(){active=null;qty=1}
  window.SHQRReference={onLoaded,onDishOpen,onDishClose};
  // Read-only basket snapshot consumed by the separate, opt-in ordering module.
  // This reference-video visual layer remains read-only and free of network calls.
  window.SHQRReference.getSelectedItems=()=>[...selected.values()]
    .map(({item,qty})=>({dishId:String(item.id),qty}));
  // Used only after a real QR order is stored, to prevent ordering the same basket twice.
  window.SHQRReference.clearSelectedItems=()=>{selected.clear();paintBasket();paintDock()};

  document.addEventListener("keydown",e=>{if(e.key==="Escape")showBasket(false)});
})();
