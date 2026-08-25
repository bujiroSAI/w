# 知床、実測の大地。 — Real DEM Scroll Flight

web_factory レーンB実験（実データ版）。スクロールで知床半島を飛ぶWebGL体験の技術プロトタイプ。

- 地形: 国土地理院 標高タイル（DEM）より生成
- 空中写真: 国土地理院 全国最新写真（シームレス）より生成（陸域はカラーグレーディング済み）
- 出典: 国土地理院（https://maps.gsi.go.jp/development/ichiran.html）
- これは実験用プロトタイプであり、営利目的の公開物ではない。noindex 指定。
- 再現パイプライン: `assets/fetch_build.py`（タイル取得・埋め込み生成）／`assets/grade_tex.py`（グレード）
