# EmDash の能力と限界 — 所見

要件番号（1-1〜5-8）に紐づかない、EmDash そのものについての発見。項目ごとのレポートが「要件を満たすか」を書くのに対し、ここは「EmDash が何をできて何をできないか」を書く。採用後の設計判断と、更新時に見る場所の根拠になる。

## 書式

各所見は **典拠** と **確度** を持つ。調査中、ソースだけを読んで出した結論が公式ドキュメントで覆る場面が繰り返しあったため（F-03 / F-11 / F-20）、根拠の種類を明示する。

| 典拠 | 意味 |
|---|---|
| `docs` | docs.emdashcms.com の記述 |
| `source` | `node_modules/emdash` および `@emdash-cms/*` のソース |
| `measured` | このサンドボックスで計測した値 |
| `observed` | 動かして観察した挙動 |

| 確度 | 意味 |
|---|---|
| 確定 | `docs` または `measured` / `observed` による裏付けがある |
| 暫定 | `source` のみ。公開契約として保証されていない |

`source` のみの所見は、EmDash の更新で予告なく変わりうる。

---

## 拡張性の限界

採用判断に直接関わる 5 件。いずれも「設定で変えられない」ことが設計であり、回避には自前実装か標準 UI の放棄を伴う。

### F-01 サイト設定のスキーマは拡張できない

典拠: `docs` + `source` / 確度: 確定

`SiteSettings` は `title` / `tagline` / `logo` / `favicon` / `url` / `postsPerPage` / `dateFormat` / `timezone` / `social` / `seo` の固定 interface。フィールドの追加・削除・改名の手段がない。`social` は `twitter` / `github` / `facebook` / `instagram` / `linkedin` / `youtube` の 6 サービスが zod スキーマで列挙されており、未知のキーは書き込み時に捨てられる。

影響: サイト固有の設定（要件では X / YouTube / booth のリンク）を置く場所がない。`metadata` コレクションで代替した（D15）。`twitter` が X の旧称のままである点も含め、固定列挙は日本のサービスを想定していない。

### F-02 画像の寸法を宣言的に制約できない

典拠: `docs` / 確度: 確定

`image` フィールドのバリデーションは `allowedMimeTypes` のみ。`FieldType` は 17 種の固定ユニオンで拡張不可。`maxUploadSize` はバイト数のみ。ドキュメントは "The docs also don't describe any way to require specific image dimensions. A dimension check would need custom code" と明記する。

影響: 寸法の強制は `content:beforeSave` フックで実装した（`cms/src/plugins/image-dimensions/`）。宣言では表現できない。

### F-03 カスタムバリデーションは可能（訂正）

典拠: `docs` / 確度: 確定

当初「プラグインにカスタムバリデーションがない」と結論したが誤り。`content:beforeSave` は保存を拒否できる。サンドボックスのフックは `SAVE_REJECTED` と 1〜500 文字の `reason` を返し、ホストプロセスのコードは `ContentSaveRejectedError` を throw する。それ以外の例外はメッセージを隠した汎用エラーになる。

影響: 宣言的に表現できない制約は、すべてこの経路で実装できる。F-02 / F-04 / F-05 の回避策の土台。

### F-04 クライアント側のフックが存在しない

典拠: `docs` / 確度: 確定

管理 UI 側の拡張点は、生成設定フォーム / 管理ページ / ダッシュボードウィジェット / フィールドの編集 UI / エディタパネル / 一覧の列の 6 種。ドキュメントは "The docs describe no client-side hook for media uploads. They don't mention transforming a file in the browser before upload or changing the standard image field" と述べる。フック一覧もすべてサーバー側イベント。

影響: **「標準の画像フィールドを保ったまま、アップロード前にブラウザで変換する」は実現できない。** 変換を別ページに切り出す構成になった（D16）。

### F-05 リッチテキストの構成はハードコード

典拠: `source` / 確度: 暫定

管理 UI は `PortableTextStarterKit.configure({ heading: { levels: [1,2,3,4,5,6] }, codeBlock: false, code: false, orderedList: false, … })` の後に自前拡張（`CodeBlockExtension` / `HtmlBlockExtension` / `IframeBlockExtension` / `EmDashTable*` / `Subscript` / `Superscript` / `GalleryExtension` / `VideoExtension`）を並べる。`codeBlock: false` は StarterKit の実装を使わない意味で、機能としては有効。フィールドの `options` も `validation` も届かない。

影響: 見出しレベルも使用可能なブロックも配置できない。保存時の拒否で制限した（`cms/src/plugins/portable-text-policy/`）。ツールバーからは消えないため、編集者は使えてしまい保存時に止まる。

