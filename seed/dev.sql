-- ローカル開発用のダミーデータ。本番には投入しないこと。
-- 適用: npx wrangler d1 execute satooya-db --local --file=seed/dev.sql
-- .dev.vars の DEV_USER_EMAIL は dev-a@example.com を想定

INSERT INTO staff (id, name, email) VALUES
  (1, 'スタッフA', 'dev-a@example.com'),
  (2, 'スタッフB', 'dev-b@example.com');

INSERT INTO contacts
  (id, kind, name, family_name, given_name, phone, phone_normalized, address, address_normalized, city, line_name, status, memo, created_by)
VALUES
  (1, 'adopter', '山田 太郎', '山田', '太郎', '090-0000-1234', '09000001234',
   '神奈川県横浜市港北区日吉一丁目2番3号', '横浜市港北区日吉1-2-3', '横浜市港北区', 'たろう', 'closed', NULL, 1),
  (2, 'adopter', '山田 花子', '山田', '花子', '080-0000-5678', '08000005678',
   '横浜市港北区日吉1-2-3 日吉ハイツ101', '横浜市港北区日吉1-2-3', '横浜市港北区', NULL, 'inquiry', NULL, 2),
  (3, 'adopter', '山田 一郎', '山田', '一郎', '070-0000-9012', '07000009012',
   '神奈川県川崎市中原区木月1-1-1', '川崎市中原区木月1-1-1', '川崎市中原区', NULL, 'contracted', NULL, 1),
  (4, 'breeder', '山田ケンネル', NULL, NULL, '0300000000', '0300000000',
   '埼玉県〇〇市〇〇5-6', '〇〇市〇〇5-6', '〇〇市', NULL, 'suspended', NULL, 1),
  (5, 'breeder', '佐藤キャッテリー', NULL, NULL, '0450000000', '0450000000',
   '神奈川県藤沢市鵠沼1-1', '藤沢市鵠沼1-1', '藤沢市', NULL, 'active', NULL, 2);

INSERT INTO ng_records (contact_id, category, detail, created_by) VALUES
  (1, 'false_statement', 'ペット可物件と申告していたが、契約前の確認で不可物件と判明。', 1),
  (4, 'no_health_check', '健康診断書なしで引き渡しがあった。', 2);

INSERT INTO notes (contact_id, channel, body, noted_on, created_by) VALUES
  (1, 'instagram', 'チワワの子について初回問い合わせ。', '2026-05-02', 2),
  (1, 'line', '住居はペット可と回答あり。契約書類を案内。', '2026-05-08', 1),
  (1, 'phone', '物件確認の結果を伝え、今回はお断り。', '2026-05-12', 1);
