(function () {
    "use strict";

    const $ = id => document.getElementById(id);
    const SERVER_PASSWORD_MARKER = "__SH_SERVER_STORED__";

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
            const passwordInput=$("iiko-password");
            if(passwordInput){
                const stored=connection.passwordStored===true||connection.password===SERVER_PASSWORD_MARKER;
                passwordInput.value="";
                passwordInput.dataset.serverStored=stored?"1":"0";
                passwordInput.placeholder=stored?"Сохранён на сервере — оставьте пустым":"Пароль";
            }
            if($("remember-iiko")) $("remember-iiko").checked=true;
            const restaurantCount=organizations.length||departments.length;
            setStatus(chain
                ? `🟢 D1: SH Chain • ${identity.displayName||connection.displayName||"—"} • ресторанов: ${restaurantCount}`
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

    async function callConnectionEndpoint(path, credentials) {
        const auth=await authHeaders();
        const headers={"Content-Type":"application/json","Accept":"application/json"};
        if(auth?.Authorization)headers.Authorization=auth.Authorization;
        const response=await fetch(path,{
            method:"POST",
            headers,
            body:JSON.stringify(credentials)
        });
        const data=await safeJson(response);
        if(!response.ok||data.success===false)throw new Error(data.message||`HTTP ${response.status}`);
        return data;
    }

    async function handleIdentityConnection(event){
        event.preventDefault();
        const ip=$("iiko-ip")?.value.trim(), port=$("iiko-port")?.value.trim(), login=$("iiko-login")?.value.trim();
        const passwordInput=$("iiko-password");
        const enteredPassword=passwordInput?.value||"";
        const password=enteredPassword||(passwordInput?.dataset.serverStored==="1"?SERVER_PASSWORD_MARKER:"");
        const requestedChain=$("is-chain")?.checked===true;
        if(!ip||!port||!login||!password){setStatus("🟠 Заполните IP, порт, логин и пароль");return;}
        const button=$("connect-iiko"); if(button)button.disabled=true;
        setStatus("🟡 Проверяем SH Server и загружаем структуру в D1...");
        const card=$("iiko-identity"), list=$("iiko-identity-list");
        if(card&&list){card.hidden=false;list.innerHTML=`<div class="iiko-identity-empty">Определяем тип сервера и загружаем структуру...</div>`;}
        try{
            const credentials={ip,port,login,password};
            let departments=[];
            let organizations=[];
            let chainStructure=null;
            let primaryData=null;
            let serverMode="";
            let discoverySource="chain";

            try{
                const candidate=await callConnectionEndpoint("/api/iiko/chain",credentials);
                chainStructure=candidate;
                serverMode=String(candidate.detectedMode||candidate.mode||"").toUpperCase();
                departments=Array.isArray(candidate.departments)?candidate.departments.filter(x=>x?.id):[];
                organizations=Array.isArray(candidate.restaurants)?candidate.restaurants.filter(x=>x?.id):[];
            }catch(error){
                console.warn("SH corporation structure lookup failed; trying connection fallback",error);
            }

            if(!departments.length){
                discoverySource="connect-fallback";
                primaryData=await callConnectionEndpoint("/api/iiko/connect",credentials);
                departments=Array.isArray(primaryData.departments)?primaryData.departments.filter(x=>x?.id):[];
                organizations=Array.isArray(primaryData.organizations)?primaryData.organizations.filter(x=>x?.id):[];
                serverMode=String(primaryData.detectedMode||primaryData.mode||serverMode||"").toUpperCase();
            }

            if(!departments.length)throw new Error("SH Server подключён, но Department ID не найден.");
            if(serverMode!=="CHAIN"&&serverMode!=="RMS")serverMode=departments.length>1?"CHAIN":"RMS";

            const isChain=serverMode==="CHAIN"||requestedChain;
            const detectedMode=serverMode;
            const checkedAt=new Date().toISOString();
            const organizationId=String(primaryData?.organizationId||organizations[0]?.id||departments[0]?.id||"");
            const networkName=clean(chainStructure?.organization?.name||chainStructure?.organization?.Name||"");
            const restaurantName=clean(organizations[0]?.name||departments[0]?.name||primaryData?.restaurantName||"");
            const displayName=isChain?(networkName||restaurantName):restaurantName;
            const restaurantList=organizations.length?organizations:departments.map(x=>({id:x.id,name:x.name,code:x.code,parentId:x.parentId}));

            const identity={
                mode:isChain?"CHAIN":"RMS",
                detectedMode,
                organizationId,
                displayName,
                networkName,
                restaurantName,
                organizations:restaurantList,
                departmentIds:departments.map(x=>String(x.id)),
                departments,
                hierarchy:chainStructure?.hierarchy||[],
                groups:chainStructure?.groups||[],
                pointsOfSale:chainStructure?.pointsOfSale||[],
                restaurantSections:chainStructure?.restaurantSections||[],
                server:{ip,port},
                checkedAt,
                discoverySource
            };
            const connection={
                ip,port,login,password,
                connectionType:isChain?"CHAIN":"RMS",
                isChain,detectedMode,organizationId,displayName,networkName,restaurantName,
                departmentIds:identity.departmentIds,
                departments,
                organizations:restaurantList,
                hierarchy:identity.hierarchy,
                groups:identity.groups,
                pointsOfSale:identity.pointsOfSale,
                restaurantSections:identity.restaurantSections,
                connectedAt:checkedAt
            };

            await saveIikoState(connection,identity);

            if(passwordInput){
                passwordInput.value="";
                passwordInput.dataset.serverStored="1";
                passwordInput.placeholder="Сохранён на сервере — оставьте пустым";
            }
            const checkbox=$("is-chain"), hint=$("chain-hint");
            if(checkbox)checkbox.checked=isChain;
            if(hint&&checkbox)hint.classList.toggle("visible",checkbox.checked);
            renderIdentity(departments,restaurantList,identity.server,isChain,identity.groups,identity.pointsOfSale);
            setStatus(isChain
                ? `🟢 SH Chain сохранён в D1 • сеть: ${displayName||"—"} • ресторанов: ${restaurantList.length}`
                : `🟢 SH RMS сохранён в D1 • ресторан: ${displayName||"—"} • Department ID: ${organizationId||"—"}`);
            console.info("SH D1 SAVED:",{mode:identity.mode,departmentIds:identity.departmentIds,discoverySource});
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
            const passwordInput=$("iiko-password");
            if(passwordInput){passwordInput.value="";delete passwordInput.dataset.serverStored;passwordInput.placeholder="Пароль";}
            const card=$("iiko-identity"); if(card)card.hidden=true;
            setStatus("⚪ Подключение iiko удалено из D1");
        }catch(error){setStatus("🔴 " + (error?.message||error));}
    }

    function bindIdentityLookup(){
        const button=$("connect-iiko");
        if(button&&button.dataset.identityBound!=="1"){
            button.dataset.identityBound="1";
            button.addEventListener("click",handleIdentityConnection);
        }
        const clear=$("clear-iiko-data");
        if(clear&&clear.dataset.identityClearBound!=="1"){
            clear.dataset.identityClearBound="1";
            clear.addEventListener("click",handleClear);
        }
    }

    if(document.readyState==="loading"){
        document.addEventListener("DOMContentLoaded",()=>{loadSavedIdentity();bindIdentityLookup();});
    }else{
        loadSavedIdentity();
        bindIdentityLookup();
    }
})();