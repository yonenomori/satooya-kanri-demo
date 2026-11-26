# 里親・ブリーダー管理システム（デモ版）

犬猫の里親募集を行う企業のスタッフ向け、スマホで使う顧客管理 Web アプリです。
里親希望者とブリーダーを 1 か所で管理し、**NG（ブラックリスト）の本人だけでなく、同じ世帯の家族からの問い合わせにも気づける**ようにすることを目的にしています。

> **このリポジトリについて**
> 実案件の要件定義・設計をもとに、公開用に作り直した**ポートフォリオ／デモ用リポジトリ**です。
> 収録されているデータはすべて `seed/dev.sql` のダミーデータ（`山田 太郎`、`dev-a@example.com`、`090-0000-1234` など）で、実在の顧客情報・連絡先・アカウント ID は含まれていません。

## 何を解決するか

里親募集の現場では、やり取りが公式 LINE に流れて消え、NG 情報がスタッフの記憶や紙に散らばります。
特に問題になるのが「NG に登録した本人ではなく、その家族・同じ世帯の人からの問い合わせ」です。

このアプリは、問い合わせが来たらまず検索 → 該当がなければ新規登録、という流れをスマホで完結させ、
登録時に入力された電話・住所・苗字を既存の NG と自動で突き合わせて警告します。

| 照合キー | 判定 | 表示 |
| --- | --- | --- |
| 電話番号（数字のみで完全一致） | NG 本人の可能性が高い | NG（赤） |
| 住所（番地まで一致） | 同じ世帯の可能性 | 要確認（オレンジ） |
| 苗字＋市区町村 | 家族の可能性 | 要確認（オレンジ） |

警告は保存を止めません。スタッフが理由を確認したうえで「確認して保存」できます。

## 主な機能

- **検索（トップ）** … 名前・電話・住所で検索。種別（すべて／里親／ブリーダー）で絞り込み。検索語がなければ最近更新した 20 件。NG → 要確認 → 更新日時の順に並ぶ
- **新規登録** … 里親／ブリーダーの切り替え、保存時の自動照合、警告 → 「確認して保存」。最初のやり取りメモも同時入力できる
- **詳細** … 基本情報、有効な NG 理由、解除済み NG（折りたたみ）、同じ世帯の可能性がある人、やり取りメモ
- **編集** … 更新時も照合して警告を出す
- **NG の登録・解除** … 解除理由は必須。解除しても記録は消さず履歴として残す
- **やり取りメモ** … LINE／Instagram／電話／来店／その他 を手入力で記録
- **CSV エクスポート（管理者のみ）** … contacts / ng_records / notes を UTF-8 BOM 付きで出力（バックアップ用途）
- **操作ログ** … 登録・更新・NG 操作にログイン中のスタッフ ID を自動記録
- **ペットフードのサブスク** … 里親ごとに管理番号（`00001` 形式）付きで開始。オン／オフの切り替え、メニューの追加・外す。**終了した番号は二度と使わない**（アプリと DB トリガーの両方で保証）
- **メニュー管理** … ペットフードのメニュー（名前・価格・説明）を追加・編集。削除せず販売停止にできる

## 技術スタック

- **Cloudflare Workers**（サーバーレス。スマホからの低レイテンシ）
- **Hono**（TypeScript の Web フレームワーク）＋ Hono JSX によるサーバーサイドレンダリング
- **Cloudflare D1**（SQLite）
- **Cloudflare Access**（メールのワンタイムコードでログイン。アプリ側は JWT を検証）
- **Vitest**（ユニットテスト）、**TypeScript**（strict）、**wrangler**

フロントエンドのビルド工程はありません。CSS は `public/style.css` の 1 ファイルを Workers の静的アセットとして配信し、
外部 CDN・外部フォント・アクセス解析は使いません。JavaScript が無くても全機能が動作します。

