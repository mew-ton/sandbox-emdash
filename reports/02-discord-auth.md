# 項目 2. Discord 認証プロバイダとロールの同期

対象: emdash 1.3.1 / `providers/discord`（プロバイダ）/ `cms/src/middleware.ts`（ガードの組み込み）。
検証: `verify/item2-discord.mjs`（ローカルの `cms/dist` とモック Discord。機械出力は [`generated/02-discord-auth.md`](generated/02-discord-auth.md)）。
実 Discord での確認はしていない。手元での確認手順は [`providers/discord/README.md`](../providers/discord/README.md)。

## 結論

§0-2 の不変条件 1〜6 は、プロバイダとガード middleware を合わせればすべて満たせた（全チェック合格）。
ただし、満たすために EmDash の内部に属する事柄へいくつか依存している（後述「依存した拡張点」）。
認証の不変条件を緩める必要は生じていない。

## 結果

| # | 結果 | 要点 |
|---|---|---|
| 2-1 | 合格 | Authorization Code + PKCE(S256)。scope は `identify email guilds.members.read`。state 不一致は拒否 |
| 2-2 | 合格 | 未在籍は拒否しユーザーを作らない。既存ユーザーでも脱退後は拒否。初回在籍者は自動作成 |
| 2-3 | 合格 | ログインのたびに Discord ロールから EmDash ロールを決めて上書き。昇格・降格は次回ログインで反映 |
| 2-4 | 合格 | 一般メンバー: 他人の記事も編集可・削除不可（自分の記事も不可）。リーダー: 削除可。API 直叩きで確認 |
| 2-5 | 合格 | 一般メンバー・リーダーは passkey 登録、passkey ログイン、magic link、招待、セルフサインアップ、組み込み OAuth、トークン発行を使えない。middleware で塞いだ |
| 2-6 | 合格 | Bot トークンありなら `DISCORD_REVALIDATE_SECONDS`（既定 600 秒）以内に脱退・降格がログイン中セッションへ反映。Bot なしでも `DISCORD_SESSION_MAX_AGE_SECONDS`（既定 12 時間）で失効 |
| 2-7 | 合格 | `EMDASH_COLD_STANDBY=on` と再起動で magic link が開き、`off` と再起動で閉じる。閉じるとその経路のセッションも失効 |
| 2-8 | 合格 | Discord に到達できない状態で運営が passkey でログインできる。一般利用者の passkey を塞いでも運営の passkey 登録・ログインは使える |
| 2-9 | 合格 | EmDash 本体にはセットアップ保護が無い。`EMDASH_SETUP_TOKEN` を持たない要求をガードで拒否し、Discord からは最初の Admin を作れないようにした |

## 実装の要点

### ロールの対応（2-4）

| 主体 | EmDash ロール | 追加制限 |
|---|---|---|
| 未認証 | — | API はすべて 401 |
| 一般メンバー | Editor (40) | ガードが `DELETE` を 403 にする（ロック解除と予約解除を除く） |
| リーダー | Editor (40) | なし。削除はゴミ箱まで（完全削除は Admin 権限） |
| 運営 | Admin (50) | Discord からは付与しない。passkey でログイン |

EmDash の権限表（`@emdash-cms/auth` の `Permissions`）では `content:edit_any` と `content:delete_any` がともに Editor 以上で、
「他人の記事を編集できるが削除できない」ロールが存在しない。Author にすると他人の記事を編集できない。
そのため一般メンバーも Editor にし、削除だけをガードで止めた。

この方式の副作用:

- Editor はタクソノミー・メニュー・ウィジェット・セクションの管理権限も持つ。これらの削除（`DELETE`）はガードで止まるが、作成・更新はできる
- Editor は他人の記事の公開・非公開化もできる（`content:publish_any`）
- 管理画面には削除ボタンが表示されたままで、押すと 403 になる（UI の出し分けはしていない）

### 他経路の封鎖（2-5）

EmDash は passkey と magic link を設定で無効にできない（`authProviders` は追加のみ）。
組み込みルートは `/_emdash/api/auth/...` に注入されるので、プロジェクトの `src/middleware.ts`（EmDash の middleware の後に走る）で次を拒否した。

