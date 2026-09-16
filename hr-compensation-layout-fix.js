(()=>{
'use strict';
function set(el,styles){if(el)Object.assign(el.style,styles)}
function setAll(sel,styles){document.querySelectorAll(sel).forEach(el=>set(el,styles))}
function apply(){
  const mobile=window.innerWidth<=760,medium=window.innerWidth<=1250;
  set(document.querySelector('.hcp-form'),{display:'grid',gap:'14px'});
  set(document.querySelector('.hcp-scope-card'),{
    display:'grid',
    gridTemplateColumns:mobile?'1fr':medium?'1fr 1fr':'minmax(220px,.8fr) minmax(320px,1.4fr) minmax(260px,1fr)',
    gap:'12px',alignItems:'end',padding:'14px',border:'1px solid rgba(66,211,146,.20)',borderRadius:'13px',background:'rgba(66,211,146,.035)'
  });
  setAll('.hcp-scope-card label,.hcp-form-grid label',{display:'flex',flexDirection:'column',gap:'7px',color:'#8d9aaa',fontSize:'10px',fontWeight:'800',textTransform:'uppercase',letterSpacing:'.045em'});
  setAll('.hcp-scope-card select,.hcp-form-grid input,.hcp-form-grid select',{height:'40px',border:'1px solid #293645',borderRadius:'10px',background:'#0d141d',color:'#edf3f8',padding:'0 11px',fontSize:'13px',outline:'none',boxSizing:'border-box',width:'100%'});
  setAll('.hcp-scope-card small,.hcp-form-grid small',{color:'#69798a',fontSize:'9px',fontWeight:'500',textTransform:'none',letterSpacing:'0'});
  set(document.querySelector('.hcp-inheritance'),{minHeight:'58px',padding:'9px 11px',border:'1px solid #263442',borderRadius:'10px',background:'#101821',display:'flex',flexDirection:'column',justifyContent:'center',gap:'3px',gridColumn:medium?'1 / -1':'auto'});
  setAll('.hcp-inheritance span',{color:'#708091',fontSize:'8px',textTransform:'uppercase',fontWeight:'800'});
  setAll('.hcp-inheritance strong',{color:'#83e5b5',fontSize:'12px'});
  setAll('.hcp-inheritance small',{color:'#687788',fontSize:'9px'});
  set(document.querySelector('.hcp-form-grid'),{display:'grid',gridTemplateColumns:mobile?'1fr':medium?'repeat(2,minmax(0,1fr))':'repeat(4,minmax(0,1fr))',gap:'12px'});
  document.querySelectorAll('.hcp-span-2').forEach(el=>set(el,{gridColumn:mobile?'auto':'span 2'}));
  set(document.querySelector('.hcp-preview'),{padding:'14px',border:'1px solid #24313e',borderRadius:'13px',background:'#0d141d'});
  set(document.querySelector('.hcp-preview-head'),{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px',marginBottom:'12px'});
  set(document.querySelector('.hcp-preview-grid'),{display:'grid',gridTemplateColumns:mobile?'1fr':medium?'1fr 1fr':'repeat(3,minmax(0,1fr))',gap:'10px'});
  document.querySelectorAll('.hcp-panel').forEach((el,i)=>set(el,{padding:'13px',border:i===2?'1px solid rgba(66,211,146,.28)':'1px solid #22303d',borderRadius:'12px',background:i===2?'rgba(66,211,146,.045)':'#111923',gridColumn:medium&&i===2?'1 / -1':'auto'}));
  setAll('.hcp-panel h3',{margin:'0 0 10px',color:'#dbe5ed',fontSize:'11px'});
  setAll('.hcp-line',{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'10px',padding:'7px 0',borderBottom:'1px solid #1d2834',fontSize:'10px'});
  setAll('.hcp-line span',{color:'#7f8d9d'});
  setAll('.hcp-line strong',{color:'#d9e2ea'});
  set(document.querySelector('.hcp-big'),{display:'flex',alignItems:'flex-end',justifyContent:'space-between',gap:'12px',padding:'10px 11px',border:'1px solid rgba(66,211,146,.20)',borderRadius:'10px',background:'rgba(66,211,146,.06)'});
  const big=document.querySelector('.hcp-big strong');set(big,{color:'#8ce8bc',fontSize:'21px'});
  set(document.querySelector('.hcp-actions'),{display:'flex',alignItems:mobile?'stretch':'center',justifyContent:'space-between',gap:'14px',paddingTop:'2px',flexDirection:mobile?'column':'row'});
  setAll('.hcp-source',{display:'inline-flex',alignItems:'center',padding:'5px 8px',borderRadius:'999px',fontSize:'9px',fontWeight:'800'});
  document.querySelectorAll('[hidden]').forEach(el=>{if(el.hidden)el.style.display='none'});
}
function init(){apply();requestAnimationFrame(apply);setTimeout(apply,250)}
window.addEventListener('resize',apply);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
