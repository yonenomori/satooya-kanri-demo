/**
 * 里親・ブリーダー管理システム（デモ版）
 *
 * 画面とルーティング。処理は lib / db に置き、ここでは入力の検証と画面の切り替えだけを行う。
 * - POST はすべて Origin を検証（originGuard）
 * - すべての画面は認証ミドルウェアの後ろ（authMiddleware）
 * - 画面は Hono JSX のサーバーサイドレンダリング。JS が無くても全機能が動く
 */
import { Hono, type Context } from 'hono';
import type { AppEnv } from './env';
import { authMiddleware } from './middleware/auth';
import { originGuard } from './middleware/origin';
import {
  addNote,
  addNgRecord,
  buildContactRecord,
  createContact,
  exportRows,
  getActiveNgRecords,
  getContact,
  getHouseholdCandidates,
  getNgRecord,
  getNotes,
  getRevokedNgRecords,
  isExportTable,
  listStaff,
  revokeNgRecord,
  searchContacts,
  softDeleteContact,
  updateContact,
  type ContactDraft,
  type ContactKind,
  type ContactRow,
} from './db/contacts';
import {
  addSubscriptionItem,
  changeSubscriptionStatus,
  createMenu,
  createSubscription,
  getMenu,
  getSubscription,
  getSubscriptionItemOwner,
  getSubscriptionItems,
  listMenus,
  listSubscriptions,
  listSubscriptionsForContact,
  removeSubscriptionItem,
  updateMenu,
  updateSubscriptionMemo,
  type SubscriptionFilter,
} from './db/subscriptions';
import { csvFileName, toCsv } from './lib/csv';
import { defaultStatus, isCategoryForKind, kindLabel, statusOptions, todayInJapan } from './lib/labels';
import { findMatches, type Match } from './lib/matching';
import { isSubscriptionAction, parsePrice, parseQuantity, parseSubscriptionNo } from './lib/subscription';
import { ContactForm, type ContactFormValues } from './views/ContactForm';
import { DetailPage } from './views/DetailPage';
import { ErrorPage } from './views/ErrorPage';
import { Layout } from './views/Layout';
import { SearchPage } from './views/SearchPage';
import { MenuPage, SubscriptionListPage, SubscriptionPage } from './views/SubscriptionViews';

const app = new Hono<AppEnv>();

app.use('*', originGuard);
app.use('*', authMiddleware);

