# 里親・ブリーダー管理システム

犬猫の里親募集を行う企業向けの、スタッフ用スマホWebアプリ。
里親顧客とブリーダーを一元管理し、NG（ブラックリスト）の本人・同じ世帯の人を登録時に警告する。

## 最初に読むもの

1. `docs/requirements.md` … 何を作るか（範囲・やらないこと）
2. `docs/design.md` … どう作るか（構成・画面・API・照合ロジック・正規化ルール）
3. `migrations/` … テーブル定義（0001 が基本、0002 がサブスク。変更する場合は新しいマイグレーションを追加）
4. `docs/maintenance.md` … 依存パッケージの保守とデプロイの流れ（`.github/` 配下の設定と対応）

迷ったら requirements.md の「今回やらないこと」を確認し、範囲外の機能は作らない。

## 技術構成

- Cloudflare Workers + Hono（TypeScript）
- D1（SQLite）
- 画面は Hono JSX によるサーバーサイドレンダリング。フロントのフレームワークは使わない
- 認証は Cloudflare Access（メールのワンタイムコード）。アプリ側は JWT を検証してスタッフを特定する
- テストは Vitest + @cloudflare/vitest-pool-workers

## 作る順番

各ステップの終わりにテストを通し、動作確認してから次へ進む。

1. プロジェクト作成（Hono の Cloudflare Workers テンプレート）、wrangler 設定、D1 作成、ローカルにマイグレーション適用。package.json に `test`（vitest run）と `typecheck`（tsc --noEmit）スクリプトを用意し、`.github/workflows/ci.yml` がそのまま動く状態にする。package-lock.json は必ずコミットする
2. `src/lib/normalize.ts`（電話・住所・市区町村の正規化）とユニットテスト。design.md のテストケースをすべて通す
3. `src/lib/matching.ts`（照合）とテスト
4. 認証ミドルウェア（本番は Access JWT 検証、ローカルは DEV_USER_EMAIL で代替）
5. 検索画面（トップ）
6. 新規登録（照合 → 警告 → 確認して保存）
7. 詳細画面、やり取りメモの追加、NG理由の追加・解除
8. 編集画面
9. CSVエクスポート（管理者のみ）
10. 本番デプロイ手順を `docs/deploy.md` にまとめる（Access の設定、GitHub の初回設定はユーザーが手で行う。maintenance.md と矛盾しないこと）

## 守ること

- SQL は必ずバインドパラメータを使う。文字列連結で組み立てない
- 個人情報（氏名・電話・住所・NG理由）を console.log やエラーメッセージに出さない
- POST はすべて Origin ヘッダーを検証する（自ドメイン以外は 403）
- 削除は論理削除（deleted_at）。物理削除はしない
- NG理由は解除しても消さない（revoked_at を入れる）
- 登録・更新・NG操作には必ずログイン中のスタッフIDを記録する
- 外部CDN・外部フォント・アクセス解析は使わない
- 依存パッケージは必要最小限にする。追加するときは理由を PR に書く
- 本番へのデプロイは GitHub Actions 経由のみ。手元から `wrangler deploy` で本番に出さない（初回セットアップを除く）
- 画面の文言は日本語。スマホ（幅390px前後）で操作しやすいことを最優先にする

## コマンド（プロジェクト作成後に実際の内容へ更新すること）

- 開発: `npm run dev`
- テスト: `npm test`
- 型チェック: `npm run typecheck`
- ダミーデータ投入（ローカル）: `npm run db:seed:local`
- マイグレーション（ローカル）: `npx wrangler d1 migrations apply satooya-db --local`
- デプロイ: `npm run deploy`
