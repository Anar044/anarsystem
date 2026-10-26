// Private Cloudflare Worker, callable only through a Pages service binding.
// Each Durable Object owns ONE tenant/credential pair. Only authentication
// is serialized; independent data calls use a bounded concurrent pool.
// Never expose this Worker on a public route.
const te = new TextEncoder();
const json = (data, status = 500) => new Response(JSON.stringify(data), {
  status, headers: {"content-type":"application/json; charset=utf-8", "cache-control":"no-store", "x-sh-broker-result":"error"}
});
const clean = value => String(value ?? "").trim();
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(value))))
  .map(x=>x.toString(16).padStart(2,"0")).join("");
const sha1 = async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", te.encode(value))))
  .map(x=>x.toString(16).padStart(2,"0")).join("");
const sleepAbort = (url, init, ms) => fetch(url, {...init, signal: AbortSignal.timeout(ms)});

async function encryptionKey(env) {
  const raw = env.IIKO_BROKER_ENCRYPTION_KEY_B64;
  if (!raw) throw Error("Encryption key missing");
  const bytes = Uint8Array.from(atob(raw), c=>c.charCodeAt(0));
  if (bytes.length !== 32) throw Error("Encryption key must be 32 bytes");
  return crypto.subtle.importKey("raw",bytes,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
async function encrypt(env, value, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:te.encode(aad)},await encryptionKey(env),te.encode(value));
  return {iv:Array.from(iv),bytes:Array.from(new Uint8Array(buf))};
}
async function decrypt(env, item, aad) {
  if (!item || !Array.isArray(item.iv) || !Array.isArray(item.bytes)) throw Error("Invalid saved session");
  const result=await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(item.iv),additionalData:te.encode(aad)},
    await encryptionKey(env),new Uint8Array(item.bytes));
  return new TextDecoder().decode(result);
}
// Host-only entries intentionally permit any valid TCP port on that ONE exact
// DNS host. Host:port entries continue to restrict to a single iiko endpoint.
// Never interpret wildcards, URLs, suffix matches, IP ranges, or subdomains.
function allowedIikoTarget(env, c) {
  const host=c.ip.toLowerCase();
  const exact=host+":"+c.port;
  const entries=String(env.IIKO_ALLOWED_TARGETS||"")
    .split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
  return entries.some(entry=>{
    if(entry===exact)return true;
    if(entry!==host)return false;
    // Restrict the broad all-ports form to exact DNS hostnames, not literal
    // IPv4 addresses or local single-label names.
    if(!host.includes(".") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host))return false;
    if(host==="localhost" || host.endsWith(".localhost") || host.endsWith(".local"))return false;
    return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(host);
  });
}

