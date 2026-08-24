# 2026年8月1日ワークショップ用素材

このディレクトリには、2026年8月1日のTM紙芝居ワークショップで使用する元データを収録しています。

## ディレクトリ

- `drafts/`: 参加者が利用するポーズ画像の下書き
- `draft-samples/`: ポーズ画像の下書き例
- `master/`: キャラクター画像のマスター
- `generated/`: ワークショップ中に生成物を保存する空ディレクトリ
- `generated-samples/`: 生成画像の例
- `tmpose/`: TM紙芝居の成果物を保存する空ディレクトリ
- `tmpose-samples/`: Teachable Machineプロジェクトの例

画像ファイルとTeachable Machineプロジェクトのライセンスは[`LICENSES.md`](LICENSES.md)を参照してください。

## 配布データの生成

リポジトリルートで次を実行します。

```bash
pnpm run build-workshop-20260801
```

このコマンドは既存のサンプルサイト成果物を再生成し、次の配布物を作成します。

- `dist/workshop/20260801/`
- `dist/workshop/20260801.zip`

配布物の`stories/my-urashima/`には、作業用SB3、DSL 3.2台本、DSL 4.0ワークショップ台本、SB3へPrincessを追加する`project-assets.yml`を収録します。

教材PDFは、既定では隣接する`tmpose-kamishibai`リポジトリの次の出力を使用します。

```text
output/pdf/workshops/2026-08-01/tmpose-kamishibai-20260801.pdf
```

別のPDFを使用する場合は、`TMPOSE_KAMISHIBAI_WORKSHOP_PDF`にファイルの絶対パスを指定してください。