| 経路 | 扱い |
|---|---|
| `/_emdash/api/auth/passkey/register/*` | Admin 以外は 403 |
| `/_emdash/api/auth/passkey/verify`（ログイン） | 応答後にセッションのユーザーを確認し、Admin 以外ならセッションを破棄して 401 |
| `/_emdash/api/auth/magic-link/*` | `EMDASH_COLD_STANDBY=on` のときだけ通す |
| `/_emdash/api/auth/invite/accept` ほか受諾系 | `EMDASH_ALLOW_INVITES=on` のときだけ通す（運営を追加するときだけ開く） |
| `/_emdash/api/auth/signup/*`、`/_emdash/api/auth/oauth/*`、dev-bypass | 常に 403 |
| `/_emdash/api/auth/handover`、`/_emdash/api/oauth/device/authorize`、`/_emdash/oauth/authorize` | Admin 以外は 403（ログイン中のメンバーが自分用のトークンや別経路のリンクを作れないようにする） |

ログイン画面には passkey と「メールでログイン」のボタンが出たままになる。押してもサーバーが拒否する。

### ログイン中セッションの扱い（2-6）

Discord 経由のセッションには発行時刻と最終確認時刻を Astro セッションに持たせ、Admin 以外のセッション認証の要求ごとにガードが確認する。

- 発行から `DISCORD_SESSION_MAX_AGE_SECONDS` を過ぎたら破棄して 401
- `DISCORD_BOT_TOKEN` があり、最終確認から `DISCORD_REVALIDATE_SECONDS` を過ぎていたら、Bot で `GET /guilds/{guild}/members/{user}` を呼ぶ。
  未在籍・対象ロールなしなら破棄して 401、ロールが変わっていれば EmDash ロールと削除可否を即時に更新する
- Discord API に到達できないときはセッションを維持する（上限時刻までは使える）
- Discord 経由でないセッション（cold-standby の magic link）は、cold-standby が `on` の間だけ有効

Discord API の呼び出し量: ログイン 1 回につき 3 回（token、`users/@me`、`users/@me/guilds/{guild}/member`）。
再確認はアクティブなセッション 1 つにつき間隔あたり最大 1 回。検証では間隔 2 秒で 20 要求を連続して送り、Bot 呼び出しは 0 回、
間隔経過後の要求で 1 回だった。既定 600 秒で同時編集者 30 人なら毎分 3 回程度。
Discord の公表している上限（Bot あたり毎秒 50 要求のグローバル上限）に対して十分小さい。ルートごとの上限値は応答ヘッダで示される方式で、ここでは測っていない。

### cold-standby（2-7）

EmDash にはパスワードログインが無いので magic link を使う。magic link はメール送信手段（`email:deliver` を提供するプラグイン）が必要。

| プラグイン | 公式か | メンテナ | 最終公開 |
|---|---|---|---|
| `emdash-smtp`（+ `emdash-smtp-core`） | 非公式 | 1 名（masonjames） | 2026-09-30 |
| `emdash-plugin-resend` | 非公式 | 1 名（maikunari） | 2026-04-16 |
| 公式（`@emdash-cms/*`）のメール送信プラグイン | 見当たらない | — | — |

サンドボックスでは、メールをファイルに書き出すだけの検証用プラグイン（`cms/src/plugins/email-outbox.ts`）を使った。

観察した事実:

- 送信手段のプラグインを入れて送信先を未設定にすると、招待の作成が 500（`INVITE_CREATE_ERROR`）になる。送信手段が無いときは招待 URL を応答に返す動作に切り替わるが、プラグインがあると送信を試みて失敗する
- cold-standby 用に集めた email は EmDash のユーザーレコードの `email` になる。検証で確認した、EmDash 側でこの email が現れる場面: magic link の宛先、管理画面のユーザー一覧（Admin のみ）、サイトエクスポートの著者情報（インポート解析結果の `principals` に email が入る）。§0-2-4 の「その用途以外に使わない」は、運用（エクスポートパッケージの扱いなど）で守る必要がある

