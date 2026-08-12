# 浦島太郎 — 用途別SB3の生成元

浦島太郎の元台本、画像・音声、ポーズモデル、アセットロック、生成設定を管理します。3.2成果物に加え、DSL 4.0の台本・全アセット・実行基盤を一つにしたオフライン動作確認用`urashima-4.0.sb3`を提供します。

## 成果物

| プロファイル | ファイル | 台本 | 物語固有アセット | 用途 |
| --- | --- | --- | --- | --- |
| `generic` | `base/kamishibai.sb3` | 非埋め込み | 非埋め込み | 汎用の物語作成・再生用雛形 |
| `editor` | `_urashima.sb3` | 非埋め込み | 埋め込み | 物語作成者による台本編集・動作確認 |
| `player` | `urashima.sb3` | 埋め込み | 埋め込み | 配布・再生、Web版生成 |
| `dsl4-offline` | `urashima-4.0.sb3` / `web-4.0/index.html` | DSL 4.0 YAML埋め込み | 画像・音声・3ポーズモデル埋め込み | DSL 4.0のSB3・Web版での実ブラウザ・実カメラ確認 |

先頭の `_` は物語作成者による内部的使用をコンパクトに示し、非公開や一時ファイルを意味しません。`player` は「再生専用」ではなく「再生用」です。

`editor`と`player`は同じ `source.txt` と `assets.lock.json` から生成します。両者の変換済み台本は同一バイト列です。`player`ではタイトル画面をクリックすると、ファイル選択を開かず、SB3内の台本とアセットだけで紙芝居を開始します。

冒頭と終幕のテキストは、DSL 3.2の`svgTextStyle`と`setText`を使用します。Narrationアクターをproject-localの透明な`prompt/ui-placeholder`から生成し、SVG Text 0.1.0が名前付きstyleを適用したSVG skinへ置き換えます。冒頭ではリテラル`\n`による2行表示、終幕では別の相対font sizeを実演します。旧Text Assetは正式サンプルから分離し、`test/fixtures/legacy-text-3.2.txt`で3.1／3.2ヘッダーのbuilder互換を検証します。ベースは、予約UIテキストを旧Text Asset警告から除外し、builder manifest版を揃えた本体コミット `2b5005d293a9b63c8ba5da396fd86815d093f975` から生成しています。Title、menu、language UIは画面遷移ごとに必要なcloneだけを生成し、不要になったcloneを削除します。

## ビルド元データ

- `source.txt`: 元アセットを `file:` URIで参照する台本
- `urashima.txt`: 生成結果と一致させる変換済み公開用台本
- `urashima.k4.yml`: `urashima.txt`を公式CLIで変換したDSL 4.0 YAML
- `assets/images/`: 画像元データ24ファイル
- `assets/sounds/`: MP3音声元データ22ファイル（組み込み対象20、来歴保存2）
- `pose-models/`: オフライン版へ組み込むTeachable Machine Poseモデル3組（各3ファイル）
- `assets.lock.json`: 組み込み対象44件の名前、target、Scratchメタデータ、サイズ、SHA-256
- `dsl4-inputs.lock.json`: DSL 4.0で追加するStars／TextPlaceholderと3ポーズモデルの取得元、サイズ、SHA-256
- `project-assets-dsl4.yml`: DSL 4.0 actor IDと同名の物理Scratch target 5件を作る`sb3-toolchain --project-assets`入力
- `project.source.json`: `urashima.k4.yml`を選ぶ固定cache identity付きDSL 4.0 source manifest
- `dsl4-build.config.json`: 4.0 runtime base、tmpose-kamishibai commit、入力上限を固定する生成設定
- `dsl4-artifacts.lock.json`: `urashima-4.0.sb3`の入力・出力ハッシュとtarget構成
- `dsl4-web-artifacts.lock.json`: `web-4.0/index.html`の入力・出力ハッシュとPackager設定
- `sample.config.json`: ベース、ビルダー、プロファイル、出力名、既定OFFのWeb生成機能を浦島太郎で有効にする設定
- `artifacts.lock.json`: `_urashima` / `urashima` / `web/index.html` の再現可能な出力ハッシュ
- `base/kamishibai.sb3`: `tmpose-kamishibai` のclone-only UI `generic` 成果物
- `base/kamishibai-4.0.sb3`: DSL 4.0.0-rc.2の固定release sourceから生成した`generic`ベース

