# EmDash 採用可否の調査要件

コミュニティ CMS の稼働基盤（現行: PocketBase）を EmDash へ置き換えられるかを、サンドボックスリポジトリでコードを書きながら判定するための要件。
各調査項目は「問い / 仮説 / 検証手順 / 合格基準 / 不合格時の扱い」で構成する。全項目の結果をもって採用可否と構成案（後述の A / B）を決める。

---

## 0. 前提：守るべき現行の要件

調査はこの要件を満たせるかを測る。満たせない場合は「要件を緩めるか」を別途意思決定する（サンドボックス側で勝手に緩めない）。

### 0-1. 構成

```
メンバー（Discord サーバー在籍者）
  │ 編集・保存
  ▼
CMS（VPS 上・SQLite + ローカルファイル）
  │ 公開操作を起点に CI のビルドを起動 / ビルド時に read API で取得
  ▼
CI（公開サイトを静的ビルド）
  │ rsync over SSH
  ▼
静的ホスト（公開サイト）──► 閲覧者
```

- 閲覧者は静的ホストだけにアクセスし、CMS には到達しない。CMS の負荷は同時編集者数とビルド時の取得だけで決まる。
- CMS 側と公開サイト側は別リポジトリで、両者は private npm registry 上の境界パッケージ（以下 `cms-client`）でのみ繋がる。
- 公開サイトから見えるのは `cms-client` が export する Domain 型と fetch 関数だけで、CMS 固有の型・URL・認証フローは見えない。CMS を次に乗り換えるとき、公開サイトを書き換えずに済ませるため。

### 0-2. 認証の不変条件

1. Discord サーバー（`<GUILD_ID>`）への在籍が確認できないアクセスはログインさせない。在籍確認は認証フローの中で行い、ユーザーレコードの有無で代替しない。
2. Discord ロール → CMS ロールの対応はログインの都度再評価し、降格・脱退が次回ログインで反映される。
3. Discord 経路の障害に備えた cold-standby のログイン経路を持つ。通常時は dormant で、サーバー側で拒否される（UI の非表示だけに頼らない）。切替は運営の手動操作。
4. cold-standby 用に集める email は、その用途以外に使わない。
5. 運営（管理者）は Discord に依存しない独立したログイン経路を持ち、MFA 相当の保護がある。
6. 権限はサーバー側で強制する。UI の出し分けを唯一の防御にしない。

### 0-3. 権限モデル（現行）

| 主体 | 閲覧 | 作成・編集 | 削除 |
|---|---|---|---|
| 未認証 | 公開コンテンツのみ | ✗ | ✗ |
| 一般メンバー（Discord 一般ロール） | ◯ | 全メンバーのコンテンツを編集可（緩め編集） | ✗ |
| リーダー（Discord リーダーロール） | ◯ | ◯ | ◯ |
| 運営（管理者） | ◯ | ◯ | ◯ + 設定 |

### 0-4. Domain 型の契約（`cms-client` の公開 surface）

`Article` の shape を例とする。CMS を替えても、この shape と fetch 関数のシグネチャは変えない。

```ts
export interface Article {
  id: string
  title: string
  description: string
  keywords: string[]          // カンマ区切りから正規化
  heroImageUrl: string        // 未設定時は空文字
  heroImageAlt: string
  heroImageLabel?: string
  bodyHtml: string            // 本文 HTML
  themeColor: ColorThemeBase | null
  publishedAt: string         // ISO 8601
  updatedAt: string           // ISO 8601
}

export interface ListQuery { page?: number; perPage?: number; sort?: string }
export interface PaginatedResponse<T> {
  items: T[]; page: number; perPage: number; totalItems: number; totalPages: number
}

export function fetchArticles(query?: ListQuery, options?: FetchOptions): Promise<PaginatedResponse<Article>>
export function fetchArticle(id: string, options?: FetchOptions): Promise<Article>
```

検証用の collection は `articles` と `casts`（画像フィールド複数・JSON フィールドあり）の 2 つで足りる。

### 0-5. 運用・コストの制約

- 月額コストを増やさない。CMS 用 VPS は 512MB プランで始める。
- 単一サービスの無料枠や個人アカウントに依存する箇所を増やさない。
- secret・内部 URL をリポジトリに含めない。

---

## 1. サンドボックスの共通要件

### 1-1. ディレクトリ構成

別リポジトリの状態を再現するため、`cms/` と `site/` の間で workspace リンクや相対 import を使わない。`site/` は `cms-client` をビルド済み tarball（`pnpm pack`）経由でのみ取り込む。

