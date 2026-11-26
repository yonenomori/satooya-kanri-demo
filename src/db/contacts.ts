/**
 * contacts / ng_records / notes / staff へのクエリ。
 *
 * 守ること（CLAUDE.md）:
 * - SQL は必ずバインドパラメータ。文字列連結で値を埋め込まない
 * - 削除は論理削除（deleted_at）。物理削除はしない
 * - NG 理由は解除しても消さない（revoked_at を入れる）
 * - 登録・更新・NG 操作にはログイン中のスタッフIDを記録する
 */
import { extractCity, normalizeAddress, normalizePhone } from '../lib/normalize';
import { categoryLabel, channelLabel, kindLabel, statusLabel } from '../lib/labels';
import { formatSubscriptionNo, subscriptionStatusLabel } from '../lib/subscription';

export type ContactKind = 'adopter' | 'breeder';

export type ContactRow = {
  id: number;
  kind: string;
  name: string;
  family_name: string | null;
  given_name: string | null;
  phone: string | null;
  phone_normalized: string | null;
  address: string | null;
  address_normalized: string | null;
  city: string | null;
  line_name: string | null;
  status: string;
  memo: string | null;
  created_by: number;
  created_at: string;
  updated_by: number | null;
  updated_at: string | null;
  deleted_at: string | null;
};

export type StaffRow = {
  id: number;
  name: string;
  email: string;
  is_active: number;
};

export type NgRecordRow = {
  id: number;
  contact_id: number;
  category: string;
  detail: string;
  created_by: number;
  created_at: string;
  revoked_at: string | null;
  revoked_by: number | null;
  revoke_reason: string | null;
};

export type NoteRow = {
  id: number;
  contact_id: number;
  channel: string;
  body: string;
  noted_on: string;
  created_by: number;
  created_at: string;
};

/** 保存する値（正規化済み） */
export type ContactRecord = {
  kind: ContactKind;
  name: string;
  familyName: string | null;
  givenName: string | null;
  phone: string | null;
  phoneNormalized: string | null;
  address: string | null;
  addressNormalized: string | null;
  city: string | null;
  lineName: string | null;
  status: string;
  memo: string | null;
};

/** フォームから受け取った生の値 */
export type ContactDraft = {
  kind: ContactKind;
  familyName: string;
  givenName: string;
  breederName: string;
  phone: string;
  address: string;
  lineName: string;
  status: string;
  memo: string;
};

function trimmedOrNull(value: string): string | null {
  const s = value.trim();
  return s === '' ? null : s;
}

/**
 * フォームの値を保存用に整える。正規化は必ずここを通す（手入力させない）。
 */
export function buildContactRecord(draft: ContactDraft): ContactRecord {
  const familyName = draft.kind === 'adopter' ? trimmedOrNull(draft.familyName) : null;
  const givenName = draft.kind === 'adopter' ? trimmedOrNull(draft.givenName) : null;
  const name =
    draft.kind === 'adopter'
      ? [familyName, givenName].filter((part): part is string => part !== null).join(' ')
      : (trimmedOrNull(draft.breederName) ?? '');

  const phone = trimmedOrNull(draft.phone);
  const address = trimmedOrNull(draft.address);
  const addressNormalized = normalizeAddress(address);

  return {
    kind: draft.kind,
    name,
    familyName,
    givenName,
    phone,
    phoneNormalized: normalizePhone(phone),
    address,
    addressNormalized,
    city: extractCity(addressNormalized),
    lineName: trimmedOrNull(draft.lineName),
    status: draft.status,
    memo: trimmedOrNull(draft.memo),
  };
}

/** LIKE のワイルドカード（% _ \）をエスケープする */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}

/**
 * 検索語が電話番号らしいか（数字・ハイフン・括弧・空白だけで4桁以上）。
 */
export function isPhoneQuery(input: string): boolean {
  const s = input.normalize('NFKC').trim();
  if (s === '') return false;
  if (!/^[0-9\-\s()（）+]+$/.test(s)) return false;
  return s.replace(/[^0-9]/g, '').length >= 4;
}

const SEARCH_HARD_LIMIT = 200;

export type SearchResultRow = ContactRow & {
  is_ng: number;
  check_reason: string | null;
  latest_ng_category: string | null;
  latest_ng_detail: string | null;
};

