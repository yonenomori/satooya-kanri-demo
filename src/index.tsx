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
import { csvFileName, toCsv } from './lib/csv';
import { defaultStatus, isCategoryForKind, kindLabel, statusOptions, todayInJapan } from './lib/labels';
import { findMatches, type Match } from './lib/matching';
import { ContactForm, type ContactFormValues } from './views/ContactForm';
import { DetailPage } from './views/DetailPage';
import { ErrorPage } from './views/ErrorPage';
import { Layout } from './views/Layout';
import { SearchPage } from './views/SearchPage';

const app = new Hono<AppEnv>();

app.use('*', originGuard);
app.use('*', authMiddleware);

const CHANNELS = ['line', 'instagram', 'phone', 'visit', 'other'] as const;
const KINDS = ['adopter', 'breeder'] as const;

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

  const [staffList, activeNg, revokedNg, notes, households] = await Promise.all([
    listStaff(db),
    getActiveNgRecords(db, id),
    getRevokedNgRecords(db, id),
    getNotes(db, id),
    getHouseholdCandidates(db, contact),
  ]);

  const errorParam = c.req.query('error');
  const errorMessage =
    errorParam === 'revoke_reason'
      ? 'NGの解除理由を入力してください。'
      : errorParam === 'ng_detail'
        ? 'NGの詳細を入力してください。'
        : errorParam === 'note_body'
          ? 'メモの内容を入力してください。'
          : undefined;

  return c.html(
    <DetailPage
      contact={contact}
      staffList={staffList}
      activeNg={activeNg}
      revokedNg={revokedNg}
      notes={notes}
      households={households}
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