```
<sandbox>/
├── cms/            # EmDash アプリ（Astro + Node adapter + SQLite + local storage）
├── cms-client/     # 境界パッケージ（調査項目 3 の実装対象）
├── site/           # 公開サイト相当（静的出力の Astro）
├── providers/      # Discord 認証プロバイダ（調査項目 2 の実装対象）
├── bench/          # メモリ計測スクリプト・docker compose（調査項目 4）
└── reports/        # 各調査項目の結果
```

### 1-2. バージョン固定

- `emdash` は調査開始時点の最新安定版に完全一致で固定し、`reports/` に記録する（`1.3.1` を起点に想定）。
- Node は 24 系を推奨する。22 系を使う場合、Astro 7.3 以前なら 22.16 以上、それより新しい Astro なら 22.23.4 以上が必要。
- サンドボックス用プラグイン（`workerd`）は、項目 4 の比較計測以外では使わない。

### 1-3. secret の扱い

- `.env.example` のみコミットし、`.env` は gitignore する。
- Discord の client secret、`EMDASH_ENCRYPTION_KEY`、API token は実値をコミット・レポートに書かない。
- URL は `example.com` または `<DOMAIN>` のプレースホルダーで記述する。

---

## 2. 調査項目

### 項目 1. 分離リポジトリでの headless 運用

**問い**: EmDash は admin と公開ページが同じアプリになる設計。CMS 側リポジトリでは admin と read API だけを動かし、公開サイトを別リポジトリでビルドする使い方をしても、機能・保守の両面で破綻しないか。

**仮説**: REST API（`/_emdash/api/`、OpenAPI 3.1）と Bearer token で、ビルド時の読み取りは成立する。公開ページ側の機能（route cache、visual editor、preview など）は使えなくなるが、要件上は不要。

**検証手順と合格基準**

| # | 検証内容 | 合格基準 |
|---|---|---|
| 1-1 | `cms/` から公開ページを除き、admin と API のみを提供する | 未使用の公開ルートが 404 になるか、無害な固定ページだけになる。admin の全機能が動く |
| 1-2 | 読み取り専用 token（最小 scope・最小ロール）で、`site/` のビルドから collection 一覧・単体・メディアを取得する | 下書き・予約投稿・ゴミ箱の項目が応答に含まれない。書き込み系の API がその token で拒否される |
| 1-3 | ページネーション・ソートを REST で取得する | `PaginatedResponse` の各値（`totalItems` / `totalPages` 含む）を API の応答から組み立てられる |
| 1-4 | メディア URL の扱いを確認する | 静的ビルドが画像を取得できる。公開サイトが CMS ホストへ直リンクしない方式（ビルド時コピー等）を選べる |
| 1-5 | `content:afterPublish` / `afterUnpublish` / `afterDelete` フックから CI のビルドを起動する（GitHub `repository_dispatch` 相当をモック） | 公開・非公開化・削除のたびに 1 回だけ起動できる。フック内で使う token は env vars から渡せる |
| 1-6 | スキーマをコードとして管理する（seed ファイル + CLI によるスキーマ変更 + `export-seed`） | collection 定義の変更が repo 内のファイル差分として残り、空の DB に再適用すると同じスキーマが再現される |
| 1-7 | 全データのエクスポート（`emdash site export`）と、空のインスタンスへのインポート | 管理者のみ実行できる。コンテンツ・メディア・ユーザーが欠けずに戻る |
| 1-8 | EmDash の公式サポート範囲を確認する | 依存する API がすべて OpenAPI 文書に載っている（載っていない内部ルートに依存しない） |

**不合格時の扱い**: 1-2 / 1-6 / 1-7 のいずれかが不合格なら headless 運用は不可とし、構成案 B（後述）の検討に移る。

**成果物**: `reports/01-headless.md`（各 # の結果、依存する API の一覧、未使用になる EmDash 機能の一覧）

---

### 項目 2. Discord 認証プロバイダとロールの同期

**問い**: EmDash のプロバイダ拡張（`AuthProviderDescriptor`）で Discord 認証を自作し、§0-2 の不変条件をすべて満たせるか。

**前提知識**: EmDash 同梱の OAuth プロバイダは GitHub / Google / Microsoft のみ。passkey と magic link はプロバイダとは独立したログイン経路で、既定で有効。同梱プロバイダには、外部側の変更（脱退・降格）をログイン済みセッションや passkey に反映する仕組みがない。

**検証手順と合格基準**

