import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildRmsPayrollDocument,hashRmsDocument,normalizeRmsCorrections,approvalSourceForRestaurant} from '../functions/api/hr/_lib/rms-payroll-document.js';

const month='2026-09';
const scope={isChain:true,selectedDepartmentIds:['r1','r2'],allowedDepartmentIds:['r1','r2'],
 selectedRestaurants:[{id:'r1',code:'1',name:'RMS 1'},{id:'r2',code:'2',name:'RMS 2'}]};
const devices=[{device_id:'face1',restaurant_id:'r1',is_active:1},{device_id:'face2',restaurant_id:'r2',is_active:1}];
const employees=[{iiko_employee_id:'farid',employee_code:'31',display_name:'Самедов Фарид',
 role_code:'WAITER',department_code:'1',is_deleted:0}];
const norm=id=>({restaurant_id:id,role_code:'WAITER',payroll_mode:'RESTAURANT_HOURS',
 norm_days:26,daily_norm_minutes:600,updated_at:'2026-09-01'});
const terms=[{iiko_employee_id:'farid',official_gross:400,additional_amount:0,
 effective_from:'2026-01-01',effective_to:'',is_active:1}];
const event=(device,ts)=>({device_id:device,iiko_employee_id:'farid',
 event_time:new Date(ts).toISOString(),event_id:device+'|'+ts,restaurantId:device==='face1'?'r1':'r2'});
const first=event('face1','2026-09-08T08:00:00+04:00');
const beforeLunch=event('face1','2026-09-08T12:00:00+04:00');
const second=event('face2','2026-09-08T13:00:00+04:00');
const last=event('face2','2026-09-08T18:00:00+04:00');
const base=events=>buildRmsPayrollDocument({
 month,scope,devices,employees,events,norms:[norm('r1'),norm('r2')],
 employeeTerms:terms,roleTerms:[],roleRules:[],employeeRules:[],nowMs:Date.parse('2026-10-02')
});
test('One Farid in CHAIN has two independent payable restaurant documents',()=>{
 const doc=base([first,beforeLunch,second,last]);
 assert.equal(doc.network.uniqueEmployees,1);
 assert.equal(doc.restaurants.length,2);
 assert.deepEqual(doc.restaurants.map(x=>x.gross),[6.15,7.69]);
 assert.equal(doc.network.restaurantGross,13.84);
 assert.ok(doc.restaurants.every(x=>x.ready));
 assert.equal(doc.restaurants[0].rows[0].actualMinutes,240);
 assert.equal(doc.restaurants[1].rows[0].actualMinutes,300);
});
test('Missed exit at RMS1 is independent of complete RMS2 session and blocks approval',()=>{
 const doc=base([first,second,last]);
 assert.equal(doc.restaurants[0].ready,false);
 assert.equal(doc.restaurants[0].issueCount,1);
 assert.equal(doc.restaurants[1].ready,true);
 assert.equal(doc.restaurants[1].gross,7.69);
 assert.equal(doc.restaurants[0].gross,0);
});
test('Explicit manual correction applies to only named restaurant and work date',()=>{
 const corrected=normalizeRmsCorrections(base([first,second,last]).attendance,[{
  iiko_employee_id:'farid',restaurant_id:'r1',work_date:'2026-09-08',
  worked_minutes:240,reason:'Забыл пробить уход в конце смены',updated_at:'2026-10-01'
 }],employees,scope.selectedRestaurants);
 assert.equal(corrected.filter(x=>x.restaurantId==='r1')[0].workedMinutes,240);
 assert.equal(corrected.filter(x=>x.restaurantId==='r1')[0].manualCorrection,true);
 assert.equal(corrected.filter(x=>x.restaurantId==='r2')[0].workedMinutes,300);
});
test('Approved source version hashes are deterministic and isolated per RMS',async()=>{
 const one=base([first,beforeLunch,second,last]);
 const sr1=approvalSourceForRestaurant(one,'r1',[first,beforeLunch,second,last],[],[norm('r1'),norm('r2')],terms,[],[],[]);
 const sr2=approvalSourceForRestaurant(one,'r2',[first,beforeLunch,second,last],[],[norm('r1'),norm('r2')],terms,[],[],[]);
 const h1=await hashRmsDocument(sr1);
 assert.equal(h1,await hashRmsDocument(sr1));
 assert.notEqual(h1,await hashRmsDocument(sr2));
 const newNorm=norm('r1');newNorm.norm_days=25;
 const update=base([first,beforeLunch,second,last]);
 assert.notEqual(h1,await hashRmsDocument(approvalSourceForRestaurant(update,'r1',[first,beforeLunch,second,last],[],[newNorm,norm('r2')],terms,[],[],[])));
});
test('Unapproved and incomplete restaurant documents have no posting or payment side effects',()=>{
 const api=readFileSync(new URL('../functions/api/hr/rms-payroll.js',import.meta.url),'utf8');
 assert.match(api,/status='MANAGER_APPROVED'/);
 assert.match(api,/status='HR_APPROVED'/);
 assert.match(api,/old\.source_hash!==target\.sourceHash/);
 assert.match(api,/old\.manager_id===actorId/);
 assert.match(api,/postingEnabled:false/);
 assert.match(api,/SAVE_CORRECTION/);
 assert.match(api,/restaurant_id/);
 assert.doesNotMatch(api,/syncOvertimeAccrualPosting|syncOvertimePaymentPosting|INSERT INTO sh_accounting_journal/);
 const legacy=readFileSync(new URL('../functions/api/hr/payroll.js',import.meta.url),'utf8');
 assert.match(legacy,/if\(payrollTimesheetApproved&&!scope\?\.isChain\)/);
 assert.match(legacy,/postingAllowed:!scope\?\.isChain/);
});
test('CHAIN restricted role cannot access another RMS approval from route',()=>{
 const api=readFileSync(new URL('../functions/api/hr/rms-payroll.js',import.meta.url),'utf8');
 assert.match(api,/authorizedRestaurants\(scope\)\.some\(x=>x\.id===restaurantId\)/);
 assert.match(api,/scope\.membershipRestricted/);
 assert.match(api,/hasPermission/);
 const html=readFileSync(new URL('../hr-payroll.html',import.meta.url),'utf8');
 assert.match(html,/hrpRmsApprovalAttendance/);
 const ui=readFileSync(new URL('../hr-payroll.js',import.meta.url),'utf8');
 assert.match(ui,/renderRmsApprovals/);
 assert.match(ui,/data-rms-action/);
});
