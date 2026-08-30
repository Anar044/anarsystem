(function(){
  "use strict";
  const MENU_KEY="horeca_qr_menu_v1";
  const IDENTITY_KEY="iikoDepartmentIdentity";
  const CONNECTION_KEY="iikoConnection";

  function readJson(key){try{return JSON.parse(localStorage.getItem(key)||"null");}catch{return null;}}
  function getIdentity(){return readJson(IDENTITY_KEY);}
  function getConnection(){return readJson(CONNECTION_KEY);}
  function getState(){return readJson(MENU_KEY);}
  function restaurantName(identity){return identity?.organizations?.[0]?.name||"Мой ресторан";}

  function ensureResultBox(){
    let box=document.getElementById("publishResult");
    if(box)return box;
    box=document.createElement("div");
    box.id="publishResult";
    box.style.cssText="position:fixed;right:24px;bottom:24px;z-index:200;max-width:460px;background:#111821;border:1px solid #293442;border-radius:16px;padding:16px;box-shadow:0 20px 60px #0008;color:#fff;display:none";
    document.body.appendChild(box);
    return box;
  }
  function showResult(title,text,ok=true,url=""){
    const box=ensureResultBox();
    box.innerHTML=`<div style="font-weight:800;font-size:15px;margin-bottom:6px">${title}</div><div style="color:${ok?'#aeb7c4':'#ffb454'};font-size:12px;line-height:1.5;white-space:pre-line">${text}</div>${url?`<a href="${url}" target="_blank" style="display:block;margin-top:10px;color:#42d392;word-break:break-all">${url}</a>`:''}<button id="closePublishResult" style="margin-top:12px;border:1px solid #293442;background:#151d27;color:#fff;border-radius:9px;padding:7px 10px">Закрыть</button>`;
    box.style.display="block";
    document.getElementById("closePublishResult").onclick=()=>box.style.display="none";
  }
  function setQr(url){
    const box=document.getElementById("qrbox");if(!box||!url)return;
    box.innerHTML="";
    const img=document.createElement("img");
    img.alt="QR Menu";img.width=150;img.height=150;
    img.style.cssText="width:150px;height:150px;display:block";
    img.src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data="+encodeURIComponent(url);
    box.appendChild(img);
    const hint=document.querySelector(".preview .hint");
    if(hint)hint.textContent="QR-код ведёт на опубликованное меню ресторана.";
  }

  async function resolveIdentity(){
    const current=getIdentity();
    const currentId=String(current?.organizationId||current?.organizations?.[0]?.id||"").trim();
    if(currentId)return current;

    const connection=getConnection();
    if(!connection?.ip||!connection?.port||!connection?.login||connection?.password==null){
      throw new Error("Не найдено подключение к локальному iiko Server. Откройте «Настройки», подключитесь к iiko и повторите публикацию.");
    }

    const response=await fetch("/api/iiko/connect",{
      method:"POST",
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify({ip:connection.ip,port:connection.port,login:connection.login,password:connection.password})
    });
    const text=await response.text();
    let data={};
    try{data=text?JSON.parse(text):{};}catch{data={message:text};}
    if(!response.ok||data.success===false)throw new Error(data.message||`Ошибка подключения к iiko: HTTP ${response.status}`);

    const organizationId=String(data.organizationId||data.organizations?.[0]?.id||"").trim();
    if(!organizationId){
      throw new Error("Локальный iiko Server подключён, но API не вернул Organization ID. Сначала нажмите «Подключиться» в Настройках и проверьте блок «Идентификатор iiko».");
    }

    const identity={
      organizationId,
      organizations:Array.isArray(data.organizations)?data.organizations:[],
      departmentIds:Array.isArray(data.departmentIds)?data.departmentIds:[],
      departments:Array.isArray(data.departments)?data.departments:[],
      server:{ip:connection.ip,port:connection.port},
      checkedAt:new Date().toISOString()
    };
    localStorage.setItem(IDENTITY_KEY,JSON.stringify(identity));
    return identity;
  }

  async function publish(){
    const state=getState();
    if(!state||!Array.isArray(state.categories)||!Array.isArray(state.dishes)){
      showResult("Меню не найдено","В QR Menu нет данных для публикации.",false);return;
    }
    const button=document.getElementById("publishBtn");
    if(button){button.disabled=true;button.textContent="Получаем ID iiko...";}
    try{
      const identity=await resolveIdentity();
      const organizationId=String(identity.organizationId||identity.organizations?.[0]?.id||"").trim();
      if(!organizationId)throw new Error("Organization ID iiko не найден.");
      if(button)button.textContent="Публикация...";

      const response=await fetch("/api/qr-menu/publish",{
        method:"POST",
        headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({organizationId,restaurantName:restaurantName(identity),menu:state})
      });
      const text=await response.text();
      let data={};
      try{data=text?JSON.parse(text):{};}catch{data={message:text};}
      if(!response.ok||data.success===false)throw new Error(data.message||`HTTP ${response.status}`);

      localStorage.setItem("horeca_qr_public",JSON.stringify({publicId:data.publicId,publicUrl:data.publicUrl,organizationId,updatedAt:data.updatedAt}));
      setQr(data.publicUrl);
      showResult("Меню опубликовано",`Версия опубликована для организации ${organizationId}.`,true,data.publicUrl);
      const status=document.getElementById("saveStatus");if(status)status.textContent="● Опубликовано на сервере";
    }catch(error){
      console.error("QR Menu publish",error);
      showResult("Ошибка публикации",error.message||"Не удалось опубликовать меню.",false);
    }finally{
      if(button){button.disabled=false;button.textContent="Опубликовать меню";}
    }
  }

  function restore(){try{const p=readJson("horeca_qr_public");if(p?.publicUrl)setQr(p.publicUrl);}catch{}}
  function install(){const button=document.getElementById("publishBtn");if(button){button.onclick=publish;button.dataset.serverPublish="1";}restore();}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});else install();
})();
