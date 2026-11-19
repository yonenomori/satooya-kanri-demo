/**
 * Workers の Bindings / Variables の型。
 *
 * 本番では Cloudflare Access が発行する JWT を検証してスタッフを特定する。
 * ローカル開発では ENVIRONMENT=development のときだけ DEV_USER_EMAIL を使う。
 * 公開デモ（ENVIRONMENT=demo）では認証をせず、DEMO_USER_EMAIL のスタッフとして動く。
 */
export type Bindings = {
  DB: D1Database;

  /** "development" のときだけローカル用の簡易ログインを使う。"demo" は公開デモ用 */
  ENVIRONMENT?: string;
  /** ローカル開発時のログインメール（本番では設定しない） */
  DEV_USER_EMAIL?: string;
  /** 公開デモ（ENVIRONMENT=demo）でログイン扱いにするメール。未設定なら dev-a@example.com */
  DEMO_USER_EMAIL?: string;

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
  /** 公開デモとして動いているか（画面にデモ表示を出す） */
  demo?: boolean;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    staff: Staff;
  };
};
