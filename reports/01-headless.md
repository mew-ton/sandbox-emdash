# 項目 1. 分離リポジトリでの headless 運用

対象: emdash 1.3.1 / `cms/`（公開ページを削除し、admin と REST API だけを提供）。
検証: `verify/item1-headless.mjs`（ローカルの `cms/dist`。機械出力は [`generated/01-headless.md`](generated/01-headless.md)）。

## 結論

ビルド時の読み取り（1-2〜1-5）とスキーマのコード管理（1-6）は成立した。
不合格は 2 点:

- **1-7**: `emdash site export` はユーザーを含まない（設計上の仕様）。コンテンツとメディアは欠けずに戻る。ユーザーまで戻すには SQLite ファイルのバックアップから復元する必要がある
- **1-8**: `cms-client` が使う読み取り API は OpenAPI 文書に載っているが、運用で使う 3 ルート（API トークン発行、招待、メディアファイル配信）は載っていない

要件の「1-2 / 1-6 / 1-7 のいずれかが不合格なら headless 運用は不可」に該当する（1-7）。
ただし 1-7 の不合格は headless 構成に固有ではなく、構成案 B（統合）でも同じ `site export` を使う限り同じ結果になる。
扱いは [`00-summary.md`](00-summary.md) の意思決定事項に挙げた。

## 結果

| # | 結果 | 要点 |
|---|---|---|
| 1-1 | 合格 | 未使用の公開ルートは 404。残る公開ルートは空の sitemap、`/_emdash/` を Disallow する robots.txt、匿名の検索 API（公開済みのみ）、メディアファイル。admin は画面表示と記事作成まで確認 |
| 1-2 | 合格（手順付き） | 運営が自分で発行したトークンは運営の Admin ロールで評価され、下書きが返る（不合格）。Subscriber のサービスアカウントが持つトークンなら下書き・予約・ゴミ箱・未公開の編集は一切返らず、書き込みは 403 |
| 1-3 | 合格 | `page` / `limit` / `total` から `PaginatedResponse` を組み立てられる。`orderBy` / `order` はページをまたいで保たれる |
| 1-4 | 合格 | メディア一覧の `url` からビルド時にダウンロードできる。site/ は Astro の画像処理で dist/ にコピーし、CMS ホストへ直リンクしない |
| 1-5 | 合格 | 公開・非公開化・ゴミ箱移動のたびに 1 回だけ dispatch。作成・未公開の編集・ゴミ箱を空にする操作では起動しない。トークンは env から渡す |
| 1-6 | 合格 | `seed/seed.json` をリポジトリに置き、CLI のスキーマ変更 → `export-seed` の差分 → 空の DB へ `emdash seed` で同じスキーマが再現された |
| 1-7 | **不合格** | 管理者のみ実行可、コンテンツ（全ステータス・ゴミ箱）とメディア（バイト一致）は戻る。**ユーザーは戻らない**。SQLite のオンラインバックアップ + `uploads/` ならユーザー・passkey・トークンまで戻る |
| 1-8 | **一部不合格** | 読み取り経路は掲載済み。API トークン発行・招待・メディアファイル配信のルートは未掲載。設定更新は文書が `PUT`、実装が `POST` で食い違う |

## 詳細

### 1-1 公開ページの除去

`cms/src/pages` を削除した。EmDash が注入するルートのうち、認証なしで応答するもの:

| ルート | 応答 |
|---|---|
| `/sitemap.xml` | 空の sitemap index |
| `/robots.txt` | `/_emdash/` を Disallow |
| `/_emdash/api/search` | 公開済みコンテンツの全文検索（検証では下書きはヒットしない） |
| `/_emdash/api/comments/...` | コレクションでコメントが有効な場合の投稿・取得（今回のスキーマでは無効） |
| `/_emdash/api/media/file/{key}` | メディアファイル本体（下書きでしか使っていない画像も含む。キーは推測困難な ULID） |
| `/.well-known/oauth-*`、`/_emdash/oauth/authorize` | MCP 用 OAuth の発見・認可エンドポイント（注入をルート定義で確認。応答内容は未検証） |

admin は `/_emdash/admin` 配下の各画面の表示と、エディタからの記事作成・保存を Playwright で確認した。
`fonts: false` で管理画面の Google Fonts 取得を止めている（ビルド時の外部取得もなくなる）。

### 1-2 読み取り専用トークン

EmDash の API トークンは、運営（Admin）が自分自身のためにしか発行できない。トークンは発行者の**現在の**ロールで評価され、
`content:read` スコープだけでもロールが Admin なら下書きの閲覧権限（`content:read_drafts`）を持つ。

成立した手順:

