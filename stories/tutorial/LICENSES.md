# DSL 4.0チュートリアル作品のライセンス

次のファイルはMozilla Public License 2.0（SPDX: `MPL-2.0`）で提供します。

- YAML台本、設定、artifact lock、公開surface manifest、README
- `classroom.svg`、`earthquake-classroom.svg`、`student-ready.svg`、`protect-head.svg`
- addition kitのYAML断片
- `success.mp3`（浦島太郎サンプルの`Jump`成功音と同一bytes）
- `safety-pose/`（浦島太郎サンプルの`6and7`モデルと同じmodel topology／weights）

生成されるSB3と単一HTML Web版には、MPL-2.0のTMPose紙芝居runtimeとTurboWarp Packagerが
含まれます。TurboWarp PackagerはCopyright (C) 2021-2024 Thomas Weberです。

`safety-pose`は、浦島太郎の最終場面で「ひざまずいて両手で頭を抱える」姿勢を認識する`despair`
クラスを、同じ身体形状の「しゃがんで両手で頭を守る」見本へ転用しています。学習済みweightsは変更せず、
クラス4の表示ラベルだけを「頭を守る」へ変更しています。ポーズ認識にはブラウザーのカメラ権限が必要です。
モデル、音、SVG、台本は外部networkへ依存せず、完成版SB3へ組み込みます。

Copyright 2026 Hiroya Kubo

ライセンス全文はリポジトリルートの[`LICENSE`](../../LICENSE)を参照してください。
