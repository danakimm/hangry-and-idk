CREATE TRIGGER IF NOT EXISTS trg_menu_sets_limit_insert
BEFORE INSERT ON menu_sets
WHEN NEW.archived_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'MENU_SET_LIMIT_REACHED')
  WHERE (
    SELECT COUNT(*) FROM menu_sets
    WHERE owner_user_id = NEW.owner_user_id AND archived_at IS NULL
  ) >= 20;
END;

CREATE TRIGGER IF NOT EXISTS trg_menu_sets_limit_update
BEFORE UPDATE ON menu_sets
WHEN NEW.archived_at IS NULL AND OLD.archived_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'MENU_SET_LIMIT_REACHED')
  WHERE (
    SELECT COUNT(*) FROM menu_sets
    WHERE owner_user_id = NEW.owner_user_id AND archived_at IS NULL
  ) >= 20;
END;