type NgLookupRow = {
  id: number;
  kind: string;
  family_name: string | null;
  city: string | null;
  phone_normalized: string | null;
  address_normalized: string | null;
};

/** 有効な NG を持つ連絡先（照合・要確認の判定用） */
export async function listActiveNgLookup(db: D1Database): Promise<NgLookupRow[]> {
  const result = await db
    .prepare(
      `SELECT c.id, c.kind, c.family_name, c.city, c.phone_normalized, c.address_normalized
         FROM contacts c
         JOIN ng_records n ON n.contact_id = c.id AND n.revoked_at IS NULL
        WHERE c.deleted_at IS NULL
        GROUP BY c.id`
    )
    .all<NgLookupRow>();
  return result.results ?? [];
}

/**
 * 自分は NG ではないが、NG の相手と電話・住所・苗字＋市区町村のどれかが一致する場合の理由。
 */
export function checkReasonFor(row: NgLookupRow, ngList: NgLookupRow[]): string | null {
  for (const ng of ngList) {
    if (ng.id === row.id) continue;
    if (row.phone_normalized !== null && row.phone_normalized === ng.phone_normalized) {
      return 'NG登録と電話番号が一致';
    }
    if (row.address_normalized !== null && row.address_normalized === ng.address_normalized) {
      return 'NG登録と住所が一致';
    }
    if (
      row.kind === 'adopter' &&
      ng.kind === 'adopter' &&
      row.family_name !== null &&
      row.family_name === ng.family_name &&
      row.city !== null &&
      row.city === ng.city
    ) {
      return 'NG登録と苗字・市区町村が一致';
    }
  }
  return null;
}

/**
 * 検索（トップ）。検索語がなければ最近更新した20件。
 * NG → 要確認 → 更新日時の新しい順に最大50件。
 */
export async function searchContacts(
  db: D1Database,
  params: { q?: string; kind?: string }
): Promise<SearchResultRow[]> {
  const q = (params.q ?? '').normalize('NFKC').trim();
  const kind = params.kind === 'adopter' || params.kind === 'breeder' ? params.kind : 'all';

  const where: string[] = ['c.deleted_at IS NULL'];
  const binds: (string | number)[] = [];

  if (kind !== 'all') {
    where.push('c.kind = ?');
    binds.push(kind);
  }

  if (q !== '') {
    if (isPhoneQuery(q)) {
      where.push("c.phone_normalized LIKE ? ESCAPE '\\'");
      binds.push(`%${escapeLike(normalizePhone(q) ?? '')}%`);
    } else {
      const like = `%${escapeLike(q)}%`;
      where.push(
        "(c.name LIKE ? ESCAPE '\\' OR COALESCE(c.line_name, '') LIKE ? ESCAPE '\\' OR COALESCE(c.address_normalized, '') LIKE ? ESCAPE '\\')"
      );
      binds.push(like, like, like);

      // 住所として正規化すると一致する場合も拾う（例: 「日吉一丁目2番3号」）
      const normalized = normalizeAddress(q);
      if (normalized !== null && normalized !== q) {
        where.push("COALESCE(c.address_normalized, '') LIKE ? ESCAPE '\\'");
        binds.push(`%${escapeLike(normalized)}%`);
      }
    }
  }

  const sql = `SELECT c.id, c.kind, c.name, c.family_name, c.given_name, c.phone, c.phone_normalized,
                      c.address, c.address_normalized, c.city, c.line_name, c.status, c.memo,
                      c.created_by, c.created_at, c.updated_by, c.updated_at, c.deleted_at,
                      (SELECT COUNT(*) FROM ng_records n WHERE n.contact_id = c.id AND n.revoked_at IS NULL) AS is_ng,
                      (SELECT n.category FROM ng_records n WHERE n.contact_id = c.id AND n.revoked_at IS NULL
                         ORDER BY n.created_at DESC, n.id DESC LIMIT 1) AS latest_ng_category,
                      (SELECT n.detail FROM ng_records n WHERE n.contact_id = c.id AND n.revoked_at IS NULL
                         ORDER BY n.created_at DESC, n.id DESC LIMIT 1) AS latest_ng_detail
                 FROM contacts c
                WHERE ${where.join(' AND ')}
                ORDER BY COALESCE(c.updated_at, c.created_at) DESC
                LIMIT ?`;
  binds.push(SEARCH_HARD_LIMIT);

  const result = await db
    .prepare(sql)
    .bind(...binds)
    .all<Omit<SearchResultRow, 'check_reason'>>();

  const ngList = await listActiveNgLookup(db);

  const rows: SearchResultRow[] = (result.results ?? []).map((row) => ({
    ...row,
    check_reason: row.is_ng > 0 ? null : checkReasonFor(row, ngList),
  }));

  const updatedAt = (row: SearchResultRow) => row.updated_at ?? row.created_at;
  rows.sort((a, b) => {
    const byNg = Number(b.is_ng > 0) - Number(a.is_ng > 0);
    if (byNg !== 0) return byNg;
    const byCheck = Number(b.check_reason !== null) - Number(a.check_reason !== null);
    if (byCheck !== 0) return byCheck;
    return updatedAt(b).localeCompare(updatedAt(a));
  });

  return rows.slice(0, q === '' ? 20 : 50);
}

