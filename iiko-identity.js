(function () {
    "use strict";

    const $ = id => document.getElementById(id);

    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
    }

    const clean = value => String(value ?? "").trim();

    async function safeJson(response) {
        const text = await response.text();
        if (!text) return {};
        try { return JSON.parse(text); } catch { return { success:false, message:text }; }
    }

    async function authHeaders() {
        try {
            if (!window.SHAuth?.createClient) return null;
            const client = await window.SHAuth.createClient();
            if (!client) return null;
            const { data } = await client.auth.getSession();
            const token = data?.session?.access_token;
            if (!token) return null;
            return {
                "Content-Type": "application/json",
                "Accept": "application/json",
                Authorization: `Bearer ${token}`
            };
        } catch (error) {
            console.warn("SH iiko auth token failed", error);
            return null;
        }
    }

    function setStatus(text) {
        const e=$("iiko-status");
        if(e)e.textContent=text;
    }

    function renderIdentity(departments, organizations, server, chain, groups, pointsOfSale) {
        const card=$("iiko-identity"), list=$("iiko-identity-list");
        if(!card||!list)return;
        card.hidden=false;
        const orgs=Array.isArray(organizations)?organizations:[];
        const deps=Array.isArray(departments)?departments:[];
        const grps=Array.isArray(groups)?groups:[];
        const pos=Array.isArray(pointsOfSale)?pointsOfSale:[];
        let html=server?.ip&&server?.port?`<div class="iiko-identity-empty">Сервер: ${esc(server.ip)}:${esc(server.port)}</div>`:"";
        html+=`<div class="iiko-identity-empty">Режим: <strong>${chain?"CHAIN — сеть ресторанов":"RMS — один ресторан"}</strong></div>`;
        if(orgs.length){
            html+=orgs.map(org=>`<div class="iiko-identity-item"><div class="iiko-identity-name">${chain?"Торговое предприятие":"Организация"}: ${esc(org.name||"Ресторан")}</div><div class="iiko-identity-id">Department ID: ${esc(org.id)}</div>${org.code?`<div class="iiko-identity-id">Код: ${esc(org.code)}</div>`:""}</div>`).join("");
        }
        if(deps.length){
            html+=`<div class="iiko-identity-empty" style="margin-top:8px">Подразделения SH Server</div>`;
            html+=deps.map(item=>`<div class="iiko-identity-item"><div class="iiko-identity-name">${esc(item.name||item.code||"Подразделение")}</div><div class="iiko-identity-id">Department ID: ${esc(item.id)}</div>${item.parentId?`<div class="iiko-identity-id">Parent ID: ${esc(item.parentId)}</div>`:""}</div>`).join("");
        }
        if(grps.length){
            html+=`<div class="iiko-identity-empty" style="margin-top:8px">Группы отделений: ${grps.length}</div>`;
            html+=grps.map(group=>`<div class="iiko-identity-item"><div class="iiko-identity-name">${esc(group.name||"Группа")}</div><div class="iiko-identity-id">Group ID: ${esc(group.id)}</div>${group.departmentId?`<div class="iiko-identity-id">Department ID: ${esc(group.departmentId)}</div>`:""}</div>`).join("");
        }
        if(pos.length) html+=`<div class="iiko-identity-empty">Точек продаж: ${pos.length}</div>`;
        if(!orgs.length&&!deps.length)html+=`<div class="iiko-identity-empty">Структура подразделений не получена.</div>`;
        list.innerHTML=html;
    }

    async function loadSavedIdentity(){
        try{
            const headers=await authHeaders();
            if(!headers) return;
            const response=await fetch("/api/iiko/state",{headers:{Accept:"application/json",Authorization:headers.Authorization},cache:"no-store"});
            const data=await safeJson(response);
            if(!response.ok||data.success===false) throw new Error(data.message||`HTTP ${response.status}`);
            if(!data.found||!data.state) return;

            const connection=data.state.connection||{};
            const identity=data.state.identity||{};
            const departments=Array.isArray(identity.departments)?identity.departments:[];
            const organizations=Array.isArray(identity.organizations)?identity.organizations:[];
            const chain=connection.connectionType==="CHAIN"||identity.mode==="CHAIN";
            renderIdentity(departments,organizations,identity.server||{ip:connection.ip,port:connection.port},chain,identity.groups,identity.pointsOfSale);
            const checkbox=$("is-chain"); if(checkbox)checkbox.checked=chain;
            const hint=$("chain-hint"); if(hint&&checkbox)hint.classList.toggle("visible",checkbox.checked);
            if(connection.ip) $("iiko-ip").value=connection.ip;
            if(connection.port) $("iiko-port").value=connection.port;
            if(connection.login) $("iiko-login").value=connection.login;
            if($("iiko-password")) $("iiko-password").value=connection.password||"";
            if($("remember-iiko")) $("remember-iiko").checked=true;
            setStatus(chain
                ? `🟢 D1: SH Chain • ${identity.displayName||connection.displayName||"—"}`
                : `🟢 D1: SH RMS • ${identity.displayName||connection.displayName||"—"} • Department ID: ${identity.organizationId||"—"}`);
        }catch(error){
            console.warn("Cannot load saved SH identity from D1",error);
        }
    }

    async function saveIikoState(connection, identity) {
        const headers=await authHeaders();
        if(!headers) throw new Error("Не удалось получить сессию пользователя для сохранения iiko в D1.");
        const response=await fetch("/api/iiko/state",{
            method:"POST",
            headers,
            body:JSON.stringify({connection,identity})
        });
        const data=await safeJson(response);
        if(!response.ok||data.success===false) throw new Error(data.message||`Ошибка сохранения iiko в D1: HTTP ${response.status}`);
        return data;
    }

    async function clearIikoState() {
        const headers=await authHeaders();
        if(!headers) throw new Error("Не удалось получить сессию пользователя.");
        const response=await fetch("/api/iiko/state",{method:"DELETE",headers});
        const data=await safeJson(response);
        if(!response.ok||data.success===false) throw new Error(data.message||`HTTP ${response.status}`);
    }

    async function handleIdentityConnection(event){
        event.preventDefault();
        event.stopImmediatePropagation();
        const ip=$("iiko-ip")?.value.trim(), port=$("iiko-port")?.value.trim(), login=$("iiko-login")?.value.trim(), password=$("iiko-password")?.value||"";
        const requestedChain=$("is-chain")?.checked===true;
        if(!ip||!port||!login||!password){setStatus("🟠 Заполните IP, порт, логин и пароль");return;}
        const button=$("connect-iiko"); if(button)button.disabled=true;
        setStatus("🟡 Проверяем SH Server и загружаем структуру в D1...");
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
            const networkName=clean(chainStructure?.organization?.name||chainStructure?.organization?.Name||"");
            const restaurantName=clean(organizations[0]?.name||departments[0]?.name||data.restaurantName||"");
            const displayName=isChain?(networkName||restaurantName):restaurantName;

            const identity={mode:isChain?"CHAIN":"RMS",detectedMode,organizationId,displayName,networkName,restaurantName,organizations,departmentIds:departments.map(x=>x.id),departments,hierarchy:chainStructure?.hierarchy||[],groups:chainStructure?.groups||[],pointsOfSale:chainStructure?.pointsOfSale||[],restaurantSections:chainStructure?.restaurantSections||[],server:{ip,port},checkedAt};
            const connection={ip,port,login,password,connectionType:isChain?"CHAIN":"RMS",isChain,detectedMode,organizationId,displayName,networkName,restaurantName,departmentIds:identity.departmentIds,departments,organizations,hierarchy:identity.hierarchy,groups:identity.groups,pointsOfSale:identity.pointsOfSale,restaurantSections:identity.restaurantSections,connectedAt:checkedAt};

            await saveIikoState(connection,identity);

            const checkbox=$("is-chain"), hint=$("chain-hint");
            if(checkbox)checkbox.checked=isChain;
            if(hint&&checkbox)hint.classList.toggle("visible",checkbox.checked);
            renderIdentity(departments,organizations,identity.server,isChain,identity.groups,identity.pointsOfSale);
            setStatus(isChain
                ? `🟢 SH Chain сохранён в D1 • сеть: ${displayName||"—"} • ресторанов: ${organizations.length}`
                : `🟢 SH RMS сохранён в D1 • ресторан: ${displayName||"—"} • Department ID: ${organizationId||"—"}`);
            console.info("SH D1 SAVED:",identity);
        }catch(error){
            setStatus("🔴 Ошибка соединения");
            if(list)list.innerHTML=`<div class="iiko-identity-empty">${esc(error?.message||error)}</div>`;
            console.warn("SH CONNECTION FAILED:",error);
        }finally{if(button)button.disabled=false;}
    }

    async function handleClear(event){
        event.preventDefault();
        try{
            await clearIikoState();
            ["iikoConnection","iikoDepartmentIdentity"].forEach(key=>localStorage.removeItem(key));
            const card=$("iiko-identity"); if(card)card.hidden=true;
            setStatus("⚪ Подключение iiko удалено из D1");
        }catch(error){setStatus("🔴 " + (error?.message||error));}
    }

    function bindIdentityLookup(){
        const button=$("connect-iiko");
        if(button&&button.dataset.identityBound!=="1"){
            button.dataset.identityBound="1";
            button.addEventListener("click",handleIdentityConnection,true);
        }
        const clear=$("clear-iiko-data");
        if(clear&&clear.dataset.identityClearBound!=="1"){
            clear.dataset.identityClearBound="1";
            clear.addEventListener("click",handleClear,true);
        }
    }

    if(document.readyState==="loading"){
        document.addEventListener("DOMContentLoaded",()=>{loadSavedIdentity();bindIdentityLookup();});
    }else{
        loadSavedIdentity();
        bindIdentityLookup();
    }
})();
