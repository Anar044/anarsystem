// Safe transport selection for Smart Horeca cross-RMS shipments.
// The iikoChain UI supports a receiving STORE as buyer, but the observed
// outgoingInvoice REST XML import casts counteragentId to User and crashes
// when passed a STORE. This is not a supported route for our installation.
const id=x=>String(x??"").trim().replace(/^\{+|\}+$/g,"").toLowerCase();
export const UNSUPPORTED_STORE_BUYER_MESSAGE=
  "iiko отклонил получателя-склад: REST API расходной накладной ожидает другой тип контрагента (User), а выбранный RMS является Store. "+
  "Для связанной приходной нужен поддерживаемый iikoChain способ внутренней отгрузки. "+
  "Автоматическая отгрузка через этот API временно заблокирована; товары не списаны.";
export function assessInternalShipmentRoute(order){
  const source=id(order?.central_department_id),destination=id(order?.destination_department_id);
  const receiver=id(order?.destination_store_id);
  if(source&&destination&&source!==destination&&receiver)
    return {supported:false,code:"IIKO_CROSS_RMS_STORE_BUYER_UNSUPPORTED",message:UNSUPPORTED_STORE_BUYER_MESSAGE};
  return {supported:false,code:"IIKO_ROUTE_UNVERIFIED",message:"Отгрузка не поддерживается без подтверждённого API для этой пары RMS и складов."};
}
