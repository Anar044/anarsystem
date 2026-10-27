import { mobileContext, response, errorResponse, MobileError } from "../_lib/context.js";
import { onRequestPost as sourcePost, onRequestGet as sourceGet } from "../../ai-assistant.js";
import { clean } from "../_lib/query-helpers.js";

export function scopedRequest(request, ctx, { method = "GET", body } = {}) {
  const headers = new Headers(request.headers);
  // The assistant's existing restaurant scope resolver reads this fixed cookie;
  // derive it from the server-validated mobile selection, not from the client.
  // The web AI resolver reads sh_workspace_id from a cookie, whereas mobile
  // authentication uses the X-SH-Workspace-Id header. Both cookie values
  // MUST come from mobileContext's verified workspace and department scope.
  // Never forward an arbitrary mobile-provided Cookie header.
  headers.set("Cookie", "sh_workspace_id=" +
    encodeURIComponent(ctx.access.workspace.id) +
    "; sh_selected_departments=" +
    encodeURIComponent(ctx.selectedIds.join(",")));
  headers.set("X-SH-Workspace-Id", ctx.access.workspace.id);
  headers.set("X-SH-Mobile-Strict-Scope", "1");
  if (method === "POST") headers.set("Content-Type", "application/json");
  return new Request(request.url, {
    method, headers, ...(method === "POST" ? { body: JSON.stringify(body) } : {})
  });
}

export async function onRequestGet({ request, env }) {
  try {
    const ctx = await mobileContext(request,env);
    const url = new URL(request.url);
    const action = clean(url.searchParams.get("action")||"status");
    if (!["status","conversations","messages"].includes(action)) {
      throw new MobileError("AI_ACTION_FORBIDDEN","Недопустимый запрос AI.",400);
    }
    const sourceRequest = scopedRequest(request,ctx);
    const result = await sourceGet({request:sourceRequest,env});
    const data = await result.json().catch(() => null);
    if (!result.ok || !data?.success) {
      const status = [400,401,403,404,409,429,502,503,504]
        .includes(result.status) ? result.status : 502;
      throw new MobileError(
        clean(data?.code) || "AI_SOURCE_FAILED",
        clean(data?.message) ||
          (result.status===503
            ? "AI Assistant временно недоступен (503)."
            : "AI Assistant не ответил на запрос."),
        status
      );
    }
    return response(data);
  }catch(error){return errorResponse(error);}
}

export async function onRequestPost({request,env}) {
  try {
    const ctx = await mobileContext(request,env,{connectionRequired:true});
    const body = await request.json().catch(()=>null);
    if (!body || typeof body !== "object" || Array.isArray(body) || body.action !== "message") {
      throw new MobileError("AI_ACTION_FORBIDDEN","Разрешены только аналитические сообщения.",400);
    }
    const message = clean(body.message);
    if(!message || message.length>4000) throw new MobileError("INVALID_AI_MESSAGE","Укажите вопрос до 4000 символов.",400);
    const conversationId = clean(body.conversationId);
    if (conversationId.length>150) throw new MobileError("INVALID_CHAT_ID","Некорректный разговор.",400);
    const sourceRequest = scopedRequest(request,ctx,{method:"POST",body:{
      action:"message", message,
      conversationId:conversationId||undefined,
      departmentIds:ctx.selectedIds
    }});
    const result = await sourcePost({request:sourceRequest,env});
    if (!result.ok) {
      const failure = await result.json().catch(()=>({}));
      const status = [400,401,403,404,409,429,502,503,504]
        .includes(result.status) ? result.status : 502;
      throw new MobileError(clean(failure.code)||"AI_SOURCE_FAILED",
        clean(failure.message)||"AI Assistant недоступен.",status);
    }
    const payload=await result.json();
    if(!payload?.success) throw new MobileError("AI_UNAVAILABLE","AI Assistant не ответил.",502);
    return response({
      success:true, conversationId:clean(payload.conversationId),
      answer:clean(payload.answer),
      kind:clean(payload.meta?.kind||"text"),
      report:payload.meta?.report||null,
      chart:payload.meta?.chart||null,
      // The web AI produces up to three structured charts in meta.charts.
      // Previously this mobile adapter silently discarded every one of them.
      charts:Array.isArray(payload.meta?.charts)
        ? payload.meta.charts
            .filter(item=>item&&typeof item==="object"&&Array.isArray(item.series))
            .slice(0,3) : [],
      sourceWarnings:Array.isArray(payload.meta?.sourceWarnings)
        ? payload.meta.sourceWarnings.slice(0,5).map(item=>({
            name:clean(item?.name).slice(0,80),
            code:clean(item?.code).slice(0,80),
            ...(Number.isInteger(item?.status)?{status:item.status}:{})
          })) : [],
      selectedDepartmentIds:ctx.selectedIds
    });
  }catch(error){return errorResponse(error);}
}
