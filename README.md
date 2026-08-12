# tmpose-kamishibai-samples

`tmpose-kamishibai` の作品カタログ、台本、作品固有アセット、生成設定、検証、公開物を管理するリポジトリです。リポジトリ名と公開URLは互換性のため維持し、公開ページでは「TMPose紙芝居 作品ライブラリ」として提供します。

作品ライブラリ: <https://kubohiroya.github.io/tmpose-kamishibai-samples/>

作品の掲載区分、権利情報、配布形態は[`site/works.json`](site/works.json)で管理し、その形式を[`site/works.schema.json`](site/works.schema.json)で定義します。公式サンプル、コミュニティ作品、外部作品の扱いは[`WORKS_POLICY.md`](WORKS_POLICY.md)を参照してください。外部作品はリンクのみを掲載し、このサイトでは作品データを再配布しません。

浦島太郎サンプルの台本、元アセット、生成設定は `stories/urashima/` に配置しています。

- `source.txt`: 元アセットを `file:` 参照するビルド元台本
- `urashima.txt`: editor/playerで共通の変換済み公開用台本
- `urashima.k4.yml`: 公式CLIで`urashima.txt`から変換したDSL 4.0 YAML
- `assets/images/`: 画像元データ 24ファイル
- `assets/sounds/`: Web再生互換性のためMP3へ統一した音声元データ 22ファイル
- `assets.lock.json`: 組み込み対象44件の名前・target・ハッシュ・メタデータ
- `sample.config.json`: `generic` / `editor` / `player` とWeb版の生成設定
- `artifacts.lock.json`: 再現可能な生成物のサイズとSHA-256
- `base/kamishibai.sb3`: ポーズ認識成立音対応済み本体コミットから生成したDSL 3.2 `generic` ベース
- `base/kamishibai-4.0.sb3`: DSL 4.0安定版ソースcommitから生成し、サイズとSHA-256を固定した`generic`ベース

`stories/my-urashima/`はワークショップ用の依存ストーリーです。DSL 3.2版に加え、Princess PNGを唯一のコスチュームとして持つ`Princess`スプライトと浦島太郎のプロジェクトアセットを組み込んだ、台本非埋め込みの`my-urashima-4.0.sb3`およびWeb版も生成します。生成規約と更新方法は[`stories/my-urashima/README.md`](stories/my-urashima/README.md)に記載しています。

正式な浦島太郎の実行用成果物はDSL 3.2のSVG Textを使い、名前付きstyle、相対font size、複数行のNarration actorを実演します。作品ライブラリでは、公式CLIで変換・検証したDSL 4.0 YAML、オフラインSB3、単一HTML Web版も併せて配布します。deprecatedな旧Text Assetは正式台本から分離したテストfixtureで互換性を確認します。

`pnpm build` は、完全固定した `@kubohiroya/tmpose-kamishibai` `3.2.2` のnpmビルダー、本体コミット`2b5005d`から生成してハッシュ固定したclone-only UIの3.2汎用ベース、commitとハッシュを固定した4.0汎用ベースおよび4.0ビルダー、`@turbowarp/packager` `3.13.0` を使い、次の成果物を生成します。

- `_urashima.sb3` (`editor`): 台本非埋め込み・アセット埋め込み。物語作成者の編集用
- `urashima.sb3` (`player`): 台本・アセット埋め込み。配布・再生用
- `my-urashima.sb3` (`dependent editor`): `urashima`依存・台本非埋め込み・Princess専用スプライト付きの教材用
- `web/index.html`: `player`だけを入力とする、画像・音声・台本組み込み済みの単一HTML
- `urashima-4.0.sb3` / `web-4.0/index.html`: DSL 4.0台本・全アセット・ポーズモデル組み込み済みのオフライン版
- `my-urashima-4.0.sb3` / `my-urashima/web-4.0/index.html`: DSL 4.0外部台本をファイル選択またはドラッグ＆ドロップで開くワークショップ版

先頭の `_` は物語作成者による内部的使用を示します。`player` は編集禁止を意味する「再生専用」ではなく「再生用」です。GitHub Pagesのビルド時には空の`dist/`へすべての成果物をロック済み入力から生成します。DSL 4.0のチェックイン済みSB3は配布元かつ再現性検証対象であり、Web版HTMLはリポジトリへコミットせず自動生成します。

## ライセンス

本リポジトリのソースコードと、個別のライセンス表示がないコンテンツは[Mozilla Public License 2.0](LICENSE)（SPDX: `MPL-2.0`）で提供します。浦島太郎サンプルの適用範囲は[`stories/urashima/LICENSES.md`](stories/urashima/LICENSES.md)に明記しています。

`resources/20260801/`の画像とTeachable MachineプロジェクトにはCC BY-SA 4.0が適用されます。ワークショップ配布物にビルド時に加えるPDF教材はHiroya KuboのAll rights reservedです。詳細な境界は[`resources/20260801/LICENSES.md`](resources/20260801/LICENSES.md)を参照してください。