1. `EMDASH_ALLOW_INVITES=on` で起動し、ビルド専用ユーザー（例: `site-build@example.com`）を **Admin** として招待する
2. 招待を受諾して passkey を作り、そのユーザーで `content:read` + `media:read` のトークンを発行する
3. 運営がそのユーザーを **Subscriber** に降格し、`EMDASH_ALLOW_INVITES` を戻す

Subscriber のトークンでは、`status` パラメータに何を指定しても公開済みに固定され、下書き・予約・ゴミ箱の単体取得は 404、
公開済み記事に未公開の編集がある場合も公開版が返る。書き込み系（作成・更新・公開・削除・メディア・スキーマ）はすべて 403。
サービスユーザーに残る passkey は、項目 2 のガードが Admin 以外の passkey ログインを拒否するので使えない。

### 1-3 ページネーション・ソート

一覧 API は `items` と `total` を返す。`totalPages` は `ceil(total / limit)` でクライアントが計算する。`limit` の上限は 100。

### 1-4 メディア

メディアの参照（画像フィールド）は `{ id, alt, ... }` で、URL は含まない。URL はメディア一覧（`GET /_emdash/api/media`）の `url` から取る。
単体取得（`GET /_emdash/api/media/{id}`）の応答には `url` が無い。

### 1-5 ビルド起動フック

ネイティブプラグイン `cms/src/plugins/build-trigger.ts`。注意点:

- プラグインが `capabilities: ["content:read"]` を宣言しないと、`content:*` フックは**ログ 1 行を出して黙って無効**になる
- フックは応答を返した後に実行される
- dispatch の失敗時に再試行はしない（失敗はログのみ）

### 1-6 スキーマのコード管理

- 初期スキーマは `cms/seed/seed.json`。空の DB での初回起動時に適用される（seed はビルドに埋め込まれる）
- 変更は CLI（`emdash schema add-field` など）か admin で行い、`emdash export-seed` で seed ファイルに書き戻して差分をコミットする
- `export-seed` は DB ファイルを直接読むので、VPS 上（DB と同じ場所）で実行する
- CLI の `add-field` は `select` 型を作れない（admin か seed ファイルの直接編集で行う）

### 1-7 エクスポートとインポート

`emdash site export` / `site import` は `admin` スコープのトークン（Admin のみ発行可）で動く。Editor のセッション、読み取りトークンでは 403。

戻るもの: コレクション定義、全ステータスのコンテンツ、ゴミ箱、リビジョン、設定、メディア（バイト一致）。
戻らないもの: ユーザー、passkey、API トークン、セッション。インポート時は著者が移行先の既存ユーザーへ email で対応付けられる（`principals`）。

別経路として、`node:sqlite` の `backup()`（稼働中に取れるオンラインバックアップ）と `uploads/` のコピーから新しいインスタンスを起動すると、
ユーザー・passkey・トークンを含めてすべて戻った（元インスタンスで発行したトークンがそのまま通る）。

### 1-8 公式サポート範囲

`cms-client` が依存する API:

| メソッド | パス | OpenAPI |
|---|---|---|
| GET | `/_emdash/api/content/{collection}` | 掲載 |
| GET | `/_emdash/api/content/{collection}/{id}` | 掲載 |
| GET | `/_emdash/api/media`（`url` フィールド） | 掲載 |
| GET | メディアファイル本体（上の `url` が指す `/_emdash/api/media/file/{key}`） | URL は文書化された値として受け取るが、ルート自体は未掲載 |

運用で依存する API:

| メソッド | パス | OpenAPI | 用途 |
|---|---|---|---|
| POST | `/_emdash/api/admin/api-tokens` | 未掲載 | 読み取りトークンの発行（admin 画面からも可） |
| POST | `/_emdash/api/auth/invite` | 未掲載 | サービスユーザー・運営の招待（admin 画面からも可） |
| PUT | `/_emdash/api/admin/users/{id}` | 掲載 | サービスユーザーの降格 |
| POST | `/_emdash/api/admin/transfer/exports` ほか | 掲載 | サイトエクスポート（CLI 経由） |

ほかに観察した事実:

- `/_emdash/api/openapi.json` は認証が必要で、トークンの場合 `admin` スコープが要る（スコープ規則に無いパスは admin 扱い）
- 設定更新は文書が `PUT /_emdash/api/settings`、実装は `POST`（`PUT` は 404）
- 掲載パス数は 103

## 未使用になる EmDash の機能

公開ページを別リポジトリでビルドするため、次は使わない: ページの route cache とオブジェクトキャッシュ、visual editor（インライン編集）、
プレビュー（署名付き下書きプレビュー）、SEO パネルの出力（`EmDashHead` 等のコンポーネント）、sitemap / robots の自動生成、
コメント・検索・ウィジェット・メニューの描画コンポーネント、live collection（`getEmDashCollection()`）、画像最適化エンドポイント、
ページ断片を出すプラグイン機能。管理画面でこれらの設定項目は表示されるが、公開サイトには反映されない。
