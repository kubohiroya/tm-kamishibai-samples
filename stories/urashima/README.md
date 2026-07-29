# 浦島太郎 — 用途別SB3の生成元

浦島太郎の元台本、画像・音声、アセットロック、生成設定を管理します。公開用SB3は、固定したビルダー `v3.1.1` と、テキストアクション対応済みの汎用ベースからGitHub Pagesのビルド時に生成します。

## 3つのプロファイル

| プロファイル | ファイル | 台本 | 物語固有アセット | 用途 |
| --- | --- | --- | --- | --- |
| `generic` | `base/kamishibai.sb3` | 非埋め込み | 非埋め込み | 汎用の物語作成・再生用雛形 |
| `editor` | `_urashima.sb3` | 非埋め込み | 埋め込み | 物語作成者による台本編集・動作確認 |
| `player` | `urashima.sb3` | 埋め込み | 埋め込み | 配布・再生、Web版生成 |

先頭の `_` は物語作成者による内部的使用をコンパクトに示し、非公開や一時ファイルを意味しません。`player` は「再生専用」ではなく「再生用」です。

`editor`と`player`は同じ `source.txt` と `assets.lock.json` から生成します。両者の変換済み台本は同一バイト列です。`player`ではタイトル画面をクリックすると、ファイル選択を開かず、SB3内の台本とアセットだけで紙芝居を開始します。

冒頭のテキストは `action=text:Narration:...` と `action=wait:...` を交互に記述し、シーン内の時系列に沿って更新します。汎用ベースは、同アクション、表示済みテキストの再描画、scene 0 のUI文言定義に対応した本体コミット `d5ebaee7ba5f4e24df4405c339661a3bd980efea` から生成しています。

## ビルド元データ

- `source.txt`: 元アセットを `file:` URIで参照する台本
- `urashima.txt`: 生成結果と一致させる変換済み公開用台本
- `assets/images/`: 画像元データ24ファイル
- `assets/sounds/`: MP3音声元データ21ファイル（組み込み対象18、来歴保存3）
- `assets.lock.json`: 組み込み対象42件の名前、target、Scratchメタデータ、サイズ、SHA-256
- `sample.config.json`: ベース、ビルダー、プロファイル、出力名、既定OFFのWeb生成機能を浦島太郎で有効にする設定
- `artifacts.lock.json`: `_urashima` / `urashima` / `web/index.html` の再現可能な出力ハッシュ
- `base/kamishibai.sb3`: `tmpose-kamishibai` `17246c6d2a7e3b357d55112af766f68743a37ba9` の `generic` 成果物
- `scripts/patch-urashima-runtime.mjs`: 元のベースを変更せず、Asset Managerの`actorName`クローン解決と、scene 7用の`fadeToWhite` / `fadeFromWhite`を生成時に追加する互換パッチ

`source.txt`などの入力を意図的に変更したときは、リポジトリルートで`pnpm update:artifacts-lock`を実行すると、両プロファイルとWeb版を実際に生成して`artifacts.lock.json`を再作成できます。その後の`pnpm build`では、再生成したロックとの一致を通常どおり検証します。

コスチューム18件は汎用アプリの `Actor`、背景6件と音声18件は `Stage` に組み込みます。これにより、汎用ベースへ浦島太郎専用のScratch targetを追加せず、台本のactor定義からクローンを生成できます。

`Fish1`と`Fish2`は、`setLoadingCostume=Fish1,Fish2`により通常アセット読込中のLoading画像として交互に表示します。Loading用の2画像は読込進捗の分子・分母から除外されます。

scene 3の魚アニメーションでは、`Fish`クローンを乙姫と同じ中心座標に置き、背面レイヤーで`Fish1`と`Fish2`をloop再生します。固定済み汎用ベースのAsset ManagerはScratch target名だけを検索し、コスチューム元のサイズをクローンへ再適用するため、生成時の互換パッチで`actorName`変数も検索対象に加え、クローンの表示サイズを保持します。

scene 7では、`fadeToWhite`でステージの明るさを`+100`へ上げたまま保持してから背景をSmokeへ切り替え、`fadeFromWhite`で`0`へ戻して煙を見せます。通常の`fadeOut`（`-100`で保持）と`fadeUp`（`0`へ復帰）は変更しません。これらの互換処理は元の`base/kamishibai.sb3`を変更せず生成時に適用し、パッチ後の一時ベースも`sample.config.json`のサイズとSHA-256で検証します。

Web版は `player` の `urashima.sb3` だけをTurboWarp Packager 3.13.0へ渡して生成します。音声はブラウザ互換性を考慮してMP3（44.1kHz、モノラル、128kbps）へ統一しています。Packagerは外部URLのScratch拡張も単一HTMLへ取り込みます。実行時にオンライン取得するものはmanifestで許可したTMPoseのTensorFlow.js、Teachable Machine Pose、モデルに限定し、台本固有の画像・音声・台本はSB3内参照のまま利用します。

アセットは、本体PR #44で浦島太郎固有コンテンツを分離する直前の `app/assets/` から同一バイト列で移設しています。ファイル名はScratchの `md5ext` 名を維持しています。

## ライセンスと来歴

台本、画像、音声、生成設定はMozilla Public License 2.0（SPDX: `MPL-2.0`）で提供します。適用範囲と、MITライセンスの本体ランタイムを含む生成物の構成は [`LICENSES.md`](LICENSES.md) を参照してください。

- 移設元: [`kubohiroya/tmpose-kamishibai`](https://github.com/kubohiroya/tmpose-kamishibai) PR #44
- 移設元コミット: `9526c9d6391622ee261b8d7c0778b1fbbd2e6745`
- ビルダー: `tmpose-kamishibai` `v3.1.1` / `585368f3c31e7bece3e4cc926e6fcf35225cce4a`
- 汎用ベース: `tmpose-kamishibai` / `d5ebaee7ba5f4e24df4405c339661a3bd980efea`

生成・検証・公開の実装は [Issue #2](https://github.com/kubohiroya/tmpose-kamishibai-samples/issues/2)、Packager Web版は [Issue #7](https://github.com/kubohiroya/tmpose-kamishibai-samples/issues/7) で管理します。
