/**
 * menus / subscriptions / subscription_items へのクエリ。
 *
 * 守ること（CLAUDE.md）:
 * - SQL は必ずバインドパラメータ
 * - 物理削除はしない（サブスクは終了、メニュー行は removed_at、メニューは販売停止）
 * - 操作にはログイン中のスタッフIDを記録する
 * - 終了したサブスクは変更しない（アプリと DB トリガーの両方で守る）
 */
import { nextStatus, type SubscriptionAction, type SubscriptionStatus } from '../lib/subscription';

export type MenuRow = {
  id: number;
  name: string;
  price: number | null;
  description: string | null;
  is_active: number;
  created_by: number;
  created_at: string;
  updated_by: number | null;
  updated_at: string | null;
};

export type SubscriptionRow = {
  id: number;
  contact_id: number;
  status: string;
  started_on: string;
  ended_on: string | null;
  end_reason: string | null;
  memo: string | null;
  created_by: number;
  created_at: string;
  updated_by: number | null;
  updated_at: string | null;
};

/** 一覧・詳細で使う。連絡先の名前と、有効なメニュー行の要約を付ける */
export type SubscriptionListRow = SubscriptionRow & {
  contact_name: string;
  contact_kind: string;
  contact_deleted_at: string | null;
  item_summary: string | null;
};

export type SubscriptionItemRow = {
  id: number;
  subscription_id: number;
  menu_id: number;
  menu_name: string;
  menu_price: number | null;
  menu_is_active: number;
  quantity: number;
  created_by: number;
  created_at: string;
  removed_at: string | null;
  removed_by: number | null;
};

/* ------------------------------------------------------------------ */
/* メニュー                                                            */
/* ------------------------------------------------------------------ */

export async function listMenus(db: D1Database, options: { activeOnly?: boolean } = {}): Promise<MenuRow[]> {
  const sql = options.activeOnly
    ? 'SELECT * FROM menus WHERE is_active = 1 ORDER BY name, id'
    : 'SELECT * FROM menus ORDER BY is_active DESC, name, id';
  const result = await db.prepare(sql).all<MenuRow>();
  return result.results ?? [];
}

export async function getMenu(db: D1Database, id: number): Promise<MenuRow | null> {
  const row = await db.prepare('SELECT * FROM menus WHERE id = ?').bind(id).first<MenuRow>();
  return row ?? null;
}

