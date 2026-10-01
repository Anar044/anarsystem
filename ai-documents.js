(()=>{
'use strict';
const $=id=>document.getElementById(id);
let documents=[],current=null,refs=null,chosenFile=null,previewUrl='',previewKind='',previewZoom=100,previewFitMode=true;
const activeProcessPolls=new Map();
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
const moneyCents=v=>{const n=Number(v);return Number.isFinite(n)?Math.round(n*100):null};
const today=()=>new Date().toISOString().slice(0,10);
function autoDocumentNumber(){const d=new Date(),p=n=>String(n).padStart(2,'0');return 'SH-AI-'+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds())}
const statusText={UPLOADED:'Загружен',PROCESSING:'Обработка',READY:'Готов',REVIEW:'Проверить',ERROR:'Ошибка',IMPORTED:'Импортирован'};
async function token(){const client=await window.SHAuth?.createClient?.();if(!client)throw new Error('Supabase Auth не готов');const{data,error}=await client.auth.getSession();const t=data?.session?.access_token;if(error||!t)throw new Error('Сессия пользователя не найдена');return t}
async function aiGet(query=''){const t=await token();const r=await fetch('/api/ai-documents'+query,{headers:{Authorization:`Bearer ${t}`}});const j=await r.json().catch(()=>({success:false,message:'Некорректный ответ API'}));if(!r.ok||!j.success)throw new Error(j.message||`HTTP ${r.status}`);return j}
async function aiPost(body){const t=await token();const r=await fetch('/api/ai-documents',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${t}`},body:JSON.stringify(body)});const j=await r.json().catch(()=>({success:false,message:'Некорректный ответ API'}));if(!r.ok||!j.success)throw new Error(j.message||j.document?.errorMessage||`HTTP ${r.status}`);return j}
async function connection(){if(!window.SH_IikoContext?.get)throw new Error('Контекст iiko не загружен');const s=await window.SH_IikoContext.get();const c=s?.connection;if(!c?.ip||!c?.port||!c?.login||!c?.password)throw new Error('Нет подключения к iiko Server');return c}
async function loadRefs(){if(refs)return refs;const c=await connection();const r=await fetch('/api/iiko/invoice-reference-data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({connection:c}),cache:'no-store'});const j=await r.json().catch(()=>({}));if(!r.ok||j.success===false)throw new Error(j.message||`HTTP ${r.status}`);refs={suppliers:j.suppliers||[],warehouses:j.warehouses||[],products:j.products||[]};return refs}
function providerStatus(p){const o=p?.openai,l=p?.local;const parts=[`OpenAI: ${o?.configured?'готов':'не настроен'}`,`Local AI: ${l?.configured?'готов':'не настроен'}`];$('providerState').textContent=parts.join(' · ');$('providerState').className='aid-provider-state '+(o?.configured||l?.configured?'ok':'warn')}
function renderList(){const host=$('documentList');$('docCount').textContent=documents.length;$('documentEmpty').hidden=documents.length>0;host.innerHTML=documents.map(d=>`<button class="aid-doc ${current?.id===d.id?'active':''}" data-id="${esc(d.id)}"><div class="aid-doc-top"><span class="aid-doc-name">${esc(d.fileName)}</span><span class="aid-badge ${esc(d.status)}">${esc(statusText[d.status]||d.status)}</span></div><div class="aid-doc-meta"><span>${esc(d.supplierName||d.documentType||'Не распознано')}</span><span>${esc((d.createdAt||'').slice(0,16).replace('T',' '))}</span></div></button>`).join('');host.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>selectDocument(b.dataset.id))}
function setUploadStatus(text,kind=''){$('uploadStatus').textContent=text||'';$('uploadStatus').className='aid-progress '+kind}
function setReviewStatus(text,kind=''){$('reviewStatus').textContent=text||'';$('reviewStatus').className='aid-review-status '+kind}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function processStageText(job){
  const stage=String(job?.stage||'').toLowerCase(),progress=Number(job?.progress||0);
  const suffix=progress>0&&progress<100?' · '+progress+'%':'';
  if(stage==='queued')return 'Документ поставлен в очередь…';
  if(stage==='paddleocr')return 'PaddleOCR распознаёт документ'+suffix;
  if(stage==='easyocr')return 'EasyOCR проверяет сложный документ'+suffix;
  if(stage==='ollama')return 'Локальная AI-модель структурирует данные'+suffix;
  if(stage==='finalizing')return 'OCR завершён. Подготавливаем результат…';
  if(stage==='matching')return 'OCR завершён. Сопоставляем данные с iiko…';
  if(stage==='done')return 'Распознавание завершено.';
  return 'Local AI обрабатывает документ'+suffix;
}
function mergeDocument(doc){
  if(!doc?.id)return;
  const index=documents.findIndex(x=>x.id===doc.id);
  if(index>=0)documents[index]=doc;else documents.unshift(doc);
  if(current?.id===doc.id)current=doc;
  renderList();
}
async function pollDocumentProcess(docId,{review=false}={}){
  if(activeProcessPolls.has(docId))return activeProcessPolls.get(docId);
  const promise=(async()=>{
    for(let attempt=0;attempt<360;attempt++){
      const j=await aiPost({action:'pollProcess',id:docId});
      if(j.document)mergeDocument(j.document);
      const message=processStageText(j.job);
      if(review)setReviewStatus(message,j.document?.status==='ERROR'?'error':'');
      else setUploadStatus(message,j.document?.status==='ERROR'?'error':'');
      if(!j.processing){
        if(j.document?.status==='ERROR')throw new Error(j.document.errorMessage||j.message||'Local AI завершил задачу с ошибкой.');
        return j;
      }
      await wait(2000);
    }
    throw new Error('Local AI слишком долго обрабатывает документ. Задача продолжает выполняться; обновите список позже.');
  })();
  activeProcessPolls.set(docId,promise);
  try{return await promise}finally{activeProcessPolls.delete(docId)}
}
async function startDocumentProcess(docId,provider,{review=false}={}){
  const started=await aiPost({action:'process',id:docId,provider});
  if(started.document)mergeDocument(started.document);
  if(started.processing||started.async)return pollDocumentProcess(docId,{review});
  return started;
}
function resumePendingProcesses(){
  documents.filter(d=>d.status==='PROCESSING').forEach(d=>{
    pollDocumentProcess(d.id,{review:current?.id===d.id})
      .then(()=>loadAll(current?.id||d.id))
      .catch(error=>setUploadStatus(error.message||String(error),'error'));
  });
}
async function loadAll(selectId){
  const j=await aiGet();
  documents=j.documents||[];
  providerStatus(j.providers);
  renderList();
  if(selectId){
    const d=documents.find(x=>x.id===selectId);
    if(d&&d.status!=='PROCESSING')await selectDocument(d.id);
  }
  resumePendingProcesses();
}
function selectOptions(rows,selected,placeholder){return `<option value="">${esc(placeholder)}</option>`+rows.map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(selected)?'selected':''}>${esc(x.name)}</option>`).join('')}
async function loadPreview(doc){
  if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=''}
  const t=await token();
  const r=await fetch('/api/ai-documents?file='+encodeURIComponent(doc.id),{headers:{Authorization:`Bearer ${t}`}});
  if(!r.ok){$('filePreview').innerHTML='<div class="aid-empty">Не удалось открыть оригинал</div>';return}
  const blob=await r.blob();
  previewUrl=URL.createObjectURL(blob);
  previewKind=String(doc.contentType||'').startsWith('image/')?'image':'pdf';
  previewZoom=100;
  previewFitMode=true;
  if(previewKind==='image') $('filePreview').innerHTML=`<img src="${previewUrl}" alt="Оригинал документа">`;
  else $('filePreview').innerHTML=`<iframe src="${previewUrl}#zoom=page-width" title="Документ"></iframe>`;
  applyPreviewZoom();
}