`source.txt`の`# date:`はビルドが自動管理します。日付行を除いた内容fingerprintが`artifacts.lock.json`の記録から変わった場合だけ、ビルド環境のローカル今日へ更新し、`urashima.txt`、両プロファイル、Web版、my-urashimaを再生成します。内容が同じ再ビルドでは日付も成果物も更新しません。

## DSL 4.0 YAMLへの変換

`urashima.k4.yml`は3.2台本から変換した内容を起点とし、DSL 4.0の現行schemaへ追随させています。全49 assetは短縮形のScratch project内参照ではなく、リポジトリ内の画像・音声・ポーズモデルを明示するfile-backed宣言です。`delivery: remote`と`source.url`は使用しません。

```bash
pnpm validate:urashima-dsl4
pnpm verify:urashima-dsl4
```

`verify:urashima-dsl4`は、ローカル入力のlock一致、remote asset 0件、物理target、埋め込みsource、49 asset／55 file、ポーズラベル、SB3ハッシュを確認し、最終SB3を`sb3-toolchain`へ再importしてcanonical rebuildがバイト一致することも検証します。DSL 3.2のSB3・Web版は従来どおり`source.txt`と`urashima.txt`から生成し、4.0成果物とはファイル名を分離しています。

## DSL 4.0オフラインSB3の生成

`dsl4-build.config.json`に固定した`tmpose-kamishibai` tag commitを、既定では隣接する`../tmpose-kamishibai`にcheckoutして依存関係をインストールします。CIでは同じcommitを`.tmp/tmpose-kamishibai`へcheckoutし、`TMPOSE_KAMISHIBAI_DSL4_ROOT`でその場所を指定します。入力となる`base/kamishibai-4.0.sb3`も、DSL 4.0.0-rc.2のrelease source identity、サイズ、SHA-256を設定に固定しています。

```bash
pnpm update:dsl4-artifacts
```

このコマンドが、浦島太郎とmy-urashimaのDSL 4.0 SB3、各artifact lock、両Web版のartifact lockを一括更新する正規経路です。浦島太郎だけを更新するときは`pnpm update:urashima-dsl4`を使用します。処理は次の順で行います。

1. `dsl4-inputs.lock.json`に固定したポーズモデルを必要時だけ取得し、Stars／TextPlaceholderを3.2 generic baseから検証付きで抽出する。
2. 4.0 generic baseを`sb3-toolchain`へimportし、`project-assets-dsl4.yml`でUrashima／Turtle／Princess／Fish／Narration targetを追加して決定的再構築する。
3. `tmpose-kamishibai build-dsl4`で台本、画像、音声、ポーズモデルをbundled runtime componentへ埋め込む。
4. 生成途中のSB3をもう一度`sb3-toolchain`へimportし、最終`urashima-4.0.sb3`を決定的再構築する。
5. 完成したSB3をTurboWarp Packager 3.13.0へ渡し、二度の生成結果が一致することを確認してWeb版ロックを更新する。

SB3のZIPや`project.json`を直接編集する別経路はありません。通常の`pnpm build`も同じビルダーを呼び出して、空の`dist/`へ`urashima-4.0.sb3`と`web-4.0/index.html`を自動生成し、チェックイン済みロックと一致することを検証します。通常の再生成はすでに取得済みのローカルモデルだけで完了し、完成したSB3の実行時にはモデル配布元へのネットワーク接続を必要としません。カメラを使うポーズ認識にはブラウザのカメラ権限が必要です。

DSL 4.0 Web版だけを一時停止するときは、`dsl4-build.config.json`の`web.enabled`を`false`にして再ビルドします。Web HTMLは生成されず、作品一覧と詳細画面は「準備中」表示へ戻ります。`dsl4-web-artifacts.lock.json`は保持されるため、`true`へ戻すと同じ成果物を再検証して公開できます。

アセットや生成設定など、台本以外の入力を意図的に変更したときは、リポジトリルートで`pnpm update:artifacts-lock`を実行すると、両プロファイルとWeb版を実際に生成して`artifacts.lock.json`を再作成できます。その後の`pnpm build`では、再生成したロックとの一致を通常どおり検証します。

