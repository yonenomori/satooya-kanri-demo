/**
 * 画面に出す日本語ラベルと選択肢。
 * 値と表示の対応は docs/design.md の 11 章が正。
 */

export const KIND_LABELS: Record<string, string> = {
  adopter: '里親',
  breeder: 'ブリーダー',
};

export const ADOPTER_STATUS_LABELS: Record<string, string> = {
  inquiry: '問い合わせ中',
  screening: '審査中',
  contracted: '成約',
  closed: '終了',
};

export const BREEDER_STATUS_LABELS: Record<string, string> = {
  active: '取引中',
  suspended: '取引停止',
};

export const CATEGORY_LABELS: Record<string, string> = {
  false_statement: '虚偽申告',
  bad_environment: '飼育環境が不適切',
  past_trouble: '過去のトラブル',
  no_health_check: '健康診断の未実施',
  missing_documents: '書類不備',
  condition_mismatch: '説明と異なる状態での引き渡し',
  other: 'その他',
};

export const CHANNEL_LABELS: Record<string, string> = {
  line: 'LINE',
  instagram: 'Instagram',
  phone: '電話',
  visit: '来店',
  other: 'その他',
};

export const ADOPTER_CATEGORIES = ['false_statement', 'bad_environment', 'past_trouble', 'other'] as const;
export const BREEDER_CATEGORIES = ['no_health_check', 'missing_documents', 'condition_mismatch', 'other'] as const;

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export function statusLabel(kind: string, status: string): string {
  const table = kind === 'breeder' ? BREEDER_STATUS_LABELS : ADOPTER_STATUS_LABELS;
  return table[status] ?? status;
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

export function statusOptions(kind: string): { value: string; label: string }[] {
  const table = kind === 'breeder' ? BREEDER_STATUS_LABELS : ADOPTER_STATUS_LABELS;
  return Object.entries(table).map(([value, label]) => ({ value, label }));
}

export function defaultStatus(kind: string): string {
  return kind === 'breeder' ? 'active' : 'inquiry';
}

export function categoryOptions(kind: string): { value: string; label: string }[] {
  const values = kind === 'breeder' ? BREEDER_CATEGORIES : ADOPTER_CATEGORIES;
  return values.map((value) => ({ value, label: categoryLabel(value) }));
}

export function isCategoryForKind(kind: string, category: string): boolean {
  const options = categoryOptions(kind);
  return options.some((option) => option.value === category);
}

export function channelOptions(): { value: string; label: string }[] {
  return Object.keys(CHANNEL_LABELS).map((value) => ({ value, label: channelLabel(value) }));
}

/**
 * 保存されている ISO 8601（UTC）を日本時間の "YYYY-MM-DD HH:mm" にする。
 * 表示だけの用途なので、ICU に依存しないよう自前で計算する。
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '';
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return '';
  const jst = new Date(parsed + 9 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())} ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
}

/** 日本時間の今日（YYYY-MM-DD）。やり取りメモの初期値に使う */
export function todayInJapan(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}`;
}