const CHANNELS = ['line', 'instagram', 'phone', 'visit', 'other'] as const;
const KINDS = ['adopter', 'breeder'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseId(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function parseKind(value: unknown, fallback: ContactKind = 'adopter'): ContactKind {
  return (KINDS as readonly string[]).includes(String(value)) ? (value as ContactKind) : fallback;
}

function readFormValues(body: Record<string, string | File>, kind: ContactKind): ContactFormValues {
  return {
    kind,
    familyName: asText(body.familyName),
    givenName: asText(body.givenName),
    breederName: asText(body.breederName),
    phone: asText(body.phone),
    address: asText(body.address),
    lineName: asText(body.lineName),
    status: asText(body.status),
    memo: asText(body.memo),
    noteChannel: asText(body.noteChannel) || 'line',
    noteBody: asText(body.noteBody),
  };
}

function valuesFromContact(contact: ContactRow): ContactFormValues {
  const kind = parseKind(contact.kind);
  return {
    kind,
    familyName: contact.family_name ?? '',
    givenName: contact.given_name ?? '',
    breederName: kind === 'breeder' ? contact.name : '',
    phone: contact.phone ?? '',
    address: contact.address ?? '',
    lineName: contact.line_name ?? '',
    status: contact.status,
    memo: contact.memo ?? '',
    noteChannel: 'line',
    noteBody: '',
  };
}

function toDraft(values: ContactFormValues): ContactDraft {
  return {
    kind: values.kind,
    familyName: values.familyName,
    givenName: values.givenName,
    breederName: values.breederName,
    phone: values.phone,
    address: values.address,
    lineName: values.lineName,
    status: values.status,
    memo: values.memo,
  };
}

function notFoundPage(c: Context<AppEnv>) {
  return c.html(
    <ErrorPage
      status={404}
      title="見つかりません"
      message="指定された登録は存在しないか、削除されています。"
      staff={c.get('staff')}
    />,
    404
  );
}

function forbiddenAction(c: Context<AppEnv>) {
  return c.html(
    <ErrorPage
      status={403}
      title="権限がありません"
      message="この操作は管理者のみ行えます。"
      staff={c.get('staff')}
    />,
    403
  );
}

/* ------------------------------------------------------------------ */
/* 検索（トップ）                                                      */
/* ------------------------------------------------------------------ */

app.get('/', async (c) => {
  const q = c.req.query('q') ?? '';
  const kindParam = c.req.query('kind') ?? 'all';
  const kind = kindParam === 'adopter' || kindParam === 'breeder' ? kindParam : 'all';
  const rows = await searchContacts(c.env.DB, { q, kind });
  return c.html(<SearchPage q={q} kind={kind} rows={rows} staff={c.get('staff')} />);
});

/* ------------------------------------------------------------------ */
/* 新規登録・更新（照合 → 警告 → 確認して保存）                        */
/* ------------------------------------------------------------------ */

async function saveContact(
  c: Context<AppEnv>,
  mode: 'new' | 'edit',
  contactId: number | null
): Promise<Response> {
  const body = await c.req.parseBody();
  const kind = parseKind(body.kind);
  const values = readFormValues(body, kind);
  const staff = c.get('staff');
  const today = todayInJapan();

  const errors: string[] = [];
  if (kind === 'adopter' && values.familyName.trim() === '') {
    errors.push('姓を入力してください。');
  }
  if (kind === 'breeder' && values.breederName.trim() === '') {
    errors.push('名称を入力してください。');
  }
  const validStatuses = statusOptions(kind).map((option) => option.value);
  if (!validStatuses.includes(values.status)) {
    errors.push('ステータスを選んでください。');
    values.status = defaultStatus(kind);
  }

  const renderForm = (matches: Match[], showConfirm: boolean, status: 200 | 400) =>
    c.html(
      <ContactForm
        mode={mode}
        contactId={contactId ?? undefined}
        values={values}
        matches={matches}
        showConfirm={showConfirm}
        errors={errors}
        today={today}
        staff={staff}
      />,
      status
    );

  if (errors.length > 0) {
    return renderForm([], false, 400);
  }

  if (mode === 'edit' && contactId !== null) {
    const existing = await getContact(c.env.DB, contactId);
    if (existing === null) return notFoundPage(c);
  }

  const record = buildContactRecord(toDraft(values));
  const matches = await findMatches(c.env.DB, {
    id: mode === 'edit' && contactId !== null ? contactId : undefined,
    kind: record.kind,
    familyName: record.familyName,
    phoneNormalized: record.phoneNormalized,
    addressNormalized: record.addressNormalized,
    city: record.city,
  });

  const confirmed = asText(body.confirmed) === '1';
  if (matches.length > 0 && !confirmed) {
    return renderForm(matches, true, 200);
  }

  if (mode === 'new') {
    const newId = await createContact(c.env.DB, record, staff.id);
    const noteBody = values.noteBody.trim();
    if (noteBody !== '') {
      const channel = (CHANNELS as readonly string[]).includes(values.noteChannel) ? values.noteChannel : 'other';
      await addNote(c.env.DB, newId, { channel, body: noteBody, notedOn: today }, staff.id);
    }
    return c.redirect(`/contacts/${newId}`, 303);
  }

  if (contactId === null) return notFoundPage(c);
  const updated = await updateContact(c.env.DB, contactId, record, staff.id);
  if (!updated) return notFoundPage(c);
  return c.redirect(`/contacts/${contactId}`, 303);
}

app.get('/contacts/new', (c) => {
  const kind = parseKind(c.req.query('kind'));
  const values: ContactFormValues = {
    kind,
    familyName: '',
    givenName: '',
    breederName: '',
    phone: '',
    address: '',
    lineName: '',
    status: defaultStatus(kind),
    memo: '',
    noteChannel: 'line',
    noteBody: '',
  };
  return c.html(
    <ContactForm mode="new" values={values} today={todayInJapan()} staff={c.get('staff')} />
  );
});

app.post('/contacts', (c) => saveContact(c, 'new', null));

/* ------------------------------------------------------------------ */
/* 詳細・編集・削除                                                    */
/* ------------------------------------------------------------------ */

app.get('/contacts/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return notFoundPage(c);

  const db = c.env.DB;
  const contact = await getContact(db, id);
  if (contact === null) return notFoundPage(c);

  const [staffList, activeNg, revokedNg, notes, households, subscriptions, menus] = await Promise.all([
    listStaff(db),
    getActiveNgRecords(db, id),
    getRevokedNgRecords(db, id),
    getNotes(db, id),
    getHouseholdCandidates(db, contact),
    listSubscriptionsForContact(db, id),
    listMenus(db, { activeOnly: true }),
  ]);

  const errorParam = c.req.query('error');
  const errorMessage =
    errorParam === 'revoke_reason'
      ? 'NGの解除理由を入力してください。'
      : errorParam === 'ng_detail'
        ? 'NGの詳細を入力してください。'
        : errorParam === 'note_body'
          ? 'メモの内容を入力してください。'
          : errorParam === 'subscription'
            ? 'サブスクを開始できませんでした。メニュー・数量・開始日を確認してください。'
            : undefined;

  return c.html(
    <DetailPage
      contact={contact}
      staffList={staffList}
      activeNg={activeNg}
      revokedNg={revokedNg}
      notes={notes}
      households={households}
      subscriptions={subscriptions}
      menus={menus}
      today={todayInJapan()}
      errorMessage={errorMessage}
      staff={c.get('staff')}
    />
  );
});

app.get('/contacts/:id/edit', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return notFoundPage(c);
  const contact = await getContact(c.env.DB, id);
  if (contact === null) return notFoundPage(c);
  return c.html(
    <ContactForm
      mode="edit"
      contactId={contact.id}
      values={valuesFromContact(contact)}
      today={todayInJapan()}
      staff={c.get('staff')}
    />
  );
});

