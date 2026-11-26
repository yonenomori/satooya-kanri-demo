import type { Staff } from '../env';
import type { StaffRow } from '../db/contacts';
import type { MenuRow, SubscriptionFilter, SubscriptionItemRow, SubscriptionListRow } from '../db/subscriptions';
import { formatDateTime, kindLabel } from '../lib/labels';
import {
  formatSubscriptionNo,
  formatYen,
  itemsTotal,
  subscriptionStatusLabel,
} from '../lib/subscription';
import { Layout } from './Layout';

/* ------------------------------------------------------------------ */
/* 共通パーツ                                                          */
/* ------------------------------------------------------------------ */

export const SubscriptionBadge = ({ status }: { status: string }) => (
  <span class={`badge badge-sub badge-sub-${status}`}>{subscriptionStatusLabel(status)}</span>
);

export const SubscriptionNo = ({ id }: { id: number }) => <span class="sub-no">No.{formatSubscriptionNo(id)}</span>;

const quantityOptions = Array.from({ length: 10 }, (_, i) => i + 1);

/** 販売中メニューの選択欄＋数量。サブスク開始とメニュー追加で共用 */
export const MenuPicker = ({ menus, idPrefix }: { menus: MenuRow[]; idPrefix: string }) => (
  <>
    <div class="field">
      <label class="label" for={`${idPrefix}-menu`}>
        メニュー
      </label>
      <select class="input" id={`${idPrefix}-menu`} name="menuId" required>
        {menus.map((menu) => (
          <option value={String(menu.id)}>
            {menu.name}（{formatYen(menu.price)}）
          </option>
        ))}
      </select>
    </div>
    <div class="field">
      <label class="label" for={`${idPrefix}-qty`}>
        数量
      </label>
      <select class="input" id={`${idPrefix}-qty`} name="quantity">
        {quantityOptions.map((n) => (
          <option value={String(n)}>{n}</option>
        ))}
      </select>
    </div>
  </>
);

