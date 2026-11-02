# 項目 6: コンテンツの制約（寸法・保存形式・本文）

実行: 2026-11-02T17:49:43.407Z / 生成: `verify/item6-content-constraints.mjs`

制約は `cms/seed/seed.json` の宣言から読み、スクリプト側に値を持たない。
casts.avatar = 3840x2160、articles.body = {"allowedTypes":["block","image"],"allowedStyles":["normal","h2","h3","h4"],"allowedMarks":["strong","em","link"],"allowedLists":["bullet","number"]}

| # | check | result | detail |
|---|---|---|---|
| 6-3a | a PNG upload is refused | PASS | status 500 |
| 6-3b | the refusal names where to convert the file | FAIL | {"success":false,"error":{"code":"UPLOAD_ERROR","message":"Upload failed"}} |
| 6-3c | a PNG uploaded from the casts.avatar field is refused by EmDash itself | PASS | status 400 {"success":false,"error":{"code":"INVALID_TYPE","message":"File type not allowed"}} |
| 6-4a | a WebP upload is accepted | PASS | status 201 |
| 6-2a | the stored image keeps its 3840x2160 pixels and stays WebP | PASS | 3840x2160 image/webp |
| 6-1a | an image of the wrong size can still be stored as media (the gate is on the field, not the library) | PASS | status 201 |
| 6-1b | saving casts.avatar with a 1920x1080 image is refused (declared 3840x2160) | PASS | status 422 |
| 6-1c | the refusal states the expected and the actual size | PASS | {"success":false,"error":{"code":"SAVE_REJECTED","message":"\"Avatar\" must be exactly 3840x2160px. \"wrong.webp\" is 1920x1080px."}} |
| 6-2b | saving casts.avatar with a 3840x2160 image succeeds | PASS | status 201 |
| 6-7a | a body using only normal/h2/h3/h4 and strong/em/link saves | PASS | status 201 |
| 6-6a | a body containing a code block is refused | PASS | status 422 {"success":false,"error":{"code":"SAVE_REJECTED","message":"\"Body\" cannot contain a code block."}} |
| 6-6b | a body containing a table is refused | PASS | status 422 {"success":false,"error":{"code":"SAVE_REJECTED","message":"\"Body\" cannot contain a table."}} |
| 6-6c | a body containing raw HTML is refused | PASS | status 422 {"success":false,"error":{"code":"SAVE_REJECTED","message":"\"Body\" cannot contain a raw HTML block."}} |
| 6-6d | a body containing an iframe is refused | PASS | status 422 {"success":false,"error":{"code":"SAVE_REJECTED","message":"\"Body\" cannot contain an embedded frame."}} |
| 6-6e | a body containing an h1 heading is refused | PASS | status 422 {"success":false,"error":{"code":"SAVE_REJECTED","message":"\"Body\" cannot contain a level-1 heading."}} |
| 6-6f | a body containing an underline mark is refused | PASS | status 422 {"success":false,"error":{"code":"SAVE_REJECTED","message":"\"Body\" cannot contain underlined text."}} |
| 6-5 | the converter page | note | not covered here: it converts in the browser through canvas.toBlob, so it needs a real page. Its server cost is nil by construction — the bytes arrive already encoded — but that the page converts without resizing is unverified. |
| 6-8 | the editor toolbar | note | not covered here: whether the editor offers decorations that 6-6 then refuses is a DOM question. No toolbar CSS is in place yet, so the refusal above is the only thing stopping an editor. |
