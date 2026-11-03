# 項目 1-7: 書き込み API への詰め替え

実行: 2026-11-03T08:20:53.011Z / 生成: `verify/item1-transfer.mjs`

空の 2 インスタンス間で、移行元を作り、API で読み、移行先へ書き、突き合わせた記録。

## ログ

```
### 移行元を作る
メディア 1 件: cast.webp (3840x2160, 14824 bytes)
記事: id=01M6G7YCGZ4245E85WHYRGBZRS slug=a-cast-introduction publishedAt=2024-03-15T09:00:00.000Z createdAt=2023-12-01T04:30:00.000Z
キャスト: id=01M6G7YCHEEXYZ76BPFMES2DME slug=a-cast

### 移行元を読む
記事 1 件 / キャスト 1 件 / メディア 1 件
画像を取得: /_emdash/api/media/file/01M6G7YCGMCASGS6HHQM10H5E4.webp → 200, 14824 bytes

### 移行先へ書く
メディア: 01M6G7YCGNTHNQMSX1VD0FG6FD → 01M6G7YCJSGMZCJPVC5FGCEK0F
記事: 01M6G7YCGZ4245E85WHYRGBZRS → 01M6G7YCK4ZN8BG0Z6BZQ5VCPZ

### 突き合わせ
移行先の記事: slug=a-cast-introduction publishedAt=2024-03-15T09:00:00.000Z createdAt=2023-12-01T04:30:00.000Z
```

## 判定

| # | check | result | detail |
|---|---|---|---|
| 1-7d | 移行元で slug と日付を指定して記事を作れる | PASS | status 201  |
| 1-7e | references でリレーションを張れる（metadata → articles） | PASS | status 201  |
| 1-7c | 移行元の読み出しが全ステータスを返す | PASS | 記事 1 件 |
| 1-7f | 画像がバイト単位で同じまま移る | PASS | 14824→14824 bytes, 3840x2160→3840x2160 |
| 1-7g | 画像フィールドを新しいメディア id に差し替えて保存できる | PASS | status 201  |
| 1-7h | リレーションを新しい id に張り替えて移せる | PASS | status 201  |
| 1-7i | slug が一致する | PASS | a-cast-introduction → a-cast-introduction |
| 1-7j | publishedAt が一致する | PASS | 2024-03-15T09:00:00.000Z → 2024-03-15T09:00:00.000Z |
| 1-7k | createdAt が一致する | PASS | 2023-12-01T04:30:00.000Z → 2023-12-01T04:30:00.000Z |
| 1-7l | 移行先でリレーションが引ける | PASS | {"id":"01M6G7YCKWE1VGRE5E1FK2FPN1","type":"metadata","slug":null,"status":"draft","data":{"links":[{"label":"Site","url":"https://example.com"}]},"authorId":"01M6G7YC76DH47G3Y8XQQR5DYM","primaryByline |
| 1-7m | 移行先の画像が元とバイト一致 | PASS | 14824 vs 14824 bytes |
| 1-7n | エントリ id は振り直される（移行では保てない） | PASS | 01M6G7YCGZ4245E85WHYRGBZRS → 01M6G7YCK4ZN8BG0Z6BZQ5VCPZ |
| 1-7o | リビジョン履歴 | note | 移らない。移行先では投入 1 回分だけの履歴になる。 |
| 1-7p | 執筆者の帰属 | note | 全件が実行アカウントの作成物になる。API に authorId は無い。執筆者を画面に出さない方針（項目 6）なので実害はない。 |
