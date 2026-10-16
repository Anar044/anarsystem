// Tenant-scoped, server-side last successful POS polling state.
// No cache key comes directly from user input: the caller supplies verified
// mobileContext workspace/department IDs. Offline amounts are historical
// observations, NEVER part of current network totals.
const clean = v => String(v ?? "").trim();
const cache = new WeakMap();
export const MAX_SAVED_ORDERS = 200;
export async function ensurePosSnapshotTable(db) {
  if (!db) throw new Error("D1 is required for POS snapshots.");
  if (cache.has(db)) return cache.get(db);
  const pending=db.prepare(`CREATE TABLE IF NOT EXISTS sh_owner_pos_last_seen (
    workspace_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    plugin_id TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    PRIMARY KEY (workspace_id,department_id,plugin_id)
  )`).run();
  cache.set(db,pending);
  try { await pending; return pending; }
  catch(e) { cache.delete(db); throw e; }
}
export function savedPosRegister(register,lastSeenAt=new Date().toISOString()) {
  const orders=Array.isArray(register?.orders)?register.orders:[];
  return {
    id:clean(register?.id),departmentId:clean(register?.departmentId),
    name:clean(register?.name)||"Касса",
    pluginName:clean(register?.pluginName),
    groupName:clean(register?.groupName),
    online:false, status:"OFFLINE",
    lastSeenAt, totals:register?.totals||null,
    orders:[...orders].sort((a,b)=>
      clean(b?.openedAt).localeCompare(clean(a?.openedAt)))
      .slice(0,MAX_SAVED_ORDERS),
    savedOrderCount:orders.length,
    ordersTruncated:orders.length>MAX_SAVED_ORDERS,
    snapshot:true
  };
}
export async function savePosSnapshots(db,workspaceId,registers,now=new Date().toISOString()) {
  if(!clean(workspaceId)||!registers?.length) return;
  await ensurePosSnapshotTable(db);
  await Promise.allSettled(registers.map(register=>{
    if(!register?.id||!register?.departmentId) return Promise.resolve();
    const snapshot=savedPosRegister(register,now);
    return db.prepare(`INSERT INTO sh_owner_pos_last_seen
      (workspace_id,department_id,plugin_id,last_seen_at,snapshot_json)
      VALUES (?1,?2,?3,?4,?5)
      ON CONFLICT(workspace_id,department_id,plugin_id)
      DO UPDATE SET last_seen_at=excluded.last_seen_at,
        snapshot_json=excluded.snapshot_json`)
      .bind(clean(workspaceId),snapshot.departmentId,snapshot.id,now,
        JSON.stringify(snapshot)).run();
  }));
}
export async function loadPosSnapshots(db,workspaceId,selectedIds) {
  const ids=[...new Set((selectedIds||[]).map(clean).filter(Boolean))];
  if(!clean(workspaceId)||!ids.length) return [];
  await ensurePosSnapshotTable(db);
  const placeholders=ids.map((_,i)=>`?${i+2}`).join(",");
  const query=`SELECT workspace_id,department_id,plugin_id,last_seen_at,snapshot_json
    FROM sh_owner_pos_last_seen
    WHERE workspace_id=?1 AND department_id IN (${placeholders})
    ORDER BY last_seen_at DESC LIMIT 100`;
  const rows=await db.prepare(query).bind(clean(workspaceId),...ids).all();
  const allowed=new Set(ids);
  return (rows.results||[]).flatMap(row=>{
    try {
      const data=JSON.parse(row.snapshot_json);
      // Check both stored outer key and inner snapshot to avoid tenant bleed,
      // even if a malformed/legacy row is present.
      if(row.workspace_id!==clean(workspaceId)||
         !allowed.has(clean(row.department_id)) ||
         clean(data.id)!==clean(row.plugin_id) ||
         clean(data.departmentId)!==clean(row.department_id))
        return [];
      return [{...savedPosRegister(data,row.last_seen_at),
        savedOrderCount:data.savedOrderCount??data.orders?.length??0,
        ordersTruncated:data.ordersTruncated===true}];
    } catch(_) { return []; }
  });
}
