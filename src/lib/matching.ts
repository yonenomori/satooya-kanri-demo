/**
 * 新規登録・更新時の照合（docs/design.md の 8 章）。
 *
 * 判定の強い順: ng > check > duplicate
 *   - 電話が一致 + 有効な NG あり  → ng（NG本人の可能性が高い）
 *   - 住所が一致 + 有効な NG あり  → check（同じ世帯の可能性）
 *   - 苗字＋市区町村が一致 + 有効な NG あり → check（家族の可能性。里親同士のみ）
 *   - 電話が一致 + NG なし         → duplicate（既に登録がある）
 *   - 住所・苗字だけ一致 + NG なし → 警告しない（同じ住所の家族は普通にいるため）
 */

export type MatchLevel = 'ng' | 'check' | 'duplicate';
export type MatchReason = 'phone' | 'address' | 'family_city';

export type MatchContact = {
  id: number;
  kind: string;
  name: string;
  phone: string | null;
  address: string | null;
};

export type Match = {
  level: MatchLevel;
  reason: MatchReason;
  contact: MatchContact;
  latestNg?: { category: string; detail: string; createdAt: string };
};

export type MatchInput = {
  /** 編集時は自分自身を除外する */
  id?: number;
  kind: string;
  familyName?: string | null;
  phoneNormalized?: string | null;
  addressNormalized?: string | null;
  city?: string | null;
};

/** 照合クエリが返す1行（DB の列名のまま） */
export type MatchCandidate = {
  id: number;
  kind: string;
  name: string;
  family_name: string | null;
  phone: string | null;
  address: string | null;
  phone_normalized: string | null;
  address_normalized: string | null;
  city: string | null;
  active_ng_count: number;
  latest_ng_category: string | null;
  latest_ng_detail: string | null;
  latest_ng_created_at: string | null;
};

export const MATCH_LEVEL_ORDER: Record<MatchLevel, number> = {
  ng: 0,
  check: 1,
  duplicate: 2,
};

export const MATCH_LEVEL_LABELS: Record<MatchLevel, string> = {
  ng: 'NG',
  check: '要確認',
  duplicate: '登録済み',
};

/** 警告に出す「なぜ一致したか」 */
export function matchReasonLabel(match: Match): string {
  if (match.level === 'duplicate') return '電話番号が一致する登録があります';
  switch (match.reason) {
    case 'phone':
      return 'NG登録と電話番号が一致';
    case 'address':
      return 'NG登録と住所が一致';
    case 'family_city':
      return 'NG登録と苗字・市区町村が一致';
  }
}

function toMatchContact(candidate: MatchCandidate): MatchContact {
  return {
    id: candidate.id,
    kind: candidate.kind,
    name: candidate.name,
    phone: candidate.phone,
    address: candidate.address,
  };
}

/**
 * 一致した条件のうち、いちばん強いもの1件にまとめて Match を返す。
 * 一致がなければ null。
 */
export function classifyCandidate(candidate: MatchCandidate, input: MatchInput): Match | null {
  if (input.id !== undefined && candidate.id === input.id) return null;

  const matched = {
    phone: Boolean(input.phoneNormalized) && candidate.phone_normalized === input.phoneNormalized,
    address: Boolean(input.addressNormalized) && candidate.address_normalized === input.addressNormalized,
    family_city:
      input.kind === 'adopter' &&
      candidate.kind === 'adopter' &&
      Boolean(input.familyName) &&
      Boolean(input.city) &&
      candidate.family_name === input.familyName &&
      candidate.city === input.city,
  };

  const hasNg = candidate.active_ng_count > 0;
  const latestNg =
    hasNg && candidate.latest_ng_category !== null && candidate.latest_ng_detail !== null
      ? {
          category: candidate.latest_ng_category,
          detail: candidate.latest_ng_detail,
          createdAt: candidate.latest_ng_created_at ?? '',
        }
      : undefined;

  if (hasNg) {
    if (matched.phone) {
      return { level: 'ng', reason: 'phone', contact: toMatchContact(candidate), latestNg };
    }
    if (matched.address) {
      return { level: 'check', reason: 'address', contact: toMatchContact(candidate), latestNg };
    }
    if (matched.family_city) {
      return { level: 'check', reason: 'family_city', contact: toMatchContact(candidate), latestNg };
    }
    return null;
  }

  // NG のない相手は、電話が一致したときだけ「登録済み」として知らせる
  if (matched.phone) {
    return { level: 'duplicate', reason: 'phone', contact: toMatchContact(candidate) };
  }
  return null;
}

/** 一致した相手を ng → check → duplicate の順に並べる */
export function classifyCandidates(candidates: MatchCandidate[], input: MatchInput): Match[] {
  const matches: Match[] = [];
  for (const candidate of candidates) {
    const match = classifyCandidate(candidate, input);
    if (match !== null) matches.push(match);
  }
  return matches.sort((a, b) => {
    const byLevel = MATCH_LEVEL_ORDER[a.level] - MATCH_LEVEL_ORDER[b.level];
    if (byLevel !== 0) return byLevel;
    return a.contact.id - b.contact.id;
  });
}

/**
 * 照合クエリ。条件は固定の SQL 断片だけで組み立て、値はすべてバインドパラメータで渡す。
 * 自分のID（未指定なら 0）と論理削除済みは除外する。
 */
export function buildMatchQuery(input: MatchInput): { sql: string; params: (string | number)[] } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (input.phoneNormalized) {
    conditions.push('c.phone_normalized = ?');
    params.push(input.phoneNormalized);
  }
  if (input.addressNormalized) {
    conditions.push('c.address_normalized = ?');
    params.push(input.addressNormalized);
  }
  if (input.kind === 'adopter' && input.familyName && input.city) {
    conditions.push("(c.kind = 'adopter' AND c.family_name = ? AND c.city = ?)");
    params.push(input.familyName, input.city);
  }

  const sql = `SELECT c.id,
       c.kind,
       c.name,
       c.family_name,
       c.phone,
       c.address,
       c.phone_normalized,
       c.address_normalized,
       c.city,
       (SELECT COUNT(*) FROM ng_records n WHERE n.contact_id = c.id AND n.revoked_at IS NULL) AS active_ng_count,
       (SELECT n.category FROM ng_records n WHERE n.contact_id = c.id AND n.revoked_at IS NULL
          ORDER BY n.created_at DESC, n.id DESC LIMIT 1) AS latest_ng_category,
       (SELECT n.detail FROM ng_records n WHERE n.contact_id = c.id AND n.revoked_at IS NULL
          ORDER BY n.created_at DESC, n.id DESC LIMIT 1) AS latest_ng_detail,
       (SELECT n.created_at FROM ng_records n WHERE n.contact_id = c.id AND n.revoked_at IS NULL
          ORDER BY n.created_at DESC, n.id DESC LIMIT 1) AS latest_ng_created_at
  FROM contacts c
 WHERE c.deleted_at IS NULL
   AND c.id != ?${conditions.length > 0 ? `\n   AND (${conditions.join(' OR ')})` : ''}`;

  return { sql, params: [input.id ?? 0, ...params] };
}

export async function findMatches(db: D1Database, input: MatchInput): Promise<Match[]> {
  const { sql, params } = buildMatchQuery(input);
  if (params.length === 1) {
    // 照合キーが1つもない（電話・住所・苗字のどれも未入力）
    return [];
  }
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<MatchCandidate>();
  return classifyCandidates(result.results ?? [], input);
}
