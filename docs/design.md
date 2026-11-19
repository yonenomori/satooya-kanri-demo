# 設計

## 1. 全体構成

```
スマホのブラウザ
   │  https
   ▼
Cloudflare Access（メールのワンタイムコードでログイン。許可したメールのみ通す）
   │  Cf-Access-Jwt-Assertion ヘッダー付きでリクエストが届く
   ▼
Cloudflare Workers（Hono）
   ├─ 認証ミドルウェア: JWT検証 → メールから staff を特定
   ├─ 画面: Hono JSX でHTMLを返す（フォーム送信ベース、JSは最小限）
   └─ D1（SQLite）
```

- フロントのビルド工程は持たない。CSSは1ファイルを Workers の静的アセットとして配信
- JavaScript は必要な箇所だけ素のJSで（例: 送信ボタンの二重押し防止）。なくても全機能が動くこと

## 2. ディレクトリ構成

```
CLAUDE.md
docs/
  requirements.md
  design.md
  deploy.md            … ステップ10で作成
migrations/
  0001_init.sql
seed/
  dev.sql              … ローカル用ダミーデータ（本番に入れない）
public/
  style.css
src/
  index.tsx            … Hono アプリ本体、ルーティング
  env.ts               … Bindings / Variables の型
  middleware/
    auth.ts
    origin.ts          … POST の Origin 検証
  lib/
    normalize.ts
    matching.ts
    labels.ts          … status・category・channel の日本語ラベル
    csv.ts
  db/
    contacts.ts        … contacts / ng_records / notes へのクエリ
  views/
    Layout.tsx
    SearchPage.tsx
    ContactForm.tsx    … 新規・編集で共用
    MatchAlert.tsx
    DetailPage.tsx
    ErrorPage.tsx
test/
  normalize.test.ts
  matching.test.ts
wrangler.jsonc
```

## 3. 設定（wrangler.jsonc の要点）

```jsonc
{
  "name": "satooya-kanri",
  "main": "src/index.tsx",
  "compatibility_date": "（作成時点の日付）",
  "assets": { "directory": "public" },
  "d1_databases": [
    { "binding": "DB", "database_name": "satooya-db", "database_id": "（作成後に記入）" }
  ],
  "vars": {
    "ENVIRONMENT": "production",
    "ACCESS_TEAM_DOMAIN": "（例: xxxx.cloudflareaccess.com）",
    "ACCESS_AUD": "（Access アプリの AUD タグ）",
    "ADMIN_EMAILS": "（カンマ区切り）"
  }
}
```

- D1 は作成時に `--location apac` を指定する
- ローカル開発では `.dev.vars` に `ENVIRONMENT=development` と `DEV_USER_EMAIL=...` を置く

## 4. 認証

1. `ENVIRONMENT=development` のときだけ、`DEV_USER_EMAIL` をログインユーザーとみなす（本番では絶対に使わない。production で DEV_USER_EMAIL が設定されていたら起動時に 500 を返す）
2. 本番は `Cf-Access-Jwt-Assertion` ヘッダーの JWT を、`https://{ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs` の公開鍵で検証する。`aud` が `ACCESS_AUD` と一致すること。検証には jose などのライブラリを使ってよい
3. JWT の `email` で `staff` を検索。見つからない、または `is_active = 0` なら 403（「管理者に登録を依頼してください」）
4. `c.set('staff', { id, name, email, isAdmin })` で後続に渡す。`isAdmin` は `ADMIN_EMAILS` に含まれるかで判定

スタッフの追加は当面 SQL で行う（管理画面は作らない）。手順を deploy.md に書く。

## 5. ルーティング

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET | `/` | 検索（トップ）。`?q=` `&kind=all/adopter/breeder` |
| GET | `/contacts/new` | 新規登録フォーム。`?kind=` で初期選択 |
| POST | `/contacts` | 登録。照合で一致があり `confirmed=1` でなければ、警告付きでフォームを再表示 |
| GET | `/contacts/:id` | 詳細 |
| GET | `/contacts/:id/edit` | 編集フォーム |
| POST | `/contacts/:id` | 更新（更新時も照合して警告を出す。新規と同じ流れ） |
| POST | `/contacts/:id/delete` | 論理削除（確認画面を挟む） |
| POST | `/contacts/:id/notes` | やり取りメモ追加 |
| POST | `/contacts/:id/ng` | NG理由追加 |
| POST | `/ng/:ngId/revoke` | NG解除（解除理由必須） |
| GET | `/admin` | 管理者メニュー（エクスポートのリンクのみ） |
| GET | `/admin/export/:table.csv` | contacts / ng_records / notes をCSVで出力（管理者のみ） |

