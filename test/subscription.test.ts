/// <reference types="node" />
// テスト専用: 実際のマイグレーションを node:sqlite に当てて確かめる（Workers 本体のコードは Node の型を使わない）
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addSubscriptionItem,
  changeSubscriptionStatus,
  createMenu,
  createSubscription,
  getSubscription,
  getSubscriptionItems,
  listSubscriptions,
  removeSubscriptionItem,
  updateMenu,
  updateSubscriptionMemo,
} from '../src/db/subscriptions';
import {
  formatSubscriptionNo,
  formatYen,
  itemsTotal,
  nextStatus,
  parsePrice,
  parseQuantity,
  parseSubscriptionNo,
} from '../src/lib/subscription';

/* ------------------------------------------------------------------ */
/* 純粋なルール                                                        */
/* ------------------------------------------------------------------ */

describe('管理番号', () => {
  it('5 桁ゼロ埋めで表示する', () => {
    expect(formatSubscriptionNo(1)).toBe('00001');
    expect(formatSubscriptionNo(123)).toBe('00123');
    expect(formatSubscriptionNo(99999)).toBe('99999');
    expect(formatSubscriptionNo(100000)).toBe('100000');
  });

  it('入力された番号を id にする', () => {
    expect(parseSubscriptionNo('00001')).toBe(1);
    expect(parseSubscriptionNo('1')).toBe(1);
    expect(parseSubscriptionNo('No.00012')).toBe(12);
    expect(parseSubscriptionNo('#００３')).toBe(3);
    expect(parseSubscriptionNo(' 42 ')).toBe(42);
  });

  it('番号として読めない入力は null', () => {
    expect(parseSubscriptionNo('')).toBeNull();
    expect(parseSubscriptionNo('00000')).toBeNull();
    expect(parseSubscriptionNo('12a')).toBeNull();
    expect(parseSubscriptionNo('-1')).toBeNull();
    expect(parseSubscriptionNo('1234567890')).toBeNull();
  });
});

describe('状態遷移', () => {
  it('オン ⇄ オフを切り替えられる', () => {
    expect(nextStatus('active', 'turn_off')).toBe('paused');
    expect(nextStatus('paused', 'turn_on')).toBe('active');
  });

  it('オンでもオフでも終了できる', () => {
    expect(nextStatus('active', 'end')).toBe('ended');
    expect(nextStatus('paused', 'end')).toBe('ended');
  });

  it('同じ状態への切り替えはしない', () => {
    expect(nextStatus('active', 'turn_on')).toBeNull();
    expect(nextStatus('paused', 'turn_off')).toBeNull();
  });

  it('終了したらどの操作もできない', () => {
    expect(nextStatus('ended', 'turn_on')).toBeNull();
    expect(nextStatus('ended', 'turn_off')).toBeNull();
    expect(nextStatus('ended', 'end')).toBeNull();
  });

  it('未知の状態は動かさない', () => {
    expect(nextStatus('unknown', 'end')).toBeNull();
  });
});

describe('入力値', () => {
  it('数量は 1〜99', () => {
    expect(parseQuantity('1')).toBe(1);
    expect(parseQuantity('９９')).toBe(99);
    expect(parseQuantity('0')).toBeNull();
    expect(parseQuantity('100')).toBeNull();
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('1.5')).toBeNull();
  });

  it('価格は空欄なら null、不正なら undefined', () => {
    expect(parsePrice('3980')).toBe(3980);
    expect(parsePrice('3,980円')).toBe(3980);
    expect(parsePrice('¥０')).toBe(0);
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('abc')).toBeUndefined();
    expect(parsePrice('-100')).toBeUndefined();
  });

  it('円表示と合計', () => {
    expect(formatYen(3980)).toBe('3,980円');
    expect(formatYen(1234567)).toBe('1,234,567円');
    expect(formatYen(null)).toBe('価格未設定');
    expect(
      itemsTotal([
        { price: 3980, quantity: 2 },
        { price: null, quantity: 1 },
        { price: 2640, quantity: 1 },
      ])
    ).toEqual({ total: 10600, hasUnpriced: true });
  });
});

/* ------------------------------------------------------------------ */
/* 実際のマイグレーションを当てた SQLite で DB 関数を確かめる          */
/* ------------------------------------------------------------------ */

/** node:sqlite を D1Database の必要な部分だけに見せる小さなアダプタ */
function d1(sqlite: DatabaseSync): D1Database {
  const plain = <T>(row: unknown): T => (row === undefined ? null : { ...(row as object) }) as T;
  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async <T>() => plain<T>(sqlite.prepare(sql).get(...(params as never[]))),
    all: async <T>() => ({
      results: sqlite.prepare(sql).all(...(params as never[])).map((row: unknown) => plain<T>(row)),
    }),
    run: async () => {
      const result = sqlite.prepare(sql).run(...(params as never[]));
      return { meta: { changes: Number(result.changes) } };
    },
  });
  return { prepare: (sql: string) => statement(sql) } as unknown as D1Database;
}

let sqlite: DatabaseSync;
let db: D1Database;
let menuId: number;
const STAFF = 1;

beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0001_init.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0002_subscriptions.sql', 'utf8'));
  sqlite.exec(`
    INSERT INTO staff (id, name, email) VALUES (1, 'スタッフA', 'dev-a@example.com');
    INSERT INTO contacts (id, kind, name, family_name, status, created_by)
      VALUES (1, 'adopter', '山田 一郎', '山田', 'contracted', 1);
  `);
  db = d1(sqlite);
  menuId = await createMenu(db, { name: '子犬用ドライフード 2kg', price: 3980, description: null }, STAFF);
});

