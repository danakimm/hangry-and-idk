CREATE TABLE IF NOT EXISTS menu_sets (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_menu_sets_owner_active
  ON menu_sets (owner_user_id, archived_at, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_sets_one_active_default
  ON menu_sets (owner_user_id, is_default)
  WHERE is_default = 1 AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS menu_set_items (
  id TEXT PRIMARY KEY NOT NULL,
  menu_set_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  color TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position >= 0),
  FOREIGN KEY (menu_set_id) REFERENCES menu_sets(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_set_items_unique_name
  ON menu_set_items (menu_set_id, normalized_name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_set_items_unique_position
  ON menu_set_items (menu_set_id, position);
