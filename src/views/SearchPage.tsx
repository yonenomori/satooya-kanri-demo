import type { Staff } from '../env';
import type { SearchResultRow } from '../db/contacts';
import { categoryLabel, kindLabel, statusLabel } from '../lib/labels';
import { Layout } from './Layout';

type Props = {
  q: string;
  kind: string;
  rows: SearchResultRow[];
  staff: Staff;
};

const KIND_TABS = [
  { value: 'all', label: 'すべて' },
  { value: 'adopter', label: '里親' },
  { value: 'breeder', label: 'ブリーダー' },
] as const;

export const SearchPage = ({ q, kind, rows, staff }: Props) => {
  const tabHref = (value: string) => (q === '' ? `/?kind=${value}` : `/?kind=${value}&q=${encodeURIComponent(q)}`);

  return (
    <Layout title="検索" staff={staff}>
      <form class="search-form" method="get" action="/">
        <input type="hidden" name="kind" value={kind} />
        <div class="search-row">
          <input
            class="search-input"
            type="search"
            name="q"
            value={q}
            placeholder="名前・電話・住所で検索"
            aria-label="検索語"
            autocomplete="off"
          />
          <button class="btn btn-primary" type="submit">
            検索
          </button>
        </div>
      </form>

      <nav class="tabs" aria-label="種別で絞り込む">
        {KIND_TABS.map((tab) => (
          <a class={`tab${kind === tab.value ? ' tab-active' : ''}`} href={tabHref(tab.value)}>
            {tab.label}
          </a>
        ))}
      </nav>

      <p class="result-count">
        {q === '' ? '最近の登録' : `「${q}」の検索結果`}：{rows.length}件
      </p>

      {rows.length === 0 ? (
        <div class="card empty">
          <p>該当する登録がありません。</p>
          <p class="hint">新規のお客様の場合は「新規登録」から登録してください。</p>
        </div>
      ) : (
        <ul class="list">
          {rows.map((row) => {
            const isNg = row.is_ng > 0;
            const rowClass = isNg ? 'row row-ng' : row.check_reason !== null ? 'row row-check' : 'row';
            return (
              <li class={rowClass}>
                <a class="row-link" href={`/contacts/${row.id}`}>
                  <span class="row-head">
                    <span class="row-kind">{kindLabel(row.kind)}</span>
                    <span class="row-name">{row.name}</span>
                  </span>
                  <span class="row-badges">
                    {isNg ? <span class="badge badge-ng">NG</span> : null}
                    {row.check_reason !== null ? <span class="badge badge-check">要確認</span> : null}
                    <span class="badge badge-status">{statusLabel(row.kind, row.status)}</span>
                  </span>
                  {row.phone ? <span class="row-meta">{row.phone}</span> : null}
                  {row.address ? <span class="row-meta">{row.address}</span> : null}
                  {isNg && row.latest_ng_category && row.latest_ng_detail ? (
                    <span class="row-ng-detail">
                      NG：{categoryLabel(row.latest_ng_category)}：{row.latest_ng_detail}
                    </span>
                  ) : null}
                  {row.check_reason !== null ? <span class="row-check-reason">{row.check_reason}</span> : null}
                </a>
              </li>
            );
          })}
        </ul>
      )}

      <div class="fab-bar">
        <a class="btn btn-primary btn-block fab" href={`/contacts/new${kind === 'all' ? '' : `?kind=${kind}`}`}>
          新規登録
        </a>
        {staff.isAdmin ? (
          <a class="btn btn-ghost btn-block" href="/admin">
            管理者メニュー
          </a>
        ) : null}
      </div>
    </Layout>
  );
};