```
スマホのブラウザ
   │ https
   ▼
Cloudflare Access（許可したメールのみ通す）
   │ Cf-Access-Jwt-Assertion ヘッダー
   ▼
Cloudflare Workers（Hono）
   ├─ 認証ミドルウェア（JWT 検証 → staff を特定）
   ├─ 画面（Hono JSX。フォーム送信ベース）
   └─ D1（SQLite）
```

## 設計上の配慮

- SQL はすべてバインドパラメータ。文字列連結でクエリを組み立てない
- POST はすべて `Origin` を検証し、自ドメイン以外は 403
- 個人情報（氏名・電話・住所・NG 理由）をログやエラーメッセージに出さない
- 削除は論理削除（`deleted_at`）。NG 解除も `revoked_at` を入れて履歴を残す
- 登録・更新・NG 操作には必ずスタッフ ID を記録する
- 画面はモバイル最優先（幅 390px 前後）。タップ領域 44px 以上、入力欄の文字は 16px（iOS のズーム防止）
- 色だけで状態を区別せず、必ず「NG」「要確認」の文字ラベルを添える

## ローカルで動かす

必要なもの: Node.js 22 以上

```bash
npm install

# ローカル開発用の設定（DEV_USER_EMAIL がログインユーザーになる）
cp .dev.vars.example .dev.vars

# D1 にスキーマを適用してダミーデータを投入
npm run db:migrate:local
npm run db:seed:local

npm run dev
# → http://localhost:8787
```

`.dev.vars` の `DEV_USER_EMAIL` は `seed/dev.sql` の `dev-a@example.com`（スタッフA）に合わせてあります。
`dev-b@example.com`（スタッフB）に変えると、登録者・更新者の表示が変わります。

### 試せること

1. トップの検索欄に `090-0000-1234` と入力 → NG の「山田 太郎」が出る
2. 「新規登録」で電話番号 `090-0000-1234` を入れて保存 → NG 警告が出る → 「確認して保存」で登録できる
3. 「山田 花子」の詳細を開く → 「同じ世帯の可能性がある人」に山田 太郎が出る
4. 詳細画面で NG 理由を追加 → 解除（解除理由必須）→ 解除済みとして履歴に残る
5. ヘッダーの「サブスク」→ No.00002（オン）を開いて「オフにする」→ メニューを追加 → 終了すると、No.00002 は二度と使われず、次に開始したサブスクは新しい番号になる
6. 「終了」タブの No.00001 はオンに戻せない（再開は新しい番号で）

`ADMIN_EMAILS` に自分のメールを入れると `/admin` から CSV をダウンロードできます。

## テスト

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
```

- `test/normalize.test.ts` … 電話・住所・市区町村の正規化（設計書のケースをすべて収録）
- `test/matching.test.ts` … 照合の判定（NG／要確認／登録済み）、並び順、SQL のバインドパラメータ
- `test/contacts.test.ts` … 保存値の組み立て、検索語の判定、LIKE エスケープ、CSV、日時表示
- `test/subscription.test.ts` … 管理番号・状態遷移のルールと、実際のマイグレーションを当てた SQLite（`node:sqlite`）での開始・オン／オフ・終了・番号が再利用されないこと・トリガー

CI（`.github/workflows/ci.yml`）は PR ごとに `npm ci` → 型チェック → テスト → `npm audit --audit-level=high` を実行します。

## ディレクトリ構成

```
CLAUDE.md            … 実装を進めるときの指示書（作る順番・守ること）
docs/
  requirements.md    … 要件定義（範囲・やらないこと）
  design.md          … 設計（構成・画面・照合ロジック・正規化ルール）
  maintenance.md     … 依存パッケージの保守とデプロイの流れ
  deploy.md          … 本番デプロイ手順
migrations/
  0001_init.sql      … D1 スキーマ
  0002_subscriptions.sql … サブスク・メニュー（終了済みを守るトリガー付き）
seed/
  dev.sql            … ローカル用ダミーデータ（本番には入れない）
