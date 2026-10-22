// Private Cloudflare Worker, callable only through a Pages service binding.
// Each Durable Object owns ONE tenant/credential pair and serializes all calls.
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
function outgoing(upstream, body, cached) {
  const headers=new Headers({"cache-control":"no-store","x-sh-broker-result":"upstream","x-sh-broker-cache":cached?"1":"0"});
  const ct=upstream.headers.get("content-type");
  if(ct)headers.set("content-type",ct);
  return new Response([204,205,304].includes(upstream.status)?null:body,{status:upstream.status,headers});
}
function fail(code,message,status=503) {return json({success:false,code,message},status);}

export class IikoSession {
  constructor(state,env) {
    this.state=state;
    this.env=env;
    this.tail=Promise.resolve();
  }
  fetch(request) {
    const work=this.tail.then(()=>this.handle(request));
    this.tail=work.catch(()=>{});
    return work;
  }
  async savedToken(scope) {
    const stored=await this.state.storage.get("session");
    if(!stored)return "";
    // Fail closed on key rotation/decryption failure: do not allocate a new
    // license while an existing, possibly live, session is unrecoverable.
    return decrypt(this.env,stored,scope);
  }
  async authenticate(c,scope) {
    const blocked=Number(await this.state.storage.get("authBlockedUntil")||0);
    if(blocked>Date.now())throw Object.assign(Error("Authorization cooldown after uncertain result"),{code:"AUTH_COOLDOWN"});
    const pass=await sha1(c.password);
    const url=`${c.serverUrl}/resto/api/auth?login=${encodeURIComponent(c.login)}&pass=${pass}`;
    const method=this.env.IIKO_AUTH_METHOD==="POST"?"POST":"GET"; // GET is currently used in production; change only after live compatibility test.
    let response, token;
    try {
      response=await sleepAbort(url,{method,cache:"no-store",redirect:"manual"},12000);
      token=(await response.text()).trim();
    } catch {
      await this.state.storage.put("authBlockedUntil",Date.now()+70*60_000);
      throw Object.assign(Error("iiko authentication result unknown; no retry attempted"),{code:"AUTH_UNCERTAIN"});
    }
    if(!response.ok || !token) {
      if([403,429,500,502,503,504].includes(response.status)||response.ok)
        await this.state.storage.put("authBlockedUntil",Date.now()+70*60_000);
      throw Object.assign(Error(`iiko authentication HTTP ${response.status}; no retry attempted`),{code:"AUTH_FAILED"});
    }
    // Persist BEFORE using the new token. Durable storage survives object eviction.
    await this.state.storage.put("session",await encrypt(this.env,token,scope));
    await this.state.storage.delete("authBlockedUntil");
    return token;
  }
  async call(c,token,raw,params) {
    const method=clean(params.method||"GET").toUpperCase();
    if(!["GET","POST","PUT","PATCH","DELETE"].includes(method))throw Error("Method not allowed");
    const path=safePath(raw);
    const u=new URL(path,c.serverUrl);
    u.searchParams.set("key",token);
    const headers=safeHeaders(params.headers);
    const body=params.body;
    if(body!==undefined && body!==null && typeof body!=="string")throw Error("Only string bodies supported");
    if(["GET","DELETE"].includes(method) && body)throw Error("Body not allowed for this method");
    const response=await sleepAbort(u.toString(),{method,headers,body:body||undefined,cache:"no-store",redirect:"manual"},Number(params.timeoutMs)>0?Math.min(Number(params.timeoutMs),60000):20000);
    // iiko can return binary QR/menu images as well as JSON and XML.
    // Keep the raw bytes; text decoding would corrupt JPEG/PNG responses.
    return {response,body:await response.arrayBuffer()};
  }
  async handle(request) {
    try {
      const input=await request.json();
      const tenantId=clean(input.tenantId);
      if(!tenantId || tenantId.length>256)throw Error("Missing verified tenant");
      const c=connectionOf(input.connection);
      const scope=await hash(JSON.stringify([tenantId,c.serverUrl,c.login,await hash(c.password)]));
      const action=input.action;
      let token=await this.savedToken(scope);
      if(action==="logout"){
        if(!token)return json({success:true,released:false},200);
        const url=`${c.serverUrl}/resto/api/logout?key=${encodeURIComponent(token)}`;
        const response=await sleepAbort(url,{method:"GET",cache:"no-store",redirect:"manual"},12000);
        if(response.ok||response.status===401){
          await this.state.storage.delete("session");
          return json({success:true,released:true},200);
        }
        return fail("LOGOUT_FAILED",`iiko logout HTTP ${response.status}`,502);
      }
      if(action!=="request")throw Error("Invalid action");
      // All validation happens before a licensed login.
      safePath(input.request?.path);
      safeHeaders(input.request?.headers);
      if(!["GET","POST","PUT","PATCH","DELETE"].includes(clean(input.request?.method||"GET").toUpperCase()))throw Error("Bad method");
      const wasCached=!!token;
      if(!token)token=await this.authenticate(c,scope);
      let result=await this.call(c,token,input.request.path,input.request);
      if(result.response.status===401 && wasCached && input.request.retryAuth!==false) {
        await this.state.storage.delete("session");
        // A single new login and data retry is permitted after an explicit stale-token 401.
        token=await this.authenticate(c,scope);
        result=await this.call(c,token,input.request.path,input.request);
      }
      if(result.response.status===401){
        await this.state.storage.delete("session");
        // A newly allocated token rejected by iiko must not trigger a login
        // storm from subsequent independent requests.
        if(!wasCached || input.request.retryAuth!==false)
          await this.state.storage.put("authBlockedUntil",Date.now()+70*60_000);
      }
      return outgoing(result.response,result.body,wasCached);
    } catch(error) {
      const code=["AUTH_UNCERTAIN","AUTH_COOLDOWN","AUTH_FAILED"].includes(error?.code)?error.code:"BROKER_ERROR";
      // Do not expose upstream auth URLs, login, password hash, token, or stack traces.
      return fail(code,code==="BROKER_ERROR"?"Central iiko session broker request failed":error.message);
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
      const input=await request.json();
      const tenantId=clean(input?.tenantId), c=connectionOf(input?.connection);
      if(!tenantId || tenantId.length>256)throw Error("Verified tenant required");
      // Fail closed against SSRF to arbitrary hosts if the service is
      // accidentally reachable from a trusted application route.
      const allowed=String(env.IIKO_ALLOWED_TARGETS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
      if(!allowed.includes((c.ip+":"+c.port).toLowerCase()))
        return fail("TARGET_DENIED","iiko host is not registered in broker allowlist",403);
      const idKey=await hash(JSON.stringify([tenantId,c.serverUrl,c.login,await hash(c.password)]));
      const object=env.IIKO_SESSIONS.get(env.IIKO_SESSIONS.idFromName(idKey));
      return object.fetch(new Request("https://broker.internal/request",{method:"POST",body:JSON.stringify(input),
        headers:{"content-type":"application/json"}}));
    } catch {return fail("BAD_REQUEST","Invalid private broker request",400)}
  }
};
