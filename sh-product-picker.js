/* Smart Horeca shared product-only picker.
 * Presentation adapter: existing form field retains ID/value and change events.
 * Never changes pricing, pack/quantity calculations, write endpoints or permissions.
 */
(function(root){
 "use strict";
 if(root.SHProductPicker)return;
 const txt=v=>String(v??"").trim();
 const key=v=>txt(v).replace(/^\{+|\}+$/g,"").toLowerCase();
 const css=`
 .sh-pick-wrap{position:relative;width:100%;min-width:0;display:block;box-sizing:border-box}
 .sh-pick-field{width:100%!important;min-width:0!important;box-sizing:border-box!important;background:#0e1823!important;color:#f1f7fc!important;border:1px solid #354556!important;border-radius:8px!important;padding:9px 12px!important;font:inherit!important;outline-offset:2px}
 .sh-pick-field:focus{border-color:#44ad95!important;outline:1px solid #2e8575}
 .sh-pick-field.sh-pick-invalid{border-color:#d4757c!important}
 .sh-pick-list{position:absolute;top:calc(100% + 3px);left:0;right:0;z-index:4000;max-height:244px;overflow-y:auto;box-sizing:border-box;background:#152635;color:#eef6fb;border:1px solid #466476;border-radius:9px;box-shadow:0 12px 32px #000a}
 .sh-pick-list[hidden]{display:none!important}
 .sh-pick-option{width:100%;display:block;text-align:left;border:0!important;border-radius:0!important;background:transparent!important;color:#eaf4f9!important;padding:9px 12px!important;cursor:pointer;font:inherit;font-size:12px!important}
 .sh-pick-option:hover,.sh-pick-option.sh-pick-active{background:#224a58!important}
 .sh-pick-option small{display:block;color:#a8bccc;font-size:10px;font-weight:400;margin-top:3px}
 .sh-pick-empty{padding:11px;color:#b6c7d7;font-size:12px}
 `;
 function installCss(){
   if(!document.getElementById("sh-product-picker-css")){
     const style=document.createElement("style");style.id="sh-product-picker-css";style.textContent=css;document.head.appendChild(style);
   }
 }
 function productFrom(raw,getId,getName,getCode,getUnit){
   return{id:key(getId(raw)),name:txt(getName(raw)),code:txt(getCode(raw)),unit:txt(getUnit(raw)),raw};
 }
 function attach(original,options={}){
   if(!original||!original.parentNode) return null;
   if(original._shProductPicker)return original._shProductPicker;
   installCss();
   const getId=options.getId||((x)=>x?.id);
   const getName=options.getName||((x)=>x?.name||x?.productName);
   const getCode=options.getCode||((x)=>x?.num||x?.code||x?.article||"");
   const getUnit=options.getUnit||((x)=>x?.unit||x?.unitName||x?.mainUnit?.name||"");
   const getProducts=options.getProducts||(()=>options.products||[]);
   const valueFor=options.valueFor||((x)=>x.raw?.id??x.id);
   const originalDisplay=original.style.display,wasRequired=original.required;
   const parent=original.parentNode;
   const wrap=document.createElement("div");wrap.className="sh-pick-wrap";
   const search=document.createElement("input");search.type="text";search.className="sh-pick-field";
   search.autocomplete="off";search.placeholder=options.placeholder||"Поиск товара по названию или артикулу";
   search.setAttribute("role","combobox");search.setAttribute("aria-expanded","false");
   search.setAttribute("aria-label",options.label||"Выберите товар");
   const list=document.createElement("div");list.className="sh-pick-list";list.hidden=true;list.setAttribute("role","listbox");
   wrap.append(search,list);parent.insertBefore(wrap,original.nextSibling);
   original.style.display="none";if(original.required)original.required=false;
   let candidates=[],active=-1,chosenId="",ignoreChange=false;
   const items=()=>{const raw=getProducts();return (Array.isArray(raw)?raw:[]).map(x=>productFrom(x,getId,getName,getCode,getUnit)).filter(x=>x.id&&x.name)};
   const textFor=x=>x.name+(x.code?" · "+x.code:"")+(x.unit?" ("+x.unit+")":"");
   const close=()=>{list.hidden=true;search.setAttribute("aria-expanded","false");active=-1};
   const escape=s=>txt(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
   const byValue=(v,all)=>all.find(p=>key(valueFor(p))===key(v)||p.id===key(v));
   const sync=()=>{
     const all=items(),current=byValue(original.value,all);
     if(current){chosenId=current.id;search.value=textFor(current);search.classList.remove("sh-pick-invalid")}
     else if(!txt(original.value)){chosenId="";search.value="";search.classList.remove("sh-pick-invalid")}
     else if(!options.preserveUnknown){chosenId="";search.value=txt(original.value)}
     return current;
   };
   function choose(item){
     if(!item)return;
     chosenId=item.id;search.value=textFor(item);
     search.classList.remove("sh-pick-invalid");close();
     const value=txt(valueFor(item));
     ignoreChange=true;
     original.value=value;
     original.dispatchEvent(new Event("input",{bubbles:true}));
     original.dispatchEvent(new Event("change",{bubbles:true}));
     ignoreChange=false;
     if(typeof options.onSelect==="function")options.onSelect(item.raw,item.id);
   }
   function show(){
     const words=search.value.toLocaleLowerCase().split(/\s+/).filter(Boolean);
     const selectedItem=items().find(p=>p.id===chosenId);
     const effectiveWords=selectedItem&&search.value===textFor(selectedItem)
       ?selectedItem.name.toLocaleLowerCase().split(/\s+/).filter(Boolean):words;
     const found=items().filter(p=>{
       const s=(p.name+" "+p.code+" "+p.unit).toLocaleLowerCase();
       return effectiveWords.every(w=>s.includes(w));
     }).slice(0,40);
     candidates=found;active=-1;
     list.innerHTML=found.length?found.map((p,i)=>'<button type="button" class="sh-pick-option" role="option" data-index="'+i+'">'+escape(p.name)+(p.code||p.unit?'<small>'+escape([p.code,p.unit].filter(Boolean).join(" · "))+'</small>':"")+'</button>').join("")
       :'<div class="sh-pick-empty">Товар не найден</div>';
     list.hidden=false;search.setAttribute("aria-expanded","true");
   }
   search.addEventListener("focus",show);
   search.addEventListener("input",()=>{
     chosenId="";
     original.value="";
     ignoreChange=true;original.dispatchEvent(new Event("change",{bubbles:true}));ignoreChange=false;
     search.classList.remove("sh-pick-invalid");show();
   });
   search.addEventListener("keydown",e=>{
     if(e.key==="Escape"){close();return}
     if(e.key==="ArrowDown"||e.key==="ArrowUp"){
       e.preventDefault();if(list.hidden)show();
       if(!candidates.length)return;
       active=(active+(e.key==="ArrowDown"?1:-1)+candidates.length)%candidates.length;
       list.querySelectorAll(".sh-pick-option").forEach((b,i)=>b.classList.toggle("sh-pick-active",i===active));
       list.querySelectorAll(".sh-pick-option")[active]?.scrollIntoView({block:"nearest"});
     }else if(e.key==="Enter"&&!list.hidden){
       e.preventDefault();if(candidates.length)choose(candidates[active>=0?active:0]);
     }
   });
   list.addEventListener("pointerdown",e=>{
     const button=e.target.closest("button[data-index]");
     if(!button)return;
     e.preventDefault();
     choose(candidates[Number(button.dataset.index)]);
   });
   search.addEventListener("blur",()=>{
     close();
     if(search.value&&!chosenId)search.classList.add("sh-pick-invalid");
   });
   original.addEventListener("change",()=>{if(!ignoreChange)sync()});
   sync();
   const api={refresh:sync,get selectedId(){return chosenId},get input(){return search},destroy(){
     original.style.display=originalDisplay;original.required=wasRequired;wrap.remove();delete original._shProductPicker;
   }};
   original._shProductPicker=api;
   return api;
 }
 root.SHProductPicker={attach};
})(window);
