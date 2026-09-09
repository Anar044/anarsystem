(function () {
    "use strict";

    const IDENTITY_KEY = "iikoDepartmentIdentity";
    const CONNECTION_KEY = "iikoConnection";
    const $ = id => document.getElementById(id);

    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
    }
    async function safeJson(response) {
        const text = await response.text();
        if (!text) return {};
        try { return JSON.parse(text); } catch { return { success:false, message:text }; }
    }
    function setStatus(text) { const e=$("iiko-status"); if(e)e.textContent=text; }

    function renderIdentity(departments, organizations, server, chain) {
        const card=$("iiko-identity"), list=$("iiko-identity-list");
        if(!card||!list)return;
        card.hidden=false;
        const orgs=Array.isArray(organizations)?organizations:[];
        const deps=Array.isArray(departments)?departments:[];
        let html=server?.ip&&server?.port?`<div class="iiko-identity-empty">Сервер: ${esc(server.ip)}:${esc(server.port)}</div>`:"";
        html+=`<div class="iiko-identity-empty">Режим: <strong>${chain?"CHAIN — сеть ресторанов":"RMS — один ресторан"}</strong></div>`;
        if(orgs.length){html+=orgs.map(org=>`<div class="iiko-identity-item"><div class="iiko-identity-name">${chain?"Торговое предприятие":"Организация"}: ${esc(org.name||"Ресторан")}</div><div class="iiko-identity-id">Department ID: ${esc(org.id)}</div>${org.code?`<div class="iiko-identity-id">Код: ${esc(org.code)}</div>`:""}</div>`).join("");}
        if(deps.length){html+=`<div class="iiko-identity-empty" style="margin-top:8px">Подразделения SH Server</div>`;html+=deps.map(item=>`<div class="iiko-identity-item"><div class="iiko-identity-name">${esc(item.name||item.code||"Подразделение")}</div><div class="iiko-identity-id">Department ID: ${esc(item.id)}</div>${item.parentId?`<div class="iiko-identity-id">Parent ID: ${esc(item.parentId)}</div>`:""}</div>`).join("");}
        if(!orgs.length&&!deps.length)html+=`<div class="iiko-identity-empty">Структура подразделений не получена.</div>`;
        list.innerHTML=html;
    }

    function renderSavedIdentity(){
        try{
            const saved=localStorage.getItem(IDENTITY_KEY), connection=JSON.parse(localStorage.getItem(CONNECTION_KEY)||"null");
            if(!saved&&!connection)return;
            const data=saved?JSON.parse(saved):{};
            const departments=Array.isArray(data.departments)?data.departments:(Array.isArray(connection?.departments)?connection.departments:[]);
            const organizations=Array.isArray(data.organizations)?data.organizations:(Array.isArray(connection?.organizations)?connection.organizations:[]);
            const chain=connection?.connectionType==="CHAIN"||data.mode==="CHAIN";
            renderIdentity(departments,organizations,data.server||connection,chain);
            const checkbox=$("is-chain"); if(checkbox)checkbox.checked=chain;
            const hint=$("chain-hint"); if(hint&&checkbox)hint.classList.toggle("visible",checkbox.checked);
        }catch(error){console.warn("Cannot load saved SH identity",error);}
    }

    async function handleIdentityConnection(event){
        event.preventDefault(); event.stopImmediatePropagation();
        const ip=$("iiko-ip")?.value.trim(), port=$("iiko-port")?.value.trim(), login=$("iiko-login")?.value.trim(), password=$("iiko-password")?.value||"";
        const remember=$("remember-iiko")?.checked===true, requestedChain=$("is-chain")?.checked===true;
        if(!ip||!port||!login||!password){setStatus("🟠 Заполните IP, порт, логин и пароль");return;}
        const button=$("connect-iiko"); if(button)button.disabled=true;
        setStatus("🟡 Проверяем SH Server и автоматически определяем RMS / Chain...");
        const card=$("iiko-identity"), list=$("iiko-identity-list");
        if(card&&list){card.hidden=false;list.innerHTML=`<div class="iiko-identity-empty">Определяем тип сервера и загружаем структуру...</div>`;}
        try{
            const response=await fetch("/api/iiko/connect",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({ip,port,login,password})});
            const data=await safeJson(response);
            if(!response.ok||data.success===false)throw new Error(data.message||`HTTP ${response.status}`);

            let departments=Array.isArray(data.departments)?data.departments:[];
            let organizations=Array.isArray(data.organizations)?data.organizations:[];
            let chainStructure=null;
            let serverMode=String(data.detectedMode||data.mode||"").toUpperCase();

            // Always ask the server for its corporate structure. The checkbox is NOT the detector.
            // It remains only as an explicit override for the rare ambiguous one-department Chain case.
            try{
                const chainResponse=await fetch("/api/iiko/chain",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({ip,port,login,password})});
                chainStructure=await safeJson(chainResponse);
                if(chainResponse.ok&&chainStructure.success!==false){
                    serverMode=String(chainStructure.detectedMode||chainStructure.mode||serverMode||"").toUpperCase();
                    departments=Array.isArray(chainStructure.departments)?chainStructure.departments:departments;
                    organizations=Array.isArray(chainStructure.restaurants)?chainStructure.restaurants:organizations;
                }
            }catch(error){
                console.warn("SH Chain structure lookup failed; using primary server response",error);
            }

            if(serverMode!=="CHAIN"&&serverMode!=="RMS")serverMode=departments.length>1?"CHAIN":"RMS";
            const isChain=serverMode==="CHAIN"||requestedChain;
            const detectedMode=serverMode;
            const checkedAt=new Date().toISOString();
            const organizationId=String(data.organizationId||organizations[0]?.id||departments[0]?.id||"");

            const identity={mode:isChain?"CHAIN":"RMS",detectedMode,organizationId,organizations,departmentIds:departments.map(x=>x.id),departments,hierarchy:chainStructure?.hierarchy||[],groups:chainStructure?.groups||[],pointsOfSale:chainStructure?.pointsOfSale||[],restaurantSections:chainStructure?.restaurantSections||[],server:{ip,port},checkedAt};
            localStorage.setItem(IDENTITY_KEY,JSON.stringify(identity));

            const connection={ip,port,login,password,connectionType:isChain?"CHAIN":"RMS",isChain,detectedMode,organizationId,departmentIds:identity.departmentIds,departments,organizations,hierarchy:identity.hierarchy,groups:identity.groups,pointsOfSale:identity.pointsOfSale,restaurantSections:identity.restaurantSections,connectedAt:checkedAt};
            if(remember)localStorage.setItem(CONNECTION_KEY,JSON.stringify(connection));else localStorage.removeItem(CONNECTION_KEY);

            const checkbox=$("is-chain"), hint=$("chain-hint");
            if(checkbox)checkbox.checked=isChain;
            if(hint&&checkbox)hint.classList.toggle("visible",checkbox.checked);
            renderIdentity(departments,organizations,identity.server,isChain);
            setStatus(isChain?`🟢 SH Chain определён автоматически • ресторанов: ${organizations.length}`:`🟢 SH RMS определён автоматически • Department ID: ${organizationId||"—"}`);
            console.info("SH DETECTED TYPE:",detectedMode,"FINAL TYPE:",isChain?"CHAIN":"RMS");
        }catch(error){
            setStatus("🔴 Ошибка соединения");
            if(list)list.innerHTML=`<div class="iiko-identity-empty">${esc(error?.message||error)}</div>`;
            console.warn("SH CONNECTION FAILED:",error);
        }finally{if(button)button.disabled=false;}
    }

    function bindIdentityLookup(){const button=$("connect-iiko");if(!button||button.dataset.identityBound==="1")return;button.dataset.identityBound="1";button.addEventListener("click",handleIdentityConnection,true);}
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>{renderSavedIdentity();bindIdentityLookup();});else{renderSavedIdentity();bindIdentityLookup();}
})();