export async function createMenu(
  db: D1Database,
  menu: { name: string; price: number | null; description: string | null },
  staffId: number
): Promise<number> {
  const row = await db
    .prepare('INSERT INTO menus (name, price, description, created_by) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(menu.name, menu.price, menu.description, staffId)
    .first<{ id: number }>();
  if (!row) throw new Error('menu_insert_failed');
  return row.id;
}

export async function updateMenu(
  db: D1Database,
  id: number,
  menu: { name: string; price: number | null; description: string | null; isActive: boolean },
  staffId: number
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE menus
          SET name = ?, price = ?, description = ?, is_active = ?,
              updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = ?`
    )
    .bind(menu.name, menu.price, menu.description, menu.isActive ? 1 : 0, staffId, id)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/* ------------------------------------------------------------------ */
/* サブスク                                                            */
/* ------------------------------------------------------------------ */

const LIST_SELECT = `
  SELECT s.*,
         c.name       AS contact_name,
         c.kind       AS contact_kind,
         c.deleted_at AS contact_deleted_at,
         (SELECT group_concat(m.name || ' ×' || i.quantity, '、')
            FROM subscription_items i
            JOIN menus m ON m.id = i.menu_id
           WHERE i.subscription_id = s.id AND i.removed_at IS NULL) AS item_summary
    FROM subscriptions s
    JOIN contacts c ON c.id = s.contact_id`;

export type SubscriptionFilter = 'open' | 'active' | 'paused' | 'ended' | 'all';

/**
 * 一覧。open = オン＋オフ（終了以外）。番号指定があればその 1 件だけ。
 * 並び順: オン → オフ → 終了、同じ状態の中では番号の新しい順
 */
export async function listSubscriptions(
  db: D1Database,
  options: { filter: SubscriptionFilter; id?: number | null }
): Promise<SubscriptionListRow[]> {
  if (options.id !== undefined && options.id !== null) {
    const result = await db.prepare(`${LIST_SELECT} WHERE s.id = ?`).bind(options.id).all<SubscriptionListRow>();
    return result.results ?? [];
  }

  const where =
    options.filter === 'all'
      ? ''
      : options.filter === 'open'
        ? "WHERE s.status IN ('active', 'paused')"
        : 'WHERE s.status = ?';
  const order = `ORDER BY CASE s.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, s.id DESC LIMIT 200`;
  const statement = db.prepare(`${LIST_SELECT} ${where} ${order}`);
  const bound =
    options.filter === 'active' || options.filter === 'paused' || options.filter === 'ended'
      ? statement.bind(options.filter)
      : statement;
  const result = await bound.all<SubscriptionListRow>();
  return result.results ?? [];
}

export async function getSubscription(db: D1Database, id: number): Promise<SubscriptionListRow | null> {
  const row = await db.prepare(`${LIST_SELECT} WHERE s.id = ?`).bind(id).first<SubscriptionListRow>();
  return row ?? null;
}

export async function listSubscriptionsForContact(db: D1Database, contactId: number): Promise<SubscriptionListRow[]> {
  const result = await db
    .prepare(
      `${LIST_SELECT} WHERE s.contact_id = ?
        ORDER BY CASE s.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, s.id DESC`
    )
    .bind(contactId)
    .all<SubscriptionListRow>();
  return result.results ?? [];
}

export async function getSubscriptionItems(
  db: D1Database,
  subscriptionId: number,
  options: { includeRemoved?: boolean } = {}
): Promise<SubscriptionItemRow[]> {
  const result = await db
    .prepare(
      `SELECT i.*, m.name AS menu_name, m.price AS menu_price, m.is_active AS menu_is_active
         FROM subscription_items i
         JOIN menus m ON m.id = i.menu_id
        WHERE i.subscription_id = ? ${options.includeRemoved ? '' : 'AND i.removed_at IS NULL'}
        ORDER BY i.removed_at IS NOT NULL, i.id`
    )
    .bind(subscriptionId)
    .all<SubscriptionItemRow>();
  return result.results ?? [];
}

/**
 * サブスクを新しい番号で開始する。最初のメニューも同時に入れる（1 回の batch で）。
 * 戻り値は新しい id（＝管理番号の元）。
 */
export async function createSubscription(
  db: D1Database,
  input: { contactId: number; startedOn: string; memo: string | null; menuId: number; quantity: number },
  staffId: number
): Promise<number> {
  const row = await db
    .prepare(
      'INSERT INTO subscriptions (contact_id, status, started_on, memo, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id'
    )
    .bind(input.contactId, 'active', input.startedOn, input.memo, staffId)
    .first<{ id: number }>();
  if (!row) throw new Error('subscription_insert_failed');
  await addSubscriptionItem(db, row.id, { menuId: input.menuId, quantity: input.quantity }, staffId);
  return row.id;
}

/**
 * オン／オフ／終了。終了以外からしか動かさない（WHERE status = 現在値 で二重操作も防ぐ）。
 * 戻り値: 変更できたら新しい状態、できなかったら null
 */
export async function changeSubscriptionStatus(
  db: D1Database,
  id: number,
  action: SubscriptionAction,
  options: { endedOn: string; endReason: string | null },
  staffId: number
): Promise<SubscriptionStatus | null> {
  const current = await db
    .prepare('SELECT status FROM subscriptions WHERE id = ?')
    .bind(id)
    .first<{ status: string }>();
  if (!current) return null;

  const next = nextStatus(current.status, action);
  if (next === null) return null;

  const result =
    next === 'ended'
      ? await db
          .prepare(
            `UPDATE subscriptions
                SET status = 'ended', ended_on = ?, end_reason = ?,
                    updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
              WHERE id = ? AND status = ?`
          )
          .bind(options.endedOn, options.endReason, staffId, id, current.status)
          .run()
      : await db
          .prepare(
            `UPDATE subscriptions
                SET status = ?, updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
              WHERE id = ? AND status = ?`
          )
          .bind(next, staffId, id, current.status)
          .run();

  return (result.meta?.changes ?? 0) > 0 ? next : null;
}

export async function updateSubscriptionMemo(
  db: D1Database,
  id: number,
  memo: string | null,
  staffId: number
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE subscriptions
          SET memo = ?, updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = ? AND status != 'ended'`
    )
    .bind(memo, staffId, id)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** メニューを追加する。終了済みのサブスク・販売停止のメニューは追加しない */
export async function addSubscriptionItem(
  db: D1Database,
  subscriptionId: number,
  item: { menuId: number; quantity: number },
  staffId: number
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO subscription_items (subscription_id, menu_id, quantity, created_by)
       SELECT ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM subscriptions WHERE id = ? AND status != 'ended')
          AND EXISTS (SELECT 1 FROM menus WHERE id = ? AND is_active = 1)`
    )
    .bind(subscriptionId, item.menuId, item.quantity, staffId, subscriptionId, item.menuId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** メニューを外す（記録は残す）。終了済みのサブスクは触らない */
export async function removeSubscriptionItem(
  db: D1Database,
  itemId: number,
  staffId: number
): Promise<{ subscriptionId: number } | null> {
  const item = await db
    .prepare(
      `SELECT i.subscription_id
         FROM subscription_items i
         JOIN subscriptions s ON s.id = i.subscription_id
        WHERE i.id = ? AND i.removed_at IS NULL AND s.status != 'ended'`
    )
    .bind(itemId)
    .first<{ subscription_id: number }>();
  if (!item) return null;

  const result = await db
    .prepare(
      `UPDATE subscription_items
          SET removed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), removed_by = ?
        WHERE id = ? AND removed_at IS NULL`
    )
    .bind(staffId, itemId)
    .run();
  return (result.meta?.changes ?? 0) > 0 ? { subscriptionId: item.subscription_id } : null;
}

export async function getSubscriptionItemOwner(db: D1Database, itemId: number): Promise<number | null> {
  const row = await db
    .prepare('SELECT subscription_id FROM subscription_items WHERE id = ?')
    .bind(itemId)
    .first<{ subscription_id: number }>();
  return row ? row.subscription_id : null;
}
