import {fail,clean} from './orders.js';

const guid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const same=(a,b)=>clean(a,100).toLowerCase()===clean(b,100).toLowerCase();

/**
 * Shared D1 is acceptable for the QR table catalog, but only for one
 * explicitly allowlisted test restaurant + plugin on one preview host.
 * These are server-side Cloudflare vars, NEVER browser values.
 * No separate D1 is required. Default is fail closed.
 */
export function requireTableSyncScope(request,env,{departmentId,pluginId}){
  const host=new URL(request.url).hostname.toLowerCase();
  const mode=clean(env.QR_TABLE_SYNC_MODE,24);
  const preview=clean(env.QR_TABLE_SYNC_PREVIEW_HOST,250).toLowerCase();
  const allowedRestaurant=clean(env.QR_TABLE_SYNC_DEPARTMENT_ID,100);
  const allowedPlugin=clean(env.QR_TABLE_SYNC_PLUGIN_ID,100);
  const isProduction=host==='smarthoreca.pages.dev'||host==='web.smarthoreca.az';
  if(isProduction||!preview||host!==preview)
    throw fail('QR_TABLE_SYNC_HOST_FORBIDDEN',
      'Синхронизация столов разрешена только на указанном тестовом адресе',403);
  if(mode==='shared-test'){
    if(!guid.test(allowedRestaurant)||!guid.test(allowedPlugin)||
        !same(departmentId,allowedRestaurant)||!same(pluginId,allowedPlugin))
      throw fail('QR_TABLE_SYNC_TEST_SCOPE_FORBIDDEN',
        'Эта тестовая касса или ресторан не разрешены для общей D1',403);
    return 'shared-test';
  }
  if(mode==='isolated-test'&&clean(env.QR_TEST_D1_ISOLATED)==='confirmed'){
    if(!guid.test(allowedRestaurant)||!guid.test(allowedPlugin)||
        !same(departmentId,allowedRestaurant)||!same(pluginId,allowedPlugin))
      throw fail('QR_TABLE_SYNC_TEST_SCOPE_FORBIDDEN',
        'Эта тестовая касса или ресторан не разрешены',403);
    return 'isolated-test';
  }
  throw fail('QR_TABLE_SYNC_NOT_CONFIGURED',
    'Режим синхронизации столов не настроен администратором',409);
}

export function isSharedD1Test(env){
  return clean(env?.QR_TABLE_SYNC_MODE,24)==='shared-test';
}
