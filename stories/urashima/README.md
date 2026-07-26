# 浦島太郎 — 用途別SB3の生成元

浦島太郎の元台本、画像・音声、アセットロック、生成設定を管理します。公開用SB3は、固定した本体 `v3.1.0` の汎用ベースとビルダーからGitHub Pagesのビルド時に生成します。

## 3つのプロファイル

| プロファイル | ファイル | 台本 | 物語固有アセット | 用途 |
| --- | --- | --- | --- | --- |
| `generic` | `base/kamishibai.sb3` | 非埋め込み | 非埋め込み | 汎用の物語作成・再生用雛形 |
| `editor` | `_urashima.sb3` | 非埋め込み | 埋め込み | 物語作成者による台本編集・動作確認 |
| `player` | `urashima.sb3` | 埋め込み | 埋め込み | 配布・再生、Web版生成 |

先頭の `_` は物語作成者による内部的使用をコンパクトに示し、非公開や一時ファイルを意味しません。`player` は「再生専用」ではなく「再生用」です。

`editor`と`player`は同じ `source.txt` と `assets.lock.json` から生成します。両者の変換済み台本は同一バイト列です。`player`ではタイトル画面をクリックすると、ファイル選択を開かず、SB3内の台本とアセットだけで紙芝居を開始します。

本体 `v3.1.0` では文書化済みのシーン内 `text=` が実行時エラーになるため、冒頭のテキスト更新は互換性のある `setRuntimeVariable=` で記述しています。本体側の修正は [`tmpose-kamishibai` Issue #63](https://github.com/kubohiroya/tmpose-kamishibai/issues/63) で追跡します。

## ビルド元データ

- `source.txt`: 元アセットを `file:` URIで参照する台本
- `urashima.txt`: 生成結果と一致させる変換済み公開用台本
- `assets/images/`: 画像元データ24ファイル
- `assets/sounds/`: MP3音声元データ21ファイル（組み込み対象18、来歴保存3）
- `assets.lock.json`: 組み込み対象42件の名前、target、Scratchメタデータ、サイズ、SHA-256
- `sample.config.json`: ベース、ビルダー、プロファイル、出力名、既定OFFのWeb生成機能を浦島太郎で有効にする設定
- `artifacts.lock.json`: `_urashima` / `urashima` / `web/index.html` の再現可能な出力ハッシュ
- `base/kamishibai.sb3`: `tmpose-kamishibai` `v3.1.0` の `generic` 成果物

コスチューム18件は汎用アプリの `Actor`、背景6件と音声18件は `Stage` に組み込みます。これにより、汎用ベースへ浦島太郎専用のScratch targetを追加せず、台本のactor定義からクローンを生成できます。

Web版は `player` の `urashima.sb3` だけをTurboWarp Packager 3.13.0へ渡して生成します。音声はブラウザ互換性を考慮してMP3（44.1kHz、モノラル、128kbps）へ統一しています。Packagerは外部URLのScratch拡張も単一HTMLへ取り込みます。実行時にオンライン取得するものはmanifestで許可したTMPoseのTensorFlow.js、Teachable Machine Pose、モデルに限定し、台本固有の画像・音声・台本はSB3内参照のまま利用します。

アセットは、本体PR #44で浦島太郎固有コンテンツを分離する直前の `app/assets/` から同一バイト列で移設しています。ファイル名はScratchの `md5ext` 名を維持しています。

## ライセンスと来歴

台本、画像、音声、生成設定はMozilla Public License 2.0（SPDX: `MPL-2.0`）で提供します。適用範囲と、MITライセンスの本体ランタイムを含む生成物の構成は [`LICENSES.md`](LICENSES.md) を参照してください。

- 移設元: [`kubohiroya/tmpose-kamishibai`](https://github.com/kubohiroya/tmpose-kamishibai) PR #44
- 移設元コミット: `9526c9d6391622ee261b8d7c0778b1fbbd2e6745`
- ビルダーとベース: `tmpose-kamishibai` `v3.1.0` / `c92c310159c88ff03ed3cae65dbe21f1991fcf16`

生成・検証・公開の実装は [Issue #2](https://github.com/kubohiroya/tmpose-kamishibai-samples/issues/2)、Packager Web版は [Issue #7](https://github.com/kubohiroya/tmpose-kamishibai-samples/issues/7) で管理します。
