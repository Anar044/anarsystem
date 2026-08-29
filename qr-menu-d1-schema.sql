CREATE TABLE IF NOT EXISTS qr_menus (
  organization_id TEXT PRIMARY KEY,
  public_id TEXT UNIQUE NOT NULL,
  restaurant_name TEXT NOT NULL,
  menu_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_qr_menus_public_id ON qr_menus(public_id);
