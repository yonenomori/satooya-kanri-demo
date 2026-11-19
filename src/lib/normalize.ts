/**
 * 照合用の正規化。
 *
 * 方針は docs/design.md の 7 章のとおり。
 * - 電話番号は数字だけにして完全一致で見る
 * - 住所は都道府県を落とし、番地（最大3区切り）までを残す
 * - 市区町村は苗字照合の補助に使う
 *
 * ここで作った値は contacts の phone_normalized / address_normalized / city に入る。
 * 手入力させず、保存時に必ず再計算する。
 */

/** 数字に挟まれたハイフン類（NFKC で全角ハイフンは ASCII になるが、ー や − は残る） */
const DASH_CLASS = '\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\\u2212\\u30FC\\uFF70\\-';

/** 先頭の都道府県（北海道・東京都・京都府・大阪府・○○県） */
const PREFECTURE = /^(?:北海道|東京都|京都府|大阪府|.{2,3}県)/;

const KANJI_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/**
 * 漢数字（一〜九十九）を算用数字にする。対象外なら null。
 */
export function kanjiNumberToNumber(input: string): number | null {
  if (!input) return null;
  const s = input.normalize('NFKC');
  if (!/^[一二三四五六七八九十]+$/.test(s)) return null;
  const tenIndex = s.indexOf('十');
  if (tenIndex === -1) {
    // 十を含まない = 一〜九 の1文字だけ
    return s.length === 1 ? (KANJI_DIGITS[s] ?? null) : null;
  }
  const tensPart = s.slice(0, tenIndex);
  const onesPart = s.slice(tenIndex + 1);
  const tens = tensPart === '' ? 1 : KANJI_DIGITS[tensPart];
  const ones = onesPart === '' ? 0 : KANJI_DIGITS[onesPart];
  if (tens === undefined || ones === undefined) return null;
  const value = tens * 10 + ones;
  return value >= 1 && value <= 99 ? value : null;
}

/**
 * 電話番号を照合用に正規化する。数字以外を落とし、先頭の +81 は 0 にする。
 * 空なら null。
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  let s = String(input).normalize('NFKC').trim();
  if (s === '') return null;
  s = s.replace(/^\+81/, '0');
  s = s.replace(/[^0-9]/g, '');
  return s === '' ? null : s;
}

/**
 * 住所を照合用に正規化する。都道府県を落とし、番地までを残す。
 * 建物名・部屋番号は捨てる。空なら null。
 */
export function normalizeAddress(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  let s = String(input).normalize('NFKC');

  // 1. 空白をすべて除去
  s = s.replace(/[\s\u3000]+/g, '');
  if (s === '') return null;

  // 2. 先頭の都道府県を除去
  s = s.replace(PREFECTURE, '');

  // 3. 数字に挟まれたハイフン類を "-" に統一
  s = s.replace(new RegExp(`(\\d)[${DASH_CLASS}](?=\\d)`, 'g'), '$1-');

  // 4. 丁目・番地・番・号 の直前の漢数字を算用数字に変換
  s = s.replace(/([一二三四五六七八九十]+)(?=丁目|番地の|番地|番|号)/g, (match) => {
    const n = kanjiNumberToNumber(match);
    return n === null ? match : String(n);
  });

  // 5. 丁目・番地を "-" に、号を除去。数字に挟まれた "の" も "-" に
  s = s.replace(/丁目|番地の|番地|番/g, '-').replace(/号/g, '');
  s = s.replace(/(\d)の(?=\d)/g, '$1-');

  // 6. ヶ・ケ・ｹ を "ケ" に統一（霞ヶ関 → 霞ケ関）
  s = s.replace(/[ヶケｹ]/g, 'ケ');

  // 7. 数字(-数字){0,2} の最初の出現までを残す（建物名・部屋番号を捨てる）
  const m = s.match(/\d+(?:-\d+){0,2}/);
  if (m !== null && m.index !== undefined) {
    s = s.slice(0, m.index + m[0].length);
  }

  // 8. 末尾の "-" を除去
  s = s.replace(/-+$/, '');
  return s === '' ? null : s;
}

/**
 * 正規化済み住所から市区町村を取り出す。
 * 苗字＋市区町村の照合にだけ使う（誤判定しても人が判断する前提）。
 */
export function extractCity(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const s = String(input).normalize('NFKC').trim();
  if (s === '') return null;

  const patterns = [
    /^(.+?市.+?区)/, // 政令市の区: 横浜市港北区
    /^(.+?郡.+?[町村])/, // 郡: 〇〇郡〇〇村
    /^(.+?[市区町村])/, // 東京23区・市・町・村
  ];
  for (const pattern of patterns) {
    const m = s.match(pattern);
    if (m !== null) return m[1];
  }
  return null;
}