function connectionOf(item) {
  const ip=clean(item?.ip),port=clean(item?.port),login=clean(item?.login),password=String(item?.password ?? "");
  // Do not allow URI injection; an explicit enterprise allowlist should additionally
  // restrict iiko destinations before enabling this on production.
  if (!/^[a-z0-9.-]{1,253}$/i.test(ip) || !/^\d{1,5}$/.test(port) || Number(port)<1 || Number(port)>65535 ||
      !login || !password || login.length>256 || password.length>1024) throw Error("Invalid connection");
  return {ip,port,login,password,serverUrl:`http://${ip}:${port}`};
}
function safePath(raw) {
  if (typeof raw !== "string" || raw.length > 3000 || !raw.startsWith("/resto/api/") ||
      /[\\#\r\n]/.test(raw) || /%2f|%5c|%00/i.test(raw)) throw Error("Invalid iiko path");
  const u = new URL(raw,"http://placeholder.invalid");
  if(u.host!=="placeholder.invalid" || !u.pathname.startsWith("/resto/api/") ||
     /\/(auth|logout)\/?$/i.test(u.pathname) || u.searchParams.has("key")) throw Error("Unsafe iiko path");
  return raw;
}
function safeHeaders(value) {
  const h=new Headers();
  if (value && typeof value==="object") {
    for(const [key,val] of Object.entries(value)) {
      const k=key.toLowerCase();
      if(k!=="accept" && k!=="content-type") throw Error("Forbidden header");
      h.set(k,String(val));
    }
  }
  return h;
}
function fail(code,message,status=503) {return json({success:false,code,message},status);}


function parallelism(env) {
  const n=Number(env.IIKO_MAX_PARALLEL_REQUESTS);
  return Number.isInteger(n) && n>=1 && n<=5 ? n : 1;
}
function queueCapacity(env) {
  const n=Number(env.IIKO_MAX_PENDING_REQUESTS);
  return Number.isInteger(n) && n>=1 && n<=500 ? n : 100;
}
function validatedRequest(item) {
  if(!item || typeof item!=="object")throw Error("Missing iiko request");
  const path=safePath(item.path);
  const method=clean(item.method||"GET").toUpperCase();
  if(!["GET","POST","PUT","PATCH","DELETE"].includes(method))throw Error("Invalid iiko request method");
  safeHeaders(item.headers);
  const body=item.body;
  if(body!==undefined && body!==null && typeof body!=="string")throw Error("Only string bodies supported");
  if(body && body.length>3*1024*1024)throw Error("iiko request body too large");
  if(["GET","DELETE"].includes(method) && body)throw Error("Body not allowed for this method");
  return {...item,method,path};
}
function shareableRead(params) {
  if(params.method==="POST" && params.path==="/resto/api/v2/reports/olap")return true;
  if(params.method!=="GET")return false;
  return /^\/resto\/api\/(corporation\/|v2\/reports\/|v2\/images\/|images\/|documents\/export\/|suppliers(?:\?|\/|$)|products(?:\?|\/|$)|v2\/entities\/)/.test(params.path);
}

export class IikoSession {
  constructor(state,env) {
    this.state=state;
    this.env=env;
    // Authentication is the ONLY single-flight exclusive section.
    // Data I/O is governed by an independent bounded FIFO semaphore.
    this.authTail=Promise.resolve();
    this.active=0;
    this.waiting=[];
    this.activities=new Set();
    this.sharedReads=new Map();
    this.draining=false;
    this.maxParallel=parallelism(env);
    this.maxPending=queueCapacity(env);
    this.cachedToken="";
    this.cachedScope="";
  }
  async withAuthLock(task) {
    const previous=this.authTail;
    let release;
    this.authTail=new Promise(resolve=>{release=resolve});
    await previous;
    try{return await task()}
    finally{release()}
  }
  acquireSlot() {
    if(this.active<this.maxParallel && !this.waiting.length){
      this.active++;
      return Promise.resolve();
    }
    if(this.waiting.length>=this.maxPending) {
      throw Object.assign(Error("iiko request queue full"),{code:"BROKER_BUSY"});
    }
    return new Promise(resolve=>this.waiting.push(resolve));
  }
  releaseSlot() {
    const next=this.waiting.shift();
    if(next)next();
    else this.active--;
  }
  async withSlot(task) {
    const started=Date.now();
    await this.acquireSlot();
    const waitMs=Date.now()-started;
    try{return {data:await task(),waitMs}}
    finally{this.releaseSlot()}
  }
  async savedToken(scope) {
    if(this.cachedToken && this.cachedScope===scope)return this.cachedToken;
    const stored=await this.state.storage.get("session");
    if(!stored){
      this.cachedToken="";
      this.cachedScope="";
      return "";
    }
    // An unreadable token could still own a license: fail closed.
    const token=await decrypt(this.env,stored,scope);
    this.cachedToken=token;
    this.cachedScope=scope;
    return token;
  }
  async authenticate(c,scope) {
    // Invalid/missing encryption keys MUST fail before licensed /auth.
    // Otherwise iiko could allocate a REST_API(2000) seat that we cannot save.
    await encryptionKey(this.env);
    const blocked=Number(await this.state.storage.get("authBlockedUntil")||0);
    if(blocked>Date.now())
      throw Object.assign(Error("Authorization cooldown after uncertain result"),{code:"AUTH_COOLDOWN"});
    const pass=await sha1(c.password);
    const url=c.serverUrl+"/resto/api/auth?login="+encodeURIComponent(c.login)+"&pass="+pass;
    const method=this.env.IIKO_AUTH_METHOD==="POST"?"POST":"GET";
    let response,token;
    try{
      response=await sleepAbort(url,{method,cache:"no-store",redirect:"manual"},12000);
      token=(await response.text()).trim();
    }catch{
      await this.state.storage.put("authBlockedUntil",Date.now()+70*60_000);
      throw Object.assign(Error("iiko authentication result unknown; no retry attempted"),{code:"AUTH_UNCERTAIN"});
    }
    if(!response.ok || !token){
      if([403,429,500,502,503,504].includes(response.status)||response.ok)
        await this.state.storage.put("authBlockedUntil",Date.now()+70*60_000);
      throw Object.assign(Error("iiko authentication HTTP "+response.status+"; no retry attempted"),{code:"AUTH_FAILED"});
    }
    await this.state.storage.put("session",await encrypt(this.env,token,scope));
    this.cachedToken=token;
    this.cachedScope=scope;
    await this.state.storage.delete("authBlockedUntil");
    return token;
  }
  async ensureToken(c,scope) {
    return this.withAuthLock(async()=>{
      const token=await this.savedToken(scope);
      if(token)return {token,cached:true};
      return {token:await this.authenticate(c,scope),cached:false};
    });
  }
  async refreshStaleToken(c,scope,oldToken) {
    // Concurrent 401 replies all compare against durable state. Only the
    // first one may allocate a new licensed session.
    return this.withAuthLock(async()=>{
      const now=await this.savedToken(scope);
      if(now && now!==oldToken)return now;
      if(now===oldToken){
        await this.state.storage.delete("session");
        this.cachedToken="";
        this.cachedScope="";
      }
      return this.authenticate(c,scope);
    });
  }
  async rejectToken(scope,token,cooldown) {
    await this.withAuthLock(async()=>{
      const current=await this.savedToken(scope);
      if(current===token){
        await this.state.storage.delete("session");
        this.cachedToken="";
        this.cachedScope="";
        if(cooldown)await this.state.storage.put("authBlockedUntil",Date.now()+70*60_000);
      }
    });
  }
  async call(c,token,params) {
    const u=new URL(params.path,c.serverUrl);
    u.searchParams.set("key",token);
    const headers=safeHeaders(params.headers);
    const maxTime=Number(params.timeoutMs)>0?Math.min(Number(params.timeoutMs),60000):20000;
    const response=await sleepAbort(u.toString(),{
      method:params.method,headers,body:params.body||undefined,
      cache:"no-store",redirect:"manual"
    },maxTime);
    // Keep raw image, XML and JSON bytes.
    return {response,body:await response.arrayBuffer()};
  }
  async requestData(c,scope,params) {
    const {token:initial,cached}=await this.ensureToken(c,scope);
    let token=initial;
    let totalWait=0,totalUpstream=0;
    const execute=async()=>{
      const start=Date.now();
      const result=await this.withSlot(()=>this.call(c,token,params));
      totalWait+=result.waitMs;
      totalUpstream+=Date.now()-start-result.waitMs;
      return result.data;
    };
    let result=await execute();
    if(result.response.status===401 && cached && params.retryAuth!==false){
      token=await this.refreshStaleToken(c,scope,initial);
      result=await execute();
    }
    if(result.response.status===401){
      const shouldCooldown=token!==initial || !cached;
      await this.rejectToken(scope,token,shouldCooldown);
    }
    return {result,cached,metric:{
      waitMs:totalWait,upstreamMs:totalUpstream,parallel:this.maxParallel
    }};
  }
  async runRequest(input) {
    const c=connectionOf(input.connection);
    const scope=await hash(JSON.stringify([clean(input.tenantId),c.serverUrl,c.login,await hash(c.password)]));
    // Validate first: a bad request must never consume an auth license.
    const params=validatedRequest(input.request);
    const dedupeKey=shareableRead(params)
      ?JSON.stringify([params.method,params.path,params.headers||{},params.body||""]):"";
    let shared=false;
    let task=dedupeKey?this.sharedReads.get(dedupeKey):null;
    if(task)shared=true;
    else {
      task=this.requestData(c,scope,params);
      if(dedupeKey)this.sharedReads.set(dedupeKey,task);
    }
    let data;
    try{data=await task}
    finally{if(dedupeKey && !shared && this.sharedReads.get(dedupeKey)===task)this.sharedReads.delete(dedupeKey)}
    const {result,cached,metric}=data;
    const upstream=result.response;
    const headers=new Headers({
      "cache-control":"no-store",
      "x-sh-broker-result":"upstream",
      "x-sh-broker-cache":cached?"1":"0"
    });
    const contentType=upstream.headers.get("content-type");
    if(contentType)headers.set("content-type",contentType);
    headers.set("x-sh-broker-wait-ms",String(metric.waitMs));
    headers.set("x-sh-broker-upstream-ms",String(metric.upstreamMs));
    headers.set("x-sh-broker-parallel",String(metric.parallel));
    headers.set("x-sh-broker-coalesced",shared?"1":"0");
    // Construct once: no extra arrayBuffer()/Response round trip.
    return new Response([204,205,304].includes(upstream.status)?null:result.body,{
      status:upstream.status,headers
    });
  }
  async logout(input) {
    if(this.draining)return fail("BROKER_BUSY","iiko broker is already draining",429);
    this.draining=true;
    try{
      // No new operations enter; finish writes already accepted before
      // revoking the session (especially internal order shipments).
      await Promise.allSettled([...this.activities]);
      const c=connectionOf(input.connection);
      const scope=await hash(JSON.stringify([clean(input.tenantId),c.serverUrl,c.login,await hash(c.password)]));
      return this.withAuthLock(async()=>{
        const token=await this.savedToken(scope);
        if(!token)return json({success:true,released:false},200);
        const url=c.serverUrl+"/resto/api/logout?key="+encodeURIComponent(token);
        const response=await sleepAbort(url,{method:"GET",cache:"no-store",redirect:"manual"},12000);
        if(response.ok || response.status===401){
          await this.state.storage.delete("session");
        this.cachedToken="";
        this.cachedScope="";
          return json({success:true,released:true},200);
        }
        return fail("LOGOUT_FAILED","iiko logout HTTP "+response.status,502);
      });
    }finally{this.draining=false}
  }
  async fetch(request) {
    try{
      const input=await request.json();
      if(!input || !clean(input.tenantId) || clean(input.tenantId).length>256)
        throw Error("Missing verified tenant");
      if(input.action==="logout")return await this.logout(input);
      if(input.action!=="request")throw Error("Invalid action");
      if(this.draining)return fail("BROKER_DRAINING","iiko broker is draining",503);
      // Bound admitted operations BEFORE auth to avoid memory pressure and
      // another license allocation during overload.
      if(this.activities.size>=this.maxPending+this.maxParallel)
        return fail("BROKER_BUSY","Too many pending iiko requests",429);
      const task=this.runRequest(input);
      this.activities.add(task);
      try{return await task}
      finally{this.activities.delete(task)}
    }catch(error){
      const code=["AUTH_UNCERTAIN","AUTH_COOLDOWN","AUTH_FAILED","BROKER_BUSY"].includes(error?.code)
        ?error.code:"BROKER_ERROR";
      return fail(code,code==="BROKER_ERROR"?"Central iiko session broker request failed":error.message,
        code==="BROKER_BUSY"?429:503);
    }
  }
}

export default {
  async fetch(request,env) {
    if(request.method!=="POST")return fail("FORBIDDEN","Private service only",403);
    const shared=String(env.IIKO_BROKER_SERVICE_SECRET||"");
    const received=String(request.headers.get("x-sh-broker-secret")||"");
    const a=await hash(shared),b=await hash(received);
    let mismatch=0;
    for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);
    if(!shared || !received || mismatch!==0)return fail("FORBIDDEN","Private service only",403);
    try {
      if(!env.IIKO_SESSIONS || !env.IIKO_BROKER_ENCRYPTION_KEY_B64)return fail("CONFIG_MISSING","Broker is not configured",503);
      // Verify key material before entering the Durable Object. An invalid
      // key must never trigger a new licensed iiko authentication attempt.
      try {await encryptionKey(env)}catch{return fail("ENCRYPTION_CONFIG_INVALID","Broker encryption is invalid",503)}
      const input=await request.json();
      const tenantId=clean(input?.tenantId), c=connectionOf(input?.connection);
      if(!tenantId || tenantId.length>256)throw Error("Verified tenant required");
      // Fail closed against SSRF to arbitrary hosts if the service is
      // accidentally reachable from a trusted application route.
      if(!allowedIikoTarget(env,c))
        return fail("TARGET_DENIED","iiko host or port is not registered in broker allowlist",403);
      // Private, license-free readiness probe. It validates the exact server
      // target, service secret, SQLite Durable Object binding and AES key.
      // It MUST NOT create a Durable Object, authorize to iiko, use a token,
      // or return the server address or credentials to the Pages caller.
      if(input.action==="status"){
        try {await encryptionKey(env)}
        catch {return fail("ENCRYPTION_CONFIG_INVALID","Broker encryption key is invalid",503)}
        return json({success:true,code:"BROKER_READY",readOnly:true},200);
      }
      const idKey=await hash(JSON.stringify([tenantId,c.serverUrl,c.login,await hash(c.password)]));
      const object=env.IIKO_SESSIONS.get(env.IIKO_SESSIONS.idFromName(idKey));
      return object.fetch(new Request("https://broker.internal/request",{method:"POST",body:JSON.stringify(input),
        headers:{"content-type":"application/json"}}));
    } catch {return fail("BAD_REQUEST","Invalid private broker request",400)}
  }
};
