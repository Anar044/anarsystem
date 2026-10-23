(()=>{
 "use strict";
 const kind=document.body.dataset.documentType;
 if(!["writeoff","sales"].includes(kind))return;
 const typeTitle=kind==="writeoff"?"списания":"реализации";
 const $=s=>document.querySelector(s);
 const esc=x=>String(x??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
 const api="/api/iiko/warehouse-acts";
 const fmt=x=>Number(x||0).toLocaleString("ru-RU",{maximumFractionDigits:3});
 let data=null,busy=false,writeUncertain=false;
 const createBtn=document.createElement("button");
 createBtn.type="button";createBtn.id="wa-open";createBtn.textContent="+ Новый акт "+typeTitle;
 const toolbar=$(".documents-toolbar");
 toolbar?.insertBefore(createBtn,$("#documents-status"));
 const editor=document.createElement("section");
 editor.id="wa-editor";
 editor.className="wa-editor";
 editor.hidden=true;
 editor.innerHTML=`<div class="wa-head"><strong>Новый акт ${typeTitle}</strong><button type="button" id="wa-close">✕</button></div>
   <div class="wa-form-grid">
     <label>Дата документа <input type="datetime-local" id="wa-date"></label>
     <label>Номер документа <input id="wa-number" maxlength="80" placeholder="Автоматически"></label>
     <label>Склад <select id="wa-store"><option value="">Выберите склад</option></select></label>
     ${kind==="writeoff"?`<label>Счёт списания <select id="wa-account"><option value="">Выберите счёт</option></select></label>`:
     `<label>Расходный счёт <select id="wa-account-out"><option value="">Выберите счёт</option></select></label>
       <label>Счёт выручки <select id="wa-account-income"><option value="">Выберите счёт</option></select></label>`}
     ${kind==="writeoff"?`<label class="wa-full">Комментарий <input id="wa-comment" maxlength="2000" placeholder="Причина списания"></label>`:""}
   </div>
   <div class="wa-items-head"><strong>Товары</strong><button type="button" id="wa-add">+ Добавить строку</button></div>
   <div class="wa-columns"><span>Товар</span><span>Количество</span>${kind==="sales"?"<span>Сумма</span><span>Скидка</span><span>НДС %</span>":""}<span></span></div>
   <div id="wa-rows"></div>
   <div class="wa-actions"><span id="wa-message" role="status"></span><button type="button" id="wa-draft">Сохранить черновик</button><button type="button" id="wa-process" class="wa-process">Создать и провести</button></div>
   <div class="wa-hint">Проведение изменяет складской учёт SH Server. Для проверки сначала сохраняй черновик. Количество указывается в основных единицах товара.</div>`;
 const panel=$(".documents-panel");
 panel?.parentNode.insertBefore(editor,panel);
 const style=document.createElement("style");style.id="wa-form-style";
 style.textContent=`
 .wa-editor{background:#111b25;color:#edf4fa;border:1px solid #263c4c;border-radius:12px;margin:0 0 18px;padding:18px}
 .wa-editor[hidden]{display:none!important}.wa-head,.wa-items-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px}
 .wa-head strong{font-size:17px}.wa-editor button{border:1px solid #2a5361;border-radius:8px;background:#173442;color:#e7f6fd;padding:8px 12px;font-size:12px;cursor:pointer}
 .wa-editor button:hover{background:#1d4a56}.wa-editor button:disabled{opacity:.45;cursor:default}
 .wa-form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:18px}
 .wa-form-grid label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:#a9bacb}
 .wa-form-grid .wa-full{grid-column:1/-1}
 .wa-editor input,.wa-editor select{box-sizing:border-box;background:#0c131b;border:1px solid #354454;color:#f0f7fa;padding:9px;border-radius:8px;min-width:0;width:100%;font:inherit}
 .wa-items-head{border-top:1px solid #273443;padding-top:15px}
 .wa-columns,.wa-line{display:grid;grid-template-columns:minmax(220px,3fr) 105px ${kind==="sales"?"115px 105px 85px ":""} 36px;gap:8px;align-items:center;}
 .wa-columns{font-size:11px;color:#90a7b7;margin:0 0 8px;padding:0 0 7px;border-bottom:1px solid #273443}
 .wa-line{margin:7px 0;min-height:38px}
 .wa-product-group{min-width:0;position:relative}
 .wa-editor .wa-product-search{width:100%;padding:10px 12px}
 .wa-editor .wa-product-search.wa-missing{border-color:#ec817d}
 .wa-suggestions{position:absolute;top:calc(100% + 3px);left:0;right:0;z-index:250;max-height:245px;overflow:auto;background:#152635;border:1px solid #466476;border-radius:8px;box-shadow:0 12px 28px #0009}
 .wa-suggestions[hidden]{display:none!important}
 .wa-editor button.wa-suggestion{width:100%;border:none;border-radius:0;background:transparent;color:#eff7fa;padding:10px 12px;display:block;text-align:left;font-size:13px}
 .wa-editor button.wa-suggestion:hover,.wa-editor button.wa-suggestion.wa-active{background:#1d4e59}
 .wa-suggestion small{display:block;font-size:11px;color:#a4bccb;margin-top:2px}
 .wa-suggestion-empty{padding:11px;color:#a7bccc;font-size:12px}
 .wa-line .wa-remove{padding:8px 6px;background:#36212a;border-color:#61414a}
 .wa-actions{display:flex;align-items:center;gap:10px;justify-content:flex-end;margin-top:18px}
 .wa-actions #wa-message{flex:1;color:#98aabb;font-size:12px}
 .wa-actions .wa-process{background:#38c891;border-color:#38c891;color:#0a1c16;font-weight:750}
 .wa-hint{font-size:11px;color:#a0b5bf;margin-top:12px}
 @media(max-width:1000px){.wa-form-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.wa-columns,.wa-line{grid-template-columns:minmax(180px,2fr) 88px ${kind==="sales"?"95px 78px 68px ":""} 32px;gap:5px}}
 @media(max-width:640px){.wa-form-grid{grid-template-columns:1fr}.wa-columns{display:none}.wa-line{grid-template-columns:minmax(160px,1fr) 80px 30px;gap:7px;padding:8px;border:1px solid #354454;border-radius:8px}.wa-product-group{grid-column:1/-1}.wa-line>input{width:100%}.wa-line .wa-remove{grid-column:3;grid-row:2}.wa-actions{flex-wrap:wrap}.wa-actions #wa-message{flex-basis:100%}}

 `;
 document.head.appendChild(style);
 function message(v,isError=false){const el=$("#wa-message");if(el){el.textContent=v;el.style.color=isError?"#ffa6a0":"#9ee7c8"}}
 function fill(sel,values,label){
   sel.innerHTML='<option value="">Выберите</option>'+values.map(x=>`<option value="${esc(x.id||x.code)}">${esc(label(x))}</option>`).join("");
 }
 function productLabel(p){
   return String(p.name||"Товар")+(p.code?" · "+p.code:"")+(p.unit?" ("+p.unit+")":"");
 }
 function createLine(item=null){
   if($("#wa-rows").children.length>=250){message("Максимум 250 строк",true);return}
   const row=document.createElement("div");row.className="wa-line";
   row.innerHTML=`<div class="wa-product-group"><input class="wa-product-search" placeholder="Поиск товара по названию или артикулу" autocomplete="off" aria-label="Товар" role="combobox" aria-expanded="false"><div class="wa-suggestions" hidden role="listbox"></div></div>
     <input class="wa-qty" type="number" min="0.001" step="any" value="${esc(item?.amount??1)}" placeholder="Кол-во" title="Количество" aria-label="Количество">
     ${kind==="sales"?'<input class="wa-sum" type="number" min="0" step="0.01" placeholder="Сумма" title="Сумма без скидки" aria-label="Сумма"><input class="wa-discount" type="number" min="0" step="0.01" value="0" title="Скидка" aria-label="Скидка"><input class="wa-vat" type="number" min="0" max="100" step="any" placeholder="НДС %" title="НДС %" aria-label="НДС %">':""}
     <button type="button" class="wa-remove" title="Удалить строку" aria-label="Удалить строку">×</button>`;
   row.dataset.productId="";
   const search=row.querySelector(".wa-product-search"),list=row.querySelector(".wa-suggestions");
   let results=[],active=-1;
   const hide=()=>{list.hidden=true;search.setAttribute("aria-expanded","false");active=-1};
   const choose=p=>{
     row.dataset.productId=p.id;
     search.value=productLabel(p);
     search.classList.remove("wa-missing");
     hide();
   };
   const highlight=()=>{
     list.querySelectorAll("button").forEach((x,i)=>x.classList.toggle("wa-active",i===active));
     if(active>=0)list.querySelectorAll("button")[active]?.scrollIntoView({block:"nearest"});
   };
   function suggest(){
     for(const other of $("#wa-rows").querySelectorAll(".wa-suggestions"))if(other!==list)other.hidden=true;
     const needle=search.value.trim().toLocaleLowerCase();
     const tokens=needle.split(/\\s+/).filter(Boolean);
     results=(data?.products||[]).filter(p=>{
       const label=(p.name+" "+p.code+" "+(p.unit||"")).toLocaleLowerCase();
       return tokens.every(token=>label.includes(token));
     }).slice(0,40);
     list.innerHTML=results.length?results.map((p,i)=>`<button type="button" class="wa-suggestion" data-index="${i}" role="option">${esc(p.name)}${p.code?"<small>"+esc(p.code)+(p.unit?" · "+esc(p.unit):"")+"</small>":p.unit?"<small>"+esc(p.unit)+"</small>":""}</button>`).join("")
       :'<div class="wa-suggestion-empty">Товар не найден</div>';
     list.hidden=false;search.setAttribute("aria-expanded","true");active=-1;
   }
   search.addEventListener("focus",suggest);
   search.addEventListener("input",()=>{row.dataset.productId="";search.classList.remove("wa-missing");suggest()});
   search.addEventListener("keydown",e=>{
     if(e.key==="Escape"){hide();return}
     if(e.key==="ArrowDown"||e.key==="ArrowUp"){
       e.preventDefault();if(list.hidden)suggest();
       active=(active+(e.key==="ArrowDown"?1:-1)+results.length)%Math.max(1,results.length);highlight();
     } else if(e.key==="Enter"&&!list.hidden&&results.length){
       e.preventDefault();choose(results[active>=0?active:0]);
     }
   });
   list.addEventListener("pointerdown",e=>{
     const button=e.target.closest("button[data-index]");
     if(!button)return;
     e.preventDefault();
     const product=results[Number(button.dataset.index)];
     if(product)choose(product);
   });
   search.addEventListener("blur",()=>{hide();if(!row.dataset.productId&&search.value.trim())search.classList.add("wa-missing")});
   row.querySelector(".wa-remove").addEventListener("click",()=>row.remove());
   $("#wa-rows").appendChild(row);
   if(item?.productId){
     const product=(data?.products||[]).find(p=>p.id===item.productId);
     if(product)choose(product);
   }
 }
 async function deps(){
   try{
     if(window.SH_IikoContext?.getBinding){
       const b=await window.SH_IikoContext.getBinding();
       if(Array.isArray(b?.departmentIds))return b.departmentIds.map(String).filter(Boolean);
     }
     const state=await window.SH_IikoContext?.get?.();
     return window.SH_IikoContext?.departmentIds?.(state)||[];
   }catch{return[]}
 }
 const perform=(window.SH_IikoContext?.fetchWithTimeout||fetch).bind(window.SH_IikoContext?.fetchWithTimeout?window.SH_IikoContext:window);
 async function send(body){
   let r;
   try{
     r=await perform(api,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...body,departmentIds:await deps()})},90000);
   }catch(e){
     const err=new Error(body.action==="create"
       ?"Нет ответа от Smart Horeca. Неизвестно, получен ли документ сервером. Проверь список документов перед повторной отправкой."
       :"Нет связи со Smart Horeca: "+String(e?.message||"сетевая ошибка"));
     err.resultUnknown=body.action==="create";
     throw err;
   }
   let d;
   try{d=await r.json()}catch{
     const err=new Error("Некорректный ответ Smart Horeca: HTTP "+r.status);
     err.resultUnknown=body.action==="create";
     throw err;
   }
   if(!r.ok||!d.success){
     const err=new Error(d.message||"HTTP "+r.status);
     err.resultUnknown=Boolean(d.resultUnknown);
     err.code=d.code||"";
     throw err;
   }
   return d;
 }
 async function open(){
   editor.hidden=false;createBtn.disabled=true;writeUncertain=false;
   $("#wa-draft").disabled=$("#wa-process").disabled=false;
   message("Загружаем справочники…");
   $("#wa-date").value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
   try{
     data=await send({kind,action:"bootstrap"});
     if(!data.stores?.length)throw Error("Нет складов для выбранного ресторана.");
     fill($("#wa-store"),data.stores,x=>x.name);
     if(kind==="writeoff")fill($("#wa-account"),data.accounts,x=>[x.code,x.name].filter(Boolean).join(" · "));
     else{
       const validAccounts=data.accounts.filter(x=>x.code);
       fill($("#wa-account-out"),validAccounts.map(x=>({...x,id:x.code})),x=>x.code+" · "+x.name);
       fill($("#wa-account-income"),validAccounts.map(x=>({...x,id:x.code})),x=>x.code+" · "+x.name);
     }
     $("#wa-number").value="";
     $("#wa-rows").innerHTML="";
     createLine();message("Выбери склад, счёт и товары.");
   }catch(e){message(e.message,true)}
   finally{createBtn.disabled=false}
 }
 function extractRows(){
   return [...$("#wa-rows").children].map(row=>({
     productId:row.dataset.productId||"",
     amount:Number(row.querySelector(".wa-qty").value),
     ...(kind==="sales"?{
       sum:row.querySelector(".wa-sum").value.trim()===""?null:Number(row.querySelector(".wa-sum").value),
       discountSum:Number(row.querySelector(".wa-discount").value||0),
       vatPercent:row.querySelector(".wa-vat").value.trim()
     }:{})
   }));
 }
 async function save(status){
   if(busy||writeUncertain)return;
   const items=extractRows();
   const doc={
     dateIncoming:$("#wa-date").value,documentNumber:$("#wa-number").value.trim(),
     storeId:$("#wa-store").value,status,items,
     ...(kind==="writeoff"?{accountId:$("#wa-account").value,comment:$("#wa-comment").value}:
       {accountToCode:$("#wa-account-out").value,revenueAccountCode:$("#wa-account-income").value})
   };
   if(!doc.storeId||!items.length||items.some(x=>!x.productId||!(x.amount>0))){
     message("Выбери склад и товары из подсказок, укажи положительное количество.",true);return;
   }
   if(kind==="sales"&&items.some(x=>!Number.isFinite(x.sum)||x.sum<0)){message("Укажи суммы по всем строкам.",true);return}
   if(status==="PROCESSED"&&!window.confirm("Провести акт? Это изменит учёт. Подтверждаешь проведение?"))return;
   busy=true;$("#wa-draft").disabled=$("#wa-process").disabled=true;message("Отправляем документ на SH Server… Не повторяй отправку.");
   try{
     const response=await send({action:"create",kind,document:doc});
     message(response.message+(response.warning?" "+response.warning:""));
     if(response.registrySaved!==false){
       editor.hidden=true;
       $("#documents-load")?.click();
     }
   }catch(e){
     if(e.resultUnknown){
       writeUncertain=true;
       message(e.message+" Сохранение заблокировано до проверки, чтобы не создать дубликат. Список документов обновлён.",true);
       $("#documents-load")?.click();
     }else message(e.message,true);
   }finally{
     busy=false;
     $("#wa-draft").disabled=$("#wa-process").disabled=writeUncertain;
   }
 }
 createBtn.addEventListener("click",open);
 $("#wa-close").addEventListener("click",()=>{editor.hidden=true});
 $("#wa-add").addEventListener("click",()=>createLine());
 $("#wa-draft").addEventListener("click",()=>save("NEW"));
 $("#wa-process").addEventListener("click",()=>save("PROCESSED"));
})();
