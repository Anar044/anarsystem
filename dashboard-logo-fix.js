(()=>{
  'use strict';
  const SRC='/assets/brand/smarthoreca-logo-original.jpg?v=20260917-2';

  function apply(){
    const mark=document.querySelector('.sketch-brand-mark');
    if(!mark)return false;

    mark.style.setProperty('background','transparent','important');
    mark.style.setProperty('width','62px','important');
    mark.style.setProperty('height','70px','important');
    mark.style.setProperty('border-radius','12px','important');
    mark.style.setProperty('box-shadow','none','important');
    mark.style.setProperty('overflow','hidden','important');
    mark.style.setProperty('display','flex','important');
    mark.style.setProperty('align-items','center','important');
    mark.style.setProperty('justify-content','center','important');

    let img=mark.querySelector('img[data-exact-smarthoreca-logo]');
    if(!img){
      mark.replaceChildren();
      img=document.createElement('img');
      img.setAttribute('data-exact-smarthoreca-logo','1');
      img.alt='Smart Horeca';
      mark.appendChild(img);
    }

    img.src=SRC;
    img.style.width='100%';
    img.style.height='100%';
    img.style.objectFit='contain';
    img.style.objectPosition='center';
    img.style.display='block';
    img.style.border='0';
    img.style.borderRadius='10px';
    img.style.background='transparent';
    return true;
  }

  function boot(){
    if(apply())return;
    let tries=0;
    const timer=setInterval(()=>{
      tries+=1;
      if(apply()||tries>30)clearInterval(timer);
    },100);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
  setTimeout(apply,700);
})();