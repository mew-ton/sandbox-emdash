# @sandbox/emdash-auth-discord

EmDash 1.3.1 用の Discord ログインプロバイダと、Discord 以外のログイン経路を閉じるサーバー側ガード。

- `src/index.ts` — `AuthProviderDescriptor`（`discord()`）。ビルド時に直列化されるので secret や ID は持たない
- `src/routes/login.ts` / `callback.ts` — Authorization Code + PKCE。callback で対象サーバーの在籍とロールを確認し、EmDash のロールを毎回上書きする
- `src/guard.ts` — プロジェクトの `src/middleware.ts` から使う middleware。セットアップの施錠、他経路の封鎖、ログイン中セッションの再確認、一般メンバーの削除禁止
- `mock/server.mjs` — 自動検証用のモック Discord（実 Discord の代わりに使う）

## ロールの対応

| Discord | EmDash ロール | 追加の制限（guard） |
|---|---|---|
| `DISCORD_LEADER_ROLE_IDS` のいずれか | Editor (40) | なし（削除はゴミ箱まで。完全削除は Admin） |
| `DISCORD_MEMBER_ROLE_IDS` のいずれか | Editor (40) | `DELETE` を拒否（ロック解除と予約解除を除く） |
| どちらも無い／未在籍 | ログイン不可 | — |
| （運営） | Admin (50) | Discord からは付与しない。passkey でログイン |

EmDash には「全員の記事を編集できるが削除できない」ロールが無い（`content:edit_any` と `content:delete_any` がともに Editor 以上）ため、一般メンバーも Editor にし、削除だけ guard で止めている。

## 手元で実 Discord を使って試す

本番デプロイは不要。`localhost` で動く。

1. https://discord.com/developers/applications でテスト用アプリを作る
   - OAuth2 → Redirects に `http://localhost:4321/_emdash/api/auth/discord/callback` を追加
   - Client ID と Client Secret を控える
2. テスト用 Discord サーバーで、開発者モードを有効にしてサーバー ID とロール ID（一般・リーダー）をコピーする
3. （任意）ログイン中セッションの再確認を試すなら、同じアプリに Bot を作ってテスト用サーバーへ招待し、Bot Token を控える
4. `cms/.env.example` を `cms/.env` にコピーして値を入れる（`DISCORD_API_BASE` / `DISCORD_AUTHORIZE_URL` は空のまま）
   - `EMDASH_ENCRYPTION_KEY` は `cd cms && pnpm emdash secrets generate`
   - `EMDASH_SETUP_TOKEN` は任意の長い文字列
5. 起動

   ```sh
   cd cms
   pnpm install
   pnpm build
   pnpm start            # .env を読み込んで http://localhost:4321 で待ち受ける
   ```

6. `http://localhost:4321/_emdash/admin/setup?setup_token=<EMDASH_SETUP_TOKEN>` を開き、運営アカウントを passkey で作る
   （passkey は `localhost` なら HTTPS なしで動く）
7. ログアウトし、ログイン画面の「Discord」から入る。テスト用サーバーのロールを付け替えたり、サーバーから抜けたりして挙動を確かめる

実 Discord での確認はこのサンドボックスでは行っていない（外部サービスへの接続を伴うため、自動検証はモックで行った）。
実 Discord で次の点が想定と違ったら、その事実を `reports/02-discord-auth.md` に追記する。

- PKCE（`code_challenge` / `code_verifier`）を受け付けるか。受け付けない場合は `DISCORD_PKCE=off` で切れる
- Bot で `GET /guilds/{guild}/members/{user}` を呼ぶときに特権 Intent が要らないか

## モックで試す

```sh
node providers/discord/mock/server.mjs                     # http://127.0.0.1:4400
MOCK_DISCORD_FIXTURE=providers/discord/mock/users.example.json node providers/discord/mock/server.mjs
```

`cms/.env` で `DISCORD_API_BASE=http://127.0.0.1:4400/api/v10`、`DISCORD_AUTHORIZE_URL=http://127.0.0.1:4400/oauth2/authorize`、
クライアント ID などを `mock-client-id` / `mock-client-secret` / サーバー ID `100000000000000001` /
ロール ID `300000000000000001`（一般）・`300000000000000002`（リーダー）/ Bot Token `mock-bot-token` にすると、
ブラウザでモックのユーザー選択画面からログインできる。`/_mock/users/<id>` に PUT して在籍やロールを変えられる。

## 環境変数

| 変数 | 既定 | 意味 |
|---|---|---|
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | — | OAuth2 アプリ |
| `DISCORD_GUILD_ID` | — | 在籍を必須とするサーバー |
| `DISCORD_LEADER_ROLE_IDS` / `DISCORD_MEMBER_ROLE_IDS` | — | カンマ区切りのロール ID |
| `DISCORD_BOT_TOKEN` | なし | 設定するとログイン中セッションを定期的に再確認する |
| `DISCORD_REVALIDATE_SECONDS` | 600 | 再確認の間隔（セッションごと） |
| `DISCORD_SESSION_MAX_AGE_SECONDS` | 43200 | Discord 経由セッションの上限 |
| `DISCORD_PKCE` | on | `off` で PKCE を使わない |
| `DISCORD_API_BASE` / `DISCORD_AUTHORIZE_URL` | discord.com | モックへの差し替え |
| `EMDASH_SETUP_TOKEN` | なし | 未設定だとセットアップ API が常に拒否される |
| `EMDASH_COLD_STANDBY` | off | `on` で magic link ログインを開く（再起動で反映） |
| `EMDASH_ALLOW_INVITES` | off | `on` で招待の受諾を開く（運営の追加時だけ） |
