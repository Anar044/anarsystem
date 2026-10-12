// iiko's REST_API(2000) has a licensed concurrent-connection limit.
// This is a server licence response, NOT a product-cost or warehouse error.
export function isIikoRestApiLicenseError(error){
  const message=String(error?.message??error??"");
  return /license enhancement is required/i.test(message)&&
    /rest_api|restapi|no connections available/i.test(message)
    || /no connections available for module\s+rest_api/i.test(message);
}
export const IIKO_REST_API_LICENSE_MESSAGE =
  "На сервере iiko нет свободного лицензированного подключения REST API (модуль REST_API 2000). " +
  "Проверьте активные API-сеансы и количество подключений в лицензии iikoChain; при необходимости обратитесь к администратору iiko или дилеру. " +
  "Себестоимость временно недоступна, отгрузка не выполнена. После восстановления доступа нажмите «Повторить проверку».";