export async function getContact(db: D1Database, id: number): Promise<ContactRow | null> {
  const row = await db
    .prepare('SELECT * FROM contacts WHERE id = ? AND deleted_at IS NULL')
    .bind(id)
    .first<ContactRow>();
  return row ?? null;
}

export async function listStaff(db: D1Database): Promise<StaffRow[]> {
  const result = await db.prepare('SELECT id, name, email, is_active FROM staff ORDER BY id').all<StaffRow>();
  return result.results ?? [];
}

export async function findStaffByEmail(db: D1Database, email: string): Promise<StaffRow | null> {
  const row = await db
    .prepare('SELECT id, name, email, is_active FROM staff WHERE email = ? COLLATE NOCASE')
    .bind(email.trim())
    .first<StaffRow>();
  return row ?? null;
}

export async function getActiveNgRecords(db: D1Database, contactId: number): Promise<NgRecordRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM ng_records
        WHERE contact_id = ? AND revoked_at IS NULL
        ORDER BY created_at DESC, id DESC`
    )
    .bind(contactId)
    .all<NgRecordRow>();
  return result.results ?? [];
}

export async function getRevokedNgRecords(db: D1Database, contactId: number): Promise<NgRecordRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM ng_records
        WHERE contact_id = ? AND revoked_at IS NOT NULL
        ORDER BY revoked_at DESC, id DESC`
    )
    .bind(contactId)
    .all<NgRecordRow>();
  return result.results ?? [];
}

