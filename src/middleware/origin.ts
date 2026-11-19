/**
 * POST の Origin 検証。
 * 自ドメイン以外からの POST は 403。Origin ヘッダーが無い POST も受け付けない
 * （フォーム送信はブラウザが必ず Origin を付ける）。
 */
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

export const originGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method === 'POST' || c.req.method === 'PUT' || c.req.method === 'DELETE') {
    const origin = c.req.header('Origin');
    const requestHost = hostOf(c.req.url);
    const originHost = origin ? hostOf(origin) : null;
    if (requestHost === null || originHost === null || originHost !== requestHost) {
      return c.text('Forbidden', 403);
    }
  }
  await next();
});
