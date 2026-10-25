# 項目 5. セキュリティ

対象: emdash 1.3.1 / `cms/`（headless 構成）、`providers/discord`、`cms-client`、`site`。
検証: `verify/item5-security.mjs`（非破壊。機械出力は [`generated/05-security.md`](generated/05-security.md)）と `bench/security/dos-poc.mjs`（破壊的。コンテナを落とすので手動実行）。
要件は [`docs/requirements.md`](../docs/requirements.md) の「項目 5」。この項目は調査開始後に追加した。

## 結論

認証（項目 2）以外のセキュリティ面で、**受け入れ可否の判断が要る所見が 2 件**出た。

- **5-6（可用性）: 一般メンバーが 1 リクエストで CMS を落とせる。** 配列フィールドの検証を失敗させる内容を書き込むと、約 2MiB の本文（10MiB 制限の内側）で Node プロセスが SIGSEGV（exit 139）で落ち、再起動まで到達不能になる。zod を 4.6.6+ に上げても直らない。これは項目 4（OOM なし）とは別の経路。
- **5-7（追跡）: core には操作の監査ログが無い。** 誰がいつ公開・削除・権限変更したかは core では記録されない。記録には非公式プラグインが要る。

残りは、未認証で届く入口の封鎖（5-1、middleware を追加）、本文の XSS（5-2）、アップロードの XSS（5-3）、CSRF・Cookie・ヘッダ（5-4）は合格。
総当たり対策（5-5）は「仕組みはあるが既定では無効」で、`EMDASH_TRUSTED_PROXY_HEADERS` の設定が必須。

## 結果

| # | 検証内容（要件） | 合格基準（要件） | 結果 | 何が起きたか |
|---|---|---|---|---|
| 5-1 | 未認証で到達できるルートを洗い出す | 一覧があり「必要／塞いだ」に分類。塞いだものは 404/403 | 合格（対策込み） | 既定では公開サイト用・MCP/CLI 用 OAuth・画像サービスなど 12 系統が未認証で届いた。`cms/src/security/public-surface.ts`（middleware）で匿名時に 404 にし、`mcp: false` で MCP も止めた。塞いだ後は 404、運営・health 経路は維持 |
| 5-2 | 公開サイトに出す本文の XSS | `<script>`・イベント属性・`javascript:` が無害化 | 合格（スキーマ依存） | 本文に入れた `<script>` / `<img onerror>` / `javascript:` リンクは、公開 HTML ではすべてエスケープされ、実行可能なタグとして出ない（`@portabletext/to-html`）。html/iframe ブロック型を足すと変わる（下記） |
| 5-3 | アップロードファイルの XSS | 危険な形式を拒否、または実行されない形で配信 | 合格 | SVG・HTML は拒否（400）。中身が SVG のファイルは `image/svg+xml` + `Content-Disposition: attachment` でダウンロード扱い。全メディアに `X-Content-Type-Options: nosniff` と制限的 CSP（`sandbox; default-src 'none'`）。配信 Content-Type はバイトを見て決める |
| 5-4 | 管理画面と API の HTTP 防御 | 別 origin から状態変更が拒否される。Cookie が HttpOnly/Secure/SameSite。CSP が付く | 合格（HSTS はプロキシ） | Cookie 認証の書き込みは `X-EmDash-Request` ヘッダ必須（単純なクロスサイトフォームは送れない）。セッション Cookie は HttpOnly/Secure/SameSite=Lax。CSP・nosniff・`frame-ancestors 'none'`・`no-store` あり。HSTS は無し（TLS 終端のプロキシで付ける前提） |
| 5-5 | ログインと magic link の総当たり対策（プロキシ配下想定） | 一定回数で制限。プロキシ配下でも IP 単位で効く設定がある | **条件付き** | 仕組みはある（passkey options 10回/60秒 等）が、**既定では無効**。クライアント IP が解決できないと（Cloudflare 無し・trusted header 無しの Node 既定）、制限は常に素通りする。`EMDASH_TRUSTED_PROXY_HEADERS=x-forwarded-for` を設定すると転送元 IP 単位で効いた。本番で必須 |
| 5-6 | 依存パッケージの脆弱性 | `pnpm audit` で high 以上の未対処が無い。更新を追う手順がある | **不合格** | 下記。EmDash が zod 4.5.4（CVE-2023-54404、high）を固定。override で audit は clean にできるが、**一般メンバーが 1 リクエストで CMS を落とせる経路は zod を上げても残る** |
| 5-7 | 監査ログ | 誰がいつ公開・削除・権限変更したかを後から追える | **不合格** | core は `audit_logs` を MCP ツール呼び出しとエクスポート/インポートにしか書かない。公開・削除・ロール変更は記録されない。記録には非公式の `@emdash-cms/plugin-audit-log`（v0.2.3）が要る |

**不合格時の扱い（要件）**: 不合格の # ごとに対策か受け入れを意思決定事項として列挙する。→ [`00-summary.md`](00-summary.md) の D10〜D13。

## 詳細

### 5-1 未認証で届くルート

公開ページを消しても、EmDash は多くのルートを注入する。未認証（Cookie・トークンなし）で全 220 ルートに GET/POST した結果、次が届いていた。