| # | 検証内容 | 合格基準 |
|---|---|---|
| 2-1 | Discord OAuth（Authorization Code + PKCE）の login / callback ルートを `providers/` に実装する | 必要最小の scope（ユーザー識別・対象サーバーのメンバー情報・email）でログインが完了する |
| 2-2 | callback で対象サーバーへの在籍を確認する | 未在籍のアカウントはユーザーレコードの有無にかかわらず拒否される。初回の在籍者はユーザーが自動作成される |
| 2-3 | ログインのたびに Discord ロールを EmDash ロールへ対応させて上書きする | 降格・昇格が次回ログインで反映される。プロバイダから EmDash のユーザーロールを更新できる公開 API があるか、なければ何に依存したかを記録する |
| 2-4 | §0-3 の権限モデルを EmDash のロール（Subscriber / Contributor / Author / Editor / Admin）へ対応させる | 一般メンバーが他メンバーのコンテンツを編集でき、削除できない。リーダーは削除できる。サーバー側（API 直叩き）でも同じ結果になる |
| 2-5 | Discord を経由しないログイン経路を塞ぐ | 一般メンバー・リーダーが passkey 登録・magic link・招待でログインできないか、それらの経路でも在籍確認が走る。設定で塞げない場合は、どの拡張点で塞いだか（middleware 等）を記録する |
| 2-6 | 脱退・降格した利用者のセッションを無効化する | 脱退後、既存セッションでの操作が一定時間内（例: 次のリクエスト、または上限 N 時間）に拒否される。方式（セッション有効期限の短縮、リクエスト時の再検証、定期ジョブ等）と、それによる Discord API 呼び出し量・rate limit を記録する |
| 2-7 | cold-standby 経路を用意する（EmDash にはパスワードログインがないため magic link を候補とする） | env var の切替と再起動で有効化・無効化できる。無効時はサーバー側で拒否される。メール送信に使うプラグインの保守状況（公式か・メンテナ数）を記録する |
| 2-8 | 運営の独立経路 | Admin が passkey でログインでき、Discord の OAuth が停止しても admin に到達できる。2-5 で一般利用者の passkey を塞いでも Admin の passkey は使える |
| 2-9 | 初回セットアップの乗っ取り対策 | セットアップウィザード完了前の公開 URL で、第三者が最初の Admin になれない手順・設定がある |

**不合格時の扱い**: 2-2 / 2-3 / 2-5 / 2-6 のいずれかが満たせない場合は、認証の不変条件を緩めるかを意思決定事項として `reports/02-discord-auth.md` に列挙し、サンドボックスでは緩めない。

**成果物**: `providers/discord/`（プロバイダ実装）、`reports/02-discord-auth.md`（各 # の結果、依存した拡張点・内部 API の一覧、EmDash の更新で壊れうる箇所）

---

### 項目 3. `cms-client` を EmDash の上に載せ替えられるか

**問い**: 公開サイト側の契約（§0-4）を一切変えずに、`cms-client` の内部だけを EmDash 向けに差し替えられるか。差し替えるなら、`getEmDashCollection()` をラップする方式と、REST API をラップする方式のどちらが適するか。

**前提知識**: `getEmDashCollection()` は Astro の live collection（`src/live.config.ts` の `emdashLoader()`）経由で、EmDash ランタイムがデータベースを直接読む仕組み。

**仮説**

- **3a. `getEmDashCollection()` ラッパー**: 呼び出し側（公開サイト）に EmDash インテグレーションとデータベース接続が必要になる。その場合、公開サイトが実質 EmDash アプリになり、「registry 経由でのみ繋がる」構成は保てない。
- **3b. REST API ラッパー**: 現行の `cms-client` と同じ構造（Raw 型 → Domain 型の変換を内部に閉じる）で作れる。

**検証手順と合格基準**

| # | 検証内容 | 合格基準 |
|---|---|---|
| 3-1 | 3a を実装し、`site/` を最小構成でビルドする | `site/` が追加で必要とするもの（依存パッケージ、Astro の設定、DB の接続情報、env vars）をすべて列挙できる |
| 3-2 | 3a で DB を CMS と共有する方法を確認する（VPS 上の SQLite を CI から読む、libSQL / PostgreSQL へ移す 等） | 方式ごとに、CI に渡る secret・データ、追加コスト、CMS 停止時のビルド可否を表にできる |
| 3-3 | 3b を実装する（`fetchArticles` / `fetchArticle` + `casts` 相当） | §0-4 のシグネチャと Domain 型のまま、`site/` が tarball の `cms-client` だけを依存に持ってビルドできる |
| 3-4 | 公開 surface の純度を検査する | `cms-client` のビルド済み `.d.ts` に `emdash` パッケージの型・REST のパス・EmDash 固有の用語が現れない。`site/` の `node_modules` に `emdash` が入らない（3b の場合） |
| 3-5 | Raw → Domain 変換の網羅 | rich text → `bodyHtml`、メディア参照 → `heroImageUrl`、select → `themeColor`、カンマ区切り → `keywords[]`、日時 → ISO 8601 が型安全に変換できる。EmDash のレスポンス型は OpenAPI から生成するか `emdash types` の出力を使い、手書きしない |
| 3-6 | 移行耐性の確認 | 現行（PocketBase 版）の `cms-client` と 3b 版で、`site/` 側のコードが 1 行も変わらない |