### 運営の独立経路（2-8）

運営は passkey（WebAuthn、ユーザー検証あり）でログインする。所持（認証器）と生体・PIN の 2 要素で、MFA 相当。
検証は Chromium の仮想認証器で行った。Discord（モック）を停止した状態でも、運営は passkey でログインでき、追加の passkey も登録できた。

運営を増やすときは `EMDASH_ALLOW_INVITES=on` で再起動し、Admin として招待し、受諾後に `off` に戻す。

### セットアップの乗っ取り対策（2-9）

EmDash 1.3.1 はセットアップ完了前、`/_emdash/admin/setup` に到達した最初の人を Admin にする。
さらに組み込み OAuth プロバイダ（GitHub / Google / Microsoft）と公式 atproto プロバイダは、セットアップ未完了時に最初にログインした OAuth ユーザーを Admin にする。

対策として:

- ガードが `/_emdash/api/setup/*` を `EMDASH_SETUP_TOKEN` の一致（`?setup_token=` で一度渡すと Cookie に保持）を条件に通す。未設定なら常に拒否
- Discord のコールバックはセットアップ未完了なら拒否する（Discord から最初の Admin は作れない）
- セットアップ完了後は EmDash 自身がセットアップ API を拒否する

運用での追加策: 公開 URL を開ける前に VPS 内（`127.0.0.1` で待ち受け + SSH トンネル）でセットアップを済ませる。

## 依存した拡張点・内部 API（EmDash の更新で壊れうる箇所）

| 依存先 | 公開か | 壊れたときの影響 |
|---|---|---|
| `AuthProviderDescriptor`（`routes` / `publicRoutes` / `storage` / `adminEntry`） | 公開 | ログインボタン・ルートが消える |
| `emdash/api/route-utils`（`getAuthProviderStorage` / `getPublicOrigin` / `OptionsRepository`） | 公開（プロバイダ向け） | 同上 |
| `@emdash-cms/auth/adapters/kysely` の `createKyselyAdapter(locals.emdash.db)` によるユーザー作成・ロール更新（2-3） | パッケージの公開 export だが、EmDash 内部の DB ハンドルを型キャストして渡す（公式 atproto プロバイダと同じ使い方）。ロール更新専用の公開 API は無い | ロール同期が止まる |
| Astro セッションの `user` キー（`{ id }`）にログイン中ユーザーを置く約束 | 非公開（組み込みルートの慣習） | ログインが成立しない |
| `locals.user` / `locals.emdash`（`emdash/locals` の型） | 公開 | ガードが働かない |
| `locals.tokenScopes`（トークン認証かどうか） | 非公開（型に無い） | トークン経由の要求を誤って再確認する |
| プロジェクトの `src/middleware.ts` が EmDash の middleware（`order: "pre"`）の後に走ること | Astro の仕様 | ガードが `locals.user` を読めない |
| 塞ぐべき組み込みルートのパス一覧（passkey / magic-link / invite / signup / oauth / handover / device flow） | 非公開（注入ルートのパス） | **新しいログイン経路が追加されると、ガードが知らないまま開く**。更新のたびに `routes.ts` の差分を確認する必要がある |
| `_plugin_storage` の `auth:discord` 名前空間（メンバー区分と最終確認時刻） | 公開（`storage` 宣言） | 削除可否の判定ができず、安全側（削除不可）に倒れる |

## 意思決定が要る事項

認証の不変条件を緩める必要は無かった。次は不変条件ではなく運用上の判断として残る。

1. 一般メンバーを Editor にすることで生じる権限（タクソノミー・メニュー等の作成更新、他人の記事の公開・非公開化）を許容するか
2. Discord API に到達できないとき、ログイン中セッションを上限時刻まで維持する（現状）か、拒否するか
3. cold-standby で集める email が、EmDash の機能（エクスポートの著者情報など）に現れることをどう扱うか
4. メール送信プラグインを非公式（各 1 名メンテナ）から選ぶか、自作するか
5. EmDash の更新ごとに、注入ルートの差分（新しいログイン経路が無いか）を確認する運用を受け入れるか
