# 保守（依存パッケージとデプロイ）

## 仕組み

| 段階 | 担当 | 内容 |
| --- | --- | --- |
| 検知 | Dependabot alerts | 直接・間接の依存に既知の脆弱性があれば通知 |
| 更新PR | Dependabot security updates / dependabot.yml | 修正版へのPRを自動作成。通常更新は毎週月曜 |
| テスト | ci.yml | 型チェック、テスト、npm audit（high以上で失敗） |
| レビュー | 人 | 下の「マージの判断基準」に沿って確認 |
| 本番反映 | deploy.yml | main へのマージで、テスト → マイグレーション → デプロイ |

## 初回のGitHub設定（リポジトリ作成後に一度だけ）

1. Settings → Code security で次を有効にする
   - Dependency graph
   - Dependabot alerts
   - Dependabot security updates
   - Grouped security updates
2. Settings → Branches で main のブランチ保護ルールを作る
   - Require a pull request before merging
   - Require status checks to pass（CI の test を必須にする）
3. Settings → Environments で `production` を作り、Required reviewers に自分を入れる（本番反映前に承認を挟む）
4. Settings → Secrets and variables → Actions に登録
   - `CLOUDFLARE_API_TOKEN`：先方アカウントで発行。権限は Workers Scripts:Edit と D1:Edit のみ
   - `CLOUDFLARE_ACCOUNT_ID`：先方のアカウントID
5. 通知: Watch を「Custom → Security alerts」以上にしておく

## マージの判断基準

- **パッチ・マイナー更新（まとめPR）**：CI が通っていればマージ可
- **メジャー更新**：リリースノートの破壊的変更を読み、必要ならコードを直してからマージ
- **セキュリティ更新**：最優先。CI が通れば当日中にマージ
- CI が落ちたPRは放置しない。直せないときは Issue を立てて理由を残す

## 定期作業（月1回）

- 開いたままの Dependabot PR とアラートを確認し、ゼロにする
- 間接依存で修正版がまだないアラートは、`npm ls <パッケージ名>` でどこから入っているかを調べ、影響の有無をメモに残す
- 本番の動作確認（検索・登録・NG警告が出るか）
- CSV エクスポートでバックアップを取得
