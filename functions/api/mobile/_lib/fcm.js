// FCM HTTP v1: credentials ONLY from Cloudflare encrypted secret.
// Client never receives the service-account key.
const enc=new TextEncoder();
const clean=v=>String(v??"").trim();
const base64Url=bytes=>{
 let s="";for(const b of bytes)s+=String.fromCharCode(b);
 return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
};
const encoded=o=>base64Url(enc.encode(JSON.stringify(o)));
const authCache=new Map();
async function bearerToken(account){
 const cacheKey=account.client_email;
 const prior=authCache.get(cacheKey);
 if(prior&&prior.expires>Date.now()+60000)return prior.value;
 const now=Math.floor(Date.now()/1000);
 const claim={iss:account.client_email,scope:"https://www.googleapis.com/auth/firebase.messaging",
   aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3500};
 const head=encoded({alg:"RS256",typ:"JWT"});
 const signed=head+"."+encoded(claim);
 const pem=clean(account.private_key);
 if(!pem.includes("BEGIN PRIVATE KEY"))throw Error("FCM_PRIVATE_KEY_INVALID");
 const data=atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,""));
 const binary=Uint8Array.from(data,c=>c.charCodeAt(0));
 const key=await crypto.subtle.importKey("pkcs8",binary,
   {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
 const signature=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,enc.encode(signed));
 const assertion=signed+"."+base64Url(new Uint8Array(signature));
 const params=new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion});
 const response=await fetch("https://oauth2.googleapis.com/token",{
   method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
   body:params.toString()
 });
 const json=await response.json().catch(()=>null);
 if(!response.ok||!json?.access_token)throw Error("FCM_OAUTH_FAILED");
 authCache.set(cacheKey,{value:json.access_token,
   expires:Date.now()+Math.min(Number(json.expires_in||3000),3500)*1000});
 return json.access_token;
}
export function configuredFcm(env){
 return Boolean(clean(env?.FCM_SERVICE_ACCOUNT_JSON));
}
export function ownerFcmPayload(deviceToken,alert) {
 const payload={message:{
   token:deviceToken,
   notification:{title:"Smart Horeca • "+alert.title,body:alert.body},
   android:{
     priority:"HIGH",
     notification:{channel_id:"sh_owner_pos_alerts",sound:"default"}
   },
   // These fields are used only to navigate to the existing read-only
   // cash order endpoint. The app rechecks server-side workspace/restaurant
   // access before reading any order. Never put secrets in FCM data.
   data:{kind:alert.kind,departmentId:alert.departmentId,
     pluginId:alert.pluginId,
     ...(alert.orderNum?{orderNum:alert.orderNum}:{})}
 }};

 return payload;
}
export async function sendFcmAlert(env,deviceToken,alert){
 const raw=clean(env?.FCM_SERVICE_ACCOUNT_JSON);
 if(!raw)throw Error("FCM_NOT_CONFIGURED");
 let account;try{account=JSON.parse(raw)}catch{throw Error("FCM_SERVICE_ACCOUNT_INVALID")}
 if(!account?.client_email||!account?.private_key||!account?.project_id)
   throw Error("FCM_SERVICE_ACCOUNT_INCOMPLETE");
 const bearer=await bearerToken(account);
 const payload=ownerFcmPayload(deviceToken,alert);
 const resp=await fetch("https://fcm.googleapis.com/v1/projects/"+
   encodeURIComponent(account.project_id)+"/messages:send",{
   method:"POST",headers:{"Authorization":"Bearer "+bearer,
      "Content-Type":"application/json"},
   body:JSON.stringify(payload)
 });
 const body=await resp.json().catch(()=>({}));
 if(!resp.ok){
   const code=clean(body?.error?.details?.[0]?.errorCode||
     body?.error?.status||"FCM_DELIVERY_FAILED");
   const e=new Error("FCM_"+code);e.code=code;
   e.status=resp.status;throw e;
 }
 return body.name;
}
