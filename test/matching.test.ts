import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildMatchQuery,
  classifyCandidate,
  classifyCandidates,
  findMatches,
  matchReasonLabel,
  type MatchCandidate,
  type MatchInput,
} from '../src/lib/matching';

/** 照合クエリが返す1行のひな形 */
function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    id: 1,
    kind: 'adopter',
    name: '山田 太郎',
    family_name: '山田',
    phone: '090-0000-1234',
    address: '横浜市港北区日吉1-2-3',
    phone_normalized: '09000001234',
    address_normalized: '横浜市港北区日吉1-2-3',
    city: '横浜市港北区',
    active_ng_count: 0,
    latest_ng_category: null,
    latest_ng_detail: null,
    latest_ng_created_at: null,
    ...overrides,
  };
}

const ngCandidate = (overrides: Partial<MatchCandidate> = {}) =>
  candidate({
    active_ng_count: 1,
    latest_ng_category: 'false_statement',
    latest_ng_detail: 'ペット可物件と申告していたが不可物件だった。',
    latest_ng_created_at: '2026-05-01T00:00:00Z',
    ...overrides,
  });

const input: MatchInput = {
  kind: 'adopter',
  familyName: '山田',
  phoneNormalized: '09000001234',
  addressNormalized: '横浜市港北区日吉1-2-3',
  city: '横浜市港北区',
};

describe('classifyCandidate', () => {
  it('電話が一致し、有効なNGがあれば ng', () => {
    const match = classifyCandidate(ngCandidate(), input);
    expect(match).not.toBeNull();
    expect(match?.level).toBe('ng');
    expect(match?.reason).toBe('phone');
    expect(match?.latestNg).toEqual({
      category: 'false_statement',
      detail: 'ペット可物件と申告していたが不可物件だった。',
      createdAt: '2026-05-01T00:00:00Z',
    });
  });

  it('住所が一致し、有効なNGがあれば check（同じ世帯の可能性）', () => {
    const match = classifyCandidate(
      ngCandidate({ id: 2, phone_normalized: '08000001111', family_name: '鈴木', city: '横浜市港北区' }),
      input
    );
    expect(match?.level).toBe('check');
    expect(match?.reason).toBe('address');
  });

  it('苗字＋市区町村が一致し、有効なNGがあれば check（家族の可能性）', () => {
    const match = classifyCandidate(
      ngCandidate({
        id: 3,
        phone_normalized: '08011112222',
        address_normalized: '横浜市港北区日吉9-9-9',
      }),
      input
    );
    expect(match?.level).toBe('check');
    expect(match?.reason).toBe('family_city');
  });

  it('電話が一致し、NGが無ければ duplicate（既に登録がある）', () => {
    const match = classifyCandidate(candidate({ id: 4 }), input);
    expect(match?.level).toBe('duplicate');
    expect(match?.reason).toBe('phone');
    expect(match?.latestNg).toBeUndefined();
  });

  it('住所だけ一致してNGが無ければ警告しない', () => {
    expect(
      classifyCandidate(candidate({ id: 5, phone_normalized: '08099998888' }), input)
    ).toBeNull();
  });

  it('苗字＋市区町村だけ一致してNGが無ければ警告しない', () => {
    expect(
      classifyCandidate(
        candidate({
          id: 6,
          phone_normalized: '08099997777',
          address_normalized: '横浜市港北区日吉8-8-8',
        }),
        input
      )
    ).toBeNull();
  });

  it('苗字の照合は里親同士だけ（ブリーダーとは照合しない）', () => {
    const match = classifyCandidate(
      ngCandidate({
        id: 7,
        kind: 'breeder',
        name: '山田ケンネル',
        family_name: '山田',
        phone_normalized: '0300000000',
        address_normalized: '埼玉県〇〇市〇〇5-6',
        city: '横浜市港北区',
      }),
      input
    );
    expect(match).toBeNull();
  });

  it('里親とブリーダーをまたいでも電話一致は照合する', () => {
    const match = classifyCandidate(
      ngCandidate({ id: 8, kind: 'breeder', name: '山田ケンネル', family_name: null }),
      { ...input, kind: 'breeder', familyName: null }
    );
    expect(match?.level).toBe('ng');
  });

  it('複数の条件に当たったら強い方（ng）1件にまとめる', () => {
    const match = classifyCandidate(ngCandidate(), input);
    expect(match?.level).toBe('ng');
    expect(match?.reason).toBe('phone');
  });

  it('住所と苗字の両方が一致したら、より具体的な住所を理由にする', () => {
    const match = classifyCandidate(
      ngCandidate({ id: 9, phone_normalized: '08033334444' }),
      input
    );
    expect(match?.level).toBe('check');
    expect(match?.reason).toBe('address');
  });

  it('編集時は自分自身を除外する', () => {
    expect(classifyCandidate(ngCandidate({ id: 42 }), { ...input, id: 42 })).toBeNull();
  });

  it('照合キーが無ければ一致しない', () => {
    expect(classifyCandidate(ngCandidate(), { kind: 'adopter' })).toBeNull();
  });

  it('解除済みNGだけの相手（有効NG 0）は duplicate 扱いになる', () => {
    const match = classifyCandidate(candidate({ id: 10, active_ng_count: 0 }), input);
    expect(match?.level).toBe('duplicate');
  });
});

