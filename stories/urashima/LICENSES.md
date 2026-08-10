# 浦島太郎サンプルのライセンス

浦島太郎サンプルとして本リポジトリで配布する次のファイルは、Mozilla Public License 2.0（SPDX: `MPL-2.0`）で提供します。

- `source.txt`、`urashima.txt`、`urashima.k4.yml`
- `../my-urashima/my-urashima.txt`、`../my-urashima/my-urashima.k4.yml`、`../my-urashima/project-assets.yml`、`../my-urashima/sample.config.json`、`../my-urashima/artifacts.lock.json`
- `assets/images/` 配下の画像26ファイル（3.2用24ファイルとDSL 4.0用Stars／TextPlaceholder）
- `assets/sounds/` 配下の音声のうち、`cfc75b8ec10d522a49e754cee372fcb9.mp3`を除く21ファイル
- `pose-models/` 配下の浦島太郎用Teachable Machine Poseモデル3組
- `assets.lock.json`、`artifacts.lock.json`、`dsl4-inputs.lock.json`、`dsl4-build.config.json`、`dsl4-artifacts.lock.json`、`project.source.json`、`project-assets-dsl4.yml`、`sample.config.json`
- 本ディレクトリの説明と生成・公開用コード

生成される `_urashima.sb3`、`urashima.sb3`、`../my-urashima/my-urashima.sb3` は、上記のMPL-2.0対象コンテンツに加えて、`tmpose-kamishibai` `3.2.2`／`2b5005d293a9b63c8ba5da396fd86815d093f975` のMPL-2.0対象ランタイムと、次節のCC BY-SA 2.0対象音声を含む結合物です。`../my-urashima/my-urashima.sb3`のPrincessコスチュームは、リポジトリでは`resources/20260801/master/Princess.png`、ワークショップ配布物では`master/Princess.png`として収録する画像を入力としており、各配布場所の`LICENSES.md`に記載されたCC BY-SA 4.0が適用されます。汎用ベース `base/kamishibai.sb3` と本体由来部分にも、[`licenses/tmpose-kamishibai-MPL-2.0.txt`](licenses/tmpose-kamishibai-MPL-2.0.txt) のMozilla Public License 2.0が適用されます。

`urashima-4.0.sb3`は、上記コンテンツと3ポーズモデルに加え、`tmpose-kamishibai` PR #519のcommit `a40d52ef003e3ec85835d325dc443359c64a229d`から生成したDSL 4.0 runtime baseを含みます。統合されたJavaScriptの冒頭には、各機能拡張ソースの名称、著作権表示、ライセンス表示を保持しています。ポーズモデルの取得元と各ファイルの固定SHA-256は`dsl4-inputs.lock.json`に記録しています。

## Scratch Sewing Machine {#scratch-sewing-machine}

`assets/sounds/cfc75b8ec10d522a49e754cee372fcb9.mp3`は、Scratch音声ライブラリの`Sewing Machine`（asset ID `7bd800cb66d6fb18886a4c5cea1b76a6`）をMP3へ変換したものです。Scratch support materialsとして[Creative Commons Attribution-ShareAlike 2.0](https://creativecommons.org/licenses/by-sa/2.0/)で提供します。

Attribution: Scratch is developed by the Lifelong Kindergarten Group at the MIT Media Lab. See https://scratch.mit.edu/.

`web/index.html` は `urashima.sb3` からTurboWarp Packager 3.13.0で生成する単一HTMLです。TurboWarp PackagerはMPL-2.0で提供され、Copyright (C) 2021-2024 Thomas Weberです。詳細は[`licenses/turbowarp-packager-NOTICE.md`](licenses/turbowarp-packager-NOTICE.md)を参照してください。生成HTMLにはPackagerが付与するTurboWarp PackagerおよびScratchのライセンス告知も保持されます。

3.2 Web版の画像・音声・台本は組み込み済みですが、台本で指定するTMPoseモデルはオンライン取得します。一方、`urashima-4.0.sb3`は3ポーズモデルも組み込んでおり、実行時のモデル取得は不要です。どちらもポーズ認識にはブラウザのカメラ権限が必要です。

Copyright 2026 Hiroya Kubo

ライセンス全文はリポジトリルートの [`LICENSE`](../../LICENSE) を参照してください。

This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
