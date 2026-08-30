CREATE TABLE IF NOT EXISTS decision_history (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  selected_name TEXT NOT NULL,
  selected_emoji TEXT NOT NULL,
  selected_color TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('temporary', 'menu_set')),
  source_menu_set_id TEXT,
  source_menu_set_name TEXT,
  candidates_json TEXT NOT NULL CHECK(json_valid(candidates_json)),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK(
    (source_type = 'temporary' AND source_menu_set_id IS NULL AND source_menu_set_name IS NULL)
    OR
    (source_type = 'menu_set' AND source_menu_set_id IS NOT NULL AND source_menu_set_name IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_history_owner_request
  ON decision_history (owner_user_id, client_request_id);

CREATE INDEX IF NOT EXISTS idx_decision_history_owner_created
  ON decision_history (owner_user_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_decision_history_keep_latest_ten
AFTER INSERT ON decision_history
BEGIN
  DELETE FROM decision_history
  WHERE owner_user_id = NEW.owner_user_id
    AND rowid NOT IN (
      SELECT rowid
      FROM decision_history
      WHERE owner_user_id = NEW.owner_user_id
      ORDER BY created_at DESC, rowid DESC
      LIMIT 10
    );
END;
