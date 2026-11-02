# 項目 6: コンテンツの制約（寸法・保存形式・本文）

要件: [`docs/requirements.md` 項目 6](../docs/requirements.md)
機械出力: [`reports/generated/06-content-constraints.md`](generated/06-content-constraints.md)
検証: 2026-11-03、`verify/item6-content-constraints.mjs`（`cms/dist` + 使い捨て DB、実機）

## 結果

| # | 内容 | 判定 |
|---|---|---|
| 6-1 | 寸法が宣言と一致しない画像の保存を拒否 | **合格** |
| 6-2 | 一致する画像は保存でき、縮小・再エンコードが起きない | **合格** |
| 6-3 | WebP 以外のアップロードを拒否し、変換の導線を案内 | **一部不合格**（拒否は効く。案内が消える） |
| 6-4 | WebP のアップロードを受け入れる | **合格** |
| 6-5 | 変換ページで PNG を WebP にできる | **未検証** |
| 6-6 | 許可していない装飾を含む本文の保存を拒否 | **合格** |
| 6-7 | 許可した装飾だけの本文は保存できる | **合格** |
| 6-8 | 編集画面で使えない装飾が操作できない | **未実施**（6-6 の拒否のみが残る） |

## 強制の仕組みと、どこが担っているか

制約は `cms/seed/seed.json` が宣言し、プラグインは宣言を読んで強制するだけで、何を禁じるかをコードに持たない。

| 宣言 | 強制するもの |
|---|---|
| `casts.avatar.options = {width:3840, height:2160}` | `image-dimensions` プラグイン（`content:beforeSave`） |
| `casts.avatar.validation.allowedMimeTypes = ["image/webp"]` | **EmDash 本体**（フィールド経由のアップロード） |
| `articles.body.options`（4 軸の許可リスト） | `portable-text-policy` プラグイン（`content:beforeSave`） |
| （宣言なし。プラグイン固定） | `webp-only` プラグイン（`media:beforeUpload`、メディアページ経由） |

拒否時に編集者が見る文は具体的である。

```
"Avatar" must be exactly 3840x2160px. "wrong.webp" is 1920x1080px.
"Body" cannot contain a code block.
"Body" cannot contain a level-1 heading.
```

## アップロード経路が 2 つあり、別の仕組みが担っている

EmDash は許可リストを `fieldAllowlist ?? GLOBAL_UPLOAD_ALLOWLIST` で解決し、フォームに `fieldId` が入っているときだけフィールドの一覧を使う（`api/handlers/media-allowlist.ts`）。

| 経路 | 門番 | 応答 |
|---|---|---|
| エントリ編集画面のフィールドから | **EmDash 本体**。seed の `allowedMimeTypes` が効く | `400 INVALID_TYPE "File type not allowed"` |
| メディアページから | `webp-only` プラグインのみ | `500 UPLOAD_ERROR "Upload failed"` |

`GLOBAL_UPLOAD_ALLOWLIST` は png・jpeg・gif を含む**ハードコードの定数**で、設定でも env でも変えられない。メディアページ経由を塞ぐにはプラグインかミドルウェアが必要になる。

## 6-3b が不合格である理由（F-26）

`media:beforeUpload` から投げた例外は、メッセージが失われる。

```
plugins/hooks.ts  runMediaBeforeUpload: errorPolicy の既定は "abort" なので中断はする
astro/routes/api/media.ts            : handleError(error, "Upload failed", "UPLOAD_ERROR") で 500
```

コンテンツ側には `ContentSaveRejectedError` があり、投げると `422 SAVE_REJECTED` とメッセージが編集者まで届く。**メディア側に相当するエラー型が存在しない**（EmDash が持つのは `ContentSaveRejectedError` と `SandboxSaveRejectedError` だけ）。

結果として編集者には「Upload failed」しか出ず、**変換ページへの案内が届かない**。クライアント側の誤りが 500 で返るのも正しくない。

### 対応案

| 案 | 内容 | 得るもの / 失うもの |
|---|---|---|
| A | 受け入れる。変換ページの存在は別の導線（サイドバーの Tools）で伝える | 追加実装なし。編集者は失敗の理由を推測することになる |
| B | `POST /_emdash/api/media` を自前のミドルウェアで先に判定し、`400` とメッセージを返す | メッセージと状態コードを完全に制御できる。アップロード経路に手を入れる分、EmDash の更新時に確認が要る |
| C | EmDash に `MediaUploadRejectedError` 相当を要望する | 本筋。採用判定には間に合わない |

B は既に `cms/src/middlewares/` があるので構成上の無理はない。ただし **6-3 の合格基準「拒否され、変換の導線が案内される」を満たすには B が必要**である。

## 未検証のもの

- **6-5**: 変換ページはブラウザの `canvas.toBlob` で変換するため、実ページが要る。サーバー負荷が無いことは構成上明らか（バイト列は符号化済みで届く）だが、**縮小が起きないことは未確認**。
- **6-8**: 編集画面が使えない装飾を提示するかは DOM の問題。ツールバーを隠す CSS は未実装なので、現状は 6-6 の保存時拒否だけが編集者を止めている。
