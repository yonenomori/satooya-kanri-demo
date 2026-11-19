import { describe, expect, it } from 'vitest';
import {
  buildContactRecord,
  checkReasonFor,
  escapeLike,
  isPhoneQuery,
  type ContactDraft,
} from '../src/db/contacts';
import { csvFileName, escapeCsvValue, toCsv } from '../src/lib/csv';
import { formatDateTime, isCategoryForKind, statusLabel, todayInJapan } from '../src/lib/labels';

const adopterDraft: ContactDraft = {
  kind: 'adopter',
  familyName: '山田',
  givenName: '太郎',
  breederName: '',
  phone: '090-0000-1234',
  address: '神奈川県横浜市港北区日吉一丁目2番3号',
  lineName: 'たろう',
  status: 'inquiry',
  memo: '',
};

describe('buildContactRecord', () => {
  it('里親は「姓 名」を表示名にし、照合用の値を計算する', () => {
    const record = buildContactRecord(adopterDraft);
    expect(record.name).toBe('山田 太郎');
    expect(record.familyName).toBe('山田');
    expect(record.phoneNormalized).toBe('09000001234');
    expect(record.addressNormalized).toBe('横浜市港北区日吉1-2-3');
    expect(record.city).toBe('横浜市港北区');
  });

  it('名が空でも姓だけで表示名を作る', () => {
    const record = buildContactRecord({ ...adopterDraft, givenName: '  ' });
    expect(record.name).toBe('山田');
  });

  it('ブリーダーは名称をそのまま表示名にし、姓・名は持たない', () => {
    const record = buildContactRecord({
      ...adopterDraft,
      kind: 'breeder',
      breederName: '山田ケンネル',
      familyName: '無視される',
      givenName: '無視される',
    });
    expect(record.name).toBe('山田ケンネル');
    expect(record.familyName).toBeNull();
    expect(record.givenName).toBeNull();
  });

  it('空欄は null にし、正規化できない住所は null', () => {
    const record = buildContactRecord({ ...adopterDraft, phone: ' ', address: '' });
    expect(record.phone).toBeNull();
    expect(record.phoneNormalized).toBeNull();
    expect(record.address).toBeNull();
    expect(record.addressNormalized).toBeNull();
    expect(record.city).toBeNull();
  });

  it('メモと LINE名の前後の空白を落とす', () => {
    const record = buildContactRecord({ ...adopterDraft, memo: '  要フォロー  ', lineName: ' たろう ' });
    expect(record.memo).toBe('要フォロー');
    expect(record.lineName).toBe('たろう');
  });
});

describe('isPhoneQuery', () => {
  it('数字・ハイフン・括弧・空白だけで4桁以上なら電話検索', () => {
    expect(isPhoneQuery('090-1234-5678')).toBe(true);
    expect(isPhoneQuery('0901234')).toBe(true);
    expect(isPhoneQuery('（０９０）１２３４')).toBe(true);
    expect(isPhoneQuery('045 123 4567')).toBe(true);
  });

  it('4桁未満や電話番号以外は文字検索', () => {
    expect(isPhoneQuery('123')).toBe(false);
    expect(isPhoneQuery('山田')).toBe(false);
    expect(isPhoneQuery('山田 090')).toBe(false);
    expect(isPhoneQuery('')).toBe(false);
  });
});

describe('escapeLike', () => {
  it('LIKE のワイルドカードをエスケープする', () => {
    expect(escapeLike('50%_off')).toBe('50\\%\\_off');
    expect(escapeLike('C:\\temp\\a')).toBe('C:\\\\temp\\\\a');
    expect(escapeLike('山田')).toBe('山田');
  });
});

describe('checkReasonFor', () => {
  const base = {
    kind: 'adopter',
    family_name: '鈴木',
    city: '横浜市港北区',
    phone_normalized: '08000001111',
    address_normalized: '横浜市港北区日吉9-9-9',
  };
  const ng = { id: 99, ...base };

  it('電話が一致したら電話の理由を返す', () => {
    expect(checkReasonFor({ id: 1, ...base }, [ng])).toBe('NG登録と電話番号が一致');
  });

  it('住所が一致したら住所の理由を返す', () => {
    expect(checkReasonFor({ id: 1, ...base, phone_normalized: '08099998888' }, [ng])).toBe(
      'NG登録と住所が一致'
    );
  });

  it('苗字＋市区町村が一致したらその理由を返す', () => {
    expect(
      checkReasonFor(
        { id: 1, ...base, phone_normalized: '08099998888', address_normalized: '横浜市港北区日吉1-1' },
        [ng]
      )
    ).toBe('NG登録と苗字・市区町村が一致');
  });

  it('自分自身とは照合しない', () => {
    expect(checkReasonFor({ id: 99, ...base }, [ng])).toBeNull();
  });

  it('一致が無ければ null', () => {
    expect(
      checkReasonFor(
        {
          id: 1,
          ...base,
          phone_normalized: '08012345678',
          address_normalized: '藤沢市鵠沼1-1',
          family_name: '田中',
          city: '藤沢市',
        },
        [ng]
      )
    ).toBeNull();
  });
});

describe('CSV', () => {
  it('カンマ・改行・ダブルクォートをエスケープする', () => {
    expect(escapeCsvValue('a,b')).toBe('"a,b"');
    expect(escapeCsvValue('改行\nあり')).toBe('"改行\nあり"');
    expect(escapeCsvValue('ダブル"引用')).toBe('"ダブル""引用"');
  });

  it('数式インジェクションを無害化する', () => {
    expect(escapeCsvValue('=1+1')).toBe("'=1+1");
    expect(escapeCsvValue('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('null は空文字にする', () => {
    expect(escapeCsvValue(null)).toBe('');
    expect(escapeCsvValue(undefined)).toBe('');
  });

  it('BOM 付き・CRLF の CSV を作る', () => {
    const csv = toCsv(['ID', '名前'], [[1, '山田 太郎'], [2, 'a,b']]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toBe('\uFEFFID,名前\r\n1,山田 太郎\r\n2,"a,b"\r\n');
  });

  it('ファイル名に日付を入れる', () => {
    expect(csvFileName('contacts', '2026-11-19')).toBe('contacts_2026-11-19.csv');
  });
});

describe('ラベル', () => {
  it('ステータスの表示を種別ごとに変える', () => {
    expect(statusLabel('adopter', 'inquiry')).toBe('問い合わせ中');
    expect(statusLabel('breeder', 'suspended')).toBe('取引停止');
  });

  it('NG区分は種別ごとに選べるものを絞る', () => {
    expect(isCategoryForKind('adopter', 'false_statement')).toBe(true);
    expect(isCategoryForKind('adopter', 'no_health_check')).toBe(false);
    expect(isCategoryForKind('breeder', 'no_health_check')).toBe(true);
    expect(isCategoryForKind('breeder', 'past_trouble')).toBe(false);
    expect(isCategoryForKind('breeder', 'other')).toBe(true);
  });

  it('日時は日本時間で表示する', () => {
    expect(formatDateTime('2026-11-18T23:30:00Z')).toBe('2026-11-19 08:30');
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime('invalid')).toBe('');
  });

  it('今日は日本時間で求める', () => {
    expect(todayInJapan(new Date('2026-11-19T14:30:00Z'))).toBe('2026-11-19');
    expect(todayInJapan(new Date('2026-11-19T15:30:00Z'))).toBe('2026-11-20');
  });
});
