# 浦島太郎サンプルのライセンス

浦島太郎サンプルとして本リポジトリで配布する次のファイルは、Mozilla Public License 2.0（SPDX: `MPL-2.0`）で提供します。

- `source.txt` と `urashima.txt`
- `assets/images/` 配下の画像24ファイル
- `assets/sounds/` 配下の音声のうち、`cfc75b8ec10d522a49e754cee372fcb9.mp3`を除く21ファイル
- `assets.lock.json`、`artifacts.lock.json`、`sample.config.json`
- 本ディレクトリの説明と生成・公開用コード

生成される `_urashima.sb3` と `urashima.sb3` は、上記のMPL-2.0対象コンテンツに加えて、`tmpose-kamishibai` `v3.1.7` のMITライセンス対象ランタイムと、次節のCC BY-SA 2.0対象音声を含む結合物です。汎用ベース `base/kamishibai.sb3` と本体由来部分には、[`licenses/tmpose-kamishibai-MIT.txt`](licenses/tmpose-kamishibai-MIT.txt) のMIT Licenseが引き続き適用されます。

## Scratch Sewing Machine {#scratch-sewing-machine}

`assets/sounds/cfc75b8ec10d522a49e754cee372fcb9.mp3`は、Scratch音声ライブラリの`Sewing Machine`（asset ID `7bd800cb66d6fb18886a4c5cea1b76a6`）をMP3へ変換したものです。Scratch support materialsとして[Creative Commons Attribution-ShareAlike 2.0](https://creativecommons.org/licenses/by-sa/2.0/)で提供します。

Attribution: Scratch is developed by the Lifelong Kindergarten Group at the MIT Media Lab. See https://scratch.mit.edu/.

`web/index.html` は `urashima.sb3` からTurboWarp Packager 3.13.0で生成する単一HTMLです。TurboWarp PackagerはMPL-2.0で提供され、Copyright (C) 2021-2024 Thomas Weberです。詳細は[`licenses/turbowarp-packager-NOTICE.md`](licenses/turbowarp-packager-NOTICE.md)を参照してください。生成HTMLにはPackagerが付与するTurboWarp PackagerおよびScratchのライセンス告知も保持されます。

Web版の画像・音声・台本は組み込み済みです。TMPoseのTensorFlow.js／Teachable Machine Poseランタイムと台本で指定するTMPoseモデルはオンライン取得するため、Web版は完全オフライン版ではありません。ポーズ認識にはブラウザのカメラ権限が必要です。

Copyright 2026 Hiroya Kubo

ライセンス全文はリポジトリルートの [`LICENSE`](../../LICENSE) を参照してください。

This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
