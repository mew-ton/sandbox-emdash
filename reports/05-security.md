# 項目 5. セキュリティ

対象: emdash 1.3.1 / `cms/`（headless 構成）、`providers/discord`、`cms-client`、`site`。
検証: `verify/item5-security.mjs`（非破壊。機械出力は [`generated/05-security.md`](generated/05-security.md)）と `bench/security/dos-poc.mjs`（破壊的。コンテナを落とすので手動実行）。
要件は [`docs/requirements.md`](../docs/requirements.md) の「項目 5」。この項目は調査開始後に追加した。

## 結論

認証（項目 2）以外のセキュリティ面を検証し、対策を入れた。残る受容判断は **5-6（可用性）1 件**。

- **5-6（可用性）: 一般メンバーが 1 リクエストで CMS を落とせる。** 配列フィールドに型が間違った要素を約 15 万個以上入れた書き込みで、Node プロセスが落ち（OOM kill / segfault）、再起動まで到達不能になる。zod を上げても直らない。**ただし偶発では踏めず**（エディタの通常操作や巨大ドキュメントの貼り付けでは起きない）、curl 等で手作業に細工したリクエストが要る。到達できるのは内部犯か乗っ取られたメンバーセッションだけで、影響は可用性のみ。ユーザー判断として「内部犯は性善説で受容し監査ログで追う／乗っ取りはセッション短縮で緩和」とした。
- **5-7（追跡）: 対策して合格。** core は操作の監査ログを持たないので、自前 middleware で全書き込みを実行者・ロール・IP・結果付きに記録するようにした。

その他: 未認証で届く入口の封鎖（5-1、middleware と `mcp: false`）、本文 XSS（5-2）、アップロード XSS（5-3）、CSRF・Cookie・ヘッダ（5-4）は合格。
総当たり対策（5-5）は、`trustedProxyHeaders` をビルドに焼き込んで既定で効くようにした（Node ポートはプロキシ経由のみ到達可にする前提）。

## 結果

| # | 検証内容（要件） | 合格基準（要件） | 結果 | 何が起きたか |
|---|---|---|---|---|
| 5-1 | 未認証で到達できるルートを洗い出す | 一覧があり「必要／塞いだ」に分類。塞いだものは 404/403 | 合格（対策込み） | 既定では公開サイト用・MCP/CLI 用 OAuth・画像サービスなど 12 系統が未認証で届いた。`cms/src/security/public-surface.ts`（middleware）で匿名時に 404 にし、`mcp: false` で MCP も止めた。塞いだ後は 404、運営・health 経路は維持 |
| 5-2 | 公開サイトに出す本文の XSS | `<script>`・イベント属性・`javascript:` が無害化 | 合格（スキーマ依存） | 本文に入れた `<script>` / `<img onerror>` / `javascript:` リンクは、公開 HTML ではすべてエスケープされ、実行可能なタグとして出ない（`@portabletext/to-html`）。html/iframe ブロック型を足すと変わる（下記） |
| 5-3 | アップロードファイルの XSS | 危険な形式を拒否、または実行されない形で配信 | 合格 | SVG・HTML は拒否（400）。中身が SVG のファイルは `image/svg+xml` + `Content-Disposition: attachment` でダウンロード扱い。全メディアに `X-Content-Type-Options: nosniff` と制限的 CSP（`sandbox; default-src 'none'`）。配信 Content-Type はバイトを見て決める |
| 5-4 | 管理画面と API の HTTP 防御 | 別 origin から状態変更が拒否される。Cookie が HttpOnly/Secure/SameSite。CSP が付く | 合格（HSTS はプロキシ） | Cookie 認証の書き込みは `X-EmDash-Request` ヘッダ必須（単純なクロスサイトフォームは送れない）。セッション Cookie は HttpOnly/Secure/SameSite=Lax。CSP・nosniff・`frame-ancestors 'none'`・`no-store` あり。HSTS は無し（TLS 終端のプロキシで付ける前提） |
| 5-5 | ログインと magic link の総当たり対策（プロキシ配下想定） | 一定回数で制限。プロキシ配下でも IP 単位で効く設定がある | 合格（対策込み） | 仕組みはある（passkey options 10回/60秒 等）が、EmDash 既定では IP が解決できず素通りした。`trustedProxyHeaders: ["x-forwarded-for"]` を **astro.config に焼き込んだ**ので、env 変数なしで転送元 IP 単位で効く。ただし Node ポートはプロキシ経由のみ到達可能にする必要がある（127.0.0.1 バインド/ファイアウォール。直叩きだと x-forwarded-for を詐称できる） |
| 5-6 | 依存パッケージの脆弱性 | `pnpm audit` で high 以上の未対処が無い。更新を追う手順がある | **不合格（可用性のみ・方針で受容）** | 下記。EmDash が zod 4.5.4（CVE-2023-54404、high）を固定。override で audit は clean にできるが、**一般メンバーが 1 リクエストで CMS を落とせる経路は zod を上げても残る**。ただし偶発では踏めず、手で細工した書き込みが要る（下記）。50人の信頼コミュニティでは「性善説 + `restart: always` + 監査ログ」で受容、乗っ取りはセッション短縮で緩和する方針 |
| 5-7 | 監査ログ | 誰がいつ公開・削除・権限変更したかを後から追える | 合格（対策込み） | core は `audit_logs` を MCP とエクスポート/インポートにしか書かない。そこで自前の middleware（`cms/src/security/audit-log.ts`）を足し、全書き込みを実行者・ロール・IP・パス・結果付きで stdout に構造化ログ出力した。拒否された操作（403）も記録される |

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

