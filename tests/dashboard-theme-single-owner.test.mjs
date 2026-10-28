import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
test("Dashboard uses one owner for loading Smart Horeca theme CSS",()=>{
  const html=read("dashboard.html");
  const first=read("smart-horeca-theme-loader.js");
  const primary=read("dashboard-theme-loader.js");
  assert.doesNotMatch(html,/src=["']smart-horeca-theme-loader\.js/);
  assert.match(html,/src=["']dashboard-theme-loader\.js/);
  assert.match(html,/localStorage\.setItem\(k,'1'\)/);
  assert.match(primary,/brand\.href='\/smart-horeca-theme\.css/);
  assert.match(primary,/document\.addEventListener\('DOMContentLoaded',sync/);
  assert.match(first,/\/smart-horeca-theme\.css\?v=/);
});
