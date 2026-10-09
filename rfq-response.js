(()=>{"use strict";
const $=id=>document.getElementById(id),num=(v,f=0)=>{const n=Number(v);return Number.isFinite(n)?n:f},esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=v=>num(v).toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2})+" ₼";
const qty=v=>num(v).toLocaleString("ru-RU",{maximumFractionDigits:3});
const token=new URLSearchParams(location.search).get("token")||"";
let rfq=null;

function show(id){["rfq-loading","rfq-error","rfq-success","rfq-form"].forEach(x=>$(x).hidden=x!==id)}
function fail(msg){$("rfq-error-text").textContent=msg||"RFQ недоступен.";show("rfq-error")}
function dateLabel(v){if(!v)return"—";const d=new Date(v+"T00:00:00");return Number.isNaN(d.getTime())?v:d.toLocaleDateString("ru-RU")}
function existingLine(pid){return (rfq?.existing?.lines||[]).find(x=>String(x.productId||"")===String(pid||""))||null}
function renderLines(){
  $("rfq-lines").innerHTML=(rfq.lines||[]).map((l,i)=>{
    const ex=existingLine(l.productId),price=num(ex?.unitPrice),checked=!!ex||!rfq.existing,pc=num(l.packageCount,num(l.quantity)/num(l.packageSize,1));
    return '<tr data-line="'+esc(l.productId)+'" class="'+(checked?'':'offered-off')+'"><td><input class="rfq-check" type="checkbox" data-offer '+(checked?'checked':'')+'></td><td><strong>'+esc(l.productName||l.productId)+'</strong><small>'+(l.packageName?esc(l.packageName)+' · ':'')+qty(l.packageSize)+' '+esc(l.unit||'')+' / упак.</small></td><td><strong>'+qty(pc)+' упак.</strong><small>'+qty(l.quantity)+' '+esc(l.unit||'')+' всего</small></td><td>'+num(l.vatPercent)+'%</td><td><input class="rfq-price" data-price type="number" min="0" step="0.01" value="'+(price||"")+'" placeholder="0.00"></td><td class="rfq-line-total">'+money(checked?pc*price:0)+'</td></tr>';
  }).join("");
  document.querySelectorAll("[data-line]").forEach(row=>{
    const check=row.querySelector("[data-offer]"),price=row.querySelector("[data-price]");
    check.onchange=()=>{row.classList.toggle("offered-off",!check.checked);price.disabled=!check.checked;recalc()};
    price.oninput=recalc;price.disabled=!check.checked;
  });
  recalc();
}
function recalc(){
  let total=0;(rfq.lines||[]).forEach(l=>{
    const row=document.querySelector('[data-line="'+CSS.escape(String(l.productId))+'"]');if(!row)return;
    const on=row.querySelector("[data-offer]").checked,price=num(row.querySelector("[data-price]").value),pc=num(l.packageCount,num(l.quantity)/num(l.packageSize,1)),sum=on?pc*price:0;
    total+=sum;row.querySelector(".rfq-line-total").textContent=money(sum);
  });$("rfq-total").textContent=money(total);return total;
}
async function load(){
  if(!token)return fail("В ссылке отсутствует токен RFQ.");
  try{
    const r=await fetch("/api/procurement-rfq?token="+encodeURIComponent(token),{cache:"no-store"}),j=await r.json().catch(()=>({}));
    if(!r.ok||!j.success)throw Error(j.message||("HTTP "+r.status));
    rfq=j.rfq;
    $("rfq-number").textContent=rfq.number||"RFQ";$("rfq-message").textContent=rfq.message||"Просим предоставить ценовое предложение.";
    $("rfq-deadline").textContent=dateLabel(rfq.deadline);
    $("rfq-restaurant").textContent=(rfq.restaurantNames||[]).join(" · ")||"Smart Horeca";
    $("rfq-requested-by").textContent=rfq.requestedBy||"Smart Horeca";
    $("rfq-supplier").textContent=rfq.supplierName||"—";$("rfq-pr").textContent=rfq.prNumber||"—";$("rfq-warehouse").textContent=rfq.warehouseName||"—";
    if(rfq.existing){$("rfq-delivery-days").value=num(rfq.existing.deliveryDays);$("rfq-payment").value=rfq.existing.paymentTerms||"";$("rfq-valid-until").value=rfq.existing.validUntil||"";$("rfq-comment").value=rfq.existing.comment||""}
    else if(rfq.deadline)$("rfq-valid-until").value=rfq.deadline;
    renderLines();show("rfq-form");
  }catch(e){fail(e.message||String(e))}
}
$("rfq-form").addEventListener("submit",async e=>{
  e.preventDefault();$("rfq-form-status").textContent="";
  const lines=(rfq.lines||[]).map(l=>{
    const row=document.querySelector('[data-line="'+CSS.escape(String(l.productId))+'"]');if(!row||!row.querySelector("[data-offer]").checked)return null;
    const unitPrice=num(row.querySelector("[data-price]").value);return unitPrice>0?{productId:l.productId,unitPrice}:null;
  }).filter(Boolean);
  if(!lines.length){$("rfq-form-status").textContent="Укажите цену хотя бы для одной позиции.";return}
  const btn=$("rfq-submit");btn.disabled=true;btn.textContent="Отправляем…";
  try{
    const r=await fetch("/api/procurement-rfq",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,lines,deliveryDays:num($("rfq-delivery-days").value),validUntil:$("rfq-valid-until").value,paymentTerms:$("rfq-payment").value,comment:$("rfq-comment").value,currency:"AZN"})});
    const j=await r.json().catch(()=>({}));if(!r.ok||!j.success)throw Error(j.message||("HTTP "+r.status));
    $("rfq-success-total").textContent="Итого предложения: "+money(j.totalAmount);show("rfq-success");
  }catch(err){$("rfq-form-status").textContent=err.message||String(err);btn.disabled=false;btn.textContent="Отправить предложение"}
});
load();
})();