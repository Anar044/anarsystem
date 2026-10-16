import test from "node:test";
import assert from "node:assert/strict";
import {isIikoLicenseSeatExhausted} from "../functions/api/iiko/_lib/iiko-client.js";

test("iiko REST API licence exhaustion is recognized separately from expired token",()=>{
 assert.equal(isIikoLicenseSeatExhausted("License enhancement is required: no connections available for module REST_API(2000) 'API (RestApi)'"),true);
 assert.equal(isIikoLicenseSeatExhausted("Token expired"),false);
 assert.equal(isIikoLicenseSeatExhausted("Access denied for user"),false);
});
