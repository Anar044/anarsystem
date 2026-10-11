import test from "node:test";
import assert from "node:assert/strict";
import {assessInternalShipmentRoute,UNSUPPORTED_STORE_BUYER_MESSAGE} from "../functions/api/_lib/internal-order-route.js";

test("cross-RMS invoice REST route is rejected before an iiko write",()=>{
  const route=assessInternalShipmentRoute({central_department_id:"central",destination_department_id:"rms2",destination_store_id:"rms2-kitchen"});
  assert.equal(route.supported,false);
  assert.equal(route.code,"IIKO_CROSS_RMS_STORE_BUYER_UNSUPPORTED");
  assert.match(route.message,/Store/);
});
test("same-RMS route is not silently treated as cross-company invoice",()=>{
  const route=assessInternalShipmentRoute({central_department_id:"rms1",destination_department_id:"rms1",destination_store_id:"store-b"});
  assert.equal(route.supported,false);
  assert.equal(route.code,"IIKO_ROUTE_UNVERIFIED");
});
test("missing source RMS is rejected safely rather than guessing receiver",()=>{
  const route=assessInternalShipmentRoute({central_department_id:"",destination_department_id:"rms2",destination_store_id:"store2"});
  assert.equal(route.supported,false);
  assert.match(route.message,/подтверждённого API/);
});
test("error message says user action is blocked, without inventing a replacement buyer",()=>{
  assert.match(UNSUPPORTED_STORE_BUYER_MESSAGE,/временно заблокирована/);
  assert.match(UNSUPPORTED_STORE_BUYER_MESSAGE,/связанной приходной/);
});
