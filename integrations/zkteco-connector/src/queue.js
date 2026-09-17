import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class PersistentQueue{
  constructor(dir,maxItems=50000){
    this.dir=dir;
    this.file=path.join(dir,'queue.json');
    this.tmp=path.join(dir,'queue.tmp.json');
    this.maxItems=maxItems;
    fs.mkdirSync(dir,{recursive:true});
    this.items=[];
    this.load();
  }
  load(){
    try{
      const parsed=JSON.parse(fs.readFileSync(this.file,'utf8'));
      this.items=Array.isArray(parsed)?parsed:[];
    }catch(error){
      if(error?.code!=='ENOENT')console.error('[QUEUE] load:',error.message);
      this.items=[];
    }
  }
  persist(){
    fs.writeFileSync(this.tmp,JSON.stringify(this.items,null,2),'utf8');
    fs.renameSync(this.tmp,this.file);
  }
  enqueueMany(serial,events){
    const existing=new Set(this.items.map(x=>x.dedupeKey));
    let added=0,duplicates=0,dropped=0;
    for(const event of events){
      const dedupeKey=`${serial}|${event.sourceId}`;
      if(existing.has(dedupeKey)){duplicates++;continue;}
      if(this.items.length>=this.maxItems){dropped++;continue;}
      const item={
        queueId:crypto.randomUUID(),
        dedupeKey,
        serial:String(serial||''),
        event,
        queuedAt:new Date().toISOString(),
        attempts:0,
        lastError:''
      };
      this.items.push(item);
      existing.add(dedupeKey);
      added++;
    }
    if(added)this.persist();
    return{added,duplicates,dropped,total:this.items.length};
  }
  peek(limit=300){return this.items.slice(0,limit);}
  remove(ids){
    const set=new Set(ids);
    const before=this.items.length;
    this.items=this.items.filter(x=>!set.has(x.queueId));
    if(this.items.length!==before)this.persist();
  }
  markFailed(ids,message){
    const set=new Set(ids);
    const now=new Date().toISOString();
    let changed=false;
    for(const item of this.items){
      if(!set.has(item.queueId))continue;
      item.attempts=(Number(item.attempts)||0)+1;
      item.lastError=String(message||'').slice(0,500);
      item.lastAttemptAt=now;
      changed=true;
    }
    if(changed)this.persist();
  }
  stats(){
    const oldest=this.items[0]?.queuedAt||'';
    const failed=this.items.filter(x=>Number(x.attempts)>0).length;
    return{queued:this.items.length,failed,oldest};
  }
}
