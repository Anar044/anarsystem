(()=>{
  'use strict';

  const apply=()=>{
    const brand=document.querySelector('.sidebar .unified-brand');
    if(!brand)return false;

    brand.querySelectorAll('.sketch-brand-mark, img, .brand-logo, .brand-icon').forEach(el=>el.remove());

    const copy=brand.querySelector('.sketch-brand-copy');
    if(copy){
      copy.style.margin='0';
      copy.style.width='100%';
    }

    brand.style.display='block';
    brand.style.gridTemplateColumns='1fr';
    brand.style.padding='8px 8px 22px';
    brand.style.minHeight='0';
    return true;
  };

  apply();
  document.addEventListener('DOMContentLoaded',apply,{once:true});
  setTimeout(apply,100);
  setTimeout(apply,400);
  setTimeout(apply,1000);

  const sidebar=document.querySelector('.sidebar');
  if(sidebar){
    new MutationObserver(()=>apply()).observe(sidebar,{childList:true,subtree:true});
  }
})();