app.post('/contacts/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return notFoundPage(c);
  return saveContact(c, 'edit', id);
});

app.get('/contacts/:id/delete', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return notFoundPage(c);
  const contact = await getContact(c.env.DB, id);
  if (contact === null) return notFoundPage(c);

  return c.html(
    <Layout title="削除の確認" staff={c.get('staff')}>
      <section class="card">
        <h1 class="page-title">この登録を削除しますか？</h1>
        <p class="confirm-text">
          {kindLabel(contact.kind)}：{contact.name}
        </p>
        <p class="hint">
          削除しても記録は残り（論理削除）、検索や照合には表示されなくなります。NG理由ややり取りメモも履歴として残ります。
        </p>
        <form method="post" action={`/contacts/${contact.id}/delete`} class="confirm-block">
          <button type="submit" class="btn btn-danger btn-block">
            削除する
          </button>
        </form>
        <a class="btn btn-ghost btn-block" href={`/contacts/${contact.id}`}>
          戻る
        </a>
      </section>
    </Layout>
  );
});

app.post('/contacts/:id/delete', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return notFoundPage(c);
  await softDeleteContact(c.env.DB, id, c.get('staff').id);
  return c.redirect('/', 303);
});

/* ------------------------------------------------------------------ */
/* やり取りメモ・NG                                                    */
/* ------------------------------------------------------------------ */

app.post('/contacts/:id/notes', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return notFoundPage(c);
  const contact = await getContact(c.env.DB, id);
  if (contact === null) return notFoundPage(c);

  const body = await c.req.parseBody();
  const channel = asText(body.channel);
  const noteBody = asText(body.body).trim();
  const notedOn = asText(body.notedOn);

  if (noteBody === '') {
    return c.redirect(`/contacts/${id}?error=note_body`, 303);
  }

  await addNote(
    c.env.DB,
    id,
    {
      channel: (CHANNELS as readonly string[]).includes(channel) ? channel : 'other',
      body: noteBody,
      notedOn: /^\d{4}-\d{2}-\d{2}$/.test(notedOn) ? notedOn : todayInJapan(),
    },
    c.get('staff').id
  );
  return c.redirect(`/contacts/${id}#notes`, 303);
});

