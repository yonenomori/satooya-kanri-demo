/**
 * Workers の Bindings / Variables の型。
 *
 * 本番では Cloudflare Access が発行する JWT を検証してスタッフを特定する。
 * ローカル開発では ENVIRONMENT=development のときだけ DEV_USER_EMAIL を使う。
 */
export type Bindings = {
  DB: D1Database;

  /** "development" のときだけローカル用の簡易ログインを使う */
  ENVIRONMENT?: string;
  /** ローカル開発時のログインメール（本番では設定しない） */
  DEV_USER_EMAIL?: string;

  /** 例: xxxx.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN?: string;
  /** Access アプリの AUD タグ */
  ACCESS_AUD?: string;
  /** 管理者のメールアドレス（カンマ区切り） */
  ADMIN_EMAILS?: string;
};

/** ログイン中のスタッフ。画面とDBの操作ログに使う */
export type Staff = {
  id: number;
  name: string;
  email: string;
  isAdmin: boolean;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    staff: Staff;
  };
};
