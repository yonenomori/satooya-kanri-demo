import type { Staff } from '../env';
import type { ContactRow, HouseholdCandidate, NgRecordRow, NoteRow, StaffRow } from '../db/contacts';
import {
  categoryLabel,
  categoryOptions,
  channelLabel,
  channelOptions,
  formatDateTime,
  kindLabel,
  statusLabel,
} from '../lib/labels';
import type { MenuRow, SubscriptionListRow } from '../db/subscriptions';
import { Layout } from './Layout';
import { ContactSubscriptions } from './SubscriptionViews';

type Props = {
  contact: ContactRow;
  staffList: StaffRow[];
  activeNg: NgRecordRow[];
  revokedNg: NgRecordRow[];
  notes: NoteRow[];
  households: HouseholdCandidate[];
  subscriptions: SubscriptionListRow[];
  menus: MenuRow[];
  today: string;
  errorMessage?: string;
  staff: Staff;
};

export const DetailPage = ({
  contact,
  staffList,
  activeNg,
  revokedNg,
  notes,
  households,
  subscriptions,
  menus,
  today,
  errorMessage,
  staff,
}: Props) => {
  const staffName = (id: number | null): string => {
    if (id === null) return '—';
    const found = staffList.find((s) => s.id === id);
    return found ? found.name : `#${id}`;
  };
  const isNg = activeNg.length > 0;

  return (
    <Layout title={contact.name} staff={staff}>
      <p class="breadcrumb">
        <a href="/">検索</a> ／ 詳細
      </p>

      {errorMessage ? (
        <div class="alert alert-error" role="alert">
          {errorMessage}
        </div>
      ) : null}

      <section class={`card contact-head${isNg ? ' contact-head-ng' : ''}`}>
        <div class="row-head">
          <span class="row-kind">{kindLabel(contact.kind)}</span>
          <h1 class="contact-name">{contact.name}</h1>
        </div>
        <div class="row-badges">
          {isNg ? <span class="badge badge-ng">NG</span> : null}
          <span class="badge badge-status">{statusLabel(contact.kind, contact.status)}</span>
        </div>
        {contact.family_name ? (
          <p class="contact-sub">
            姓: {contact.family_name}
            {contact.given_name ? ` ／ 名: ${contact.given_name}` : ''}
          </p>
        ) : null}
      </section>

      <section class="card">
        <h2 class="section-title">基本情報</h2>
        <dl class="info">
          <dt>電話番号</dt>
          <dd>{contact.phone ? <a href={`tel:${contact.phone.replace(/[^0-9+]/g, '')}`}>{contact.phone}</a> : '—'}</dd>
          <dt>住所</dt>
          <dd>{contact.address ?? '—'}</dd>
          <dt>LINE名</dt>
          <dd>{contact.line_name ?? '—'}</dd>
          <dt>メモ</dt>
          <dd class="pre-wrap">{contact.memo ?? '—'}</dd>
          <dt>登録</dt>
          <dd>
            {staffName(contact.created_by)} / {formatDateTime(contact.created_at)}
          </dd>
          <dt>更新</dt>
          <dd>
            {contact.updated_by !== null ? staffName(contact.updated_by) : '—'} / {formatDateTime(contact.updated_at) || '—'}
          </dd>
        </dl>
      </section>

      <section class="card">
        <h2 class="section-title">
          NG理由 <span class="count-badge">{activeNg.length}</span>
        </h2>
        {activeNg.length === 0 ? (
          <p class="hint">有効なNG理由はありません。</p>
        ) : (
          <ul class="ng-list">
            {activeNg.map((record) => (
              <li class="ng-item">
                <p class="ng-head">
                  <span class="badge badge-ng">{categoryLabel(record.category)}</span>
                  <span class="meta">{formatDateTime(record.created_at)} / {staffName(record.created_by)}</span>
                </p>
                <p class="pre-wrap">{record.detail}</p>
                <details class="revoke">
                  <summary>このNGを解除する</summary>
                  <form method="post" action={`/ng/${record.id}/revoke`} class="form form-compact">
                    <label class="label" for={`revoke-${record.id}`}>
                      解除理由<span class="required">必須</span>
                    </label>
                    <input
                      class="input"
                      id={`revoke-${record.id}`}
                      name="reason"
                      type="text"
                      placeholder="例: 誤登録だったため"
                      required
                    />
                    <button type="submit" class="btn btn-danger btn-block">
                      解除する
                    </button>
                    <p class="hint">解除しても記録は残ります（履歴として表示されます）。</p>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        )}

        <details class="add-block">
          <summary>NG理由を追加</summary>
          <form method="post" action={`/contacts/${contact.id}/ng`} class="form form-compact">
            <div class="field">
              <label class="label" for="ngCategory">
                区分
              </label>
              <select class="input" id="ngCategory" name="category">
                {categoryOptions(contact.kind).map((option) => (
                  <option value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div class="field">
              <label class="label" for="ngDetail">
                詳細
              </label>
              <textarea class="input textarea" id="ngDetail" name="detail" rows={3} required />
              <p class="hint hint-warn">事実のみを記載してください。</p>
            </div>
            <button type="submit" class="btn btn-danger btn-block">
              NG理由を保存
            </button>
          </form>
        </details>

        {revokedNg.length > 0 ? (
          <details class="revoked-block">
            <summary>解除済みのNG（{revokedNg.length}件）</summary>
            <ul class="ng-list">
              {revokedNg.map((record) => (
                <li class="ng-item ng-item-revoked">
                  <p class="ng-head">
                    <span class="badge badge-status">{categoryLabel(record.category)}</span>
                    <span class="meta">
                      {formatDateTime(record.revoked_at)} 解除 / {staffName(record.revoked_by)}
                    </span>
                  </p>
                  <p class="pre-wrap">{record.detail}</p>
                  <p class="meta">解除理由: {record.revoke_reason ?? '—'}</p>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section class="card">
        <h2 class="section-title">
          同じ世帯の可能性がある人 <span class="count-badge">{households.length}</span>
        </h2>
        {households.length === 0 ? (
          <p class="hint">該当する人はいません。</p>
        ) : (
          <ul class="list list-compact">
            {households.map(({ contact: other, reason }) => (
              <li class="row">
                <a class="row-link" href={`/contacts/${other.id}`}>
                  <span class="row-head">
                    <span class="row-kind">{kindLabel(other.kind)}</span>
                    <span class="row-name">{other.name}</span>
                    <span class="badge badge-check">要確認</span>
                  </span>
                  <span class="row-check-reason">{reason}</span>
                  {other.address ? <span class="row-meta">{other.address}</span> : null}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {contact.kind === 'adopter' ? (
        <ContactSubscriptions
          contactId={contact.id}
          subscriptions={subscriptions}
          menus={menus}
          today={today}
          isNg={isNg}
        />
      ) : null}

      <section class="card" id="notes">
        <h2 class="section-title">
          やり取りメモ <span class="count-badge">{notes.length}</span>
        </h2>
        {notes.length === 0 ? (
          <p class="hint">メモはまだありません。</p>
        ) : (
          <ul class="note-list">
            {notes.map((note) => (
              <li class="note">
                <p class="note-head">
                  <span class="badge badge-channel">{channelLabel(note.channel)}</span>
                  <span class="note-date">{note.noted_on}</span>
                </p>
                <p class="pre-wrap">{note.body}</p>
                <p class="meta">
                  {staffName(note.created_by)} / {formatDateTime(note.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}

        <details class="add-block" open={notes.length === 0}>
          <summary>メモを追加</summary>
          <form method="post" action={`/contacts/${contact.id}/notes`} class="form form-compact">
            <div class="field">
              <label class="label" for="noteChannel">
                チャネル
              </label>
              <select class="input" id="noteChannel" name="channel">
                {channelOptions().map((option) => (
                  <option value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div class="field">
              <label class="label" for="notedOn">
                やり取りした日
              </label>
              <input class="input" id="notedOn" name="notedOn" type="date" value={today} />
            </div>
            <div class="field">
              <label class="label" for="noteBody">
                要点
              </label>
              <textarea class="input textarea" id="noteBody" name="body" rows={3} required />
            </div>
            <button type="submit" class="btn btn-primary btn-block">
              メモを保存
            </button>
          </form>
        </details>
      </section>

      <div class="fab-bar">
        <a class="btn btn-primary btn-block" href={`/contacts/${contact.id}/edit`}>
          編集
        </a>
        <a class="btn btn-ghost btn-block btn-danger-text" href={`/contacts/${contact.id}/delete`}>
          この登録を削除
        </a>
      </div>
    </Layout>
  );
};
