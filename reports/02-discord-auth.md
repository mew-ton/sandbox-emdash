# 項目 2. Discord 認証プロバイダとロールの同期

対象: emdash 1.3.1 / `providers/discord`（プロバイダ）/ `cms/src/middleware.ts`（ガードの組み込み）。
検証: `verify/item2-discord.mjs`（ローカルの `cms/dist` とモック Discord。機械出力は [`generated/02-discord-auth.md`](generated/02-discord-auth.md)）。
実 Discord での確認はしていない。手元での確認手順は [`providers/discord/README.md`](../providers/discord/README.md)。

## 結論

§0-2 の不変条件 1〜6 は、プロバイダとガード middleware を合わせればすべて満たせた（全チェック合格）。
ただし、満たすために EmDash の内部に属する事柄へいくつか依存している（後述「依存した拡張点」）。
認証の不変条件を緩める必要は生じていない。

## 結果

要件の原文は [`docs/requirements.md`](../docs/requirements.md) の「項目 2」と「§0-2 認証の不変条件」「§0-3 権限モデル」。

| # | 検証内容（要件） | 合格基準（要件） | 結果 | 何が起きたか |
|---|---|---|---|---|
| 2-1 | Discord OAuth（Authorization Code + PKCE）の login / callback ルートを実装する | 必要最小の scope（ユーザー識別・対象サーバーのメンバー情報・email）でログインが完了する | 合格 | scope は `identify email guilds.members.read` の 3 つ。PKCE は S256。state が一致しないコールバックは拒否 |
| 2-2 | callback で対象サーバーへの在籍を確認する | 未在籍のアカウントはユーザーレコードの有無にかかわらず拒否される。初回の在籍者はユーザーが自動作成される | 合格 | 未在籍は拒否し、ユーザーも作らない。既にユーザーがいても、脱退後は拒否。初回の在籍者は自動作成 |
| 2-3 | ログインのたびに Discord ロールを EmDash ロールへ対応させて上書きする | 降格・昇格が次回ログインで反映される。ロールを更新できる公開 API があるか、なければ何に依存したかを記録する | 合格 | 昇格・降格が次回ログインで反映された。ロール更新専用の公開 API は無く、`@emdash-cms/auth` の DB アダプタに EmDash 内部の DB ハンドルを渡して更新している（下の「依存した拡張点」） |
| 2-4 | §0-3 の権限モデルを EmDash のロールへ対応させる | 一般メンバーが他メンバーのコンテンツを編集でき、削除できない。リーダーは削除できる。API 直叩きでも同じ | 合格 | EmDash に該当するロールが無いため、一般メンバーもリーダーも Editor にし、一般メンバーの削除だけを middleware で拒否。API 直叩きで、一般メンバーは他人の記事の編集 200・削除 403、リーダーは削除 200 |
| 2-5 | Discord を経由しないログイン経路を塞ぐ | 一般メンバー・リーダーが passkey 登録・magic link・招待でログインできないか、その経路でも在籍確認が走る。設定で塞げない場合はどの拡張点で塞いだか記録する | 合格 | EmDash の設定では塞げなかった（passkey と magic link は常に有効）。プロジェクトの middleware で、passkey 登録・passkey ログイン・magic link・招待・セルフサインアップ・組み込み OAuth・トークン発行を Admin 以外に対して拒否した |
| 2-6 | 脱退・降格した利用者のセッションを無効化する | 脱退後、既存セッションでの操作が一定時間内に拒否される。方式と Discord API 呼び出し量・rate limit を記録する | 合格 | Bot トークンがあれば、ログイン中のセッションを一定間隔（既定 600 秒）で Discord に再確認し、脱退なら拒否、降格なら即時に権限を下げる。Bot が無くてもセッションは上限（既定 12 時間）で切れる。呼び出し量は下の「ログイン中セッションの扱い」 |
| 2-7 | cold-standby 経路（magic link）を用意する | env var の切替と再起動で有効化・無効化できる。無効時はサーバー側で拒否される。メール送信プラグインの保守状況を記録する | 合格 | `EMDASH_COLD_STANDBY=on` と再起動で magic link が使え、`off` と再起動で拒否され、その経路のセッションも切れる。メール送信プラグインは公式が無く、非公式は各 1 名メンテナ |
| 2-8 | 運営の独立経路 | Admin が passkey でログインでき、Discord の OAuth が停止しても admin に到達できる。一般利用者の passkey を塞いでも Admin の passkey は使える | 合格 | Discord（モック）を止めた状態で、運営が passkey でログインでき、passkey の追加登録もできた |
| 2-9 | 初回セットアップの乗っ取り対策 | セットアップ完了前の公開 URL で、第三者が最初の Admin になれない手順・設定がある | 合格 | EmDash 本体には保護が無い（最初に来た人が Admin になれる）。`EMDASH_SETUP_TOKEN` を知らない要求を middleware で拒否し、Discord からも最初の Admin を作れないようにした |

**不合格時の扱い（要件）**: 2-2 / 2-3 / 2-5 / 2-6 が満たせない場合は不変条件を緩めるかを意思決定事項として列挙する。→ 該当なし。

検証スクリプトの機械出力（generated/）では、ひとつの # を複数の確認に分けて `2-9a`、`2-9b` のように枝番で示している。枝番はすべて同じ番号の要件に属する。

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
