/* QR Menu editor preview: visual-only video reference layout. No state writes. */
(()=>{
 "use strict";
 const $=id=>document.getElementById(id);
 const price=(n,c)=>new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2}).format(Number(n)||0)+" "+String(c||"AZN");
 function refresh(state){
   if(!state||!Array.isArray(state.categories)||!Array.isArray(state.dishes))return;
   const d=state.design||{};
   const dishes=state.dishes.filter(x=>x.isAvailable!==false);
   const feature=dishes.find(x=>x.photo)||dishes[0];
   const head=$("phoneTop"),hero=$("phoneHero"),screen=$("phoneScreen"),name=$("previewName"),tag=$("previewTagline"),body=$("previewBody");
   if(!head||!hero||!screen||!name||!tag||!body)return;
   // Use the actual configured hero, else a real dish photo. No stock images.
   const photo=d.hero||feature?.photo||"";
   hero.style.display="block";
   hero.style.backgroundImage=photo?'url("'+String(photo).replace(/["\\\n\r]/g,"")+'")':"none";
   hero.style.backgroundColor="#181818";
   hero.dataset.restaurant=d.name||"Мой ресторан";
   head.style.background="#fff";
   head.style.color="#161616";
   screen.style.background="#fff";
   screen.style.color="#161616";
   body.style.background="#fff";
   name.textContent=feature?.name||d.name||"Мой ресторан";
   tag.textContent=d.showPrices!==false&&feature?price(feature.price,feature.currency):"QR Menu";
   let nav=$("shqrPreviewCategories");
   if(!nav){nav=document.createElement("div");nav.id="shqrPreviewCategories";nav.className="shqr-preview-categories";head.insertAdjacentElement("afterend",nav)}
   nav.replaceChildren();
   for(const c of state.categories.filter(c=>dishes.some(x=>String(x.cat)===String(c.id)))){
     const n=document.createElement("span");
     n.textContent=c.name;n.className="shqr-preview-category";nav.append(n);
   }
   if(nav.firstElementChild)nav.firstElementChild.classList.add("current");
   let bar=$("shqrPreviewDock");
   if(!bar){
     bar=document.createElement("div");bar.id="shqrPreviewDock";bar.className="shqr-preview-dock";
     const search=document.createElement("span");search.textContent="⌕";search.className="shqr-preview-round";
     const basket=document.createElement("span");basket.textContent="▣ 0 ₼";basket.className="shqr-preview-pill";
     const menu=document.createElement("span");menu.textContent="⌂";menu.className="shqr-preview-round";
     bar.append(search,basket,menu);screen.append(bar);
   }
   // The preview mirrors public cards, not an order editor.
   for(const card of body.querySelectorAll(".p-item")){
     const picture=card.querySelector(".p-photo");
     if(!picture||picture.querySelector(".shqr-preview-heart"))continue;
     const heart=document.createElement("span");heart.className="shqr-preview-heart";heart.textContent="♡";
     const plus=document.createElement("span");plus.className="shqr-preview-plus";plus.textContent="+";
     picture.append(heart,plus);
   }
 }
 window.SHQRMenuPreviewVideo={refresh};
})();
