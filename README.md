# IG Media Auto-Poster

Instagram自動投稿用の画像・動画公開・在庫リポジトリ。**ストーリーズ＋リール**に同時投稿する（フィード投稿は行わない）。

## 仕組み（スケジュール投稿）

1. `images/` に画像、`videos/`（ffmpegで静止画から自動生成した縦型mp4）に動画、同名の `.txt` キャプションを `captions/` に置いてpushしておく（＝「投稿案の在庫」を積んでおくだけで、この時点では投稿されない）
2. 毎日 **9:00 / 12:00 / 20:00（JST）** に GitHub Actions が自動起動
3. 在庫の中から**先頭の1件だけ**（ファイル名の先頭数字が小さい順、例: `01_...` → `02_...`）を選んで投稿
   - ストーリーズ：画像を使用（キャプションは付かない仕様）
   - リール：動画を使用（キャプション付き）
4. 投稿が完了した項目は `posted.json` に記録した上で、**`images/` `videos/` `captions/` から自動削除**（在庫から除外し、二重投稿を防止）
5. 手動で今すぐ1件投稿したい場合は Actions タブから `workflow_dispatch` で手動実行も可能

## 使い方

ローカルの `publish.sh` が images/videos/captions の同期・動画生成・push まで自動で行う（投稿はしない、在庫を積むだけ）。
このリポジトリを直接操作する場合は：

- `images/05_商品名.png` を追加
- `videos/05_商品名.mp4` を追加（リール用の縦型動画）
- `captions/05_商品名.txt` にキャプション本文を書く（このファイルが無い/空の場合はスキップされ、在庫としてもカウントされない）
- `git add . && git commit -m "add: 05" && git push`
- 次回のスケジュール実行（または手動実行）で、在庫の中の順番が来たら自動投稿される

## 必要なリポジトリ設定

- Settings → Secrets and variables → Actions → New repository secret
  - Name: `IG_ACCESS_TOKEN`
  - Value: テスト済みのInstagramアクセストークン