const start = () =>
  createSubscription(db, { contactId: 1, startedOn: '2026-11-01', memo: null, menuId, quantity: 1 }, STAFF);

const end = (id: number) => changeSubscriptionStatus(db, id, 'end', { endedOn: '2026-11-30', endReason: '解約' }, STAFF);

describe('サブスクの DB 操作', () => {
  it('開始すると 1 番から番号が付き、最初のメニューが入る', async () => {
    const id = await start();
    expect(formatSubscriptionNo(id)).toBe('00001');
    const sub = await getSubscription(db, id);
    expect(sub?.status).toBe('active');
    expect(sub?.item_summary).toBe('子犬用ドライフード 2kg ×1');
  });

  it('オン／オフを切り替えられる', async () => {
    const id = await start();
    expect(await changeSubscriptionStatus(db, id, 'turn_off', { endedOn: '', endReason: null }, STAFF)).toBe('paused');
    expect(await changeSubscriptionStatus(db, id, 'turn_off', { endedOn: '', endReason: null }, STAFF)).toBeNull();
    expect(await changeSubscriptionStatus(db, id, 'turn_on', { endedOn: '', endReason: null }, STAFF)).toBe('active');
  });

  it('終了すると終了日と理由が残る', async () => {
    const id = await start();
    expect(await end(id)).toBe('ended');
    const sub = await getSubscription(db, id);
    expect(sub).toMatchObject({ status: 'ended', ended_on: '2026-11-30', end_reason: '解約', updated_by: STAFF });
  });

  it('終了した番号は二度と使われない（次は新しい番号になる）', async () => {
    const first = await start();
    await end(first);
    const second = await start();
    expect(formatSubscriptionNo(second)).toBe('00002');
  });

  it('終了したサブスクはオンに戻せず、メニューもメモも変えられない', async () => {
    const id = await start();
    const [item] = await getSubscriptionItems(db, id);
    await end(id);

    expect(await changeSubscriptionStatus(db, id, 'turn_on', { endedOn: '', endReason: null }, STAFF)).toBeNull();
    expect(await addSubscriptionItem(db, id, { menuId, quantity: 1 }, STAFF)).toBe(false);
    expect(await removeSubscriptionItem(db, item.id, STAFF)).toBeNull();
    expect(await updateSubscriptionMemo(db, id, 'メモ', STAFF)).toBe(false);
    expect((await getSubscription(db, id))?.status).toBe('ended');
  });

  it('アプリを通さなくても、DB のトリガーが終了済みの変更・削除を止める', async () => {
    const id = await start();
    await end(id);
    expect(() => sqlite.exec(`UPDATE subscriptions SET status = 'active', ended_on = NULL WHERE id = ${id}`)).toThrow(
      /subscription_ended/
    );
    expect(() => sqlite.exec(`DELETE FROM subscriptions WHERE id = ${id}`)).toThrow(/subscription_delete_forbidden/);
    expect(() =>
      sqlite.exec(`INSERT INTO subscription_items (subscription_id, menu_id, created_by) VALUES (${id}, ${menuId}, 1)`)
    ).toThrow(/subscription_ended/);
  });

  it('行を消しても番号は再利用されない（AUTOINCREMENT）', async () => {
    const id = await start();
    // トリガーを外して強制的に消しても、次の番号は進む
    sqlite.exec('DROP TRIGGER trg_subscriptions_no_delete');
    sqlite.exec(`DELETE FROM subscription_items WHERE subscription_id = ${id}`);
    sqlite.exec(`DELETE FROM subscriptions WHERE id = ${id}`);
    expect(await start()).toBe(id + 1);
  });

  it('メニューを追加・外すと、外した記録が残る', async () => {
    const id = await start();
    const other = await createMenu(db, { name: '成猫用ウェットフード', price: null, description: null }, STAFF);
    expect(await addSubscriptionItem(db, id, { menuId: other, quantity: 3 }, STAFF)).toBe(true);

    const items = await getSubscriptionItems(db, id);
    expect(items.map((item) => [item.menu_name, item.quantity])).toEqual([
      ['子犬用ドライフード 2kg', 1],
      ['成猫用ウェットフード', 3],
    ]);

    expect(await removeSubscriptionItem(db, items[0].id, STAFF)).toEqual({ subscriptionId: id });
    expect((await getSubscriptionItems(db, id)).map((item) => item.menu_name)).toEqual(['成猫用ウェットフード']);
    const all = await getSubscriptionItems(db, id, { includeRemoved: true });
    expect(all.find((item) => item.id === items[0].id)?.removed_by).toBe(STAFF);
  });

  it('販売停止のメニューは追加できないが、入っている分は残る', async () => {
    const id = await start();
    await updateMenu(db, menuId, { name: '子犬用ドライフード 2kg', price: 3980, description: null, isActive: false }, STAFF);
    expect(await addSubscriptionItem(db, id, { menuId, quantity: 1 }, STAFF)).toBe(false);
    const [item] = await getSubscriptionItems(db, id);
    expect(item.menu_is_active).toBe(0);
  });

  it('一覧: 利用中は終了を除き、番号指定で 1 件引ける', async () => {
    const a = await start();
    const b = await start();
    await end(a);
    expect((await listSubscriptions(db, { filter: 'open' })).map((s) => s.id)).toEqual([b]);
    expect((await listSubscriptions(db, { filter: 'ended' })).map((s) => s.id)).toEqual([a]);
    expect((await listSubscriptions(db, { filter: 'all' })).map((s) => s.id)).toEqual([b, a]);
    expect((await listSubscriptions(db, { filter: 'open', id: a })).map((s) => s.id)).toEqual([a]);
  });
});
