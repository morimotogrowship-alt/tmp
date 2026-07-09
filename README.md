# IG Media Auto-Poster

Instagram自動投稿用の画像・動画公開・トリガーリポジトリ。**ストーリーズ＋リール**に同時投稿する（フィード投稿は行わない）。

## 仕組み

1. `images/` に画像、`videos/`（ffmpegで静止画から自動生成した縦型mp4）に動画、同名の `.txt` キャプションを `captions/` に置いてpush
2. push をトリガーに GitHub Actions が起動
3. Actions が `raw.githubusercontent.com` の公開URL経由で Instagram Graph API に投稿
   - ストーリーズ：画像を使用（キャプションは付かない仕様）
   - リール：動画を使用（キャプション付き）
4. 投稿済みの項目は `posted.json` に記録され、二重投稿を防止

## 使い方

ローカルの `publish.sh` が images/videos/captions の同期・動画生成・push まで自動で行う。
このリポジトリを直接操作する場合は：

- `images/01_タカミスキンピール.png` を追加
- `videos/01_タカミスキンピール.mp4` を追加（リール用の縦型動画）
- `captions/01_タカミスキンピール.txt` にキャプション本文を書く（このファイルが無い/空の場合は投稿されずスキップされる）
- `git add . && git commit -m "add: 01" && git push`
- Actions タブで実行結果を確認

## 必要なリポジトリ設定

- Settings → Secrets and variables → Actions → New repository secret
  - Name: `IG_ACCESS_TOKEN`
  - Value: テスト済みのInstagramアクセストークン