/** 連絡先の詳細画面に出す「サブスク」欄 */
export const ContactSubscriptions = ({
  contactId,
  subscriptions,
  menus,
  today,
  isNg,
}: {
  contactId: number;
  subscriptions: SubscriptionListRow[];
  menus: MenuRow[];
  today: string;
  isNg: boolean;
}) => {
  const hasOpen = subscriptions.some((s) => s.status !== 'ended');
  return (
    <section class="card" id="subscriptions">
      <h2 class="section-title">
        サブスク <span class="count-badge">{subscriptions.length}</span>
      </h2>
      {subscriptions.length === 0 ? (
        <p class="hint">サブスクの登録はありません。</p>
      ) : (
        <ul class="list list-compact">
          {subscriptions.map((sub) => (
            <li class={`row${sub.status === 'ended' ? ' row-ended' : ''}`}>
              <a class="row-link" href={`/subscriptions/${sub.id}`}>
                <span class="row-head">
                  <SubscriptionNo id={sub.id} />
                  <SubscriptionBadge status={sub.status} />
                </span>
                <span class="row-meta">{sub.item_summary ?? 'メニューなし'}</span>
                <span class="row-meta">
                  {sub.started_on} 開始{sub.ended_on ? ` ／ ${sub.ended_on} 終了` : ''}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <details class="add-block">
        <summary>{hasOpen ? '別のサブスクを開始' : 'サブスクを開始'}</summary>
        {menus.length === 0 ? (
          <p class="hint">
            販売中のメニューがありません。先に<a href="/menus">メニュー管理</a>でメニューを追加してください。
          </p>
        ) : (
          <form method="post" action={`/contacts/${contactId}/subscriptions`} class="form form-compact">
            {isNg ? <p class="hint hint-warn">この方にはNG理由が登録されています。内容を確認してから開始してください。</p> : null}
            <MenuPicker menus={menus} idPrefix="newsub" />
            <div class="field">
              <label class="label" for="newsub-start">
                開始日
              </label>
              <input class="input" id="newsub-start" name="startedOn" type="date" value={today} required />
            </div>
            <div class="field">
              <label class="label" for="newsub-memo">
                メモ（任意）
              </label>
              <input class="input" id="newsub-memo" name="memo" type="text" placeholder="例: 毎月10日発送" />
            </div>
            <button type="submit" class="btn btn-primary btn-block">
              新しい番号で開始する
            </button>
            <p class="hint">管理番号は自動で付きます（例: No.00001）。</p>
          </form>
        )}
      </details>
    </section>
  );
};

/* ------------------------------------------------------------------ */
/* サブスク一覧                                                        */
/* ------------------------------------------------------------------ */

const FILTER_TABS: { value: SubscriptionFilter; label: string }[] = [
  { value: 'open', label: '利用中' },
  { value: 'active', label: 'オン' },
  { value: 'paused', label: 'オフ' },
  { value: 'ended', label: '終了' },
  { value: 'all', label: 'すべて' },
];

export const SubscriptionListPage = ({
  filter,
  no,
  rows,
  staff,
}: {
  filter: SubscriptionFilter;
  no: string;
  rows: SubscriptionListRow[];
  staff: Staff;
}) => (
  <Layout title="サブスク" staff={staff}>
    <p class="breadcrumb">
      <a href="/">検索</a> ／ サブスク
    </p>
    <h1 class="page-title">サブスク</h1>

    <form class="search-form" method="get" action="/subscriptions">
      <input type="hidden" name="filter" value={filter} />
      <div class="search-row">
        <input
          class="search-input"
          type="search"
          name="no"
          value={no}
          inputmode="numeric"
          placeholder="管理番号（例: 00001）"
          aria-label="管理番号"
          autocomplete="off"
        />
        <button class="btn btn-primary" type="submit">
          検索
        </button>
      </div>
    </form>

    <nav class="tabs" aria-label="状態で絞り込む">
      {FILTER_TABS.map((tab) => (
        <a class={`tab${filter === tab.value && no === '' ? ' tab-active' : ''}`} href={`/subscriptions?filter=${tab.value}`}>
          {tab.label}
        </a>
      ))}
    </nav>

    <p class="result-count">
      {no === '' ? '' : `管理番号「${no}」：`}
      {rows.length}件
    </p>

    {rows.length === 0 ? (
      <div class="card empty">
        <p>該当するサブスクがありません。</p>
        <p class="hint">サブスクは、里親の詳細画面から開始できます。</p>
      </div>
    ) : (
      <ul class="list">
        {rows.map((sub) => (
          <li class={`row${sub.status === 'ended' ? ' row-ended' : ''}`}>
            <a class="row-link" href={`/subscriptions/${sub.id}`}>
              <span class="row-head">
                <SubscriptionNo id={sub.id} />
                <span class="row-name">{sub.contact_name}</span>
              </span>
              <span class="row-badges">
                <SubscriptionBadge status={sub.status} />
              </span>
              <span class="row-meta">{sub.item_summary ?? 'メニューなし'}</span>
              <span class="row-meta">
                {sub.started_on} 開始{sub.ended_on ? ` ／ ${sub.ended_on} 終了` : ''}
              </span>
            </a>
          </li>
        ))}
      </ul>
    )}

    <div class="fab-bar">
      <a class="btn btn-ghost btn-block" href="/menus">
        メニュー管理
      </a>
      <a class="btn btn-ghost btn-block" href="/">
        検索画面へ戻る
      </a>
    </div>
  </Layout>
);

/* ------------------------------------------------------------------ */
/* サブスク詳細                                                        */
/* ------------------------------------------------------------------ */

export const SubscriptionPage = ({
  sub,
  items,
  removedItems,
  menus,
  staffList,
  today,
  errorMessage,
  staff,
}: {
  sub: SubscriptionListRow;
  items: SubscriptionItemRow[];
  removedItems: SubscriptionItemRow[];
  menus: MenuRow[];
  staffList: StaffRow[];
  today: string;
  errorMessage?: string;
  staff: Staff;
}) => {
  const staffName = (id: number | null): string => {
    if (id === null) return '—';
    const found = staffList.find((s) => s.id === id);
    return found ? found.name : `#${id}`;
  };
  const ended = sub.status === 'ended';
  const total = itemsTotal(items.map((item) => ({ price: item.menu_price, quantity: item.quantity })));
  const no = formatSubscriptionNo(sub.id);

  return (
    <Layout title={`サブスク No.${no}`} staff={staff}>
      <p class="breadcrumb">
        <a href="/subscriptions">サブスク</a> ／ No.{no}
      </p>

      {errorMessage ? (
        <div class="alert alert-error" role="alert">
          {errorMessage}
        </div>
      ) : null}

      <section class={`card sub-head sub-head-${sub.status}`}>
        <p class="sub-head-no">No.{no}</p>
        <div class="row-badges">
          <SubscriptionBadge status={sub.status} />
        </div>
        <p class="contact-sub">
          {kindLabel(sub.contact_kind)}：
          {sub.contact_deleted_at ? (
            <span>{sub.contact_name}（削除済み）</span>
          ) : (
            <a href={`/contacts/${sub.contact_id}`}>{sub.contact_name}</a>
          )}
        </p>
        {ended ? (
          <p class="hint">
            このサブスクは終了しています。管理番号 No.{no} は今後使われません。再開する場合は、新しい番号で開始してください。
          </p>
        ) : null}
      </section>

      {!ended ? (
        <section class="card">
          <h2 class="section-title">オン／オフ</h2>
          <form method="post" action={`/subscriptions/${sub.id}/status`} class="form form-compact">
            {sub.status === 'active' ? (
              <>
                <input type="hidden" name="action" value="turn_off" />
                <p class="hint">現在は「オン」です。一時的に止めるときはオフにします（番号はそのまま）。</p>
                <button type="submit" class="btn btn-ghost btn-block">
                  オフにする（休止）
                </button>
              </>
            ) : (
              <>
                <input type="hidden" name="action" value="turn_on" />
                <p class="hint">現在は「オフ（休止中）」です。</p>
                <button type="submit" class="btn btn-primary btn-block">
                  オンにする（再開）
                </button>
              </>
            )}
          </form>
        </section>
      ) : null}

      <section class="card">
        <h2 class="section-title">
          メニュー <span class="count-badge">{items.length}</span>
        </h2>
        {items.length === 0 ? (
          <p class="hint">メニューが入っていません。</p>
        ) : (
          <ul class="note-list">
            {items.map((item) => (
              <li class="note">
                <p class="note-head">
                  <span class="row-name">{item.menu_name}</span>
                  <span class="meta">×{item.quantity}</span>
                  {item.menu_is_active ? null : <span class="badge badge-status">販売停止中</span>}
                </p>
                <p class="meta">
                  {formatYen(item.menu_price)}
                  {item.menu_price !== null ? ` ／ 小計 ${formatYen(item.menu_price * item.quantity)}` : ''}
                </p>
                {!ended ? (
                  <form method="post" action={`/subscription-items/${item.id}/remove`} class="inline-form">
                    <button type="submit" class="btn btn-ghost btn-danger-text btn-sm">
                      このメニューを外す
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {items.length > 0 ? (
          <p class="sub-total">
            1回あたり合計：{formatYen(total.total)}
            {total.hasUnpriced ? <span class="hint">（価格未設定のメニューを除く）</span> : null}
          </p>
        ) : null}

        {!ended ? (
          <details class="add-block" open={items.length === 0}>
            <summary>メニューを追加</summary>
            {menus.length === 0 ? (
              <p class="hint">
                販売中のメニューがありません。<a href="/menus">メニュー管理</a>から追加してください。
              </p>
            ) : (
              <form method="post" action={`/subscriptions/${sub.id}/items`} class="form form-compact">
                <MenuPicker menus={menus} idPrefix="additem" />
                <button type="submit" class="btn btn-primary btn-block">
                  メニューを追加
                </button>
              </form>
            )}
          </details>
        ) : null}

        {removedItems.length > 0 ? (
          <details class="revoked-block">
            <summary>外したメニュー（{removedItems.length}件）</summary>
            <ul class="note-list">
              {removedItems.map((item) => (
                <li class="note">
                  <p class="note-head">
                    <span>{item.menu_name}</span>
                    <span class="meta">×{item.quantity}</span>
                  </p>
                  <p class="meta">
                    {formatDateTime(item.removed_at)} に外した / {staffName(item.removed_by)}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section class="card">
        <h2 class="section-title">契約情報</h2>
        <dl class="info">
          <dt>管理番号</dt>
          <dd>No.{no}</dd>
          <dt>開始日</dt>
          <dd>{sub.started_on}</dd>
          <dt>終了日</dt>
          <dd>{sub.ended_on ?? '—'}</dd>
          {ended ? (
            <>
              <dt>終了理由</dt>
              <dd class="pre-wrap">{sub.end_reason ?? '—'}</dd>
            </>
          ) : null}
          <dt>メモ</dt>
          <dd class="pre-wrap">{sub.memo ?? '—'}</dd>
          <dt>登録</dt>
          <dd>
            {staffName(sub.created_by)} / {formatDateTime(sub.created_at)}
          </dd>
          <dt>更新</dt>
          <dd>
            {sub.updated_by !== null ? staffName(sub.updated_by) : '—'} / {formatDateTime(sub.updated_at) || '—'}
          </dd>
        </dl>
        {!ended ? (
          <details class="add-block">
            <summary>メモを変更</summary>
            <form method="post" action={`/subscriptions/${sub.id}/memo`} class="form form-compact">
              <label class="label" for="sub-memo">
                メモ
              </label>
              <textarea class="input textarea" id="sub-memo" name="memo" rows={2}>
                {sub.memo ?? ''}
              </textarea>
              <button type="submit" class="btn btn-primary btn-block">
                メモを保存
              </button>
            </form>
          </details>
        ) : null}
      </section>

      {!ended ? (
        <section class="card">
          <details class="revoke">
            <summary>このサブスクを終了する</summary>
            <form method="post" action={`/subscriptions/${sub.id}/status`} class="form form-compact">
              <input type="hidden" name="action" value="end" />
              <div class="field">
                <label class="label" for="sub-end-on">
                  終了日
                </label>
                <input class="input" id="sub-end-on" name="endedOn" type="date" value={today} required />
              </div>
              <div class="field">
                <label class="label" for="sub-end-reason">
                  終了理由（任意）
                </label>
                <input class="input" id="sub-end-reason" name="endReason" type="text" placeholder="例: 本人からの解約申し出" />
              </div>
              <div class="field">
                <label class="check-label">
                  <input type="checkbox" name="confirm" value="1" required /> 終了すると元に戻せず、No.{no} は今後使えなくなることを確認しました
                </label>
              </div>
              <button type="submit" class="btn btn-danger btn-block">
                終了する
              </button>
            </form>
          </details>
        </section>
      ) : null}
    </Layout>
  );
};

/* ------------------------------------------------------------------ */
/* メニュー管理                                                        */
/* ------------------------------------------------------------------ */

export const MenuPage = ({
  menus,
  errorMessage,
  staff,
}: {
  menus: MenuRow[];
  errorMessage?: string;
  staff: Staff;
}) => (
  <Layout title="メニュー管理" staff={staff}>
    <p class="breadcrumb">
      <a href="/subscriptions">サブスク</a> ／ メニュー管理
    </p>
    <h1 class="page-title">メニュー管理</h1>

    {errorMessage ? (
      <div class="alert alert-error" role="alert">
        {errorMessage}
      </div>
    ) : null}

    <section class="card">
      <h2 class="section-title">メニューを追加</h2>
      <form method="post" action="/menus" class="form form-compact">
        <div class="field">
          <label class="label" for="menu-name">
            名前<span class="required">必須</span>
          </label>
          <input class="input" id="menu-name" name="name" type="text" placeholder="例: 子犬用ドライフード 2kg" required />
        </div>
        <div class="field">
          <label class="label" for="menu-price">
            価格（税込・円）
          </label>
          <input class="input" id="menu-price" name="price" type="text" inputmode="numeric" placeholder="例: 3980（未定なら空欄）" />
        </div>
        <div class="field">
          <label class="label" for="menu-desc">
            説明（任意）
          </label>
          <input class="input" id="menu-desc" name="description" type="text" />
        </div>
        <button type="submit" class="btn btn-primary btn-block">
          追加する
        </button>
      </form>
    </section>

    <section class="card">
      <h2 class="section-title">
        メニュー一覧 <span class="count-badge">{menus.length}</span>
      </h2>
      {menus.length === 0 ? (
        <p class="hint">まだメニューがありません。</p>
      ) : (
        <ul class="note-list">
          {menus.map((menu) => (
            <li class={`note${menu.is_active ? '' : ' note-inactive'}`}>
              <p class="note-head">
                <span class="row-name">{menu.name}</span>
                <span class={`badge ${menu.is_active ? 'badge-sub badge-sub-active' : 'badge-status'}`}>
                  {menu.is_active ? '販売中' : '販売停止'}
                </span>
              </p>
              <p class="meta">
                {formatYen(menu.price)}
                {menu.description ? ` ／ ${menu.description}` : ''}
              </p>
              <details class="add-block">
                <summary>編集</summary>
                <form method="post" action={`/menus/${menu.id}`} class="form form-compact">
                  <label class="label" for={`menu-${menu.id}-name`}>
                    名前
                  </label>
                  <input class="input" id={`menu-${menu.id}-name`} name="name" type="text" value={menu.name} required />
                  <label class="label" for={`menu-${menu.id}-price`}>
                    価格（税込・円）
                  </label>
                  <input
                    class="input"
                    id={`menu-${menu.id}-price`}
                    name="price"
                    type="text"
                    inputmode="numeric"
                    value={menu.price === null ? '' : String(menu.price)}
                  />
                  <label class="label" for={`menu-${menu.id}-desc`}>
                    説明
                  </label>
                  <input
                    class="input"
                    id={`menu-${menu.id}-desc`}
                    name="description"
                    type="text"
                    value={menu.description ?? ''}
                  />
                  <label class="check-label">
                    <input type="checkbox" name="isActive" value="1" checked={menu.is_active === 1} /> 販売中にする
                  </label>
                  <button type="submit" class="btn btn-primary btn-block">
                    保存
                  </button>
                  <p class="hint">販売停止にしても、すでにサブスクに入っている分はそのまま残ります。</p>
                </form>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  </Layout>
);
