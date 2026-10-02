import { loadRequestIikoState, privateConnection, hasPrivateConnection } from "../../iiko/_lib/user-state.js";
import { resolveRestaurantScope } from "../../iiko/_lib/restaurant-scope.js";

function clean(v){return String(v??"").trim()}

export async function resolvePluginChainScope(request,env){
  const stored=await loadRequestIikoState(request,env);
  if(!stored?.user?.id){
    const e=new Error("Требуется авторизация.");
    e.status=401;
    e.code="AUTH_REQUIRED";
    throw e;
  }
  if(!stored.found||!stored.state||!hasPrivateConnection(stored.state)){
    const e=new Error("Подключение SH Server не найдено.");
    e.status=409;
    e.code="SH_CONNECTION_REQUIRED";
    throw e;
  }
  const scope=resolveRestaurantScope({state:stored.state,request,strict:true});
  const c=privateConnection(stored.state);
  const ip=clean(c.ip),port=clean(c.port);
  return{
    userId:stored.user.id,
    scope,
    departmentIds:[...(scope.selectedDepartmentIds||[])],
    serverUrl:ip&&port?`http://${ip}:${port}`:"",
    connection:c
  };
}

export function pluginScopeMeta(ctx){
  return{
    mode:ctx?.scope?.mode||"RMS",
    departmentIds:[...(ctx?.departmentIds||[])]
  };
}