app.post('/contacts/:id/ng', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return notFoundPage(c);
  const contact = await getContact(c.env.DB, id);
  if (contact === null) return notFoundPage(c);

  const body = await c.req.parseBody();
  const category = asText(body.category);
  const detail = asText(body.detail).trim();

  if (!isCategoryForKind(contact.kind, category) || detail === '') {
    return c.redirect(`/contacts/${id}?error=ng_detail`, 303);
  }

  await addNgRecord(c.env.DB, id, { category, detail }, c.get('staff').id);
  return c.redirect(`/contacts/${id}`, 303);
});

app.post('/ng/:ngId/revoke', async (c) => {
  const ngId = parseId(c.req.param('ngId'));
  if (ngId === null) return notFoundPage(c);
  const record = await getNgRecord(c.env.DB, ngId);
  if (record === null) return notFoundPage(c);

  const body = await c.req.parseBody();
  const reason = asText(body.reason).trim();
  if (reason === '') {
    return c.redirect(`/contacts/${record.contact_id}?error=revoke_reason`, 303);
  }

  await revokeNgRecord(c.env.DB, ngId, reason, c.get('staff').id);
  return c.redirect(`/contacts/${record.contact_id}`, 303);
});

/* ------------------------------------------------------------------ */
/* サブスク（ペットフードの定期提供）                                  */
/*   管理番号 = subscriptions.id を 5 桁表示。終了した番号は二度と使わない */
/* ------------------------------------------------------------------ */

const SUBSCRIPTION_FILTERS: SubscriptionFilter[] = ['open', 'active', 'paused', 'ended', 'all'];

const SUBSCRIPTION_ERRORS: Record<string, string> = {
  status: 'この操作はできません。画面を開き直して、現在の状態を確認してください。',
  ended: 'このサブスクは終了しているため変更できません。',
  item: 'メニューを追加できませんでした。販売中のメニューと数量を選んでください。',
  confirm: '終了するには確認のチェックを入れてください。',
  end_date: '終了日を正しく入力してください。',
};

app.get('/subscriptions', async (c) => {
  const filterParam = c.req.query('filter') ?? 'open';
  const filter = (SUBSCRIPTION_FILTERS as string[]).includes(filterParam) ? (filterParam as SubscriptionFilter) : 'open';
  const no = (c.req.query('no') ?? '').trim();
  const id = no === '' ? null : parseSubscriptionNo(no);
  const rows = no !== '' && id === null ? [] : await listSubscriptions(c.env.DB, { filter, id });
  return c.html(<SubscriptionListPage filter={filter} no={no} rows={rows} staff={c.get('staff')} />);
});

app.post('/contacts/:id/subscriptions', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return notFoundPage(c);
  const contact = await getContact(c.env.DB, id);
  if (contact === null) return notFoundPage(c);
  if (contact.kind !== 'adopter') return c.redirect(`/contacts/${id}`, 303);

  const body = await c.req.parseBody();
  const menuId = parseId(asText(body.menuId));
  const quantity = parseQuantity(asText(body.quantity));
  const startedOn = asText(body.startedOn);
  const memo = asText(body.memo).trim();

  const menu = menuId === null ? null : await getMenu(c.env.DB, menuId);
  if (menu === null || menu.is_active !== 1 || quantity === null || !DATE_RE.test(startedOn)) {
    return c.redirect(`/contacts/${id}?error=subscription#subscriptions`, 303);
  }

  const subId = await createSubscription(
    c.env.DB,
    { contactId: id, startedOn, memo: memo === '' ? null : memo, menuId: menu.id, quantity },
    c.get('staff').id
  );
  return c.redirect(`/subscriptions/${subId}`, 303);
});

