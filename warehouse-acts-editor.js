(()=>{
 "use strict";
 const kind=document.body.dataset.documentType;
 if(!["writeoff","sales"].includes(kind))return;
 const typeTitle=kind==="writeoff"?"списания":"реализации";
 const $=s=>document.querySelector(s);
 const esc=x=>String(x??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
 const api="/api/iiko/warehouse-acts";
 const fmt=x=>Number(x||0).toLocaleString("ru-RU",{maximumFractionDigits:3});
 let data=null,busy=false;
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
   <div id="wa-rows"></div>
   <div class="wa-actions"><span id="wa-message" role="status"></span><button type="button" id="wa-draft">Сохранить черновик</button><button type="button" id="wa-process" class="wa-process">Создать и провести в iiko</button></div>
   <div class="wa-hint">Проведение изменяет складской учёт iiko. Для проверки сначала сохраняй черновик. Количество указывается в основных единицах товара.</div>`;
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
 .wa-line{display:grid;grid-template-columns:minmax(180px,2.4fr) 105px ${kind==="sales"?"110px 105px 85px ":""} 36px;gap:8px;align-items:center;margin:6px 0}
 .wa-product-group{min-width:0;display:grid;grid-template-columns:minmax(100px,1fr);gap:5px}
 .wa-editor .wa-product-pick{width:100%;font-size:12px}.wa-editor .wa-product-search{width:100%}
 .wa-line .wa-remove{padding:8px 6px;background:#36212a;border-color:#61414a}
 .wa-actions{display:flex;align-items:center;gap:10px;justify-content:flex-end;margin-top:18px}
 .wa-actions #wa-message{flex:1;color:#98aabb;font-size:12px}
 .wa-actions .wa-process{background:#38c891;border-color:#38c891;color:#0a1c16;font-weight:750}
 .wa-hint{font-size:11px;color:#a0b5bf;margin-top:12px}
 @media(max-width:1000px){.wa-form-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.wa-line{grid-template-columns:1fr 100px ${kind==="sales"?"100px 80px 80px ":""} 36px}}
 @media(max-width:640px){.wa-form-grid{grid-template-columns:1fr}.wa-line{display:flex;flex-wrap:wrap;padding:10px;border:1px solid #354454;border-radius:9px}.wa-product-group{flex-basis:100%}.wa-line>input{flex:1;width:70px}.wa-actions{flex-wrap:wrap}.wa-actions #wa-message{flex-basis:100%}}
 `;
 document.head.appendChild(style);
 function message(v,isError=false){const el=$("#wa-message");if(el){el.textContent=v;el.style.color=isError?"#ffa6a0":"#9ee7c8"}}
 function fill(sel,values,label){
   sel.innerHTML='<option value="">Выберите</option>'+values.map(x=>`<option value="${esc(x.id||x.code)}">${esc(label(x))}</option>`).join("");
 }
 function createLine(item=null){
   if($("#wa-rows").children.length>=250){message("Максимум 250 строк",true);return}
   const row=document.createElement("div");row.className="wa-line";
   row.innerHTML=`<div class="wa-product-group"><input class="wa-product-search" placeholder="Поиск товара по названию" autocomplete="off"><select class="wa-product-pick"><option value="">Выберите товар</option></select></div>
     <input class="wa-qty" type="number" min="0.001" step="any" value="${esc(item?.amount??1)}" title="Количество" aria-label="Количество">
     ${kind==="sales"?'<input class="wa-sum" type="number" min="0" step="0.01" placeholder="Сумма" title="Сумма без скидки" aria-label="Сумма"><input class="wa-discount" type="number" min="0" step="0.01" value="0" title="Скидка" aria-label="Скидка"><input class="wa-vat" type="number" min="0" max="100" step="any" placeholder="НДС %" title="НДС %" aria-label="НДС %">':""}
     <button type="button" class="wa-remove" title="Удалить строку">×</button>`;
   const search=row.querySelector(".wa-product-search"),select=row.querySelector(".wa-product-pick");
   const refresh=()=>{
     const q=search.value.trim().toLowerCase();
     const matches=(data?.products||[]).filter(p=>!q||(p.name+" "+p.code).toLowerCase().includes(q)).slice(0,75);
     const previous=select.value;
     select.innerHTML='<option value="">Выберите товар</option>'+matches.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${p.code?" · "+esc(p.code):""}${p.unit?" ("+esc(p.unit)+")":""}</option>`).join("");
     if(matches.some(x=>x.id===previous))select.value=previous;
   };
   search.addEventListener("input",refresh);
   select.addEventListener("change",()=>{const product=(data?.products||[]).find(x=>x.id===select.value);if(product)search.value=product.name;});
   row.querySelector(".wa-remove").addEventListener("click",()=>row.remove());
   $("#wa-rows").appendChild(row);refresh();
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
   const r=await perform(api,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...body,departmentIds:await deps()})},60000);
   let d;try{d=await r.json()}catch{throw Error("Некорректный ответ сервера: HTTP "+r.status)}
   if(!r.ok||!d.success)throw Error(d.message||"HTTP "+r.status);
   return d;
 }
 async function open(){
   editor.hidden=false;createBtn.disabled=true;message("Загружаем справочники…");
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
     $("#wa-date").value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
     $("#wa-number").value="";
     $("#wa-rows").innerHTML="";
     createLine();message("Выбери склад, счёт и товары.");
   }catch(e){message(e.message,true)}
   finally{createBtn.disabled=false}
 }
 function extractRows(){
   return [...$("#wa-rows").children].map(row=>({
     productId:row.querySelector(".wa-product-pick").value,
     amount:Number(row.querySelector(".wa-qty").value),
     ...(kind==="sales"?{
       sum:Number(row.querySelector(".wa-sum").value),
       discountSum:Number(row.querySelector(".wa-discount").value||0),
       vatPercent:row.querySelector(".wa-vat").value.trim()
     }:{})
   }));
 }
 async function save(status){
   if(busy)return;
   const items=extractRows();
   const doc={
     dateIncoming:$("#wa-date").value,documentNumber:$("#wa-number").value.trim(),
     storeId:$("#wa-store").value,status,items,
     ...(kind==="writeoff"?{accountId:$("#wa-account").value,comment:$("#wa-comment").value}:
       {accountToCode:$("#wa-account-out").value,revenueAccountCode:$("#wa-account-income").value})
   };
   if(!doc.storeId||!items.length||items.some(x=>!x.productId||!(x.amount>0))){
     message("Выбери склад и товары, укажи положительное количество.",true);return;
   }
   if(kind==="sales"&&items.some(x=>!Number.isFinite(x.sum)||x.sum<0)){message("Укажи суммы по всем строкам.",true);return}
   if(status==="PROCESSED"&&!window.confirm("Провести акт в iiko? Это изменит учёт. Подтверждаешь проведение?"))return;
   busy=true;$("#wa-draft").disabled=$("#wa-process").disabled=true;message("Отправляем документ в iiko… Не повторяй отправку.");
   try{
     const response=await send({action:"create",kind,document:doc});
     message(response.message+(response.warning?" "+response.warning:""));
     if(response.registrySaved!==false){
       editor.hidden=true;
       $("#documents-load")?.click();
     }
   }catch(e){message(e.message+" Если ответ сервера оборвался, проверь документ в iiko перед повторной отправкой.",true)}
   finally{busy=false;$("#wa-draft").disabled=$("#wa-process").disabled=false}
 }
 createBtn.addEventListener("click",open);
 $("#wa-close").addEventListener("click",()=>{editor.hidden=true});
 $("#wa-add").addEventListener("click",()=>createLine());
 $("#wa-draft").addEventListener("click",()=>save("NEW"));
 $("#wa-process").addEventListener("click",()=>save("PROCESSED"));
})();
