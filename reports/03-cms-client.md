# 項目 3. `cms-client` を EmDash の上に載せ替えられるか

対象: `cms-client/`（3b: REST ラッパー）、`experiments/3a-live-collection/`（3a: `getEmDashCollection()` ラッパー）、`site/`。
検証: `verify/item3-cms-client.mjs`（機械出力は [`generated/03-cms-client.md`](generated/03-cms-client.md)）。

## 結論

**3b（REST ラッパー）が合格**。§0-4 のシグネチャと Domain 型を変えずに内部だけ差し替えられ、`site/` は tarball の `cms-client` だけを依存に持ってビルドできた。
3a は静的ページの生成自体はできたが、公開サイトが実質 EmDash アプリになり（統合・アダプタ・DB とメディアへのアクセスが必要）、
さらに記事 ID の意味が変わる・画像が解決されない・総件数が取れないため、同じ `site/` のコードでは同じ結果にならない。

## 3a と 3b の比較

| | 3a: `getEmDashCollection()` ラッパー | 3b: REST ラッパー |
|---|---|---|
| site/ の依存 | `astro`, `cms-client`, **`emdash`, `@astrojs/react`, `react`, `react-dom`, `@astrojs/node`** | `astro`, `cms-client` |
| site/ の設定 | `emdash()` 統合、`react()`、**サーバーアダプタ**（EmDash が admin/API ルートを注入するため、静的出力でも無いと `NoAdapterInstalled` で失敗）、`src/live.config.ts` | CMS の origin を画像の取得許可に入れるだけ |
| ビルドに必要なもの | CMS の **SQLite ファイル**と **uploads ディレクトリ** | CMS の読み取り API と読み取りトークン |
| CMS プロセス停止中のビルド | 可（DB ファイルのコピーを読む） | 不可（API が必要） |
| site/ の node_modules（`du -sk`） | 660.8 MB | 197.2 MB |
| ビルド成果物 | `dist/client` 16.8 MB（管理画面のバンドル込み）+ `dist/server` 18.8 MB | `dist/` の静的ファイルのみ |
| 記事 ID | **slug**（`article-02` 等） | エントリ ID（ULID） |
| 画像 | 画像フィールドに URL が無く、ヒーロー画像が出ない。本文中の画像は EmDash のコンポーネントが無いと描画されない | メディア一覧の `url` から解決し、ビルド時に dist/ へコピー |
| 総件数 | 返らない（`hasMore` のみ）。全件を走査して数えた | `total` が返る |
| 境界の純度 | 公開 `.d.ts` は同じにできるが、実行時に `emdash` と DB 接続が必須 | `.d.ts` に EmDash の型・パス・用語なし。site/ に `emdash` が入らない |
| ビルド時の警告 | 静的ページで `Astro.request.headers` を使った旨の警告が多数（EmDash の middleware 由来） | なし |

## 結果

| # | 結果 | 要点 |
|---|---|---|
| 3-1 | 列挙済み | 上表。3a は追加依存 5 つ、統合とアダプタ、DB ファイルとメディアの場所（env 2 つ） |
| 3-2 | 表にした | 下表 |
| 3-3 | 合格 | `fetchArticles` / `fetchArticle` / `fetchCasts` / `fetchCast`。公開記事 12 件と一覧 3 ページを生成、下書きは出ない |
| 3-4 | 合格 | `dist/index.d.ts` に `emdash` / `_emdash` / `/api/` / Portable Text / `Bearer` / `storageKey` 等が現れない。site/ の `node_modules` に `emdash` なし。site/src の import は `cms-client` と `astro:assets` だけ |
| 3-5 | 合格 | 下記の変換を公開 API 経由で確認。レスポンス型は生成物のみ |
| 3-6 | 合格（代役で確認） | PocketBase 版の代役と `.d.ts` が完全一致。同じ site/ のソースで両方ビルドし、全 17 ページの HTML が一致（画像ファイル名のハッシュを除く） |

### 3-2 3a で DB を CMS と共有する方法