function applyPreviewZoom(){
  const host=$('filePreview');
  const label=$('previewZoomLabel');
  const fit=$('previewFit');
  const hundred=$('previewZoom100');
  if(!host)return;
  if(label)label.textContent=previewFitMode?'По ширине':previewZoom+'%';
  if(fit)fit.classList.toggle('active',previewFitMode);
  if(hundred)hundred.classList.toggle('active',!previewFitMode&&previewZoom===100);
  if(previewKind==='image'){
    const img=host.querySelector('img');
    if(!img)return;
    img.style.width=previewFitMode?'100%':previewZoom+'%';
    img.style.maxWidth='none';
  }else if(previewKind==='pdf'){
    const frame=host.querySelector('iframe');
    if(!frame||!previewUrl)return;
    const next=previewFitMode?previewUrl+'#zoom=page-width':previewUrl+'#zoom='+previewZoom;
    if(frame.src!==next)frame.src=next;
  }
}
function setPreviewZoom(value){
  previewFitMode=false;
  previewZoom=Math.max(50,Math.min(250,Math.round(value/25)*25));
  applyPreviewZoom();
}
function setListCollapsed(value,persist=true){
  const layout=document.querySelector('.aid-layout'),card=document.querySelector('.aid-list-card'),btn=$('listToggleBtn');
  if(!layout||!card||!btn)return;
  const collapsed=Boolean(value)&&window.innerWidth>1100;
  layout.classList.toggle('list-collapsed',collapsed);
  card.classList.toggle('collapsed',collapsed);
  btn.textContent=collapsed?'›':'‹';
  btn.title=collapsed?'Развернуть список документов':'Свернуть список документов';
  btn.setAttribute('aria-label',btn.title);
  if(persist){try{localStorage.setItem('shAiDocumentListCollapsed',collapsed?'1':'0')}catch(e){}}
}
function bindReviewWorkspace(){
  $('previewZoomOut').onclick=()=>setPreviewZoom(previewFitMode?75:previewZoom-25);
  $('previewZoomIn').onclick=()=>setPreviewZoom(previewFitMode?125:previewZoom+25);
  $('previewZoom100').onclick=()=>setPreviewZoom(100);
  $('previewFit').onclick=()=>{previewFitMode=true;applyPreviewZoom()};
  $('previewFullscreen').onclick=async()=>{
    const pane=$('previewPane');
    if(!pane)return;
    try{
      if(document.fullscreenElement)await document.exitFullscreen();
      else await pane.requestFullscreen();
    }catch(e){setReviewStatus('Браузер не разрешил полноэкранный режим.','error')}
  };
  document.addEventListener('fullscreenchange',()=>{
    const btn=$('previewFullscreen');
    if(btn)btn.textContent=document.fullscreenElement?'×':'⛶';
    if(btn)btn.title=document.fullscreenElement?'Выйти из полноэкранного режима':'На весь экран';
  });

  let dragging=false;
  const splitter=$('reviewSplitter'),grid=document.querySelector('.aid-review-grid');
  if(splitter&&grid){
    splitter.addEventListener('pointerdown',e=>{
      if(window.innerWidth<=1100)return;
      dragging=true;
      splitter.classList.add('dragging');
      splitter.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
    splitter.addEventListener('pointermove',e=>{
      if(!dragging||window.innerWidth<=1100)return;
      const rect=grid.getBoundingClientRect(),minPreview=480,minData=430,gap=7;
      const maxPreview=Math.max(minPreview,rect.width-minData-gap);
      const width=Math.max(minPreview,Math.min(maxPreview,e.clientX-rect.left));
      grid.style.setProperty('--aid-preview-width',width+'px');
    });
    const stop=()=>{dragging=false;splitter.classList.remove('dragging')};
    splitter.addEventListener('pointerup',stop);
    splitter.addEventListener('pointercancel',stop);
    splitter.addEventListener('dblclick',()=>grid.style.removeProperty('--aid-preview-width'));
  }

  $('listToggleBtn').onclick=()=>{
    const layout=document.querySelector('.aid-layout');
    setListCollapsed(!layout?.classList.contains('list-collapsed'));
  };
  let saved=false;
  try{saved=localStorage.getItem('shAiDocumentListCollapsed')==='1'}catch(e){}
  setListCollapsed(saved,false);
  window.addEventListener('resize',()=>{if(window.innerWidth<=1100)setListCollapsed(false,false)});
}

function confirmedDraft(){return current?.result?.confirmedDraft||null}
function currentMatching(){
  const base=current?.result?.matching||{};
  const draft=confirmedDraft();
  if(!draft?.items?.length)return base;
  return {
    ...base,
    supplierId:draft.supplierId||base.supplierId||null,
    defaultStoreId:draft.defaultStore||base.defaultStoreId||null,
    storeSelectionRequired:false,
    items:draft.items.map((x,i)=>({
      ...(base.items?.[i]||{}),
      index:i+1,
      sourceName:x.sourceName||base.items?.[i]?.sourceName||'',
      productId:x.productId||null,
      productName:x.productName||null,
      quantity:Number.isFinite(Number(x.amount))?Number(x.amount):null,
      unitPrice:Number.isFinite(Number(x.price))?Number(x.price):null,
      total:Number.isFinite(Number(x.sum))?Number(x.sum):null
    }))
  };
}
function candidateButtons(item){
  if(item?.productId)return '';
  const candidates=(Array.isArray(item?.candidates)?item.candidates:[])
    .filter(x=>x?.id&&x?.name&&Number(x.score||0)>=.28)
    .slice(0,3);
  if(!candidates.length)return '<div class="aid-match-warn">Похожих товаров не найдено — выберите товар вручную.</div>';
  return '<div class="aid-suggestions"><span>Возможно, вы имели в виду:</span><div class="aid-suggestion-list">'+
    candidates.map(x=>'<button type="button" class="aid-suggestion" data-product-id="'+esc(x.id)+'" title="Сходство '+Math.round(Number(x.score||0)*100)+'%">'+esc(x.name)+'</button>').join('')+
    '</div></div>';
}
function renderItems(){
  const m=currentMatching(),items=Array.isArray(m.items)?m.items:[],host=$('draftItems');
  host.innerHTML=items.map((x,i)=>{
    const opts=selectOptions(refs?.products||[],x.productId,'Выберите товар iiko');
    return '<div class="aid-item" data-index="'+i+'">'+
      '<div class="aid-source-wrap"><label>Из документа</label><div class="source">'+esc(x.sourceName||'—')+'</div>'+
      (!x.productId?'<div class="aid-match-warn">Нужно сопоставить товар</div>':'')+
      candidateButtons(x)+'</div>'+
      '<div class="aid-product-wrap"><label>Товар iiko<select data-f="product">'+opts+'</select></label></div>'+
      '<label class="aid-qty-wrap">Кол-во<input data-f="quantity" type="number" step="0.001" value="'+esc(x.quantity??'')+'"></label>'+
      '<label class="aid-price-wrap">Цена<input data-f="price" type="number" step="0.01" value="'+esc(x.unitPrice??'')+'"></label>'+
      '<label class="aid-sum-wrap">Сумма<input data-f="sum" type="number" step="0.01" value="'+esc(x.total??'')+'"></label>'+
    '</div>';
  }).join('');
  host.querySelectorAll('.aid-item').forEach(row=>{
    const qi=row.querySelector('[data-f="quantity"]'),pi=row.querySelector('[data-f="price"]'),si=row.querySelector('[data-f="sum"]'),sel=row.querySelector('[data-f="product"]');
    const recalc=()=>{const q=Number(qi.value||0),p=Number(pi.value||0);si.value=(q*p).toFixed(2);recalcTotal()};
    qi.oninput=recalc;pi.oninput=recalc;si.oninput=recalcTotal;
    sel.onchange=()=>rememberAlias(row).catch(console.error);
    row.querySelectorAll('.aid-suggestion').forEach(btn=>btn.onclick=()=>{
      sel.value=btn.dataset.productId||'';
      sel.dispatchEvent(new Event('change',{bubbles:true}));
      row.querySelectorAll('.aid-suggestion').forEach(x=>x.classList.toggle('selected',x===btn));
    });
  });
  recalcTotal();
}
function validateDraftArithmetic(){
  const rows=[...document.querySelectorAll('.aid-item')];
  const issues=[];
  let sourceRowsCents=0,calculatedCents=0,complete=true;

  rows.forEach((row,i)=>{
    const q=Number(row.querySelector('[data-f="quantity"]')?.value);
    const p=Number(row.querySelector('[data-f="price"]')?.value);
    const sumCents=moneyCents(row.querySelector('[data-f="sum"]')?.value);
    row.classList.remove('arithmetic-error');

    if(!Number.isFinite(q)||!Number.isFinite(p)||sumCents===null){
      complete=false;
      return;
    }

    const expected=Math.round(q*p*100);
    sourceRowsCents+=sumCents;
    calculatedCents+=expected;
    if(sumCents!==expected){
      row.classList.add('arithmetic-error');
      const name=row.querySelector('.source')?.textContent?.trim()||('Строка '+(i+1));
      issues.push(name+': '+money(q)+' × '+money(p)+' = '+money(expected/100)+', а сумма строки '+money(sumCents/100));
    }
  });

  const declaredCents=moneyCents($('draftDeclaredTotal')?.value);
  if(declaredCents!==null&&complete){
    if(declaredCents!==calculatedCents){
      issues.push('Итого документа '+money(declaredCents/100)+', расчёт по количеству и цене '+money(calculatedCents/100));
    }
    if(declaredCents!==sourceRowsCents){
      issues.push('Итого документа '+money(declaredCents/100)+', сумма строк '+money(sourceRowsCents/100));
    }
  }

  const warning=$('arithmeticWarning');
  if(warning){
    warning.hidden=issues.length===0;
    const canFixDeclared=
      issues.length>0 &&
      rows.every(row=>!row.classList.contains('arithmetic-error')) &&
      declaredCents!==null &&
      complete &&
      declaredCents!==calculatedCents;

    warning.innerHTML=issues.length
      ? '<strong>⚠️ Арифметическое расхождение. Сохранение заблокировано.</strong><ul>'+
        issues.map(x=>'<li>'+esc(x)+'</li>').join('')+
        '</ul>'+
        (canFixDeclared
          ? '<button type="button" id="applyCalculatedTotal" class="aid-fix-total">Исправить итог на '+esc(money(calculatedCents/100))+' ₼</button>'
          : '')
      : '';

    const fixBtn=$('applyCalculatedTotal');
    if(fixBtn){
      fixBtn.onclick=()=>{
        $('draftDeclaredTotal').value=(calculatedCents/100).toFixed(2);
        recalcTotal();
        setReviewStatus('Итог документа исправлен по расчёту строк.','ok');
      };
    }
  }

  const imported=current?.status==='IMPORTED';
  const blocked=issues.length>0;
  $('saveDraftBtn').disabled=imported||blocked;
  $('saveProcessBtn').disabled=imported||blocked;

  return {
    valid:!blocked,
    issues,
    documentTotal:declaredCents===null?null:declaredCents/100,
    rowsTotal:sourceRowsCents/100,
    calculatedTotal:calculatedCents/100
  };
}
function recalcTotal(){
  const rows=[...document.querySelectorAll('.aid-item')];
  const rowTotal=rows.reduce((s,row)=>s+Number(row.querySelector('[data-f="sum"]')?.value||0),0);
  const calcTotal=rows.reduce((s,row)=>{
    const q=Number(row.querySelector('[data-f="quantity"]')?.value||0);
    const p=Number(row.querySelector('[data-f="price"]')?.value||0);
    return s+q*p;
  },0);
  $('draftTotal').textContent=money(rowTotal)+' ₼'+(moneyCents(rowTotal)!==moneyCents(calcTotal)?' · расчёт '+money(calcTotal)+' ₼':'');
  validateDraftArithmetic();
}
async function rememberAlias(row){if(!current)return;const i=Number(row.dataset.index),item=currentMatching().items?.[i],sel=row.querySelector('[data-f="product"]');const product=(refs?.products||[]).find(x=>String(x.id)===String(sel.value));if(!item?.sourceName||!product)return;await aiPost({action:'saveAlias',sourceName:item.sourceName,productId:product.id,productName:product.name,supplierId:$('draftSupplier').value})}
async function fillReview(doc){await loadRefs();current=doc;renderList();$('reviewEmpty').hidden=true;$('reviewContent').hidden=false;$('reviewTitle').textContent=doc.fileName;$('reviewMeta').textContent=(statusText[doc.status]||doc.status)+(doc.providerUsed?' · '+doc.providerUsed+(doc.model?' / '+doc.model:''):'');const raw=doc.result?.extracted||{},saved=doc.result?.confirmedDraft||null,m=currentMatching();$('draftNumber').value=saved?.documentNumber||raw.documentNumber||doc.documentNumber||autoDocumentNumber();$('draftDate').value=String(saved?.dateIncoming||raw.date||doc.documentDate||today()).slice(0,10);$('draftSupplier').innerHTML=selectOptions(refs.suppliers,saved?.supplierId||m.supplierId||doc.supplierId,'Выберите поставщика');const trustedStore=saved?.defaultStore||(m.storeSelectionRequired===false?m.defaultStoreId:'');$('draftStore').innerHTML=selectOptions(refs.warehouses,trustedStore,'Выберите склад');$('draftInvoice').value=saved?.invoice||raw.invoiceNumber||doc.invoiceNumber||'';$('draftIncoming').value=saved?.incomingDocumentNumber||raw.incomingNumber||doc.incomingNumber||raw.invoiceNumber||doc.invoiceNumber||'';$('draftDue').value=String(saved?.dueDate||raw.dueDate||doc.dueDate||'').slice(0,10);$('draftCurrency').value=raw.currency||doc.currency||'AZN';const savedTotal=saved?.documentTotal;$('draftDeclaredTotal').value=Number.isFinite(Number(savedTotal))?Number(savedTotal).toFixed(2):(Number.isFinite(Number(raw.total))?Number(raw.total).toFixed(2):'');$('draftDeclaredTotal').oninput=recalcTotal;renderItems();const arithmetic=validateDraftArithmetic();if(doc.status==='ERROR')setReviewStatus(doc.errorMessage||'Ошибка AI','error');else if(doc.status==='IMPORTED')setReviewStatus('Документ уже импортирован в iiko'+(doc.result?.imported?.documentNumber?' · № '+doc.result.imported.documentNumber:''),'ok');else if(!arithmetic.valid)setReviewStatus('Обнаружено арифметическое расхождение. Исправьте данные перед сохранением.','error');else if(m.ready)setReviewStatus('Все обязательные данные сопоставлены. Можно создавать накладную в iiko.','ok');else setReviewStatus('Проверьте поставщика, склад и строки, отмеченные как несопоставленные.','');await loadPreview(doc)}
async function selectDocument(id){const d=documents.find(x=>x.id===id);if(!d)return;await fillReview(d)}
async function uploadAndProcess(){
  if(!chosenFile)throw new Error('Сначала выберите PDF или фото.');
  const provider=$('providerSelect').value,t=await token(),form=new FormData();
  form.set('file',chosenFile,chosenFile.name);form.set('provider',provider);
  $('uploadBtn').disabled=true;setUploadStatus('Загружаем документ…');
  try{
    const r=await fetch('/api/ai-documents',{method:'POST',headers:{Authorization:`Bearer ${t}`},body:form});
    const up=await r.json().catch(()=>({}));
    if(!r.ok||!up.success)throw new Error(up.message||`HTTP ${r.status}`);
    setUploadStatus('Запускаем Local AI…');
    const processed=await startDocumentProcess(up.document.id,provider);
    chosenFile=null;$('fileInput').value='';
    setUploadStatus(processed.document.status==='READY'?'Распознано и сопоставлено.':'Распознано. Требуется проверка.','success');
    await loadAll(up.document.id);
  }finally{$('uploadBtn').disabled=false}
}
async function reprocess(){
  if(!current)return;
  const id=current.id;
  setReviewStatus('Запускаем повторное распознавание…');
  const j=await startDocumentProcess(id,$('providerSelect').value,{review:true});
  await loadAll(j.document?.id||id);
}
async function deleteCurrent(){if(!current||!confirm('Удалить документ из AI Inbox?'))return;await aiPost({action:'delete',id:current.id});current=null;$('reviewContent').hidden=true;$('reviewEmpty').hidden=false;await loadAll()}
function collectDraft(){const supplierId=$('draftSupplier').value,storeId=$('draftStore').value;if(!supplierId)throw new Error('Выберите поставщика.');if(!storeId)throw new Error('Выберите склад.');const arithmetic=validateDraftArithmetic();if(!arithmetic.valid)throw new Error('Исправьте арифметические расхождения перед сохранением.');const items=[...document.querySelectorAll('.aid-item')].map((row,i)=>{const productId=row.querySelector('[data-f="product"]').value,amount=Number(row.querySelector('[data-f="quantity"]').value||0),price=Number(row.querySelector('[data-f="price"]').value||0),sum=Number(row.querySelector('[data-f="sum"]').value||0);if(!productId)throw new Error('Строка '+(i+1)+': выберите товар iiko.');if(!(amount>0))throw new Error('Строка '+(i+1)+': количество должно быть больше 0.');const product=(refs?.products||[]).find(x=>String(x.id)===String(productId));const sourceName=currentMatching().items?.[i]?.sourceName||'';return{num:i+1,sourceName,productId,productName:product?.name||'',amount,actualAmount:amount,price,sum}});if(!items.length)throw new Error('В документе нет товарных строк.');return{documentNumber:$('draftNumber').value||undefined,dateIncoming:($('draftDate').value||today())+'T00:00:00',supplierId,defaultStore:storeId,invoice:$('draftInvoice').value,incomingDocumentNumber:$('draftIncoming').value,dueDate:$('draftDue').value,documentTotal:arithmetic.documentTotal,comment:'Создано через SmartHoreca AI Document Inbox',items}}
async function importToIiko(processed){
  try{
    if(!current)throw new Error('Документ не выбран.');
    if(current.status==='IMPORTED')throw new Error('Этот документ уже импортирован в iiko.');

    const documentData=collectDraft();
    const c=await connection();
    const action=processed?'save-and-process':'save';

    setReviewStatus(processed?'Сохраняем и проводим в iiko…':'Сохраняем в iiko…');
    $('saveDraftBtn').disabled=true;
    $('saveProcessBtn').disabled=true;

    const r=await fetch('/api/iiko/document-action',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({connection:c,type:'incoming',action,document:documentData}),
      cache:'no-store'
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok||j.success===false){
      const detail=j.validation&&(j.validation.errorMessage||j.validation.additionalInfo);
      const reason=detail||j.message||`HTTP ${r.status}`;
      if(j.saved&&j.stage==='process')throw new Error('Накладная сохранена в iiko, но провести её не удалось: '+reason);
      throw new Error(reason);
    }

    const number=j.validation&&(j.validation.documentNumber||j.validation.otherSuggestedNumber)||documentData.documentNumber||'';
    await aiPost({action:'markImported',id:current.id,documentNumber:number,processed,draft:documentData});
    setReviewStatus('Готово: накладная создана в iiko'+(number?' · № '+number:''),'ok');
    await loadAll(current.id);
  }catch(e){
    setReviewStatus(e?.message||'Ошибка iiko','error');
    throw e;
  }finally{
    if(current?.status!=='IMPORTED'){
      validateDraftArithmetic();
    }
  }
}
function bindUpload(){const dz=$('dropzone'),input=$('fileInput');dz.onclick=()=>input.click();input.onchange=()=>{chosenFile=input.files?.[0]||null;if(chosenFile){dz.querySelector('strong').textContent=chosenFile.name;dz.querySelector('span').textContent=(chosenFile.size/1024/1024).toFixed(2)+' МБ'}};['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('drag')}));['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('drag')}));dz.addEventListener('drop',e=>{const f=e.dataTransfer?.files?.[0];if(f){chosenFile=f;dz.querySelector('strong').textContent=f.name;dz.querySelector('span').textContent=(f.size/1024/1024).toFixed(2)+' МБ'}})}
function bind(){bindUpload();bindReviewWorkspace();$('uploadBtn').onclick=()=>uploadAndProcess().catch(e=>setUploadStatus(e.message,'error'));$('refreshBtn').onclick=()=>loadAll().catch(e=>setUploadStatus(e.message,'error'));$('reprocessBtn').onclick=()=>reprocess().catch(e=>setReviewStatus(e.message,'error'));$('deleteBtn').onclick=()=>deleteCurrent().catch(e=>setReviewStatus(e.message,'error'));$('saveDraftBtn').onclick=()=>importToIiko(false).catch(()=>{});$('saveProcessBtn').onclick=()=>importToIiko(true).catch(()=>{})}
async function init(){try{bind();await Promise.all([loadRefs(),loadAll()])}catch(e){setUploadStatus(e.message||String(e),'error')}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();