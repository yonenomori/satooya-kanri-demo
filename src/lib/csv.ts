/**
 * CSV 出力（管理者のみ）。バックアップ用途。
 *
 * - UTF-8 BOM 付き（Excel で文字化けしないため）
 * - カンマ・改行・ダブルクォートを正しくエスケープ
 * - 改行は CRLF
 */

const BOM = '\uFEFF';

export function escapeCsvValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Excel の数式インジェクション対策（= + - @ で始まる値は先頭に ' を付ける）
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(escapeCsvValue).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvValue).join(','));
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** contacts_2026-11-19.csv のようなファイル名 */
export function csvFileName(table: string, date: string): string {
  return `${table}_${date}.csv`;
}