## ビルドと検証

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test
pnpm build
pnpm test:web
pnpm verify
```

`pnpm build` は空の `dist/` からDSL 3.2／4.0のSB3、Packager Web版、公開サイトを生成し、台本・SB3・HTML・全アセット・ライセンス・リンク・SHA-256を検証します。同じ入力から各Web版を2回生成してハッシュが一致することも確認します。`pnpm test:web` はPages相当のHTTPサーバで各Web版を開きます。DSL 4.0浦島太郎では外部ネットワークを遮断した状態でタイトル画面から組み込み台本が開始すること、my-urashimaではタイトルからメニューへ進み、`.k4.yml`をファイル選択して物語が開始することまでheadless Chromiumで検証します。

CIとPages workflowは`tmpose-kamishibai`を`dsl4-build.config.json`に固定したcommitへcheckoutし、`TMPOSE_KAMISHIBAI_DSL4_ROOT`でビルダー位置を指定します。ローカルでは隣接する`../tmpose-kamishibai`を既定値として使います。DSL 4.0のSB3とWebロックを意図的に一括更新する正規コマンドは`pnpm update:dsl4-artifacts`です。

浦島太郎とmy-urashimaのDSL 4.0 Web版は、各`dsl4-build.config.json`の`web.enabled`を起動時固定のfeature flagとして使います。未指定または`false`ではPackager生成とWeb lock更新をスキップし、チェックイン済みの有効版lockを保持したまま公開導線をdisabledの「準備中」へ戻します。再公開時は`true`へ戻すだけで、保持したlockとの一致を再検証します。

台本の`# date:`は手動更新しません。`pnpm build`は日付行を除いた台本内容のSHA-256をartifact lockと比較し、実質内容が変わった台本だけ、ビルド実行環境のローカル年月日へ更新します。内容が同じなら翌日の再ビルドでも既存日付と成果物ハッシュを維持します。台本変更に伴う公開台本、SB3、artifact lockは同じビルドで更新されます。ローカル実行ではOSのタイムゾーンを使い、GitHub ActionsのCI／Pagesリリースでは`Asia/Tokyo`を明示します。

アセット、生成設定など、台本以外の成果物入力を意図的に変更した場合は、`pnpm update:artifacts-lock` で `stories/urashima/artifacts.lock.json`を再生成してから`pnpm build`を実行します。更新コマンドはSB3とWeb版を実際に生成し、Web版の2回生成が一致した後にだけロックファイルを置き換えます。通常のビルドでは、日付以外の意図しない生成環境差分を引き続きエラーとして検出します。

Pull Requestでは `.github/workflows/ci.yml` が生成と検証だけを行います。`main` へのマージ後は `.github/workflows/deploy.yml` が同じ検証を再実行し、成功した `dist/` だけをGitHub Pagesへ公開します。

## 2026年8月1日ワークショップ配布物

ワークショップ用の元素材は`resources/20260801/`で管理します。次のコマンドは公開サイトを再生成した後、教材PDF、浦島太郎とmy-urashimaの台本・SB3、ライセンス表示を集め、ディレクトリとZIPを作成します。

```bash
pnpm run build-workshop-20260801
```

出力先は`dist/workshop/20260801/`と`dist/workshop/20260801.zip`です。教材PDFの既定入力は、隣接する`tmpose-kamishibai`リポジトリの`output/pdf/workshops/2026-08-01/tmpose-kamishibai-20260801.pdf`です。別の場所を使う場合は`TMPOSE_KAMISHIBAI_WORKSHOP_PDF`に絶対パスを指定します。

## 手動デプロイ

GitHub CLIをインストールして、このリポジトリへのActions実行権限を持つアカウントで認証した後、次を実行します。

```bash
gh auth status
pnpm deploy
```

`pnpm deploy` は、既存の `Deploy GitHub Pages` workflowをリモートの `main` に対して起動します。コマンドの出力に表示されるActions runのURLから進行状況を確認できます。ローカルの未コミット変更や、`main` へpushされていないコミットは公開対象になりません。

公開に問題がある場合はdeploy workflowを停止し、問題の変更をrevertします。Web版だけに問題がある場合は `sample.config.json` の `web.enabled` を `false` にし、Web出力と導線を止めても既存のSB3・台本配信は維持できます。`player`に問題がある場合は一般向け導線を停止し、外部台本を開く`editor`へ切り戻せます。ビルダーの不具合では依存タグとベースSB3を直前の検証済み組へ戻し、修正後に `workflow_dispatch` から再検証・再公開します。

実装計画は次のIssueで管理します。

- [サンプル生成とGitHub Pages公開](https://github.com/kubohiroya/tmpose-kamishibai-samples/issues/1)
- [浦島太郎の生成・検証・公開](https://github.com/kubohiroya/tmpose-kamishibai-samples/issues/2)
- [Packager Web版の生成・公開](https://github.com/kubohiroya/tmpose-kamishibai-samples/issues/7)
- [DSL 4.0 SB3・Web版の自動生成](https://github.com/kubohiroya/tmpose-kamishibai-samples/issues/90)
