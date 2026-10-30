import {adminContext,response,bad} from './_lib/orders.js';
import {registeredPosRegisters} from './_lib/pos-registers.js';

export async function onRequestGet({request,env}){
  try{
    const ctx=await adminContext(request,env);
    const registers=await registeredPosRegisters(env,ctx.restaurantId);
    return response({
      success:true,
      restaurantId:ctx.restaurantId,
      registers
    });
  }catch(error){
    return bad(Number(error?.status)||500,error?.code||'QR_POS_REGISTRY_ERROR',
      error?.status?error.message:'Не удалось получить зарегистрированные кассы');
  }
}
