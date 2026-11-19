import type { Staff } from '../env';
import type { ContactKind } from '../db/contacts';
import { channelOptions, defaultStatus, kindLabel, statusLabel, statusOptions } from '../lib/labels';
import type { Match } from '../lib/matching';
import { Layout } from './Layout';
import { MatchAlert } from './MatchAlert';

/** フォームの値。バリデーションエラーや照合警告のときも、この値で画面を作り直す */
export type ContactFormValues = {
  kind: ContactKind;
  familyName: string;
  givenName: string;
  breederName: string;
  phone: string;
  address: string;
  lineName: string;
  status: string;
  memo: string;
  noteChannel: string;
  noteBody: string;
};

export function emptyFormValues(kind: ContactKind): ContactFormValues {
  return {
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
}

type Props = {
  mode: 'new' | 'edit';
  contactId?: number;
  values: ContactFormValues;
  matches?: Match[];
  showConfirm?: boolean;
  errors?: string[];
  today: string;
  staff: Staff;
};

/** 「確認して保存」用に、入力値をすべて hidden で送り直す */
const HiddenFields = ({ values }: { values: ContactFormValues }) => (
  <>
    <input type="hidden" name="kind" value={values.kind} />
    <input type="hidden" name="familyName" value={values.familyName} />
    <input type="hidden" name="givenName" value={values.givenName} />
    <input type="hidden" name="breederName" value={values.breederName} />
    <input type="hidden" name="phone" value={values.phone} />
    <input type="hidden" name="address" value={values.address} />
    <input type="hidden" name="lineName" value={values.lineName} />
    <input type="hidden" name="status" value={values.status} />
    <input type="hidden" name="memo" value={values.memo} />
    <input type="hidden" name="noteChannel" value={values.noteChannel} />
    <input type="hidden" name="noteBody" value={values.noteBody} />
    <input type="hidden" name="confirmed" value="1" />
  </>
);

export const ContactForm = ({
  mode,
  contactId,
  values,
  matches = [],
  showConfirm = false,
  errors = [],
  today,
  staff,
}: Props) => {
  const action = mode === 'new' ? '/contacts' : `/contacts/${contactId}`;
  const isNew = mode === 'new';
  const isAdopter = values.kind === 'adopter';

  return (
    <Layout title={isNew ? '新規登録' : '編集'} staff={staff}>
      <h1 class="page-title">{isNew ? '新規登録' : '連絡先を編集'}</h1>

      {errors.length > 0 ? (
        <div class="alert alert-error" role="alert">
          <ul class="error-list">
            {errors.map((error) => (
              <li>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {showConfirm ? <MatchAlert matches={matches} /> : null}

      {showConfirm ? (
        <form method="post" action={action} class="confirm-block">
          <HiddenFields values={values} />
          <button type="submit" class="btn btn-danger btn-block">
            確認して保存
          </button>
          <p class="hint">内容を直すときは、下のフォームを編集してから保存してください。</p>
        </form>
      ) : null}

      <form method="post" action={action} class="form">
        <fieldset class="fieldset">
          <legend class="legend">種別</legend>
          {isNew ? (
            <div class="tabs tabs-inline" role="tablist">
              {(['adopter', 'breeder'] as const).map((kind) => (
                <a
                  class={`tab${values.kind === kind ? ' tab-active' : ''}`}
                  href={`/contacts/new?kind=${kind}`}
                  role="tab"
                  aria-selected={values.kind === kind ? 'true' : 'false'}
                >
                  {kindLabel(kind)}
                </a>
              ))}
            </div>
          ) : (
            <p class="static-value">{kindLabel(values.kind)}</p>
          )}
        </fieldset>

        {isAdopter ? (
          <>
            <div class="field">
              <label class="label" for="familyName">
                姓<span class="required">必須</span>
              </label>
              <input class="input" id="familyName" name="familyName" type="text" value={values.familyName} autocomplete="off" required />
            </div>
            <div class="field">
              <label class="label" for="givenName">
                名
              </label>
              <input class="input" id="givenName" name="givenName" type="text" value={values.givenName} autocomplete="off" />
            </div>
          </>
        ) : (
          <div class="field">
            <label class="label" for="breederName">
              名称<span class="required">必須</span>
            </label>
            <input class="input" id="breederName" name="breederName" type="text" value={values.breederName} autocomplete="off" required />
          </div>
        )}

        <div class="field">
          <label class="label" for="phone">
            電話番号
          </label>
          <input
            class="input"
            id="phone"
            name="phone"
            type="tel"
            inputmode="tel"
            value={values.phone}
            placeholder="090-0000-1234"
            autocomplete="off"
          />
        </div>

        <div class="field">
          <label class="label" for="address">
            住所
          </label>
          <input
            class="input"
            id="address"
            name="address"
            type="text"
            value={values.address}
            placeholder="横浜市港北区日吉1-2-3"
            autocomplete="off"
          />
          <p class="hint">番地まで入力してください（建物名は不要です）。</p>
        </div>

        <div class="field">
          <label class="label" for="lineName">
            LINE名
          </label>
          <input class="input" id="lineName" name="lineName" type="text" value={values.lineName} autocomplete="off" />
        </div>

        <div class="field">
          <label class="label" for="status">
            ステータス
          </label>
          <select class="input" id="status" name="status">
            {statusOptions(values.kind).map((option) => (
              <option value={option.value} selected={option.value === values.status}>
                {statusLabel(values.kind, option.value)}
              </option>
            ))}
          </select>
        </div>

        <div class="field">
          <label class="label" for="memo">
            メモ
          </label>
          <textarea class="input textarea" id="memo" name="memo" rows={3}>
            {values.memo}
          </textarea>
        </div>

        {isNew ? (
          <fieldset class="fieldset">
            <legend class="legend">最初のやり取りメモ（任意）</legend>
            <div class="field">
              <label class="label" for="noteChannel">
                どこでのやり取りか
              </label>
              <select class="input" id="noteChannel" name="noteChannel">
                {channelOptions().map((option) => (
                  <option value={option.value} selected={option.value === values.noteChannel}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div class="field">
              <label class="label" for="noteBody">
                やり取りの要点
              </label>
              <textarea class="input textarea" id="noteBody" name="noteBody" rows={3} placeholder="例: チワワの子について初回問い合わせ。">
                {values.noteBody}
              </textarea>
              <input type="hidden" name="notedOn" value={today} />
            </div>
          </fieldset>
        ) : null}

        <button type="submit" class="btn btn-primary btn-block">
          {showConfirm ? '内容を直して保存' : '保存する'}
        </button>
        <a class="btn btn-ghost btn-block" href={isNew ? '/' : `/contacts/${contactId}`}>
          キャンセル
        </a>
      </form>
    </Layout>
  );
};
