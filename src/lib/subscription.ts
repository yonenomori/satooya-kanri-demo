/**
 * サブスク（ペットフードの定期提供）の純粋なルール。DB に依存しないのでテストしやすい。
 *
 * - 管理番号は subscriptions.id を 5 桁ゼロ埋めで表示する（1 → "00001"）
 * - 状態: active（オン）/ paused（オフ・休止）/ ended（終了）
 * - オン ⇄ オフは何度でも切り替えられる。終了は取り消せず、その番号は二度と使わない
 */

export type SubscriptionStatus = 'active' | 'paused' | 'ended';

export const SUBSCRIPTION_NO_DIGITS = 5;

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: 'オン',
  paused: 'オフ（休止中）',
  ended: '終了',
};

export function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return value === 'active' || value === 'paused' || value === 'ended';
}

export function subscriptionStatusLabel(status: string): string {
  return isSubscriptionStatus(status) ? SUBSCRIPTION_STATUS_LABELS[status] : status;
}

/** 1 → "00001"。5 桁を超えたらそのまま（100000 → "100000"） */
export function formatSubscriptionNo(id: number): string {
  return String(id).padStart(SUBSCRIPTION_NO_DIGITS, '0');
}

/**
 * 入力された管理番号を id にする。"00001" "1" "No.00001" "#１" などを受け付ける。
 * 数字以外が混ざっている、0、桁が多すぎる場合は null。
 */
export function parseSubscriptionNo(input: string): number | null {
  const s = input
    .normalize('NFKC')
    .trim()
    .replace(/^(no\.?|#)\s*/i, '');
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export type SubscriptionAction = 'turn_on' | 'turn_off' | 'end';

/**
 * 状態遷移。許されない操作は null を返す。
 *   active → paused（オフ）/ ended
 *   paused → active（オン）/ ended
 *   ended  → どこにも行けない
 */
export function nextStatus(current: string, action: SubscriptionAction): SubscriptionStatus | null {
  if (current === 'ended') return null;
  if (action === 'end') return current === 'active' || current === 'paused' ? 'ended' : null;
  if (action === 'turn_on') return current === 'paused' ? 'active' : null;
  if (action === 'turn_off') return current === 'active' ? 'paused' : null;
  return null;
}

export function isSubscriptionAction(value: string): value is SubscriptionAction {
  return value === 'turn_on' || value === 'turn_off' || value === 'end';
}

/** 数量（1〜99）。不正なら null */
export function parseQuantity(input: string): number | null {
  const s = input.normalize('NFKC').trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 99 ? n : null;
}

/** 価格（円、0 以上の整数）。空欄は null（未定）。不正なら undefined */
export function parsePrice(input: string): number | null | undefined {
  const s = input.normalize('NFKC').trim().replace(/[,円¥\\]/g, '');
  if (s === '') return null;
  if (!/^\d{1,7}$/.test(s)) return undefined;
  return Number(s);
}

export function formatYen(price: number | null): string {
  if (price === null) return '価格未設定';
  // ICU に依存しないよう自前で 3 桁区切りにする
  return `${String(price).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}円`;
}

/** 有効なメニュー行から 1 回あたりの合計（価格未設定の行は除外して数える） */
export function itemsTotal(items: { price: number | null; quantity: number }[]): {
  total: number;
  hasUnpriced: boolean;
} {
  let total = 0;
  let hasUnpriced = false;
  for (const item of items) {
    if (item.price === null) {
      hasUnpriced = true;
    } else {
      total += item.price * item.quantity;
    }
  }
  return { total, hasUnpriced };
}