---

## 権限と認証

### F-06 ロールは 5 段階固定で、定義を編集できない

典拠: `source` / 確度: 暫定

`SUBSCRIBER: 10` / `CONTRIBUTOR: 20` / `AUTHOR: 30` / `EDITOR: 40` / `ADMIN: 50`。権限の対応は `rbac.ts` の静的マップ。新しいロールの作成も既存ロールの権限変更も、UI も API も存在しない。

影響: 「全員の記事を編集できるが削除できない」が表現できず（`content:edit_any` と `content:delete_any` がともに EDITOR）、一般メンバーの削除禁止は middleware で実装している。2-4 の前提。

### F-07 空の DB で Discord ログインを先に行うと Admin を作れなくなる

典拠: `observed` + `source` / 確度: 確定

プロバイダは `/_emdash/api/auth/discord/` を `publicRoutes` として公開し、セットアップゲートは `/_emdash/api/setup/` のみを守っていた。先に Discord でログインすると Editor が 1 人作られ、以降 `POST /_emdash/api/setup/admin` は `userCount > 0` により `ADMIN_EXISTS` で拒否される。`users:manage` は ADMIN 限定なので昇格させる主体が存在せず、復旧は DB の直接編集のみ。

影響: 外部 ID プロバイダがユーザーを自動生成する構成に固有の罠。`guard.ts` に「セットアップ完了までは Discord ログインも閉じる」判定を追加して塞いだ（D17）。2-9 の範囲。

### F-08 生 HTML と iframe が Editor 全員に開いている

典拠: `source` + `observed` / 確度: 確定

リッチテキストの `HtmlBlockExtension` / `IframeBlockExtension` は Editor が使える。Discord メンバー全員が Editor である本構成では、任意の HTML と iframe を公開コンテンツに入れられる。

影響: 項目 5 の「認証済みユーザーの権限範囲」の論点（5-1 は未認証ルートのみを扱う）。`portable-text-policy` で `htmlBlock` / `iframe` を不許可にして塞いだ。`site/` が Portable Text をどう描くかにも依存するため、5-2 と併せて確認が必要。

### F-09 メディアの寸法はクライアント申告

典拠: `docs` / 確度: 確定

`POST /media` のマルチパートは `width` / `height` を受け取り、ドキュメントは "The `width` and `height` values come from the client. The docs don't say EmDash reads dimensions from the file itself" と述べる。

影響: `image-dimensions` の寸法判定は、API を直接叩く相手に対しては偽装可能。誤操作に対する防御であり、意図的な回避に対する防御ではない。

### F-10 アップロード形式の制限はフィールド単位のみ

典拠: `docs` / 確度: 確定

`image` / `file` フィールドの `allowedMimeTypes` は保存時に検査される。直接アップロードで `fieldId` を送ればアップロード時にも適用される。しかしメディアライブラリからのアップロードはフィールド文脈を持たず、EmDash の既定許可リスト（image / video / audio / PDF）に落ちる。この既定リストを変える設定は存在しない。ロールでも区別できない（同一エンドポイント・同一 `media:upload` 権限）。

影響: 「保存される画像をすべて WebP に」はフィールド単位では担保できない。`media:beforeUpload` フックで全経路を塞いだ（D16）。

---

## プラグインの仕組み

### F-11 プラグインはスキーマを所有できない

典拠: `docs` / 確度: 確定

スキーマ関連の capability は `schema:read` のみ（`ctx.schema.listCollections()` / `getCollection()`）。書き込み系は存在せず、install / activate でコンテンツモデルを用意する仕組みもない。manifest の宣言可能キーにもコンテンツモデル系がない。移植ガイドは投稿タイプやフィールドの定義が主目的のプラグインについて "create an EmDash collection and seed file instead of a plugin" と指示する。

影響: 「管理画面をプラグインが作るなら、そのプラグインがスキーマを持つべき」は EmDash の設計と逆。**スキーマは seed、UI はプラグイン**が想定された分担。本サンドボックスの各プラグインは、方針を seed の `options` に宣言し `schema:read` で読む形にした。

### F-12 プラグインの UI は Kumo で組む

典拠: `docs` / 確度: 確定

native プラグインの peer dependencies は `react` / `@lingui/core` / `@lingui/react` / `@cloudflare/kumo` / `@tanstack/react-query` / `@emdash-cms/admin` / `emdash` / `astro`。react-admin のガイドは "Use Kumo for controls and `apiFetch()` for plugin API requests" と述べ、`@emdash-cms/admin` からの import 例は**型のみ**。ホストは navigation / routing / dashboard cards / editor layout / content tables / authentication / error boundaries を保持する。