POST 成功後はリダイレクト（PRG パターン）。フォームの検証エラーは同じ画面に入力値を保ったまま表示。

## 6. 画面

画面イメージ（別紙）に合わせる。共通ルール:

- 幅390px前後で最適化、PCでは中央に最大幅560pxで表示
- タップ領域は高さ44px以上、入力欄の文字は16px（iOSのズーム防止）
- 色: アクセント `#1E5F52`、NG `#B42318`（背景 `#FDECEA`）、要確認 `#B54708`（背景 `#FFF7E6`）、地 `#F5F5F2`、文字 `#1C1F22`
- 色だけで区別しない。必ず「NG」「要確認」の文字ラベルを添える
- フォントはシステムフォント（`-apple-system, "Hiragino Sans", "Yu Gothic", sans-serif`）

### 検索（トップ）
- 上部に検索欄と「すべて / 里親 / ブリーダー」の切り替え、下部に固定の「新規登録」ボタン
- 検索語なしのときは最近更新した20件を表示
- 各行: 種別、名前、電話、住所、バッジ（NG / 要確認 / ステータス）
- NG の行は有効なNG理由の最新1件を「区分：詳細の冒頭」で1行表示
- 要確認の行は「NG登録と住所が一致」など一致理由を表示

### 新規登録・編集
- 里親 / ブリーダーの切り替え
- 里親: 姓（必須）、名、電話、住所、LINE名、ステータス、メモ
- ブリーダー: 名称（必須）、電話、住所、LINE名、ステータス、メモ
- 保存時に照合し、一致があれば一覧を表示して「確認して保存」「戻って修正」を出す
- 新規登録では「最初のやり取りメモ」も同時に入力できる（任意）

### 詳細
- 基本情報、有効なNG理由（新しい順）、解除済みNG（折りたたみ）、同じ世帯の可能性がある人、やり取りメモ（新しい順）
- 「メモを追加」「NG理由を追加」「編集」
- NG理由の入力欄には「事実のみを記載してください」と表示

## 7. 正規化（src/lib/normalize.ts）

共通の前処理: `String.prototype.normalize('NFKC')` → 前後の空白除去。

### 電話番号 `normalizePhone(input): string | null`
1. NFKC
2. 先頭の `+81` を `0` に置換（`+81 90...` → `090...`）
3. 数字以外を除去
4. 空なら null

| 入力 | 出力 |
| --- | --- |
| `090-1234-5678` | `09012345678` |
| `０９０（１２３４）５６７８` | `09012345678` |
| `+81 90-1234-5678` | `09012345678` |
| `045 123 4567` | `0451234567` |
| `` | `null` |

### 住所 `normalizeAddress(input): string | null`
照合用。都道府県は除き、番地（最大3区切り）までを残す。建物名・部屋番号は落とす。

1. NFKC、空白をすべて除去
2. 先頭の都道府県（`北海道` / `東京都` / `京都府` / `大阪府` / `〇〇県`）を除去
3. ハイフン類（`－ ‐ ― − ー ｰ` など、数字に挟まれたもの）を `-` に統一
4. `丁目` `番地の` `番地` `番` `号` の直前の漢数字（一〜九十九）を算用数字に変換
5. `丁目` `番地の` `番地` `番` を `-` に、`号` を除去。`の` が数字に挟まれていれば `-`
6. `ヶ` `ケ` `ｹ` を `ケ` に統一
7. 「数字(-数字){0,2}」の最初の出現までを残し、それ以降（建物名・部屋番号）を捨てる
8. 末尾の `-` を除去。空なら null

| 入力 | 出力 |
| --- | --- |
| `神奈川県横浜市港北区日吉一丁目2番3号 日吉ハイツ101` | `横浜市港北区日吉1-2-3` |
| `横浜市港北区日吉1-2-3 日吉ハイツ101号室` | `横浜市港北区日吉1-2-3` |
| `神奈川県横浜市港北区日吉１－２－３` | `横浜市港北区日吉1-2-3` |
| `横浜市港北区日吉1丁目2-3` | `横浜市港北区日吉1-2-3` |
| `東京都千代田区霞ヶ関2-1-1` | `千代田区霞ケ関2-1-1` |
| `長野県〇〇郡〇〇村大字〇〇123番地の4` | `〇〇郡〇〇村大字〇〇123-4` |
| `横浜市港北区日吉` | `横浜市港北区日吉` |