**より重要な所見（メンバーが 1 リクエストで CMS を落とせる）。** `bench/security/dos-poc.mjs` を 350MiB 制限のベンチイメージで実行し、何がトリガーかを切り分けた。

落とすのに必要なのは **「同一の配列フィールドに、型が間違った要素を約 15 万個以上」** 入れた書き込み。サイズではなく**要素数**で効く。

| 送った内容 | 本文サイズ | 結果 |
|---|---|---|
| 有効な本文 5 万ブロック（巨大ドキュメントの貼り付け相当） | 8.9MiB | 200 正常保存 |
| 有効な本文 7 万ブロック | 12.5MiB | 413 Too Large（正常に拒否） |
| 本文に数値を 5 万・10 万個（型違い） | 0.1〜0.2MiB | 400 バリデーションエラー（正常） |
| 本文に数値を **15 万個** | 0.3MiB | **クラッシュ（OOM kill, exit 137）** |
| タグに数値を 100 万個 | 2MiB | **クラッシュ（SIGSEGV, exit 139）** |

- 仕組み: `body` / `taxonomies` / `references` 等の配列フィールド（`z.array`）に**検証に失敗する要素**を大量に入れると、失敗要素ごとにエラーオブジェクトを作り続け、350MiB の上限で OOM kill されるかプロセスが segfault する。フィールドで閾値（本文は約15万、タグは約100万）と落ち方（137/139）が違うが原因は同じ
- **zod を 4.6.7 に上げても落ちる**（ベンチイメージは 4.6.7 で確認）。`--max-old-space-size=256` を付けても落ちる。入力スキーマに配列長の上限が無いことが背景で、根本修正は EmDash 本体側
- ベンチの compose には `restart:` を付けていないので停止したまま。本番で `restart: always` なら数秒で復帰するが、メンバーは繰り返し送れる

**偶発では踏めない。** 管理画面のエディタが吐くのは必ず「有効なブロックの配列」で、上表のとおり保存されるか 413 で綺麗に弾かれる。巨大なドキュメントを貼り付けても落ちない。「型が間違った配列要素を15万個」は、curl や devtools で**手作業でリクエストを細工**しないと作れない。

**到達条件と影響（性善説の判断材料）。**

- トリガーできるのは (1) 悪意ある正規メンバー（内部犯）か、(2) メンバーのセッション／資格情報が乗っ取られた場合（XSS・Cookie 窃取・端末侵害・悪意ある拡張機能）だけ。**未認証の赤の他人には一切できない**（書き込みにセッションが要る）
- 影響は**可用性のみ**。プロセスが落ちて再起動するだけで、データ消失も権限昇格もない。他人の下書きも読めない
- 公開サイト（静的ホスト）は無関係

**方針（ユーザー決定）。** 50人の信頼コミュニティなので内部犯 (1) は性善説で受容し、**ログが残っていれば良い**（→ 5-7 の監査ログで実行者を記録）。乗っ取り (2) は**セッション有効期限を短くして**窓を狭める（`DISCORD_SESSION_MAX_AGE_SECONDS` を 12h→1h。期限切れ後は Discord OAuth 再認証が必須になり、Cookie だけ盗んだ攻撃者は Discord アカウントが無いので再認証できない）。当座 `restart: always` も併用。純粋な遮断は上流修正を待つ（D11）。