コスチューム18件は汎用アプリの `Actor`、背景6件と音声20件は `Stage` に組み込みます。これにより、汎用ベースへ浦島太郎専用のScratch targetを追加せず、台本のactor定義からクローンを生成できます。

`Fish1`と`Fish2`は、`setLoadingCostume=Fish1,Fish2`により通常アセット読込中のLoading画像として交互に表示します。Loading用の2画像は読込進捗の分子・分母から除外されます。

`Clock Ticking`と`Sewing Machine`はMP3音声アセットとして組み込み、`setPoseRecognitionSound=Clock Ticking,Sewing Machine`で、前者を各ポーズの認識開始から終了まで、後者をポーズ条件の成立時に再生します。

scene 3の魚アニメーションでは、`Fish`クローンを乙姫と同じ中心座標に置き、背面レイヤーで`Fish1`と`Fish2`をloop再生します。固定済み汎用ベースのAsset Managerは`actorName`変数からクローンを解決し、クローンの表示サイズを保持します。

scene 7では、本体3.2.2の標準コマンド`fadeToWhite`でステージの明るさを`+100`へ上げたまま保持してから背景をSmokeへ切り替え、`fadeFromWhite`で`0`へ戻して煙を見せます。通常の`fadeOut`（`-100`で保持）と`fadeUp`（`0`へ復帰）は変更しません。本体のAsset Managerにはproject asset検証、clone削除時の表示状態解放、`actorName`クローン解決、cloneサイズ保持が含まれます。samples側ではSB3内のランタイムコードを変更しません。

3.2 Web版は`player`の`urashima.sb3`、4.0 Web版は`dsl4-offline`の`urashima-4.0.sb3`をTurboWarp Packager 3.13.0へ渡して生成します。音声はブラウザ互換性を考慮してMP3（44.1kHz、モノラル、128kbps）へ統一しています。3.2の`web.audioUnlock.enabled`を有効にすると、WebKitがユーザー操作として扱うタイトル画面のタップ完了をキャプチャしてWeb Audioを再開し、音声クロックの進行まで確認します。バックグラウンドからの復帰時にも再確認するため、iPadOSでもタイトル自動表示と本編開始1タップを維持できます。Packagerは外部URLのScratch拡張も単一HTMLへ取り込みます。3.2版が実行時にオンライン取得するものはmanifestで許可したTMPoseのTensorFlow.js、Teachable Machine Pose、モデルに限定します。4.0版の台本固有画像・音声・台本・ポーズモデルはすべてSB3に組み込み、検証では外部ネットワークを遮断して再生開始を確認します。

アセットは、本体PR #44で浦島太郎固有コンテンツを分離する直前の `app/assets/` から同一バイト列で移設しています。ファイル名はScratchの `md5ext` 名を維持しています。

## ライセンスと来歴

台本、画像、音声、生成設定はMozilla Public License 2.0（SPDX: `MPL-2.0`）で提供します。本体ランタイムを含む生成物の適用範囲は [`LICENSES.md`](LICENSES.md) を参照してください。

- 移設元: [`kubohiroya/tmpose-kamishibai`](https://github.com/kubohiroya/tmpose-kamishibai) PR #44
- 移設元コミット: `9526c9d6391622ee261b8d7c0778b1fbbd2e6745`
- ビルダー: npm `@kubohiroya/tmpose-kamishibai` `3.2.2` / `2b5005d293a9b63c8ba5da396fd86815d093f975`
- 汎用ベース: `tmpose-kamishibai` / `2b5005d293a9b63c8ba5da396fd86815d093f975`
- DSL 4.0汎用ベースのソース: `tmpose-kamishibai` / `4.0.0-rc.2` / `sha256:70dfcb7dfc391e9f8c576976d810a55656c8cab09c0c729cc685d20e02140991`
- DSL 4.0ビルダー: `tmpose-kamishibai` / `4.0.0-rc.2` / `9fdea59854ff0a28a00a45fe8e1d7cd5bb0c9014`

生成・検証・公開の実装は [Issue #2](https://github.com/kubohiroya/tmpose-kamishibai-samples/issues/2)、Packager Web版は [Issue #7](https://github.com/kubohiroya/tmpose-kamishibai-samples/issues/7)、DSL 4.0の自動生成は [Issue #90](https://github.com/kubohiroya/tmpose-kamishibai-samples/issues/90) で管理します。