public/
  style.css          … 画面のスタイル（1ファイル）
src/
  index.tsx          … Hono アプリ本体、ルーティング
  env.ts             … Bindings / Variables の型
  middleware/
    auth.ts          … 認証（Access JWT 検証 / ローカルは DEV_USER_EMAIL）
    origin.ts        … POST の Origin 検証
  lib/
    normalize.ts     … 電話・住所・市区町村の正規化
    matching.ts      … 照合（ng / check / duplicate）
    labels.ts        … 日本語ラベル
    csv.ts           … CSV 出力
    subscription.ts  … 管理番号の表示・解釈、状態遷移などサブスクのルール
  db/
    contacts.ts      … contacts / ng_records / notes へのクエリ
    subscriptions.ts … menus / subscriptions / subscription_items へのクエリ
  views/
    Layout.tsx / SearchPage.tsx / ContactForm.tsx / MatchAlert.tsx / DetailPage.tsx / ErrorPage.tsx
    SubscriptionViews.tsx … サブスク一覧・詳細・メニュー管理
test/
  normalize.test.ts / matching.test.ts / contacts.test.ts
wrangler.jsonc
```

## データベース

`migrations/` がスキーマの正です。主なテーブルは次のとおりです。

| テーブル | 役割 |
| --- | --- |
| `staff` | スタッフ（Cloudflare Access のメールと紐づく） |
| `contacts` | 里親・ブリーダー（`kind` で区別。照合用に `phone_normalized` / `address_normalized` / `city` を保存） |
| `ng_records` | NG 記録（1人に複数。`revoked_at` で解除履歴を残す） |
| `notes` | やり取りメモ |
| `menus` | ペットフードのメニュー（販売中／販売停止） |
| `subscriptions` | サブスク契約。`id` を 5 桁表示したものが管理番号（AUTOINCREMENT で再利用しない） |
| `subscription_items` | サブスクに入っているメニューと数量（外した記録も残す） |

`phone_normalized` / `address_normalized` / `city` は保存時に必ず再計算します（手入力させない）。

## 公開デモ

ポートフォリオ用に Cloudflare Workers へ公開しています（収録データはダミーのみ）。

**https://satooya-kanri-demo.temaoff.workers.dev**

- `ENVIRONMENT=demo` のときは Cloudflare Access を介さず、`dev-a@example.com`（スタッフA）として動作します。URL を開いた人がそのまま検索・登録・NG 警告まで試せます
- そのときは画面上部に「デモ版（ダミーデータ）」の帯を出します。`production` は従来どおり Access の JWT 検証です
- デモ環境の設定は `wrangler.demo.jsonc`（実際のアカウント ID・D1 ID を含むためコミットしない）に置いています

```bash
npx wrangler d1 migrations apply satooya-kanri-demo-db --remote -c wrangler.demo.jsonc   # 0002_subscriptions.sql も適用される
npx wrangler d1 execute satooya-kanri-demo-db --remote --file=seed/dev.sql -c wrangler.demo.jsonc
npx wrangler deploy -c wrangler.demo.jsonc
```

## 本番デプロイ

Cloudflare アカウントと Access の設定が必要です。手順は [docs/deploy.md](docs/deploy.md) を参照してください。
上のデモは「Access なし・ダミーデータ」の構成で、実案件のように Access でスタッフだけを通す場合は docs/deploy.md の手順（`ENVIRONMENT=production`）を使います。

## デモ版での実装メモ

- テストは標準の **Vitest**（Node 環境）で実行しています。DB に依存しない純粋関数と、小さな D1 スタブで照合ロジックを検証する構成です。実案件では `@cloudflare/vitest-pool-workers` で workerd 上の D1 に対してテストする想定です
- `wrangler.jsonc` の `database_id` はプレースホルダー（`00000000-...`）、`vars` はダミー値です
- `deploy.yml` はデモでは本番環境を持たないため手動実行のみ、`ci.yml` は main への push と PR で実行します
