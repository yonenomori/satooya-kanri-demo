import { categoryLabel, kindLabel } from '../lib/labels';
import { MATCH_LEVEL_LABELS, matchReasonLabel, type Match } from '../lib/matching';

type Props = {
  matches: Match[];
};

/**
 * 新規登録・更新時の照合結果。
 * 警告は保存を止めない。理由を確認したうえで「確認して保存」できる。
 * 色だけに頼らず、必ず「NG」「要確認」の文字ラベルを添える。
 */
export const MatchAlert = ({ matches }: Props) => {
  const ngCount = matches.filter((match) => match.level === 'ng').length;

  return (
    <section class="alert alert-match" role="alert" aria-live="polite">
      <h2 class="alert-title">
        {ngCount > 0 ? 'NG登録に一致する可能性があります' : '登録済み・要確認の相手が見つかりました'}
      </h2>
      <p class="alert-lead">
        {ngCount > 0
          ? 'この連絡先はNG登録と一致しています。内容を確認してください。'
          : '同じ電話番号や世帯の可能性があります。内容を確認してください。'}
      </p>

      <ul class="match-list">
        {matches.map((match) => (
          <li class={`match match-${match.level}`}>
            <div class="match-head">
              <span class={`badge badge-${match.level}`}>{MATCH_LEVEL_LABELS[match.level]}</span>
              <span class="match-name">
                <a href={`/contacts/${match.contact.id}`} target="_blank" rel="noreferrer">
                  {match.contact.name}
                </a>
              </span>
              <span class="match-kind">{kindLabel(match.contact.kind)}</span>
            </div>
            <p class="match-reason">{matchReasonLabel(match)}</p>
            {match.contact.phone ? <p class="match-meta">電話: {match.contact.phone}</p> : null}
            {match.contact.address ? <p class="match-meta">住所: {match.contact.address}</p> : null}
            {match.latestNg ? (
              <p class="match-ng-detail">
                NG理由: {categoryLabel(match.latestNg.category)}：{match.latestNg.detail}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
};
