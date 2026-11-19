import { describe, expect, it } from 'vitest';
import { extractCity, kanjiNumberToNumber, normalizeAddress, normalizePhone } from '../src/lib/normalize';

describe('normalizePhone', () => {
  it('ハイフン付きの携帯番号を数字だけにする', () => {
    expect(normalizePhone('090-1234-5678')).toBe('09012345678');
  });

  it('全角数字・全角括弧を変換する', () => {
    expect(normalizePhone('０９０（１２３４）５６７８')).toBe('09012345678');
  });

  it('+81 の国番号を 0 に置き換える', () => {
    expect(normalizePhone('+81 90-1234-5678')).toBe('09012345678');
  });

  it('固定電話の区切りを除去する', () => {
    expect(normalizePhone('045 123 4567')).toBe('0451234567');
  });

  it('空文字は null', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
  });

  it('null / undefined は null', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
});

describe('normalizeAddress', () => {
  it('都道府県・漢数字・建物名を落として番地までを残す', () => {
    expect(normalizeAddress('神奈川県横浜市港北区日吉一丁目2番3号 日吉ハイツ101')).toBe('横浜市港北区日吉1-2-3');
  });

  it('建物名・部屋番号を落とす', () => {
    expect(normalizeAddress('横浜市港北区日吉1-2-3 日吉ハイツ101号室')).toBe('横浜市港北区日吉1-2-3');
  });

  it('全角の数字とハイフンを正規化する', () => {
    expect(normalizeAddress('神奈川県横浜市港北区日吉１－２－３')).toBe('横浜市港北区日吉1-2-3');
  });

  it('丁目のあとのハイフン表記をそろえる', () => {
    expect(normalizeAddress('横浜市港北区日吉1丁目2-3')).toBe('横浜市港北区日吉1-2-3');
  });

  it('ヶ を ケ に統一する', () => {
    expect(normalizeAddress('東京都千代田区霞ヶ関2-1-1')).toBe('千代田区霞ケ関2-1-1');
  });

  it('番地の をハイフンにする', () => {
    expect(normalizeAddress('長野県〇〇郡〇〇村大字〇〇123番地の4')).toBe('〇〇郡〇〇村大字〇〇123-4');
  });

  it('番地が無い住所はそのまま残す', () => {
    expect(normalizeAddress('横浜市港北区日吉')).toBe('横浜市港北区日吉');
  });

  it('前後の空白・全角スペースを除去する', () => {
    expect(normalizeAddress('　神奈川県横浜市港北区日吉1-2-3　')).toBe('横浜市港北区日吉1-2-3');
  });

  it('空文字は null', () => {
    expect(normalizeAddress('')).toBeNull();
    expect(normalizeAddress('   ')).toBeNull();
  });

  it('都道府県だけの入力は null', () => {
    expect(normalizeAddress('神奈川県')).toBeNull();
  });
});

describe('extractCity', () => {
  it('政令市の区までを取り出す', () => {
    expect(extractCity('横浜市港北区日吉1-2-3')).toBe('横浜市港北区');
  });

  it('東京23区を取り出す', () => {
    expect(extractCity('千代田区霞ケ関2-1-1')).toBe('千代田区');
  });

  it('郡＋村を取り出す', () => {
    expect(extractCity('〇〇郡〇〇村大字〇〇123-4')).toBe('〇〇郡〇〇村');
  });

  it('市だけの住所を取り出す', () => {
    expect(extractCity('藤沢市鵠沼1-1')).toBe('藤沢市');
  });

  it('空なら null', () => {
    expect(extractCity('')).toBeNull();
  });
});

describe('kanjiNumberToNumber', () => {
  it('一〜九を変換する', () => {
    expect(kanjiNumberToNumber('一')).toBe(1);
    expect(kanjiNumberToNumber('九')).toBe(9);
  });

  it('十・十一・二十・二十一を変換する', () => {
    expect(kanjiNumberToNumber('十')).toBe(10);
    expect(kanjiNumberToNumber('十一')).toBe(11);
    expect(kanjiNumberToNumber('二十')).toBe(20);
    expect(kanjiNumberToNumber('二十一')).toBe(21);
  });

  it('漢数字以外は null', () => {
    expect(kanjiNumberToNumber('1')).toBeNull();
    expect(kanjiNumberToNumber('丁目')).toBeNull();
  });
});
