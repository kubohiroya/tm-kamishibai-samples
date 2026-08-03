# 浦島太郎 — 用途別SB3の生成元

浦島太郎の元台本、画像・音声、アセットロック、生成設定を管理します。公開用SB3は、固定したnpmビルダー `3.1.7` と、legacy UI targetを削除した本体コミット`1aae65f`の汎用ベースからGitHub Pagesのビルド時に生成します。

## 3つのプロファイル

| プロファイル | ファイル | 台本 | 物語固有アセット | 用途 |
| --- | --- | --- | --- | --- |
| `generic` | `base/kamishibai.sb3` | 非埋め込み | 非埋め込み | 汎用の物語作成・再生用雛形 |
| `editor` | `_urashima.sb3` | 非埋め込み | 埋め込み | 物語作成者による台本編集・動作確認 |
| `player` | `urashima.sb3` | 埋め込み | 埋め込み | 配布・再生、Web版生成 |

先頭の `_` は物語作成者による内部的使用をコンパクトに示し、非公開や一時ファイルを意味しません。`player` は「再生専用」ではなく「再生用」です。

`editor`と`player`は同じ `source.txt` と `assets.lock.json` から生成します。両者の変換済み台本は同一バイト列です。`player`ではタイトル画面をクリックすると、ファイル選択を開かず、SB3内の台本とアセットだけで紙芝居を開始します。

冒頭のテキストは `action=text:Narration:...` と `action=wait:...` を交互に記述し、シーン内の時系列に沿って更新します。汎用ベースは、固定英語フォールバックと`UiItem` cloneによるTitle画面の多言語表示に対応した本体コミット `1aae65f5af986320b5078c9e560e7945ee1b4fde` から生成しています。Title、menu、language UIは画面遷移ごとに必要なcloneだけを生成し、不要になったcloneを削除します。

## ビルド元データ

- `source.txt`: 元アセットを `file:` URIで参照する台本
- `urashima.txt`: 生成結果と一致させる変換済み公開用台本
- `assets/images/`: 画像元データ24ファイル
- `assets/sounds/`: MP3音声元データ22ファイル（組み込み対象20、来歴保存2）
- `assets.lock.json`: 組み込み対象44件の名前、target、Scratchメタデータ、サイズ、SHA-256
- `sample.config.json`: ベース、ビルダー、プロファイル、出力名、既定OFFのWeb生成機能を浦島太郎で有効にする設定
- `artifacts.lock.json`: `_urashima` / `urashima` / `web/index.html` の再現可能な出力ハッシュ
- `base/kamishibai.sb3`: `tmpose-kamishibai` `1aae65f5af986320b5078c9e560e7945ee1b4fde` のclone-only UI `generic` 成果物
- `scripts/patch-actor-clone-runtime.mjs`: 元のベースを変更せず、Asset Managerの`actorName`クローン解決だけを生成時に追加する互換パッチ

`source.txt`などの入力を意図的に変更したときは、リポジトリルートで`pnpm update:artifacts-lock`を実行すると、両プロファイルとWeb版を実際に生成して`artifacts.lock.json`を再作成できます。その後の`pnpm build`では、再生成したロックとの一致を通常どおり検証します。

コスチューム18件は汎用アプリの `Actor`、背景6件と音声20件は `Stage` に組み込みます。これにより、汎用ベースへ浦島太郎専用のScratch targetを追加せず、台本のactor定義からクローンを生成できます。

`Fish1`と`Fish2`は、`setLoadingCostume=Fish1,Fish2`により通常アセット読込中のLoading画像として交互に表示します。Loading用の2画像は読込進捗の分子・分母から除外されます。

`Clock Ticking`と`Sewing Machine`はMP3音声アセットとして組み込み、`setPoseRecognitionSound=Clock Ticking,Sewing Machine`で、前者を各ポーズの認識開始から終了まで、後者をポーズ条件の成立時に再生します。

scene 3の魚アニメーションでは、`Fish`クローンを乙姫と同じ中心座標に置き、背面レイヤーで`Fish1`と`Fish2`をloop再生します。固定済み汎用ベースのAsset ManagerはScratch target名だけを検索し、コスチューム元のサイズをクローンへ再適用するため、生成時の互換パッチで`actorName`変数も検索対象に加え、クローンの表示サイズを保持します。

scene 7では、本体3.1.7の標準コマンド`fadeToWhite`でステージの明るさを`+100`へ上げたまま保持してから背景をSmokeへ切り替え、`fadeFromWhite`で`0`へ戻して煙を見せます。通常の`fadeOut`（`-100`で保持）と`fadeUp`（`0`へ復帰）は変更しません。本体のAsset Managerにはproject asset検証とclone削除時の表示状態解放が含まれます。浦島太郎の`actorName`解決とcloneサイズ保持の互換処理だけを生成時に追加し、パッチ後の一時ベースも`sample.config.json`のサイズとSHA-256で検証します。

Web版は `player` の `urashima.sb3` だけをTurboWarp Packager 3.13.0へ渡して生成します。音声はブラウザ互換性を考慮してMP3（44.1kHz、モノラル、128kbps）へ統一しています。`web.audioUnlock.enabled`を有効にすると、WebKitがユーザー操作として扱うタイトル画面のタップ完了をキャプチャしてWeb Audioを再開し、音声クロックの進行まで確認します。バックグラウンドからの復帰時にも再確認するため、iPadOSでもタイトル自動表示と本編開始1タップを維持できます。Packagerは外部URLのScratch拡張も単一HTMLへ取り込みます。実行時にオンライン取得するものはmanifestで許可したTMPoseのTensorFlow.js、Teachable Machine Pose、モデルに限定し、台本固有の画像・音声・台本はSB3内参照のまま利用します。

アセットは、本体PR #44で浦島太郎固有コンテンツを分離する直前の `app/assets/` から同一バイト列で移設しています。ファイル名はScratchの `md5ext` 名を維持しています。

## ライセンスと来歴

台本、画像、音声、生成設定はMozilla Public License 2.0（SPDX: `MPL-2.0`）で提供します。本体ランタイムを含む生成物の適用範囲は [`LICENSES.md`](LICENSES.md) を参照してください。

- 移設元: [`kubohiroya/tmpose-kamishibai`](https://github.com/kubohiroya/tmpose-kamishibai) PR #44
- 移設元コミット: `9526c9d6391622ee261b8d7c0778b1fbbd2e6745`
- ビルダー: npm `@kubohiroya/tmpose-kamishibai` `3.1.7` / `91ca1dadbfdd037e6f0e0f45e80941c777ab242e`
- 汎用ベース: `tmpose-kamishibai` / `1aae65f5af986320b5078c9e560e7945ee1b4fde`

生成・検証・公開の実装は [Issue #2](https://github.com/kubohiroya/tmpose-kamishibai-samples/issues/2)、Packager Web版は [Issue #7](https://github.com/kubohiroya/tmpose-kamishibai-samples/issues/7) で管理します。
