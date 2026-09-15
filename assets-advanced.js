(()=>{
'use strict';
const $=id=>document.getElementById(id);const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₼';const esc=s=>String(s??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
let insights=new Map(),activeAssetId='',objectUrls=[],loadingInsights=false,refreshTimer=null;
async function token(){const client=await window.SHAuth?.createClient?.();if(!client)throw new Error('Supabase Auth не готов');const{data,error}=await client.auth.getSession();const t=data?.session?.access_token;if(error||!t)throw new Error('Сессия пользователя не найдена');return t}
async function jsonApi(url,opt={}){const t=await token();const headers={...(opt.headers||{}),Authorization:`Bearer ${t}`};const r=await fetch(url,{...opt,headers});const j=await r.json().catch(()=>({success:false,message:'Некорректный ответ API'}));if(!r.ok||!j.success)throw new Error(j.message||`HTTP ${r.status}`);return j}
function dateText(v){if(!v)return'—';const d=new Date(`${v}T00:00:00`);return Number.isNaN(d.getTime())?v:d.toLocaleDateString('ru-RU')}
function recommendationClass(code){return code==='REVIEW_REPLACE'?'replace':code==='SERVICE_DUE'?'service':code==='WARRANTY'?'warranty':code==='ARCHIVED'?'archived':'keep'}
function ensurePanel(){if($('assetAdvancedPanel'))return;const grid=document.querySelector('#detailModal .detail-grid');if(!grid)return;const panel=document.createElement('section');panel.id='assetAdvancedPanel';panel.className='asset-advanced-panel';panel.innerHTML=`
  <div class="advanced-head"><div><h3>Состояние и обслуживание</h3><p>Гарантия, плановое ТО, расходы на ремонт и оценка замены.</p></div><span class="health-pill" id="assetHealthPill">—</span></div>
  <div class="health-metrics" id="assetHealthMetrics"></div>
  <div class="health-recommendation" id="assetRecommendation"></div>
  <div class="advanced-columns">
    <form id="assetMetaForm" class="asset-meta-form">
      <h4>Планирование</h4>
      <div class="field"><label>Гарантия до</label><input id="assetWarrantyUntil" type="date"></div>
      <div class="field"><label>Следующее ТО</label><input id="assetNextService" type="date"></div>
      <div class="field span2"><label>Стоимость нового аналога, ₼</label><input id="assetReplacementCost" type="number" min="0" step="0.01" placeholder="Необязательно"><small>Нужна для более точной оценки «ремонтировать или заменить».</small></div>
      <div class="span2"><button class="small-primary" type="submit" id="saveAssetMeta">Сохранить план</button></div>
    </form>
    <section class="asset-files-section">
      <div class="files-title"><div><h4>Фото и документы</h4><small id="assetFilesStatus">Проверяем хранилище…</small></div></div>
      <form id="assetFileForm" class="file-upload-form">
        <select id="assetFileKind"><option value="PHOTO">Фото оборудования</option><option value="DOCUMENT">Чек / документ</option></select>
        <input id="assetFileInput" type="file" accept="image/*,.pdf,application/pdf">
        <button type="submit" class="ghost" id="assetFileUpload">Загрузить</button>
      </form>
      <div class="photo-grid" id="assetPhotoGrid"></div>
      <div class="document-list" id="assetDocumentList"></div>
    </section>
  </div>`;
  grid.parentNode.insertBefore(panel,grid);
  $('assetMetaForm').addEventListener('submit',saveMeta);
  $('assetFileForm').addEventListener('submit',uploadFile);
}
function decorateRows(){const tb=$('assetRows');if(!tb)return;tb.querySelectorAll('tr[data-id]').forEach(tr=>{const info=insights.get(tr.dataset.id),name=tr.querySelector('.asset-name');if(!info||!name)return;tr.querySelectorAll('.asset-health-inline,.asset-repair-inline').forEach(x=>x.remove());const badge=document.createElement('span');badge.className=`asset-health-inline ${recommendationClass(info.code)}`;badge.textContent=info.label;name.insertAdjacentElement('afterend',badge);const sub=document.createElement('div');sub.className='asset-sub asset-repair-inline';sub.textContent=`Ремонты за 12 мес.: ${money(info.repairCost12m)}`;badge.insertAdjacentElement('afterend',sub)})}
async function loadInsights(){if(loadingInsights)return;loadingInsights=true;try{const j=await jsonApi('/api/asset-meta');insights=new Map((j.items||[]).map(x=>[x.assetId,x]));decorateRows();if(activeAssetId&&$('detailModal')?.classList.contains('show'))renderHealth(activeAssetId)}catch(e){console.warn('Asset health:',e)}finally{loadingInsights=false}}
function scheduleInsights(){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>loadInsights(),250)}
function renderHealth(assetId){ensurePanel();const x=insights.get(assetId);if(!x)return;$('assetHealthPill').className=`health-pill ${recommendationClass(x.code)}`;$('assetHealthPill').textContent=x.label;$('assetHealthMetrics').innerHTML=`
  <article><span>Ремонты за всё время</span><strong>${money(x.totalRepairCost)}</strong></article>
  <article><span>Ремонты за 12 месяцев</span><strong>${money(x.repairCost12m)}</strong></article>
  <article><span>Использовано срока</span><strong>${Math.round(Number(x.lifeRatio||0)*100)}%</strong></article>
  <article><span>Новый аналог</span><strong>${x.replacementCost?money(x.replacementCost):'не указано'}</strong></article>`;
  $('assetRecommendation').className=`health-recommendation ${recommendationClass(x.code)}`;
  const service=x.nextServiceDate?`${dateText(x.nextServiceDate)}${x.nextServiceDays<0?' · просрочено':x.nextServiceDays===0?' · сегодня':x.nextServiceDays!=null?` · через ${x.nextServiceDays} дн.`:''}`:'не запланировано';
  const warranty=x.warrantyUntil?`${dateText(x.warrantyUntil)}${x.warrantyActive?' · действует':' · завершена'}`:'не указана';
  $('assetRecommendation').innerHTML=`<div><b>${esc(x.label)}</b><p>${esc(x.reason)}</p></div><div class="health-dates"><span>Гарантия: <b>${esc(warranty)}</b></span><span>Следующее ТО: <b>${esc(service)}</b></span></div><small>Это управленческий индикатор. Решение о замене принимается с учётом состояния объекта и цены нового оборудования.</small>`;
  $('assetWarrantyUntil').value=x.warrantyUntil||'';$('assetNextService').value=x.nextServiceDate||'';$('assetReplacementCost').value=x.replacementCost||'';
}
async function saveMeta(e){e.preventDefault();if(!activeAssetId)return;const btn=$('saveAssetMeta');btn.disabled=true;try{await jsonApi('/api/asset-meta',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assetId:activeAssetId,warrantyUntil:$('assetWarrantyUntil').value,nextServiceDate:$('assetNextService').value,replacementCost:$('assetReplacementCost').value})});await loadInsights();renderHealth(activeAssetId)}catch(err){alert(err.message)}finally{btn.disabled=false}}
function revokeObjects(){objectUrls.forEach(URL.revokeObjectURL);objectUrls=[]}
async function loadFileBlob(fileId){const t=await token();const r=await fetch(`/api/asset-files?fileId=${encodeURIComponent(fileId)}`,{headers:{Authorization:`Bearer ${t}`}});if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.message||`HTTP ${r.status}`)}return r.blob()}
async function renderFiles(assetId){ensurePanel();revokeObjects();$('assetPhotoGrid').innerHTML='';$('assetDocumentList').innerHTML='';try{const j=await jsonApi(`/api/asset-files?assetId=${encodeURIComponent(assetId)}`);const configured=!!j.storageConfigured;$('assetFilesStatus').textContent=configured?'Cloudflare R2 подключён':'Нужен R2 binding ASSET_FILES';$('assetFilesStatus').className=configured?'storage-ok':'storage-warn';$('assetFileInput').disabled=!configured;$('assetFileKind').disabled=!configured;$('assetFileUpload').disabled=!configured;const photos=(j.files||[]).filter(x=>x.kind==='PHOTO'),docs=(j.files||[]).filter(x=>x.kind==='DOCUMENT');$('assetPhotoGrid').innerHTML=photos.length?photos.map(f=>`<div class="photo-item" data-photo-id="${esc(f.id)}"><div class="photo-placeholder">Фото</div><button type="button" data-delete-file="${esc(f.id)}">×</button><small>${esc(f.file_name)}</small></div>`).join(''):'<div class="files-empty">Фото пока нет.</div>';$('assetDocumentList').innerHTML=docs.length?docs.map(f=>`<div class="document-item"><span>📄</span><div><b>${esc(f.file_name)}</b><small>${Math.max(1,Math.round(Number(f.size||0)/1024))} КБ</small></div><button type="button" data-open-file="${esc(f.id)}" data-file-name="${esc(f.file_name)}">Открыть</button><button type="button" data-delete-file="${esc(f.id)}">Удалить</button></div>`).join(''):'<div class="files-empty">Документов пока нет.</div>';document.querySelectorAll('[data-delete-file]').forEach(b=>b.onclick=()=>deleteFile(b.dataset.deleteFile));document.querySelectorAll('[data-open-file]').forEach(b=>b.onclick=()=>openFile(b.dataset.openFile,b.dataset.fileName));for(const f of photos){try{const blob=await loadFileBlob(f.id),url=URL.createObjectURL(blob);objectUrls.push(url);const item=document.querySelector(`[data-photo-id="${CSS.escape(f.id)}"]`),holder=item?.querySelector('.photo-placeholder');if(holder){holder.innerHTML=`<img alt="${esc(f.file_name)}">`;holder.querySelector('img').src=url;holder.onclick=()=>window.open(url,'_blank')}}catch{}}
}catch(e){$('assetFilesStatus').textContent=e.message;$('assetFilesStatus').className='storage-warn'}}
async function uploadFile(e){e.preventDefault();if(!activeAssetId)return;const file=$('assetFileInput').files?.[0];if(!file){alert('Выберите файл.');return}const btn=$('assetFileUpload');btn.disabled=true;btn.textContent='Загрузка…';try{const t=await token(),fd=new FormData();fd.append('assetId',activeAssetId);fd.append('kind',$('assetFileKind').value);fd.append('file',file);const r=await fetch('/api/asset-files',{method:'POST',headers:{Authorization:`Bearer ${t}`},body:fd});const j=await r.json().catch(()=>({}));if(!r.ok||!j.success)throw new Error(j.message||`HTTP ${r.status}`);$('assetFileInput').value='';await renderFiles(activeAssetId)}catch(err){alert(err.message)}finally{btn.textContent='Загрузить';btn.disabled=false}}
async function deleteFile(fileId){if(!confirm('Удалить этот файл?'))return;try{await jsonApi('/api/asset-files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',fileId})});await renderFiles(activeAssetId)}catch(e){alert(e.message)}}
async function openFile(fileId,name){try{const blob=await loadFileBlob(fileId),url=URL.createObjectURL(blob);objectUrls.push(url);const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.download=name||'document';document.body.appendChild(a);a.click();a.remove()}catch(e){alert(e.message)}}
async function openAdvanced(assetId){activeAssetId=assetId;ensurePanel();if(!insights.has(assetId))await loadInsights();renderHealth(assetId);await renderFiles(assetId)}
function bind(){ensurePanel();const tb=$('assetRows');tb?.addEventListener('click',e=>{if(e.target.closest('[data-edit]'))return;const tr=e.target.closest('tr[data-id]');if(!tr)return;setTimeout(()=>openAdvanced(tr.dataset.id).catch(console.warn),0)});if(tb)new MutationObserver(()=>scheduleInsights()).observe(tb,{childList:true});const events=$('eventList');if(events)new MutationObserver(()=>{if(activeAssetId)scheduleInsights()}).observe(events,{childList:true});$('detailModal')?.addEventListener('transitionend',()=>{if(!$('detailModal').classList.contains('show'))revokeObjects()});window.addEventListener('beforeunload',revokeObjects)}
async function init(){bind();setTimeout(()=>loadInsights(),350)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();