-- ペットフードのサブスク管理
-- 方針:
--   * 管理番号は subscriptions.id（AUTOINCREMENT）を 5 桁ゼロ埋めで表示する（1 → 00001）
--     AUTOINCREMENT は一度使った番号を二度と払い出さない（行が消えても再利用しない）
--   * 状態は active（オン）/ paused（オフ・休止）/ ended（終了）。終了は取り消せない
--   * 終了したサブスクは状態・中身を変更できない。再開するときは新しい番号で作り直す
--   * 物理削除はしない（トリガーで禁止）。メニューも削除せず「販売停止」にする

-- メニュー（ペットフードの商品）
CREATE TABLE menus (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  price       INTEGER CHECK (price IS NULL OR price >= 0),   -- 税込・円。未定なら NULL
  description TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),  -- 1: 販売中 / 0: 販売停止
  created_by  INTEGER NOT NULL REFERENCES staff(id),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_by  INTEGER REFERENCES staff(id),
  updated_at  TEXT
);

-- サブスク契約（1 契約 = 1 管理番号）
CREATE TABLE subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,   -- 管理番号の元（表示は 00001 形式）
  contact_id  INTEGER NOT NULL REFERENCES contacts(id),
  status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  started_on  TEXT    NOT NULL,                    -- 開始日（YYYY-MM-DD）
  ended_on    TEXT,                                -- 終了日（YYYY-MM-DD）
  end_reason  TEXT,
  memo        TEXT,
  created_by  INTEGER NOT NULL REFERENCES staff(id),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_by  INTEGER REFERENCES staff(id),
  updated_at  TEXT,
  CHECK ((status = 'ended') = (ended_on IS NOT NULL))
);

CREATE INDEX idx_subscriptions_contact ON subscriptions (contact_id);
CREATE INDEX idx_subscriptions_status  ON subscriptions (status);

-- サブスクに入っているメニュー（1 契約に複数可）。外したら removed_at を入れる
CREATE TABLE subscription_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  menu_id         INTEGER NOT NULL REFERENCES menus(id),
  quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99),
  created_by      INTEGER NOT NULL REFERENCES staff(id),
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  removed_at      TEXT,
  removed_by      INTEGER REFERENCES staff(id)
);

CREATE INDEX idx_subscription_items_active ON subscription_items (subscription_id) WHERE removed_at IS NULL;

-- 終了したサブスクは変更できない（番号の再利用・復活を DB でも防ぐ）
CREATE TRIGGER trg_subscriptions_ended_is_final
BEFORE UPDATE ON subscriptions
WHEN OLD.status = 'ended'
BEGIN
  SELECT RAISE(ABORT, 'subscription_ended');
END;

CREATE TRIGGER trg_subscriptions_no_delete
BEFORE DELETE ON subscriptions
BEGIN
  SELECT RAISE(ABORT, 'subscription_delete_forbidden');
END;

-- 終了したサブスクにはメニューを追加・変更できない
CREATE TRIGGER trg_subscription_items_insert_ended
BEFORE INSERT ON subscription_items
WHEN (SELECT status FROM subscriptions WHERE id = NEW.subscription_id) = 'ended'
BEGIN
  SELECT RAISE(ABORT, 'subscription_ended');
END;

CREATE TRIGGER trg_subscription_items_update_ended
BEFORE UPDATE ON subscription_items
WHEN (SELECT status FROM subscriptions WHERE id = OLD.subscription_id) = 'ended'
BEGIN
  SELECT RAISE(ABORT, 'subscription_ended');
END;

-- 販売停止中のメニューは新しく追加できない
CREATE TRIGGER trg_subscription_items_menu_active
BEFORE INSERT ON subscription_items
WHEN (SELECT is_active FROM menus WHERE id = NEW.menu_id) IS NOT 1
BEGIN
  SELECT RAISE(ABORT, 'menu_inactive');
END;