影響: コントロール類は入手できるが、**メディアピッカーのような複合 UI は文書化された入手元がない**。`MediaPickerModal` / `MediaLibrary` / `uploadMedia` は `@emdash-cms/admin` から export されているが、ドキュメントに記載がなく、依存すれば未文書依存になる。この制約が「画像フィールドを含む画面は標準エディタを使う」判断を決めた（D15）。

### F-13 native と standard で admin surface の宣言場所が違う

典拠: `docs` + `observed` / 確度: 確定

ディスクリプタの `adminPages` が読まれるのは `format: "standard"` と sandboxed のみ。native（既定）は `createPlugin()` を呼ぶだけでメタデータが渡らないため、マニフェストに載るのは `definePlugin({ admin: { pages } })` の内容。サイドバーはマニフェストから構築され、ページの描画は `pluginAdmins[id].pages` をクライアント側で直接引く。

**片方だけ宣言すると、URL では開けるのに導線だけが消える。** サイドバー構築側は条件を満たさない項目を `continue` で飛ばし、エラーを出さない。

影響: 実際にこの状態を踏んだ。型はどちらも通る。D6（更新時の差分確認）に「プラグインのページがサイドバーに出ているか」を含める根拠。

### F-14 エディタパネルは Block Kit 専用

典拠: `source` / 確度: 暫定

サイドバーのパネル構築は `plugin.adminMode !== "blocks"` を満たさないプラグインを飛ばし、`PluginEditorPanel` は `route` を必須とする。Block Kit の語彙にファイル入力も canvas もない。加えてドキュメントは「パネルは未保存の新規エントリには出ない」と述べる。

影響: 「エントリ編集画面の aside に変換パネルを置く」案は実装不可。独立した管理ページに切り替えた（D16）。

### F-15 ブロックタイプに作成 UI がない

典拠: `source` / 確度: 暫定

コンテンツタイプ画面に `BlockTypeList`（"Database-owned definitions available to blocks fields."）があるが、props はデータと読み込み状態のみで作成コールバックを持たない。API 呼び出しも `fetchBlockTypes()`（GET）のみ。削除・並び替え・orphan 登録はある。

影響: `blocks` 型を使うなら `seed.blockTypes` か `POST /_emdash/api/schema/block-types`（`schema:manage`）で定義する。

### F-16 "widget" が 3 つの別物を指す

典拠: `source` / 確度: 確定

| 呼称 | 実体 |
|---|---|
| ウィジェット | WordPress 由来のサイト部品（`_emdash_widgets` / `/admin/widgets` / `getWidgetArea()`） |
| ダッシュボードウィジェット | 管理画面トップのカード（`admin.widgets`） |
| フィールドウィジェット | スキーマ 1 フィールドの編集 UI（`field.widget` / `PluginAdminExports.fields`） |

`PluginAdminExports` は 1 つの型の中で `widgets`（ダッシュボード）と `fields`（フィールド編集 UI）を併置する。

影響: 無効化対象は 1 番目のみ。運用ドキュメントを書くときに取り違えやすい。

### F-17 フィールドの編集 UI は置き換えのみで、包めない

典拠: `docs` + `source` / 確度: 確定

`field.widget` が設定されていると標準エディタの `switch` の手前で分岐し、解決できなければ "Falling back to default editor." と警告して標準に落ちる。部分的に差し込む拡張点はない。カスタム**型**は作れない（`field.kind === "unsupported"` の分岐に落ちる）一方、既存型の編集 UI は差し替えられる。

影響: 画像フィールドの UI を差し替えると alt / ライブラリ選択 / ダークモード枠をすべて自作することになる。F-12 と併せて、標準エディタを使う判断の根拠。

---

## 型生成とツール

### F-18 型生成器が slug `s` で壊れる

典拠: `source` + `measured` / 確度: 確定

`getInterfaceName()` は `pascalCase(singularize(slug))` で型名を作る。`singularize("s")` は空文字を返すため、`export interface  {` と `s: ;` を含む構文エラーの `emdash-env.d.ts` が生成され、型チェックが 7 件のエラーで停止する。docstring は "Slugs are constrained to `/^[a-z][a-z0-9_]*$/`, so PascalCasing one always yields a valid TS identifier" と主張するが、単数化という別経路で前提が崩れている。`uniqueInterfaceNames` は衝突を扱うが空文字を扱わない。

