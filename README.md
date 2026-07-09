# IG Media Auto-Poster

Instagram自動投稿用の画像公開・トリガーリポジトリ。

## 仕組み

1. `images/` に画像を追加し、同名の `.txt` キャプションを `captions/` に置いてpush
2. push をトリガーに GitHub Actions が起動
3. Actions が `raw.githubusercontent.com` の公開URL経由で Instagram Graph API に投稿
4. 投稿済みの画像は `posted.json` に記録され、二重投稿を防止

## 使い方

- `images/01_タカミスキンピール.png` を追加
- `captions/01_タカミスキンピール.txt` にキャプション本文を書く（このファイルが無い/空の場合は投稿されずスキップされる）
- `git add . && git commit -m "add: 01" && git push`
- Actions タブで実行結果を確認

## 必要なリポジトリ設定

- Settings → Secrets and variables → Actions → New repository secret
  - Name: `IG_ACCESS_TOKEN`
  - Value: テスト済みのInstagramアクセストークン
