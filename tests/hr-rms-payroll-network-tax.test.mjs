import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {allocateNetworkPayrollTax} from '../functions/api/hr/_lib/rms-tax-allocation.js';
import {DEFAULT_PAYROLL_TAX_SETTINGS} from '../functions/api/hr/_lib/payroll-tax-engine.js';
const settings={...DEFAULT_PAYROLL_TAX_SETTINGS,
 incomeTaxThreshold1:2500,personalAllowance:200,incomeTaxLowPercent:10,
 employeeSocialLowPercent:0,employeeSocialMidPercent:0,employeeSocialHighPercent:0,
 employerSocialLowPercent:0,employerSocialMidPercent:0,employerSocialHighPercent:0,
 employeeUnemploymentPercent:0,employerUnemploymentPercent:0,
 employeeMedicalLowPercent:0,employeeMedicalHighPercent:0,
 employerMedicalLowPercent:0,employerMedicalHighPercent:0};
const wage=(rms,amount,id='farid')=>({
 employeeId:id,employeeName:'Самедов Фарид',restaurantId:rms,roleCode:'WAITER',
 officialGross:amount,additionalGross:0,totalGross:amount
});
test('One employee across RMS1 and RMS2 receives one tax allowance, not two',()=>{
 const result=allocateNetworkPayrollTax({rmsRows:[wage('r1',200),wage('r2',200)],settings});
 assert.equal(result.network.uniqueEmployees,1);
 assert.equal(result.network.gross,400);
 assert.equal(result.network.withheld,20);
 assert.equal(result.network.net,380);
 assert.equal(result.lines.length,2);
 assert.deepEqual(result.lines.map(x=>x.net),[190,190]);
 assert.ok(result.lines.every(x=>!('postingAllowed' in x)||x.status==='TAX_PREVIEW_ONLY'));
 assert.equal(result.postingAllowed,false);
});
test('Tax cents reconcile exactly despite uneven restaurant gross amounts',()=>{
 const result=allocateNetworkPayrollTax({rmsRows:[wage('r1',133.33),wage('r2',266.67)],settings});
 assert.equal(result.network.withheld,20);
 assert.equal(result.lines.reduce((n,x)=>n+Math.round(x.withheld*100),0),2000);
 assert.equal(result.lines.reduce((n,x)=>n+Math.round(x.net*100),0),38000);
});
test('An office employee is taxed once, separately from restaurant workers',()=>{
 const office={employeeId:'office',employeeName:'Офисный сотрудник',roleCode:'ACCOUNTANT',
 officialGross:500,additionalGross:0,totalGross:500};
 const result=allocateNetworkPayrollTax({rmsRows:[wage('r1',400)],officeRows:[office],settings});
 assert.equal(result.network.uniqueEmployees,2);
 assert.equal(result.lines.filter(x=>x.restaurantId==='NETWORK_OFFICE').length,1);
 assert.equal(result.network.gross,900);
 assert.equal(result.network.withheld,20+30);
});
test('RMS preview stays non-posting and requires a network-wide authorized view',()=>{
 const api=readFileSync(new URL('../functions/api/hr/rms-payroll.js',import.meta.url),'utf8');
 assert.match(api,/if\(central\)\{/);
 assert.match(api,/allocateNetworkPayrollTax/);
 assert.match(api,/loadPayrollTaxContext/);
 assert.match(api,/postingEnabled:false/);
 const library=readFileSync(new URL('../functions/api/hr/_lib/rms-tax-allocation.js',import.meta.url),'utf8');
 assert.doesNotMatch(library,/INSERT INTO|UPDATE sh_accounting|syncPayrollPosting/);
});