既知の限界（許容する）: 「1-2-3-101」のように部屋番号がハイフンで続く場合は `1-2-3` で切れる。地名に数字が含まれる住所は誤判定しうる。照合結果は「要確認」として人が判断する前提。

### 市区町村 `extractCity(normalizedAddress): string | null`
正規化済み住所の先頭から次の順で最初に当たったものを返す。
1. `〇〇市〇〇区`（政令市の区）
2. `〇〇郡〇〇町` / `〇〇郡〇〇村`
3. `〇〇市` / `〇〇区`（東京23区） / `〇〇町` / `〇〇村`

| 入力 | 出力 |
| --- | --- |
| `横浜市港北区日吉1-2-3` | `横浜市港北区` |
| `千代田区霞ケ関2-1-1` | `千代田区` |
| `〇〇郡〇〇村大字〇〇123-4` | `〇〇郡〇〇村` |
| `藤沢市鵠沼1-1` | `藤沢市` |

既知の限界: `四日市市` `市川市` のように市名に「市」を含む場合は誤る。苗字照合の補助にしか使わないため許容。

### 保存時
contacts の登録・更新時に必ず `phone_normalized` `address_normalized` `city` を再計算して保存する。手入力させない。

## 8. 照合（src/lib/matching.ts）

```ts
type MatchLevel = 'ng' | 'check' | 'duplicate';
type MatchReason = 'phone' | 'address' | 'family_city';
type Match = {
  level: MatchLevel;
  reason: MatchReason;
  contact: { id: number; kind: string; name: string; phone: string | null; address: string | null };
  latestNg?: { category: string; detail: string; createdAt: string };
};
findMatches(db, input: { id?: number; kind; familyName?; phoneNormalized?; addressNormalized?; city? }): Promise<Match[]>
```

| 条件 | 相手 | level |
| --- | --- | --- |
| 電話一致 | 有効なNGがある | `ng` |
| 住所一致 | 有効なNGがある | `check` |
| 苗字＋市区町村一致（里親同士のみ） | 有効なNGがある | `check` |
| 電話一致 | NGなし | `duplicate`（「既に登録があります」） |

- 自分自身（編集時の `id`）は除外、論理削除済みは除外
- 里親とブリーダーをまたいで照合する（苗字照合のみ里親同士）
- 同じ相手が複数条件に当たったら、強い方（ng > check > duplicate）1件にまとめる
- 並び順: ng → check → duplicate

## 9. 検索（src/db/contacts.ts）

- 検索語を NFKC。数字・ハイフン・括弧・空白だけで4桁以上なら電話検索（`phone_normalized LIKE '%' || ? || '%'`）
- それ以外は `name LIKE ? OR line_name LIKE ? OR address_normalized LIKE ?`（住所側は検索語も normalizeAddress 相当の簡易正規化をかける）
- LIKE のワイルドカード（`%` `_`）はエスケープする
- 各行に `is_ng`（有効なNGあり）と `check_reason`（自分はNGではないが、NGの相手と電話・住所・苗字＋市区町村のどれかが一致）を付ける
- 並び順: NG → 要確認 → 更新日時の新しい順。最大50件

## 10. CSVエクスポート

- 管理者のみ。UTF-8 BOM付き（Excelで文字化けしないため）、カンマ・改行・ダブルクォートを正しくエスケープ
- ファイル名に日付を入れる（`contacts_2026-10-12.csv`）
- バックアップ用途。あわせて D1 の Time Travel（過去の時点への復元）も deploy.md に手順を書く

## 11. ラベル（src/lib/labels.ts）

| 値 | 表示 |
| --- | --- |
| adopter / breeder | 里親 / ブリーダー |
| inquiry / screening / contracted / closed | 問い合わせ中 / 審査中 / 成約 / 終了 |
| active / suspended | 取引中 / 取引停止 |
| false_statement / bad_environment / past_trouble | 虚偽申告 / 飼育環境が不適切 / 過去のトラブル |
| no_health_check / missing_documents / condition_mismatch | 健康診断の未実施 / 書類不備 / 説明と異なる状態での引き渡し |
| other | その他 |
| line / instagram / phone / visit / other | LINE / Instagram / 電話 / 来店 / その他 |
