# 浦島太郎サンプルのライセンス

浦島太郎サンプルとして本リポジトリで配布する次のファイルは、Mozilla Public License 2.0（SPDX: `MPL-2.0`）で提供します。

- `source.txt`、`urashima.txt`、`urashima.k4.yml`
- `../my-urashima/my-urashima.txt`、`../my-urashima/my-urashima.k4.yml`、`../my-urashima/project-assets.yml`、`../my-urashima/project-assets-dsl4.yml`、`../my-urashima/sample.config.json`、`../my-urashima/dsl4-build.config.json`、各artifact lock
- `assets/images/` 配下の画像26ファイル（3.2用24ファイルとDSL 4.0用Stars／TextPlaceholder）
- `assets/sounds/` 配下の音声のうち、`cfc75b8ec10d522a49e754cee372fcb9.mp3`を除く21ファイル
- `pose-models/` 配下の浦島太郎用Teachable Machine Poseモデル3組
- `assets.lock.json`、`artifacts.lock.json`、`dsl4-inputs.lock.json`、`dsl4-build.config.json`、`dsl4-artifacts.lock.json`、`dsl4-web-artifacts.lock.json`、`project.source.json`、`project-assets-dsl4.yml`、`sample.config.json`
- 本ディレクトリの説明と生成・公開用コード

生成される `_urashima.sb3`、`urashima.sb3`、`../my-urashima/my-urashima.sb3` は、上記のMPL-2.0対象コンテンツに加えて、`tmpose-kamishibai` `3.2.2`／`2b5005d293a9b63c8ba5da396fd86815d093f975` のMPL-2.0対象ランタイムと、次節のCC BY-SA 2.0対象音声を含む結合物です。`../my-urashima/my-urashima.sb3`のPrincessコスチュームは、リポジトリでは`resources/20260801/master/Princess.png`、ワークショップ配布物では`master/Princess.png`として収録する画像を入力としており、各配布場所の`LICENSES.md`に記載されたCC BY-SA 4.0が適用されます。汎用ベース `base/kamishibai.sb3` と本体由来部分にも、[`licenses/tmpose-kamishibai-MPL-2.0.txt`](licenses/tmpose-kamishibai-MPL-2.0.txt) のMozilla Public License 2.0が適用されます。

`base/kamishibai-4.0.sb3`は、`tmpose-kamishibai` `4.0.0-rc.5`の固定release source identity `sha256:a6c4be01405af1b3070f6d02dc584a55bd2b45844ae48761aa3d4141ef474ca4`から生成したruntime baseです。`urashima-4.0.sb3`と`../my-urashima/my-urashima-4.0.sb3`は、このbaseへtag commit `f323a5475d4c6240a255f8a6f5b6c5d68b9ea7b6`のビルダーと`@kubohiroya/sb3-toolchain@0.6.0`を適用して生成します。統合されたJavaScriptの冒頭には、各機能拡張ソースの名称、著作権表示、ライセンス表示を保持しています。浦島太郎のポーズモデルの取得元と各ファイルの固定SHA-256は`dsl4-inputs.lock.json`に記録しています。my-urashima 4.0版のPrincessコスチュームには、前述のCC BY-SA 4.0が適用されます。

## Scratch Sewing Machine {#scratch-sewing-machine}

`assets/sounds/cfc75b8ec10d522a49e754cee372fcb9.mp3`は、Scratch音声ライブラリの`Sewing Machine`（asset ID `7bd800cb66d6fb18886a4c5cea1b76a6`）をMP3へ変換したものです。Scratch support materialsとして[Creative Commons Attribution-ShareAlike 2.0](https://creativecommons.org/licenses/by-sa/2.0/)で提供します。

Attribution: Scratch is developed by the Lifelong Kindergarten Group at the MIT Media Lab. See https://scratch.mit.edu/.

`web/index.html`、`web-4.0/index.html`、`../my-urashima/web-4.0/index.html`は、それぞれ対応するSB3からTurboWarp Packager 3.13.0で生成する単一HTMLです。TurboWarp PackagerはMPL-2.0で提供され、Copyright (C) 2021-2024 Thomas Weberです。詳細は[`licenses/turbowarp-packager-NOTICE.md`](licenses/turbowarp-packager-NOTICE.md)を参照してください。生成HTMLにはPackagerが付与するTurboWarp PackagerおよびScratchのライセンス告知も保持されます。

3.2 Web版の画像・音声・台本は組み込み済みですが、台本で指定するTMPoseモデルはオンライン取得します。一方、浦島太郎4.0版は3ポーズモデルも組み込んでおり、実行時のモデル取得は不要です。my-urashima 4.0版ではワークショップ参加者が台本に指定したTMPoseモデルをオンライン取得します。ポーズ認識にはブラウザのカメラ権限が必要です。

Copyright 2026 Hiroya Kubo

ライセンス全文はリポジトリルートの [`LICENSE`](../../LICENSE) を参照してください。

This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