**判定**

- 3b が合格 → 構成案 A（headless + `cms-client` 維持）が成立する。
- 3a でしか成立しない、または 3a の単純さを優先したい → 構成案 B（公開サイトと CMS を統合）として、項目 1 の結果とあわせて別途意思決定する。

**成果物**: `cms-client/`（3b 実装）、`reports/03-cms-client.md`（3a と 3b の比較表、3-1 / 3-2 の列挙）

---

### 項目 4. メモリ制限下での稼働

**問い**: 512MB プランの VPS（OS などを除いて EmDash が使えるのは 300〜350MB 程度）で、EmDash が OOM なく稼働するか。

**仮説**: 公開アクセスが CMS に来ない構成では、メモリは起動時の固定分（Node ランタイム・V8 ヒープ・読み込むモジュール）が支配的で、待機時の常駐メモリは 100〜200MB 程度に収まる。ピークは画像処理・エクスポート・起動直後のマイグレーションで出る。

**検証環境**

- `bench/` に docker compose を置き、`mem_limit: 350m`、`memswap_limit` は「スワップなし」と「スワップ 512MB 相当」の 2 通りで計測する。
- `astro build` は計測対象外とし、ビルド済みの `dist/` と本番用の依存だけを載せたイメージで動かす（本番でも VPS 上ではビルドしない前提）。
- 計測は `docker stats` と、プロセスの RSS（`/proc/<pid>/status` の `VmRSS` / `VmHWM`）を 1 秒間隔で記録する。

**シナリオと合格基準**

| # | シナリオ | 合格基準 |
|---|---|---|
| 4-1 | 起動 → マイグレーション適用 → 待機 10 分 | ピーク RSS とその後の定常 RSS を記録する。定常 RSS が 250MB 以下 |
| 4-2 | 編集者 5 人相当の admin 操作（一覧・編集・保存・公開）を 30 分続ける | OOM・再起動がない。ピーク RSS が 350MB 未満 |
| 4-3 | 5MiB の画像を 10 枚連続でアップロードする | 同上 |
| 4-4 | ビルド時の取得負荷（全 collection を並列 10 で全件取得） | 同上。所要時間を記録する |
| 4-5 | `emdash site export` の実行（`casts` 100 件 + 画像 500 枚相当） | 同上 |
| 4-6 | 24 時間の放置（スケジューラ・メモリキャッシュの増加傾向） | RSS が単調増加しない |
| 4-7 | 比較: サンドボックス用プラグインを 1 つ有効化（`workerd` 起動） | 増加分を記録する（合否判定には使わない） |

**不合格時の扱い**: 4-1 / 4-2 のいずれかが不合格なら 1GB プランを前提にコストを再計算する。Node のヒープ上限（`--max-old-space-size`）を調整して合格するなら、その値を記録する。

**成果物**: `bench/`（compose・負荷スクリプト）、`reports/04-memory.md`（シナリオごとの RSS 推移グラフと数値）

---

## 3. 判定

| 構成案 | 内容 | 成立条件 |
|---|---|---|
| A | EmDash を headless で使い、`cms-client` を REST ラッパーとして維持する。公開サイトの配信は現行のまま | 項目 1・2・3（3b）・4 がすべて合格 |
| B | 公開サイトと CMS を 1 つの EmDash アプリに統合し、`cms-client` を廃止する（アプリ内に薄い変換モジュールを置く） | 項目 2・4 が合格し、かつ配信方式（VPS で SSR 配信 / CI で静的化して静的ホストへ配置）と、§0-1 の構成要件を緩めることの意思決定がある |
| 見送り | PocketBase を継続する | 項目 2 の 2-2 / 2-3 / 2-5 / 2-6 のいずれかが不合格で、認証の不変条件を緩めない場合 |

調査の完了時に `reports/00-summary.md` を作り、上表に沿って推奨案と、その案で必要になる作業（スキーマの移行、cold-standby の再設計、運用手順の改訂、データ移行）を列挙する。

## 4. 調査の範囲外

- 既存データの本移行（変換規約の下書きまでは範囲内）
- 公開サイトのデザイン・ページ実装
- 本番 VPS・本番 Discord アプリでの検証（サンドボックス用の Discord アプリとテスト用サーバーを使う）
