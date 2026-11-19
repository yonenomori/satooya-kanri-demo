-- 里親・ブリーダー管理システム D1スキーマ
-- 方針:
--   * 里親とブリーダーは contacts にまとめ、kind で区別する（照合を1テーブルで済ませるため）
--   * NGかどうかは status ではなく ng_records の有効レコードの有無で判定する
--   * 削除は論理削除（deleted_at）。NG解除も revoked_at で履歴を残す
--   * 日時はすべて ISO 8601 文字列（UTC）

-- スタッフ（Cloudflare Access のメールアドレスと紐づける）
CREATE TABLE staff (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  email       TEXT    NOT NULL UNIQUE,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- 里親顧客・ブリーダー
CREATE TABLE contacts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  kind                TEXT    NOT NULL CHECK (kind IN ('adopter', 'breeder')),
  name                TEXT    NOT NULL,             -- 表示名（里親は「姓 名」、ブリーダーは名称）
  family_name         TEXT,                         -- 姓（里親のみ、照合にも使う）
  given_name          TEXT,                         -- 名（里親のみ）
  phone               TEXT,                         -- 入力どおり
  phone_normalized    TEXT,                         -- 数字のみ（照合用）
  address             TEXT,                         -- 入力どおり
  address_normalized  TEXT,                         -- 正規化済み（照合用）
  city                TEXT,                         -- 都道府県＋市区町村（苗字照合用）
  line_name           TEXT,
  status              TEXT    NOT NULL,
    -- adopter: inquiry / screening / contracted / closed
    -- breeder: active / suspended
  memo                TEXT,
  created_by          INTEGER NOT NULL REFERENCES staff(id),
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_by          INTEGER REFERENCES staff(id),
  updated_at          TEXT,
  deleted_at          TEXT
);

CREATE INDEX idx_contacts_phone   ON contacts (phone_normalized)   WHERE deleted_at IS NULL;
CREATE INDEX idx_contacts_address ON contacts (address_normalized) WHERE deleted_at IS NULL;
CREATE INDEX idx_contacts_family  ON contacts (family_name, city)  WHERE deleted_at IS NULL;
CREATE INDEX idx_contacts_kind    ON contacts (kind, status)       WHERE deleted_at IS NULL;

-- NG記録（1人に複数件つけられる。解除しても履歴は残す）
CREATE TABLE ng_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id  INTEGER NOT NULL REFERENCES contacts(id),
  category    TEXT    NOT NULL CHECK (category IN (
                -- 里親
                'false_statement',      -- 虚偽申告
                'bad_environment',      -- 飼育環境が不適切
                'past_trouble',         -- 過去のトラブル
                -- ブリーダー
                'no_health_check',      -- 健康診断の未実施
                'missing_documents',    -- 書類不備
                'condition_mismatch',   -- 説明と異なる状態での引き渡し
                -- 共通
                'other'
              )),
  detail      TEXT    NOT NULL,             -- 事実のみ記載
  created_by  INTEGER NOT NULL REFERENCES staff(id),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  revoked_at  TEXT,                         -- NG解除日時
  revoked_by  INTEGER REFERENCES staff(id),
  revoke_reason TEXT
);

CREATE INDEX idx_ng_active ON ng_records (contact_id) WHERE revoked_at IS NULL;

-- やり取りメモ
CREATE TABLE notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id  INTEGER NOT NULL REFERENCES contacts(id),
  channel     TEXT    NOT NULL CHECK (channel IN ('line', 'instagram', 'phone', 'visit', 'other')),
  body        TEXT    NOT NULL,
  noted_on    TEXT    NOT NULL,             -- やり取りした日（YYYY-MM-DD）
  created_by  INTEGER NOT NULL REFERENCES staff(id),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_notes_contact ON notes (contact_id, noted_on DESC);

-- 有効なNGを持つ連絡先（照合・一覧表示用）
CREATE VIEW ng_contacts AS
SELECT c.*,
       COUNT(n.id)          AS ng_count,
       MAX(n.created_at)    AS last_ng_at
FROM contacts c
JOIN ng_records n ON n.contact_id = c.id AND n.revoked_at IS NULL
WHERE c.deleted_at IS NULL
GROUP BY c.id;

-- 照合クエリの例（アプリ側で使う想定）
--   電話一致 → NG
--   SELECT * FROM ng_contacts WHERE phone_normalized = ?1 AND id != ?4;
--   住所一致 → 要確認
--   SELECT * FROM ng_contacts WHERE address_normalized = ?2 AND id != ?4;
--   苗字＋市区町村一致 → 要確認
--   SELECT * FROM ng_contacts WHERE family_name = ?3 AND city = ?5 AND id != ?4;