### 5-7 監査ログ（対策込みで合格）

core の `audit_logs` テーブルは存在し列も揃う（`actor_id` / `actor_ip` / `action` / `resource_*` / `status`）が、core が書くのは MCP 呼び出しとエクスポート/インポートだけ。公開・削除・ロール変更・ログインは記録されない（検証でも操作後に 0 件）。

フックは使えなかった: publish/delete 後の `after*` フックには**実行者が含まれず**、ロール変更にはフック自体が無い。
そこで自前の middleware（`cms/src/security/audit-log.ts`）を足した。

- 全書き込み（POST/PUT/PATCH/DELETE）と認証系リクエストを、1 行の構造化 JSON で stdout に出す: 時刻・実行者 ID・ロール・クライアント IP・メソッド・パス・結果ステータス・所要時間
- EmDash の認証 middleware の後に走るので `locals.user`（ID・ロール）が取れる。**拒否された操作（403）も記録される**（内部犯の未遂も残る）
- 検証では、運営の削除（200）・ロール変更（200）・メンバーの拒否された削除（403）がすべて実行者・ロール・IP 付きで記録された
- 改ざん耐性のため、この JSON 行は journald / ログ収集で**箱の外へ退避**する（DB や admin に手が届く内部犯が消せない形にする）
- 注意: クラッシュ（5-6）そのものの行は best-effort。SIGKILL で stdout のバッファが失われうるので、**クラッシュ試行の記録はリバースプロキシのアクセスログ**（メソッド・パス・送信元 IP・上流切断）に委ねる。本番でアクセスログを有効にすること

ロール変更は、運営操作（`PUT /_emdash/api/admin/users/{id}`）も Discord 同期（ログイン callback）も middleware が実行者付きで捕捉する。

## 設定の持ち方（ビルド焼き込み / env / 秘密）

セキュリティの「設定」は、デプロイ時の env に依存すると付け忘れで保護が外れる（5-5・5-1 がその例だった）。そこで**非秘密のセキュリティ設定はビルド済み JS に焼き込み**、秘密は逆に**ビルドにも env にも置かない**方針にした。

| 種類 | 置き場所 | 例 |
|---|---|---|
| セキュリティ設定（非秘密） | **ビルド焼き込み**（astro.config / src/security / provider config） | 塞ぐルート一覧、`mcp:false`、`trustedProxyHeaders`、セッション有効期限 1h 既定、CSP、監査ログ |
| デプロイ固有の識別子（非秘密） | env | `EMDASH_SITE_URL`、`DISCORD_GUILD_ID`、ロール ID、`DISCORD_CLIENT_ID` |
| 秘密 | 実行時にファイル / Docker・systemd secret から読む（env にも載せない） | `EMDASH_ENCRYPTION_KEY`、`DISCORD_CLIENT_SECRET`、Bot Token、各種トークン |

- **焼き込むのは保護の既定値だけ**。これで「env を付け忘れた VPS がうっかり無防備で立ち上がる」事故を防ぐ。env での上書きは残してあるが、未設定でも堅い側に倒れる
- **秘密は焼き込まない**。ビルド成果物＝秘密になり、リポジトリ/アーティファクトに残り、ローテーションに再ビルドが要るので逆に危険（要件 §0-5・1-3 にも反する）。env に置くのも、`docker inspect` / `/proc/<pid>/environ` / クラッシュダンプに出るため、本番では root 所有のファイルや Docker/systemd secret を起動時に読む形が望ましい

## この項目で入れた対策（サンドボックス）

- `cms/src/security/public-surface.ts` + `src/middleware.ts`: 匿名の不要ルートを 404（5-1）
- `cms/astro.config.mjs`: `mcp: false`（5-1）、`trustedProxyHeaders: ["x-forwarded-for"]`（5-5 を env なしで有効化）
- `cms/src/security/audit-log.ts`: 全書き込みの監査ログ（5-7）
- `providers/discord/src/config.ts`: セッション有効期限の既定を 12h→1h に焼き込み（乗っ取り窓の短縮、5-6）
- `cms/package.json`: `pnpm.overrides.zod = 4.6.7`（5-6 の audit を clean に。ただしメンバー crash は残る）
- `cms/.env.example`: 秘密・識別子・焼き込み済み既定を分類し、秘密はファイル/secret で渡すことを明記
