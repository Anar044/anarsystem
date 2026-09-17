(()=>{
  'use strict';

  const SRC='/assets/brand/smarthoreca-logo-user-exact.jpeg?v=20260917-1';

  const apply=()=>{
    const brand=document.querySelector('.sidebar .unified-brand');
    if(!brand)return false;

    const current=brand.querySelector('img.sh-user-exact-logo');
    if(current && current.getAttribute('src')===SRC)return true;

    brand.dataset.exactUserLogo='1';
    brand.innerHTML=`
      <img class="sh-user-exact-logo" src="${SRC}" alt="Smart Horeca">
      <div class="sketch-brand-copy">
        <strong>Smart <span>Horeca</span></strong>
        <small>Управляй рестораном легко</small>
      </div>`;

    brand.style.setProperty('display','grid','important');
    brand.style.setProperty('grid-template-columns','62px minmax(0,1fr)','important');
    brand.style.setProperty('gap','11px','important');
    brand.style.setProperty('align-items','center','important');
    brand.style.setProperty('padding','2px 5px 22px','important');
    brand.style.setProperty('height','auto','important');

    const img=brand.querySelector('.sh-user-exact-logo');
    if(img){
      img.style.setProperty('display','block','important');
      img.style.setProperty('width','62px','important');
      img.style.setProperty('height','68px','important');
      img.style.setProperty('object-fit','contain','important');
      img.style.setProperty('object-position','center','important');
      img.style.setProperty('background','transparent','important');
      img.style.setProperty('border','0','important');
      img.style.setProperty('border-radius','0','important');
      img.style.setProperty('box-shadow','none','important');
      img.style.setProperty('padding','0','important');
      img.style.setProperty('margin','0','important');
    }

    return true;
  };

  apply();
  document.addEventListener('DOMContentLoaded',apply,{once:true});
  setTimeout(apply,100);
  setTimeout(apply,400);
  setTimeout(apply,1000);

  const sidebar=document.querySelector('.sidebar');
  if(sidebar){
    new MutationObserver(()=>{
      const brand=sidebar.querySelector('.unified-brand');
      if(brand && !brand.querySelector('img.sh-user-exact-logo'))apply();
    }).observe(sidebar,{childList:true,subtree:true});
  }
})();