app.get('/subscriptions/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return notFoundPage(c);
  const db = c.env.DB;
  const sub = await getSubscription(db, id);
  if (sub === null) return notFoundPage(c);

  const [allItems, menus, staffList] = await Promise.all([
    getSubscriptionItems(db, id, { includeRemoved: true }),
    listMenus(db, { activeOnly: true }),
    listStaff(db),
  ]);

  const errorParam = c.req.query('error') ?? '';
  return c.html(
    <SubscriptionPage
      sub={sub}
      items={allItems.filter((item) => item.removed_at === null)}
      removedItems={allItems.filter((item) => item.removed_at !== null)}
      menus={menus}
      staffList={staffList}
      today={todayInJapan()}
      errorMessage={SUBSCRIPTION_ERRORS[errorParam]}
      staff={c.get('staff')}
    />
  );
});

app.post('/subscriptions/:id/status', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return notFoundPage(c);
  const sub = await getSubscription(c.env.DB, id);
  if (sub === null) return notFoundPage(c);
  if (sub.status === 'ended') return c.redirect(`/subscriptions/${id}?error=ended`, 303);

  const body = await c.req.parseBody();
  const action = asText(body.action);
  if (!isSubscriptionAction(action)) return c.redirect(`/subscriptions/${id}?error=status`, 303);

  const endedOn = asText(body.endedOn);
  if (action === 'end') {
    if (asText(body.confirm) !== '1') return c.redirect(`/subscriptions/${id}?error=confirm`, 303);
    if (!DATE_RE.test(endedOn) || endedOn < sub.started_on) {
      return c.redirect(`/subscriptions/${id}?error=end_date`, 303);
    }
  }

  const reason = asText(body.endReason).trim();
  const next = await changeSubscriptionStatus(
    c.env.DB,
    id,
    action,
    { endedOn, endReason: reason === '' ? null : reason },
    c.get('staff').id
  );
  if (next === null) return c.redirect(`/subscriptions/${id}?error=status`, 303);
  return c.redirect(`/subscriptions/${id}`, 303);
});

app.post('/subscriptions/:id/memo', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return notFoundPage(c);
  const body = await c.req.parseBody();
  const memo = asText(body.memo).trim();
  const ok = await updateSubscriptionMemo(c.env.DB, id, memo === '' ? null : memo, c.get('staff').id);
  return c.redirect(`/subscriptions/${id}${ok ? '' : '?error=ended'}`, 303);
});

app.post('/subscriptions/:id/items', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return notFoundPage(c);
  const sub = await getSubscription(c.env.DB, id);
  if (sub === null) return notFoundPage(c);
  if (sub.status === 'ended') return c.redirect(`/subscriptions/${id}?error=ended`, 303);

  const body = await c.req.parseBody();
  const menuId = parseId(asText(body.menuId));
  const quantity = parseQuantity(asText(body.quantity));
  if (menuId === null || quantity === null) return c.redirect(`/subscriptions/${id}?error=item`, 303);

  const ok = await addSubscriptionItem(c.env.DB, id, { menuId, quantity }, c.get('staff').id);
  return c.redirect(`/subscriptions/${id}${ok ? '' : '?error=item'}`, 303);
});

app.post('/subscription-items/:itemId/remove', async (c) => {
  const itemId = parseId(c.req.param('itemId'));
  if (itemId === null) return notFoundPage(c);
  const removed = await removeSubscriptionItem(c.env.DB, itemId, c.get('staff').id);
  if (removed === null) {
    // 終了済み・すでに外したメニューなど。持ち主のサブスクが分かればそこへ戻す
    const owner = await getSubscriptionItemOwner(c.env.DB, itemId);
    return owner === null ? notFoundPage(c) : c.redirect(`/subscriptions/${owner}?error=status`, 303);
  }
  return c.redirect(`/subscriptions/${removed.subscriptionId}`, 303);
});

/* メニュー管理 */

const MENU_ERRORS: Record<string, string> = {
  name: 'メニューの名前を入力してください。',
  price: '価格は半角数字（円）で入力してください。未定なら空欄にしてください。',
};

function readMenuForm(body: Record<string, string | File>):
  | { ok: true; name: string; price: number | null; description: string | null }
  | { ok: false; error: 'name' | 'price' } {
  const name = asText(body.name).trim();
  if (name === '') return { ok: false, error: 'name' };
  const price = parsePrice(asText(body.price));
  if (price === undefined) return { ok: false, error: 'price' };
  const description = asText(body.description).trim();
  return { ok: true, name, price, description: description === '' ? null : description };
}

