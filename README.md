# EmDash 採用可否のサンドボックス

コミュニティ CMS の稼働基盤（現行: PocketBase）を EmDash へ置き換えられるかを、コードを書きながら判定するためのリポジトリ。
検証はすべてローカル（Node と、メモリ計測用のローカル Docker）で行う。本番環境へのデプロイはしない。

結果は [`reports/00-summary.md`](reports/00-summary.md) から読む。

## 構成

```
cms/          EmDash 1.3.1 アプリ（Astro + Node adapter + SQLite + ローカルストレージ）。admin と REST API のみ
providers/    Discord 認証プロバイダとサーバー側ガード（providers/discord）、モック Discord
cms-client/   境界パッケージ（REST ラッパー）。site/ へは pnpm pack の tarball でだけ渡す
site/         公開サイト相当（静的出力の Astro）。cms-client 以外に CMS への依存を持たない
bench/        メモリ計測（docker compose・サンプラー・負荷シナリオ・グラフ）
reports/      調査結果
verify/       項目 1〜3 の自動検証スクリプト（ローカルで cms/ を起動して確かめる）
experiments/  項目 3a（getEmDashCollection ラッパー）の実験
```

`cms/` と `site/` の間に workspace リンクや相対 import は無い。
`site/package.json` の依存は `astro` と `cms-client`（`file:./vendor/cms-client-0.1.0.tgz`）だけ。

## バージョン

| | |
|---|---|
| emdash | 1.3.1（2026-10-18 公開、調査開始時点の最新安定版） |
| astro / @astrojs/node / @astrojs/react | 7.4.2 / 11.1.9 / 7.1.1 |
| Node | 24.22.1 |
| pnpm | 10.28.0 |

## 動かし方

前提: Node 24、pnpm 10、（項目 4 のみ）Docker と Playwright の Chromium。

```sh
# CMS
cd cms && pnpm install && pnpm build
cp .env.example .env   # 値を入れる。Discord を実物で試す手順は providers/discord/README.md
pnpm start             # http://localhost:4321/_emdash/admin

# cms-client → site
cd ../cms-client && pnpm install && pnpm pack:site
cd ../site && pnpm install
CMS_URL=http://localhost:4321 CMS_TOKEN=<読み取り用トークン> pnpm build
```

読み取り用トークンの作り方（Subscriber のサービスアカウントが持つトークン）は `reports/01-headless.md` の 1-2 を参照。

## 自動検証

`cms/dist` をビルドしたうえで、リポジトリ直下から実行する。各スクリプトは空のインスタンスとモック Discord を起動し、
運営アカウントのセットアップは Playwright の仮想 WebAuthn 認証器で行う。

```sh
node verify/item1-headless.mjs   --out reports/generated/01-headless.md
node verify/item2-discord.mjs    --out reports/generated/02-discord-auth.md
node verify/item3-cms-client.mjs --out reports/generated/03-cms-client.md   # site/ と experiments/ の pnpm install が先に必要

bench/prepare.sh && node bench/run.mjs --project bench-noswap --memswap 350m
```

## secret の扱い

`.env` はコミットしない（`.env.example` のみ）。検証スクリプト内の鍵やトークンはローカル検証専用の固定値で、
どの実サービスにも対応しない。URL は `localhost` / `example.com` のみ。