影響: ランタイムには影響しない（型宣言のみ）。ただし `.d.ts` が壊れるため**他の型エラーを一切検出できなくなる**。EmDash のビルドは型検査をしないので、型チェッカを入れるまで気づけない。回避は slug を単数化で空にならないものにすること。

### F-19 `pnpm.overrides` が pnpm 10.28 で無視される

典拠: `observed` / 確度: 確定

起動時に `The "pnpm" field in package.json is no longer read by pnpm. The following keys were ignored: "pnpm.overrides"` が出る。zod の override は `pnpm-lock.yaml` に記録済みだったために効いていただけで、**ロックファイルを再生成すれば静かに失われる**状態だった。宣言は機能していないのに機能しているように見える。

影響: `pnpm-workspace.yaml` へ移設した（D10 の前提の訂正）。5-6 / D10。

### F-20 Portable Text の `_type` はツールバーのラベルと一致しない

典拠: `source` + `measured` / 確度: 確定

保存される値の `_type` は `block` / `image` / `gallery` / **`code`** / **`htmlBlock`** / `iframe` / `video` / `table`。ツールバーのラベルから推測した `codeBlock` / `html` は**実際のキーではない**。

影響: 推測で許可リストを書くと、コードブロックと生 HTML が素通りする。実際に一度その状態になった。`portable-text-policy` は全キーを列挙するカタログを持ち、未知のキーを拒否する形にして、この種の取りこぼしを構造的に防いでいる。

### F-21 `astro dev` の起動状態が残り、次回起動を拒否する

典拠: `observed` / 確度: 確定

`pkill` でプロセスを落とすと、astro が保持する起動情報（PID）が残り、次の `astro dev` が "Another astro dev server is already running." で拒否される。`astro dev stop` か `--force` が必要。

影響: 検証作業で繰り返し踏む。本番は `pnpm start`（`dist/server/entry.mjs` を直接 node で起動）なのでこの状態管理は介在しない。

### F-22 sharp が既に依存に含まれ、ロードされている

典拠: `measured` / 確度: 確定

`sharp@0.35.5` と libvips が推移的依存として入っており、`/_image`（Astro の画像サービス）が使われた時点でプロセスにロードされる。ロード自体で RSS が +32.7 MiB。

影響: 画像処理のライブラリを「追加する」コストは既に項目 4 の計測に含まれている。サーバー変換を検討する場合の増分は変換 1 回あたりの作業メモリのみ（F-23）。

---

## 計測値

### F-23 サーバー側での PNG → WebP 変換のメモリ

典拠: `measured` / 確度: 確定

sharp（libvips）で変換したときのピーク RSS 増分:

| 入力 | ピーク増分 | 変換後 RSS |
|---|---|---|
| 800×800 | +16.1 MiB | 126.8 MiB |
| 1600×900 | +36.6 MiB | 157.4 MiB |
| **4000×3000** | **+236.1 MiB** | **407.2 MiB** |

入力サイズに比例する。要件の画像は 4K（VRChat のスクリーンショット）なので、サーバー変換は 1 件で +236 MiB、同時 2 件で +470 MiB。項目 4 の合格基準（4-2: ピーク 350MB 未満）を単独で超える。

影響: **変換はサーバーで行えない。** ブラウザで変換する構成を選んだ（D16）。なお寸法違反の画像ほど大きいため、拒否するためにもっともメモリを使うという逆転が起きる。

### F-24 4K WebP の出力サイズと変換時間

典拠: `measured` / 確度: 暫定（合成画像）

3840×2160 の合成画像（グラデーション + テキスト）での測定:

| 設定 | 出力 | 時間 |
|---|---|---|
| lossy q80 | 0.05 MiB | 291 ms |
| lossy q92 | 0.08 MiB | 320 ms |
| lossy q100 | 0.11 MiB | 320 ms |
| lossless | 0.10 MiB | 1588 ms |

合成画像が滑らかすぎて圧縮されすぎており、**実物の代表値ではない**。ノイズ画像（4000×3000）では WebP 9.1 MiB だったため、実際のスクリーンショットはこの 0.1〜9 MiB の間に入る。

影響: 容量の見積もりには実物での再計測が必要。時間については可逆が約 5 倍遅い点が判断材料になる（ブラウザでは更に遅くなる）。

### F-25 Discord の OAuth は PKCE を受け付ける

典拠: `observed` / 確度: 確定

実 Discord に対して `code_challenge_method=S256` を含む認可リクエストが成立し、ログインが完了した。scope は `identify email guilds.members.read`。

