/**
 * 認証（docs/design.md の 4 章）。
 *
 * 1. ENVIRONMENT=development のときだけ DEV_USER_EMAIL をログインユーザーとみなす
 *    （production で DEV_USER_EMAIL が設定されていたら設定ミスとして 500）
 * 2. 本番は Cloudflare Access の Cf-Access-Jwt-Assertion を検証する（aud = ACCESS_AUD）
 * 3. メールで staff を引き、見つからない・無効なら 403
 * 4. 以降のハンドラへ staff を渡す（isAdmin は ADMIN_EMAILS で判定）
 *
 * このファイルは JSX を使わない（ミドルウェアは .ts）ため、画面は ErrorPage を関数として呼ぶ。
 */
import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { findStaffByEmail } from '../db/contacts';
import { ErrorPage } from '../views/ErrorPage';

/** JWKS は isolate 内で使い回す */
let cached: { domain: string; jwks: JWTVerifyGetKey } | null = null;

function jwksFor(domain: string): JWTVerifyGetKey {
  if (cached !== null && cached.domain === domain) return cached.jwks;
  const jwks = createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`));
  cached = { domain, jwks };
  return jwks;
}

function normalizeTeamDomain(value: string | undefined): string | null {
  if (!value) return null;
  const domain = value.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return domain === '' ? null : domain;
}

function adminEmails(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email !== '');
}

function errorPage(
  c: Context<AppEnv>,
  status: 403 | 500,
  title: string,
  message: string
): Response | Promise<Response> {
  return c.html(ErrorPage({ status, title, message, staff: c.get('staff') }), status);
}

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const env = c.env;
  const isDevelopment = env.ENVIRONMENT === 'development';

  if (!isDevelopment && env.DEV_USER_EMAIL) {
    return errorPage(
      c,
      500,
      '設定エラー',
      '本番環境で DEV_USER_EMAIL が設定されています。wrangler の設定から削除してください。'
    );
  }

  let email: string | null = null;

  if (isDevelopment) {
    const devEmail = env.DEV_USER_EMAIL?.trim();
    if (!devEmail) {
      return errorPage(
        c,
        403,
        '開発用ログインが未設定です',
        'ローカル開発では .dev.vars に DEV_USER_EMAIL を設定してください（例: DEV_USER_EMAIL=dev-a@example.com）。'
      );
    }
    email = devEmail;
  } else {
    const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
    const audience = env.ACCESS_AUD?.trim();
    if (teamDomain === null || !audience) {
      return errorPage(
        c,
        500,
        '設定エラー',
        'ACCESS_TEAM_DOMAIN と ACCESS_AUD を設定してください。'
      );
    }

    const token = c.req.header('Cf-Access-Jwt-Assertion');
    if (!token) {
      return errorPage(c, 403, 'ログインが必要です', 'Cloudflare Access のログインを経由してアクセスしてください。');
    }

    try {
      const { payload } = await jwtVerify(token, jwksFor(teamDomain), {
        issuer: `https://${teamDomain}`,
        audience,
      });
      email = typeof payload.email === 'string' ? payload.email : null;
    } catch {
      // トークンの中身は出さない
      return errorPage(
        c,
        403,
        'ログインが必要です',
        'ログインの有効期限が切れた可能性があります。もう一度ログインしてください。'
      );
    }
  }

  if (email === null || email === '') {
    return errorPage(c, 403, 'ログインが必要です', 'Cloudflare Access のログインを経由してアクセスしてください。');
  }

  const staffRow = await findStaffByEmail(env.DB, email);
  if (staffRow === null || staffRow.is_active !== 1) {
    return errorPage(
      c,
      403,
      'このアカウントは利用できません',
      'スタッフとして登録されていません。管理者に登録を依頼してください。'
    );
  }

  c.set('staff', {
    id: staffRow.id,
    name: staffRow.name,
    email: staffRow.email,
    isAdmin: adminEmails(env.ADMIN_EMAILS).includes(staffRow.email.toLowerCase()),
  });

  await next();
});
