import test from "node:test";
import assert from "node:assert/strict";
import {isIikoRestApiLicenseError,IIKO_REST_API_LICENSE_MESSAGE} from "../functions/api/_lib/internal-order-license.js";

test("classifies real iiko REST_API(2000) licence limit denial",()=>{
  assert.equal(isIikoRestApiLicenseError(new Error("Ошибка авторизации Smart Horeca Server: HTTP 403 — License enhancement is required: no connections available for module REST_API(2000) 'API (RestApi)'")),true);
  assert.equal(isIikoRestApiLicenseError("License enhancement is required: REST_API(2000)"),true);
});
test("does not misclassify wrong credentials, forbidden RMS or stock errors",()=>{
  assert.equal(isIikoRestApiLicenseError(new Error("HTTP 403, wrong password")),false);
  assert.equal(isIikoRestApiLicenseError(new Error("Нет доступных складов RMS")),false);
  assert.equal(isIikoRestApiLicenseError(new Error("HTTP 503 connection timeout")),false);
});
test("licence error provides recovery steps and forbids shipments",()=>{
  assert.match(IIKO_REST_API_LICENSE_MESSAGE,/REST API/);
  assert.match(IIKO_REST_API_LICENSE_MESSAGE,/отгрузка не выполнена/);
});