影響: `providers/discord/README.md` が挙げていた未確認事項の 1 つが解消。`DISCORD_PKCE=off` は不要。`guilds.members.read` を OAuth スコープで取るため、**ログイン時のロール判定に Bot は不要**（Bot が必要なのはログイン中セッションの定期再確認のみ）。2-1 / 2-3。

---

### F-26 メディアのフックは拒否の理由を伝えられない

典拠: source（`plugins/hooks.ts` `runMediaBeforeUpload`、`astro/routes/api/media.ts`） / 確度: 確定（実機で確認）

`media:beforeUpload` から投げた例外はアップロードを中断する（`errorPolicy` の既定は `"abort"`）が、
ルートが `handleError(error, "Upload failed", "UPLOAD_ERROR")` で包むため、**メッセージが失われ 500 になる**。

コンテンツ側には `ContentSaveRejectedError` があり、投げると `422 SAVE_REJECTED` とメッセージが編集者まで届く。
**メディア側に相当する型が存在しない**（EmDash が持つのは `ContentSaveRejectedError` と `SandboxSaveRejectedError` だけ）。

プラグインだけでアップロード制限を作ると、編集者には「Upload failed」しか出ない。
対策として `middlewares/webp-upload-message/` がルートの手前で同じ規則を適用し、400 とメッセージを返している。

### F-27 アップロードの許可形式は経路によって別の仕組みが見る

典拠: source（`api/handlers/media-allowlist.ts`、`astro/routes/api/media.ts`） / 確度: 確定（実機で確認）

EmDash は許可リストを `fieldAllowlist ?? GLOBAL_UPLOAD_ALLOWLIST` で解決し、
**フォームに `fieldId` が入っているときだけ**フィールドの `allowedMimeTypes` を使う。

| 経路 | 使われる許可リスト |
|---|---|
| エントリ編集画面のフィールドから | そのフィールドの `allowedMimeTypes`（seed で宣言できる） |
| メディアページから | `GLOBAL_UPLOAD_ALLOWLIST` |

`GLOBAL_UPLOAD_ALLOWLIST` は png・jpeg・gif・webp・avif・jxl・video/・audio/・pdf を含む**ハードコードの定数**で、
設定でも env でも変えられない。SVG が既定で外れているのは意図的（アップロード時の内容検査が無いため）。

したがって **seed の `allowedMimeTypes` だけではメディアページ経由を塞げない**。

### F-28 EmDash 1.3.1 のビルド成果物に `setInterval` が無い

典拠: source（`node_modules/emdash/dist/` 全体の走査） / 確度: 確定

周期的な `setTimeout` も見つからない。予約投稿はクエリ時に可視になる方式で（公開時刻を過ぎても書き込みイベントは発火しない）、
`deferred-tasks.ts` もリクエスト後に走る仕組みである。

つまり**真に待機中はプロセス内で動くものが無い**。2 つの帰結がある。

- 要件 4-6 が想定した「スケジューラによる増加」は 1.3.1 では成立しない。それでも 0.13 MiB/時 の増加は観測された（原因未特定）。
- **定期再起動が何も取りこぼさない。** cron 方式のスケジューラを持つ CMS なら再起動が発火ウィンドウを跨ぐと予約投稿を落とすが、その危険がない。

## 更新時に見る場所

これらの所見のうち、EmDash の更新で壊れうるものと、その検出手段。D6 の具体化。

| 確認対象 | 手段 | 壊れたときの兆候 |
|---|---|---|
| 型生成（F-18） | `pnpm check` | 型チェックが停止する |
| 無効化した API のパス（F-10 他） | `verify/item5-security.mjs` | 静かに通るようになる |
| サイドバーの導線（F-13） | 目視 | 項目が戻る／消える |
| Portable Text のキー（F-20） | `portable-text-policy` が未知キーを拒否 | 保存時にメッセージが出る |
| プラグインが import するホストの型（F-12） | `pnpm check` | 型エラー |
| 装飾キーのカタログ（F-05 / F-20） | 同上 + 未知キーの拒否 | 新しい装飾が拒否される |
| メディアのエラー型（F-26） | `verify/item6-content-constraints.mjs` の 6-3b | 相当する型が入れば中間層を外せる |
| 許可形式の解決順（F-27） | 同上 6-3a / 6-3c | どちらかの経路が通るようになる |
| 周期実行の不在（F-28） | `grep -r setInterval node_modules/emdash/dist/` | 再起動が予約投稿を落としうる状態になる |

F-20 の仕組みは、更新で増えた装飾を**黙って許可せず、メッセージとして出す**。他の所見にも同種の作りを広げる価値がある。