export async function getNotes(db: D1Database, contactId: number): Promise<NoteRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM notes
        WHERE contact_id = ?
        ORDER BY noted_on DESC, id DESC`
    )
    .bind(contactId)
    .all<NoteRow>();
  return result.results ?? [];
}

export type HouseholdCandidate = { contact: ContactRow; reason: string };

/**
 * 同じ世帯の可能性がある人（住所一致、または里親同士の苗字＋市区町村一致）。
 */
export async function getHouseholdCandidates(db: D1Database, contact: ContactRow): Promise<HouseholdCandidate[]> {
  const result = await db
    .prepare(
      `SELECT * FROM contacts c
        WHERE c.deleted_at IS NULL
          AND c.id != ?
          AND (
            (c.address_normalized IS NOT NULL AND c.address_normalized = ?)
            OR (c.kind = 'adopter' AND ? = 'adopter'
                AND c.family_name IS NOT NULL AND c.family_name = ?
                AND c.city IS NOT NULL AND c.city = ?)
          )
        ORDER BY COALESCE(c.updated_at, c.created_at) DESC
        LIMIT 10`
    )
    .bind(
      contact.id,
      contact.address_normalized,
      contact.kind,
      contact.family_name,
      contact.city
    )
    .all<ContactRow>();

  return (result.results ?? []).map((row) => ({
    contact: row,
    reason:
      contact.address_normalized !== null && row.address_normalized === contact.address_normalized
        ? '住所が一致'
        : '苗字と市区町村が一致',
  }));
}

export async function createContact(db: D1Database, record: ContactRecord, staffId: number): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO contacts
         (kind, name, family_name, given_name, phone, phone_normalized, address, address_normalized,
          city, line_name, status, memo, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      record.kind,
      record.name,
      record.familyName,
      record.givenName,
      record.phone,
      record.phoneNormalized,
      record.address,
      record.addressNormalized,
      record.city,
      record.lineName,
      record.status,
      record.memo,
      staffId
    )
    .run();

  const id = result.meta?.last_row_id;
  if (typeof id !== 'number' || id === 0) {
    throw new Error('登録に失敗しました');
  }
  return id;
}

export async function updateContact(
  db: D1Database,
  id: number,
  record: ContactRecord,
  staffId: number
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE contacts
          SET kind = ?, name = ?, family_name = ?, given_name = ?, phone = ?, phone_normalized = ?,
              address = ?, address_normalized = ?, city = ?, line_name = ?, status = ?, memo = ?,
              updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = ? AND deleted_at IS NULL`
    )
    .bind(
      record.kind,
      record.name,
      record.familyName,
      record.givenName,
      record.phone,
      record.phoneNormalized,
      record.address,
      record.addressNormalized,
      record.city,
      record.lineName,
      record.status,
      record.memo,
      staffId,
      id
    )
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** 論理削除 */
export async function softDeleteContact(db: D1Database, id: number, staffId: number): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE contacts
          SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
              updated_by = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = ? AND deleted_at IS NULL`
    )
    .bind(staffId, id)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function addNote(
  db: D1Database,
  contactId: number,
  note: { channel: string; body: string; notedOn: string },
  staffId: number
): Promise<void> {
  await db
    .prepare('INSERT INTO notes (contact_id, channel, body, noted_on, created_by) VALUES (?, ?, ?, ?, ?)')
    .bind(contactId, note.channel, note.body, note.notedOn, staffId)
    .run();
}

export async function addNgRecord(
  db: D1Database,
  contactId: number,
  record: { category: string; detail: string },
  staffId: number
): Promise<void> {
  await db
    .prepare('INSERT INTO ng_records (contact_id, category, detail, created_by) VALUES (?, ?, ?, ?)')
    .bind(contactId, record.category, record.detail, staffId)
    .run();
}

export async function getNgRecord(
  db: D1Database,
  ngId: number
): Promise<{ id: number; contact_id: number; revoked_at: string | null } | null> {
  const row = await db
    .prepare('SELECT id, contact_id, revoked_at FROM ng_records WHERE id = ?')
    .bind(ngId)
    .first<{ id: number; contact_id: number; revoked_at: string | null }>();
  return row ?? null;
}

/** NG 解除。理由は必須。記録は消さず revoked_at を入れる */
export async function revokeNgRecord(
  db: D1Database,
  ngId: number,
  reason: string,
  staffId: number
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE ng_records
          SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
              revoked_by = ?,
              revoke_reason = ?
        WHERE id = ? AND revoked_at IS NULL`
    )
    .bind(staffId, reason, ngId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/* ------------------------------------------------------------------ */
/* CSV エクスポート（管理者のみ）                                      */
/* ------------------------------------------------------------------ */

export type ExportTable = 'contacts' | 'ng_records' | 'notes' | 'subscriptions';

export function isExportTable(value: string): value is ExportTable {
  return value === 'contacts' || value === 'ng_records' || value === 'notes' || value === 'subscriptions';
}

type ExportRow = (string | number | null)[];

export async function exportRows(
  db: D1Database,
  table: ExportTable
): Promise<{ headers: string[]; rows: ExportRow[] }> {
  if (table === 'contacts') {
    const result = await db
      .prepare(
        `SELECT c.*, cb.name AS created_by_name, ub.name AS updated_by_name
           FROM contacts c
           LEFT JOIN staff cb ON cb.id = c.created_by
           LEFT JOIN staff ub ON ub.id = c.updated_by
          ORDER BY c.id`
      )
      .all<ContactRow & { created_by_name: string | null; updated_by_name: string | null }>();

    const headers = [
      'ID',
      '種別',
      '名前',
      '姓',
      '名',
      '電話番号',
      '住所',
      'LINE名',
      'ステータス',
      'メモ',
      '登録スタッフ',
      '登録日時',
      '更新スタッフ',
      '更新日時',
      '削除日時',
    ];
    const rows = (result.results ?? []).map((row) => [
      row.id,
      kindLabel(row.kind),
      row.name,
      row.family_name,
      row.given_name,
      row.phone,
      row.address,
      row.line_name,
      statusLabel(row.kind, row.status),
      row.memo,
      row.created_by_name,
      row.created_at,
      row.updated_by_name,
      row.updated_at,
      row.deleted_at,
    ]);
    return { headers, rows };
  }

  if (table === 'ng_records') {
    const result = await db
      .prepare(
        `SELECT n.*, c.name AS contact_name, c.kind AS contact_kind,
                cb.name AS created_by_name, rb.name AS revoked_by_name
           FROM ng_records n
           JOIN contacts c ON c.id = n.contact_id
           LEFT JOIN staff cb ON cb.id = n.created_by
           LEFT JOIN staff rb ON rb.id = n.revoked_by
          ORDER BY n.id`
      )
      .all<
        NgRecordRow & {
          contact_name: string;
          contact_kind: string;
          created_by_name: string | null;
          revoked_by_name: string | null;
        }
      >();

    const headers = ['ID', '連絡先ID', '対象者', '区分', '詳細', '登録スタッフ', '登録日時', '解除日時', '解除スタッフ', '解除理由'];
    const rows = (result.results ?? []).map((row) => [
      row.id,
      row.contact_id,
      row.contact_name,
      categoryLabel(row.category),
      row.detail,
      row.created_by_name,
      row.created_at,
      row.revoked_at,
      row.revoked_by_name,
      row.revoke_reason,
    ]);
    return { headers, rows };
  }

  if (table === 'subscriptions') {
    // 1 行 = サブスクに入っているメニュー 1 つ（メニューが無いサブスクも 1 行出す）
    const result = await db
      .prepare(
        `SELECT s.id, s.status, s.started_on, s.ended_on, s.end_reason, s.memo,
                c.id AS contact_id, c.name AS contact_name,
                m.name AS menu_name, m.price AS menu_price, i.quantity,
                i.created_at AS item_added_at, i.removed_at AS item_removed_at,
                cb.name AS created_by_name, s.created_at
           FROM subscriptions s
           JOIN contacts c ON c.id = s.contact_id
           LEFT JOIN subscription_items i ON i.subscription_id = s.id
           LEFT JOIN menus m ON m.id = i.menu_id
           LEFT JOIN staff cb ON cb.id = s.created_by
          ORDER BY s.id, i.id`
      )
      .all<{
        id: number;
        status: string;
        started_on: string;
        ended_on: string | null;
        end_reason: string | null;
        memo: string | null;
        contact_id: number;
        contact_name: string;
        menu_name: string | null;
        menu_price: number | null;
        quantity: number | null;
        item_added_at: string | null;
        item_removed_at: string | null;
        created_by_name: string | null;
        created_at: string;
      }>();

    const headers = [
      '管理番号',
      '状態',
      '連絡先ID',
      '対象者',
      '開始日',
      '終了日',
      '終了理由',
      'メモ',
      'メニュー',
      '価格',
      '数量',
      'メニュー追加日時',
      'メニューを外した日時',
      '登録スタッフ',
      '登録日時',
    ];
    const rows = (result.results ?? []).map((row) => [
      formatSubscriptionNo(row.id),
      subscriptionStatusLabel(row.status),
      row.contact_id,
      row.contact_name,
      row.started_on,
      row.ended_on,
      row.end_reason,
      row.memo,
      row.menu_name,
      row.menu_price,
      row.quantity,
      row.item_added_at,
      row.item_removed_at,
      row.created_by_name,
      row.created_at,
    ]);
    return { headers, rows };
  }

  const result = await db
    .prepare(
      `SELECT n.*, c.name AS contact_name, cb.name AS created_by_name
         FROM notes n
         JOIN contacts c ON c.id = n.contact_id
         LEFT JOIN staff cb ON cb.id = n.created_by
        ORDER BY n.id`
    )
    .all<NoteRow & { contact_name: string; created_by_name: string | null }>();

  const headers = ['ID', '連絡先ID', '対象者', 'チャネル', '内容', 'やり取り日', '登録スタッフ', '登録日時'];
  const rows = (result.results ?? []).map((row) => [
    row.id,
    row.contact_id,
    row.contact_name,
    channelLabel(row.channel),
    row.body,
    row.noted_on,
    row.created_by_name,
    row.created_at,
  ]);
  return { headers, rows };
}