| ルート | 用途 | 対策 |
|---|---|---|
| `/.well-known/oauth-authorization-server/_emdash`、`/.well-known/oauth-protected-resource`、`/_emdash/.well-known/auth`、`/_emdash/oauth/authorize`、`/_emdash/api/oauth/*` | MCP / CLI 用 OAuth の発見・認可・トークン | middleware で匿名時 404。`mcp: false` でも止めた |
| `/_emdash/api/search`、`/_emdash/api/search/suggest` | 公開サイト用の検索（公開済みのみ返す） | middleware で匿名時 404（公開サイトは別で持つ） |
| `/_emdash/api/comments/*` | 公開サイト用コメント | 同上 |
| `/_emdash/api/visual-editing/toolbar-labels` | ビジュアル編集 | 同上 |
| `/sitemap.xml`、`/sitemap-[collection].xml` | 公開サイト用 | 同上 |
| `/_image`、`/_server-islands/*` | Astro の画像サービス・サーバーアイランド | 同上 |

対策は `cms/src/security/public-surface.ts`（`src/middleware.ts` で Discord ガードの前に実行）。**匿名のときだけ** 404 を返す。管理画面自身はこれらの一部（画像サービス、検索など）をセッション付きで使うため、認証済みは通す。

残す（必要な）未認証ルート: Discord の login/callback、passkey の options/verify、magic-link の verify（運営ログインと cold-standby）、`/_emdash/api/auth/mode`、`/_emdash/api/health`、`/robots.txt`、メディアファイル本体（5-3 で別途防御）。

### 5-3 アップロードの防御

EmDash のメディア配信は次のように多層で守られている（確認済み）。

- アップロード時、拡張子や申告 Content-Type ではなく**バイトを見て**種別を決める。SVG・HTML・JS は拒否（400）
- 中身が画像でないもの（PDF 等）や SVG は `Content-Disposition: attachment` で返す（ブラウザで実行されずダウンロードになる）
- すべてのメディアに `X-Content-Type-Options: nosniff` と、`Content-Security-Policy: sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'`
- 申告を `image/png` と偽って HTML バイトを上げても、`image/png` として配信され（nosniff + sandbox CSP）スクリプトは動かない

### 5-6 依存パッケージと、メンバーが落とせる経路

**zod の脆弱性（CVE-2023-54404、high）。** EmDash は `zod` を 4.5.4 に固定している。`pnpm audit` は high 1 件を報告する（`@emdash-cms/auth > zod`、`emdash > zod`）。内容は「長さ制限のない配列スキーマに巨大な配列を渡すとメモリを使い切る」。

- `cms/package.json` に `pnpm.overrides.zod = 4.6.7` を入れると audit は clean になる
- ただし **override はクリーンインストール（`node_modules` と lockfile を消してから install）でしか効かない**。差分インストールだと、lockfile に override が入っても実ツリーには 4.5.4 が残り、`pnpm audit` は package.json を見て clean と誤表示する

**より重要な所見（メンバーが 1 リクエストで CMS を落とせる）。** `bench/security/dos-poc.mjs` を 350MiB 制限のベンチイメージで実行した結果:

| 本文 | 結果 |
|---|---|
| 検証に失敗する配列（`taxonomies.tag` に数値 0 を 100万〜490万件）。約 2〜10MiB | **コンテナが SIGSEGV（exit 139）で停止、再起動まで health 到達不能**。約 2 秒 |
| 同じ件数の有効な文字列 | 正常（サイズ超過なら 413） |
| 9MiB の有効な文字列 1 本 | 正常（200） |

- 一般メンバー（Editor 相当）のセッションで、`PUT /_emdash/api/content/articles/{id}` の配列フィールド（`taxonomies` / `references` / `bylines` 等は `z.array`）に検証を失敗する要素を大量に入れるだけ。約 2MiB の本文で足り、10MiB の本文上限の内側
- `OOMKilled: false`。cgroup の OOM ではなくプロセスの異常終了。`--max-old-space-size=256` を付けても落ちる
- **zod を 4.6.7 に上げても落ちる**（ベンチイメージは 4.6.7 で確認）。pnpm audit の high とは別に、この到達経路は塞がっていない
- ベンチの compose には `restart:` を付けていないので停止したまま。本番で `restart: always` なら数秒で復帰するが、メンバーは繰り返し送れる

root cause（zod 内部か EmDash のエラー整形か）は特定しきれていないが、「認証済みの一般メンバーが 1 リクエストで CMS を落とせる」という結果は確実。入力スキーマに配列長の上限が無いことが背景。EmDash 本体への報告と、上流修正までの緩和（後述 D11）が要る。

### 5-7 監査ログ

`audit_logs` テーブルは存在し、列も揃っている（`actor_id` / `actor_ip` / `action` / `resource_type` / `resource_id` / `details` / `status`）。
しかし core がこのテーブルに書くのは次だけ:

- MCP ツールの呼び出し（`plugin_tool_invoke`）
- サイトのエクスポート / インポート

公開・非公開化・削除・ユーザーのロール変更・ログインは記録されない。検証でも、公開→削除→ロール変更の後で 0 件だった。
記録するには `@emdash-cms/plugin-audit-log`（非公式、v0.2.3）を入れるか、同等のネイティブフックを自作する必要がある。

## この項目で入れた対策（サンドボックス）

- `cms/src/security/public-surface.ts` + `src/middleware.ts`: 匿名の不要ルートを 404（5-1）
- `cms/astro.config.mjs`: `mcp: false`（5-1）
- `cms/package.json`: `pnpm.overrides.zod = 4.6.7`（5-6 の audit を clean に。ただしメンバー crash は残る）