app.get('/menus', async (c) => {
  const menus = await listMenus(c.env.DB);
  const errorParam = c.req.query('error') ?? '';
  return c.html(<MenuPage menus={menus} errorMessage={MENU_ERRORS[errorParam]} staff={c.get('staff')} />);
});

app.post('/menus', async (c) => {
  const form = readMenuForm(await c.req.parseBody());
  if (!form.ok) return c.redirect(`/menus?error=${form.error}`, 303);
  await createMenu(c.env.DB, form, c.get('staff').id);
  return c.redirect('/menus', 303);
});

app.post('/menus/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return notFoundPage(c);
  const body = await c.req.parseBody();
  const form = readMenuForm(body);
  if (!form.ok) return c.redirect(`/menus?error=${form.error}`, 303);
  const ok = await updateMenu(c.env.DB, id, { ...form, isActive: asText(body.isActive) === '1' }, c.get('staff').id);
  if (!ok) return notFoundPage(c);
  return c.redirect('/menus', 303);
});

/* ------------------------------------------------------------------ */
/* 管理メニュー・CSV エクスポート（管理者のみ）                        */
/* ------------------------------------------------------------------ */

app.get('/admin', (c) => {
  const staff = c.get('staff');
  if (!staff.isAdmin) return forbiddenAction(c);

  return c.html(
    <Layout title="管理者メニュー" staff={staff}>
      <h1 class="page-title">管理者メニュー</h1>
      <section class="card">
        <h2 class="section-title">バックアップ（CSV）</h2>
        <p class="hint">
          UTF-8（BOM付き）で出力します。Excel でそのまま開けます。個人情報を含むため、取り扱いに注意してください。
        </p>
        <ul class="link-list">
          <li>
            <a class="btn btn-ghost btn-block" href="/admin/export/contacts.csv">
              連絡先（contacts）をダウンロード
            </a>
          </li>
          <li>
            <a class="btn btn-ghost btn-block" href="/admin/export/ng_records.csv">
              NG記録（ng_records）をダウンロード
            </a>
          </li>
          <li>
            <a class="btn btn-ghost btn-block" href="/admin/export/notes.csv">
              やり取りメモ（notes）をダウンロード
            </a>
          </li>
          <li>
            <a class="btn btn-ghost btn-block" href="/admin/export/subscriptions.csv">
              サブスク（subscriptions）をダウンロード
            </a>
          </li>
        </ul>
      </section>
      <a class="btn btn-ghost btn-block" href="/">
        検索画面へ戻る
      </a>
    </Layout>
  );
});

app.get('/admin/export/:name', async (c) => {
  const staff = c.get('staff');
  if (!staff.isAdmin) return forbiddenAction(c);

  const name = c.req.param('name');
  const table = name.replace(/\.csv$/, '');
  if (!name.endsWith('.csv') || !isExportTable(table)) {
    return notFoundPage(c);
  }

  const { headers, rows } = await exportRows(c.env.DB, table);
  const csv = toCsv(headers, rows);

  return c.body(csv, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${csvFileName(table, todayInJapan())}"`,
    'Cache-Control': 'no-store',
  });
});

/* ------------------------------------------------------------------ */
/* 404 / 500                                                          */
/* ------------------------------------------------------------------ */

app.notFound((c) =>
  c.html(
    <ErrorPage
      status={404}
      title="ページが見つかりません"
      message="URL を確認してください。"
      staff={c.get('staff')}
    />,
    404
  )
);

app.onError((err, c) => {
  // 個人情報や SQL の中身は出さない。種類だけ残す
  console.error('unhandled error:', err instanceof Error ? err.name : 'unknown');
  return c.html(
    <ErrorPage
      status={500}
      title="エラーが発生しました"
      message="時間をおいてもう一度お試しください。解決しない場合は管理者に連絡してください。"
      staff={c.get('staff')}
    />,
    500
  );
});

export default app;
