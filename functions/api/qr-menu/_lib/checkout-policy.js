// Persistent merchant checkout policy, separate from the key-encryption context.
// LIVE_PREVIEW: owner's explicit opt-in to a REAL Payriff Online charge.
// No new API keys or Cloudflare variables are needed per restaurant.
export async function ensureCheckoutPolicy(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS qr_payment_checkout_policy (
    workspace_id TEXT NOT NULL,restaurant_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'PAYRIFF',
    live_preview_enabled INTEGER NOT NULL DEFAULT 0,
    max_live_minor INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,updated_by TEXT NOT NULL,
    PRIMARY KEY(workspace_id,restaurant_id,provider)
  )`).run();
}
export async function fetchCheckoutPolicy(db,scope){
  return db.prepare(`SELECT live_preview_enabled,max_live_minor FROM qr_payment_checkout_policy
    WHERE workspace_id=?1 AND restaurant_id=?2 AND provider='PAYRIFF' LIMIT 1`)
    .bind(scope.workspaceId,scope.restaurantId).first();
}
export const isLivePreview=row=>Number(row?.live_preview_enabled)===1&&
  Number(row?.max_live_minor)===1;
