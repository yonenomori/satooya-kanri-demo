# 本番デプロイ手順

初回だけ手作業で行う。2 回目以降は main へのマージで GitHub Actions（`.github/workflows/deploy.yml`）が反映する。
`docs/maintenance.md` と矛盾しないように保つこと。

## 0. 前提

- 先方（クライアント）の Cloudflare アカウントを使う。自分のアカウントに作らない
- Cloudflare Access を有効にするには **Zero Trust** のセットアップ（チーム名の決定）が必要
- ドメインは `workers.dev` でもよいが、Access を使うなら独自ドメインを推奨

## 1. D1 データベースを作る

```bash
npx wrangler d1 create satooya-db --location apac
```

表示された `database_id` を `wrangler.jsonc` の `d1_databases[0].database_id` に貼り付ける（プレースホルダーを置き換える）。

```bash
npx wrangler d1 migrations apply satooya-db --remote
```

## 2. wrangler.jsonc の vars を本番用にする

```jsonc
"vars": {
  "ENVIRONMENT": "production",
  "ACCESS_TEAM_DOMAIN": "xxxxxxxx.cloudflareaccess.com",   // Zero Trust のチーム名
  "ACCESS_AUD": "（Access アプリの AUD タグ）",
  "ADMIN_EMAILS": "管理者1@example.com,管理者2@example.com"
}
```

- `ENVIRONMENT` は必ず `production`。`development` のままだとローカルの簡易ログインが有効になる
- `DEV_USER_EMAIL` は本番に設定しない（設定されているとアプリが 500 を返して止まる）

## 3. スタッフを登録する（管理画面は作っていない）

Access でログインするスタッフのメールアドレスを `staff` に入れる。

```bash
npx wrangler d1 execute satooya-db --remote --command \
  "INSERT INTO staff (name, email) VALUES ('山田', 'staff@example.com')"
```

退職などで使えなくするときは `is_active` を 0 にする（物理削除しない）。

```bash
npx wrangler d1 execute satooya-db --remote --command \
  "UPDATE staff SET is_active = 0 WHERE email = 'staff@example.com'"
```

## 4. Cloudflare Access を設定する

1. Zero Trust → Access → Applications → Add an application → Self-hosted
2. アプリケーションのドメインに Worker の URL を指定
3. Policy を作る: Action = Allow、Include = **Emails** にスタッフのメールアドレスを列挙
   - 全社許可にするなら「Emails ending in @example.com」でもよいが、スタッフ 5 名規模なら列挙が安全
4. Session duration は 1 週間程度（現場で毎日ログインし直さないため）
5. アプリの **AUD Tag** を控えて `wrangler.jsonc` の `ACCESS_AUD` に入れる

Access を通すとリクエストに `Cf-Access-Jwt-Assertion` ヘッダーが付く。アプリはこの JWT を
`https://{ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs` の公開鍵で検証し、`aud` の一致と `email` を見る。

## 5. GitHub Actions の設定（リポジトリ作成後に一度だけ）

`docs/maintenance.md` の「初回のGitHub設定」を参照。要点だけ:

1. Settings → Secrets and variables → Actions
   - `CLOUDFLARE_API_TOKEN` … Workers Scripts:Edit と D1:Edit のみの権限で発行
   - `CLOUDFLARE_ACCOUNT_ID` … 先方のアカウント ID
   - Variables タブに `DEPLOY_ENABLED` = `true`（これが無いと deploy.yml はスキップされる）
2. Settings → Environments で `production` を作り、Required reviewers に自分を入れる
3. Settings → Branches で main を保護（PR 必須、CI の `test` を必須チェックに）

## 6. 初回デプロイ

初回だけは GitHub Actions のシークレットが揃う前なので、手元から実行してよい。

```bash
npm run deploy
```

2 回目以降は main にマージすると `deploy.yml` がテスト → `d1 migrations apply --remote` → `deploy` を実行する。
手元からの `wrangler deploy` は使わない（設定がずれる原因になる）。

## 7. 動作確認

1. スマホで Worker の URL を開く → Access のログイン（メールのワンタイムコード）になる
2. スタッフのメールでログイン → 検索画面が出る
3. 新規登録でダミーの電話番号を登録 → 保存できる
4. NG 理由を追加 → 一覧に NG が出る → 同じ電話番号で新規登録 → 警告が出る
5. 管理メニュー（`ADMIN_EMAILS` に入れたアカウント）から CSV をダウンロード

## 8. バックアップ

- 毎月、管理メニューから CSV（contacts / ng_records / notes）を取得して保存する
- D1 の Time Travel でも過去の時点に戻せる（既定で 30 日）

```bash
# 復元ポイントの一覧
npx wrangler d1 time-travel info satooya-db --remote

# 指定した時点に戻す（例）
npx wrangler d1 time-travel restore satooya-db --remote --timestamp 2026-10-01T00:00:00Z
```

## 注意

- Access の Policy を消すと誰でも開ける状態になる。設定変更は必ず動作確認とセットで行う
- `ADMIN_EMAILS` を空にすると CSV エクスポートが誰も使えなくなる（閲覧は全スタッフ可能）