describe('classifyCandidates', () => {
  it('ng → check → duplicate の順に並べる', () => {
    const rows = [
      candidate({ id: 1 }), // duplicate
      ngCandidate({
        id: 2,
        phone_normalized: '08011112222',
        address_normalized: '横浜市港北区日吉7-7-7',
      }), // check（苗字＋市区町村）
      ngCandidate({ id: 3 }), // ng
      candidate({
        id: 4,
        phone_normalized: '08022223333',
        address_normalized: '横浜市港北区日吉1-2-3',
      }), // 住所一致・NGなし → 対象外
    ];

    const matches = classifyCandidates(rows, input);
    expect(matches.map((match) => match.level)).toEqual(['ng', 'check', 'duplicate']);
    expect(matches.map((match) => match.contact.id)).toEqual([3, 2, 1]);
  });

  it('一致が無ければ空配列', () => {
    expect(classifyCandidates([candidate({ phone_normalized: '08000000000', address_normalized: 'x' })], { kind: 'adopter' })).toEqual([]);
  });
});

describe('buildMatchQuery', () => {
  it('値はすべてバインドパラメータで渡し、SQL に値を埋め込まない', () => {
    const { sql, params } = buildMatchQuery(input);
    expect(sql).not.toContain('09000001234');
    expect(sql).not.toContain('横浜市港北区日吉1-2-3');
    expect(sql).not.toContain('山田');
    expect(sql).toContain('c.phone_normalized = ?');
    expect(sql).toContain('c.address_normalized = ?');
    expect(sql).toContain('c.family_name = ?');
    // 自分（id）の除外 + 電話 + 住所 + 苗字 + 市区町村
    expect(params).toEqual([0, '09000001234', '横浜市港北区日吉1-2-3', '山田', '横浜市港北区']);
  });

  it('編集時は自分のIDを除外条件に入れる', () => {
    const { params } = buildMatchQuery({ ...input, id: 12 });
    expect(params[0]).toBe(12);
  });

  it('論理削除済みは除外する', () => {
    expect(buildMatchQuery(input).sql).toContain('c.deleted_at IS NULL');
  });

  it('ブリーダーの入力では苗字の条件を付けない', () => {
    const { sql, params } = buildMatchQuery({
      kind: 'breeder',
      familyName: '山田',
      phoneNormalized: '0300000000',
      city: '〇〇市',
    });
    expect(sql).not.toContain('c.family_name = ?');
    expect(params).toEqual([0, '0300000000']);
  });

  it('有効なNGの最新1件を取得するサブクエリを含む', () => {
    const { sql } = buildMatchQuery(input);
    expect(sql).toContain('n.revoked_at IS NULL');
    expect(sql).toContain('ORDER BY n.created_at DESC, n.id DESC LIMIT 1');
  });
});

/** テスト用の最小 D1 スタブ（クエリとバインド値をそのまま返す） */
function fakeDb(rows: MatchCandidate[], spy: { sql?: string; params?: unknown[] } = {}): D1Database {
  const statement = {
    bind(...params: unknown[]) {
      spy.params = params;
      return statement;
    },
    async all<T>() {
      return { results: rows as unknown as T[], success: true, meta: {} };
    },
    async first<T>() {
      return (rows[0] ?? null) as unknown as T;
    },
    async run() {
      return { results: [], success: true, meta: {} };
    },
  };
  return {
    prepare(sql: string) {
      spy.sql = sql;
      return statement;
    },
  } as unknown as D1Database;
}

describe('findMatches', () => {
  let spy: { sql?: string; params?: unknown[] };

  beforeEach(() => {
    spy = {};
  });

  it('クエリ結果を判定して返す', async () => {
    const db = fakeDb([ngCandidate({ id: 3 }), candidate({ id: 4 })], spy);
    const matches = await findMatches(db, input);
    expect(matches.map((match) => match.level)).toEqual(['ng', 'duplicate']);
    expect(spy.params?.[0]).toBe(0);
  });

  it('照合キーが無ければクエリを投げない', async () => {
    const db = fakeDb([ngCandidate()], spy);
    const matches = await findMatches(db, { kind: 'adopter' });
    expect(matches).toEqual([]);
    expect(spy.sql).toBeUndefined();
  });
});

describe('matchReasonLabel', () => {
  it('一致理由を日本語で返す', () => {
    expect(matchReasonLabel({ level: 'ng', reason: 'phone', contact: { id: 1, kind: 'adopter', name: 'A', phone: null, address: null } })).toBe(
      'NG登録と電話番号が一致'
    );
    expect(
      matchReasonLabel({ level: 'check', reason: 'address', contact: { id: 1, kind: 'adopter', name: 'A', phone: null, address: null } })
    ).toBe('NG登録と住所が一致');
    expect(
      matchReasonLabel({
        level: 'check',
        reason: 'family_city',
        contact: { id: 1, kind: 'adopter', name: 'A', phone: null, address: null },
      })
    ).toBe('NG登録と苗字・市区町村が一致');
    expect(
      matchReasonLabel({
        level: 'duplicate',
        reason: 'phone',
        contact: { id: 1, kind: 'adopter', name: 'A', phone: null, address: null },
      })
    ).toBe('電話番号が一致する登録があります');
  });
});