| 方式 | CI に渡る secret・データ | 追加コスト | CMS 停止時のビルド |
|---|---|---|---|
| VPS の SQLite を CI へコピー（オンラインバックアップ + `uploads/`） | VPS への SSH 鍵。**DB 全体**（ユーザー、passkey 公開鍵、API トークンのハッシュ、下書き、プラグインの保存データ）とメディア全量 | 金額は増えない。転送量と CI 時間が DB・メディアの大きさに比例 | プロセス停止中は可（検証済み）。VPS 自体に届かなければ不可 |
| libSQL（Turso 等）へ移す | DB の URL と認証トークン（読み取り専用トークンを分けられるかはサービス次第） | 外部サービスの無料枠か有料プラン（§0-5 の「単一サービスの無料枠に依存する箇所を増やさない」に抵触） | 可 |
| マネージド PostgreSQL へ移す | 接続文字列 | 月額が増える（§0-5 に抵触）。512MB VPS で自前運用するのは現実的でない | 可 |
| VPS 上でビルドし成果物だけ送る | CI から VPS への SSH 鍵 | VPS でのビルドが要る（§0-1 とメモリ前提に反する） | 不可 |

どの方式でもメディアは別に共有が必要（ローカルストレージなら `uploads/` のコピー、S3 互換ストレージなら別サービス）。

### 3-5 Raw → Domain 変換

| 変換 | 実装 | 確認したこと |
|---|---|---|
| Portable Text → `bodyHtml` | `@portabletext/to-html`。画像ブロックはメディア一覧の URL で `<img>` にする | 装飾と HTML エスケープ、本文中画像 |
| 画像参照 → `heroImageUrl` 等 | 画像フィールドの `id` をメディア一覧（`url`）で引き、絶対 URL にする。未設定は空文字 | 設定あり・なし、alt |
| select → `themeColor` | 許可値以外は `null` | 設定あり・なし |
| カンマ区切り → `keywords[]` | 分割・trim・空要素除去 | `" alpha, beta ,,gamma "` → `["alpha","beta","gamma"]`、未設定 → `[]` |
| 日時 → ISO 8601 | `Date` を経由して `toISOString()` | ミリ秒付き UTC |
| JSON → `links` | `{label, url}` の形で安全な URL のものだけ残す | `javascript:` と不正要素を除外、配列でない値は `[]` |

型の出どころ（手書きしない）:

- `cms-client/src/generated/openapi.ts` — `schema/openapi.json` から `openapi-typescript` で生成（エンベロープ、`ContentItem`、メディア一覧）
- `cms-client/src/generated/collections.ts` — `emdash types` の出力（コレクションごとのフィールドの形）
- `cms-client/src/raw.ts` で両者を組み合わせる。`emdash types` は live collection 用の形（日時が `Date`、フィールドが平坦）なので、フィールド部分だけを使う

再生成は `pnpm gen`（`scripts/generate-types.mjs`）。OpenAPI 文書の取得に `admin` スコープのトークンが要る。
`emdash` は `cms-client` の devDependency（型生成と型参照のため）で、ビルド済み tarball には含まれない。

### 3-6 移行耐性

現行の PocketBase 版 `cms-client` はこのリポジトリに無い。代わりに §0-4 の契約から PocketBase の REST 形
（`/api/collections/<c>/records`、`/api/files/...`）で実装した代役（`verify/pocketbase-standin/`）を作り、
EmDash から取得したのと同じ内容を PocketBase 形のモックで配信して比べた。

- 公開 `.d.ts` は EmDash 版と完全一致
- `site/` のソースと `package.json` を変えずに（同名の tarball を差し替えるだけで）ビルドでき、出力 HTML は全ページ一致

これは「同じ契約の実装を差し替えても site/ が変わらない」ことの確認で、本番の PocketBase 版パッケージそのものとの比較ではない。
本番パッケージの `.d.ts` と `cms-client/dist/index.d.ts` を突き合わせる作業は残っている。
§0-4 に定義が無い `ColorThemeBase`（6 色の文字列ユニオン）、`FetchOptions`、`Cast` の形はこのサンドボックスで仮に決めたもので、突き合わせの対象に含まれる。

## 判定

3b が合格したので、項目 3 は構成案 A（headless + `cms-client` 維持）を支持する。
