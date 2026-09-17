async function postJson({url,token,body,timeoutMs=10000}){
  if(!token)throw new Error('SmartHoreca device token is not configured');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':`Bearer ${token}`,
        'User-Agent':'SmartHoreca-ZKTeco-Connector/0.2'
      },
      body:JSON.stringify(body||{}),
      signal:controller.signal
    });
    const text=await response.text();
    let payload={};
    try{payload=text?JSON.parse(text):{};}catch{payload={raw:text};}
    if(!response.ok){
      const message=payload?.message||payload?.error||`HTTP ${response.status}`;
      const error=new Error(message);
      error.status=response.status;
      error.payload=payload;
      throw error;
    }
    return payload;
  }catch(error){
    if(error?.name==='AbortError')throw new Error(`SmartHoreca request timeout after ${timeoutMs} ms`);
    throw error;
  }finally{
    clearTimeout(timer);
  }
}

export async function sendEvents({baseUrl,ingestPath,token,events,timeoutMs=10000}){
  if(!Array.isArray(events)||!events.length)return{success:true,received:0};
  return postJson({url:`${baseUrl}${ingestPath}`,token,body:{events},timeoutMs});
}

export async function sendHeartbeat({baseUrl,heartbeatPath,token,payload,timeoutMs=10000}){
  return postJson({url:`${baseUrl}${heartbeatPath}`,token,body:payload,timeoutMs});
}
