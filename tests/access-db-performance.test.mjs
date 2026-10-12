import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const code=readFileSync(resolve(root,'functions/api/access/_lib/access-control.js'),'utf8');
const {ensureAccessTables,ensureOwnerWorkspace}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

function mockDb({ready=true,workspace=null,failBatch=false}={}){
  const log={schemaReads:0,batches:0,inserts:0,workspaceReads:0};
  const db={
    prepare(sql){
      const stmt={
        bind(){return this},
        async first(){
          if(sql.includes('sqlite_master')){
            log.schemaReads++;
            return {c:ready?11:0};
          }
          if(sql.includes('SELECT * FROM sh_workspaces')){
            log.workspaceReads++;
            return workspace;
          }
          return null;
        },
        async run(){
          if(sql.includes('INSERT INTO sh_workspaces')){
            log.inserts++;
            workspace={id:'workspace-1',owner_user_id:'owner-1',server_owner_user_id:'owner-1',status:'ACTIVE'};
          }
          return {success:true};
        }
      };
      return stmt;
    },
    async batch(){
      log.batches++;
      if(failBatch){failBatch=false;throw new Error('D1 temporary failure')}
      ready=true;
      return[];
    }
  };
  return{db,log};
}
test('established schema bypasses repeated CREATE statements safely',async()=>{
  const {db,log}=mockDb();
  await ensureAccessTables(db);
  await ensureAccessTables(db);
  assert.equal(log.schemaReads,1);
  assert.equal(log.batches,0);
});
test('missing schema still executes the entire existing DDL batch',async()=>{
  const {db,log}=mockDb({ready:false});
  await ensureAccessTables(db);
  await ensureAccessTables(db);
  assert.equal(log.schemaReads,1);
  assert.equal(log.batches,1);
});
test('database initialization failure does not poison next attempt',async()=>{
  const {db,log}=mockDb({ready:false,failBatch:true});
  await assert.rejects(ensureAccessTables(db),/D1 temporary failure/);
  await ensureAccessTables(db);
  assert.equal(log.batches,2);
});
test('schema checks remain isolated for independent database bindings',async()=>{
  const first=mockDb(),second=mockDb();
  await ensureAccessTables(first.db);
  await ensureAccessTables(second.db);
  assert.equal(first.log.schemaReads,1);
  assert.equal(second.log.schemaReads,1);
});
test('existing owner workspace is read without D1 insert',async()=>{
  const workspace={id:'existing-workspace',owner_user_id:'owner-1',server_owner_user_id:'owner-1',status:'ACTIVE'};
  const {db,log}=mockDb({workspace});
  const found=await ensureOwnerWorkspace(db,'owner-1',{email:'owner@example.test'});
  assert.equal(found,workspace);
  assert.equal(log.inserts,0);
  assert.equal(log.workspaceReads,1);
});
test('new owner workspace keeps the original atomic create path',async()=>{
  const {db,log}=mockDb({workspace:null});
  const created=await ensureOwnerWorkspace(db,'owner-1',{email:'owner@example.test'});
  assert.equal(created.id,'workspace-1');
  assert.equal(log.inserts,1);
  assert.equal(log.workspaceReads,2);
});
