# my-urashima

2026-08-01ワークショップ用の依存ストーリーです。`../urashima/source.txt`、アセットロック、generic base SB3を親入力として使用し、外部台本専用の`my-urashima.sb3`を生成します。

`Princess`は独立したScratchスプライトとして定義し、親ストーリーのPrincess PNGを同名コスチュームとして直接組み込みます。台本では最短表記`asset=Princess,costume`で参照し、`Actor`スプライトにはPrincessコスチュームを組み込みません。

`my-urashima.sb3`には台本を埋め込みません。`tmposeEmbeddedScript`、台本用リスト、`.txt` ZIPエントリは空のままにし、`my-urashima.txt`を外部から読み込んで使用します。

## 作品情報

- 対応DSL: 3.2／4.0
- 掲載形態: 当サイトで配布
- ライセンス・利用条件: [MPL-2.0、CC BY-SA 2.0ほか](../urashima/LICENSES.md)

親入力や設定を意図的に変更した場合は、リポジトリルートで次を実行してチェックイン済み成果物とロックを更新します。

```bash
pnpm update:my-urashima
```

通常の`pnpm build`は同じ成果物を一時生成し、チェックイン済みSB3・台本・ロックとの一致を検証します。

## DSL 4.0 YAMLへの変換

`my-urashima.k4.yml`は、チェックイン済みの`my-urashima.txt`を`tmpose-kamishibai`の公式`convert-dsl4`で変換した公開用DSL 4.0 YAMLです。変換にはcommit `694df4095c336199eb73362523ee23dd241606ba`を使用し、同じ処理系の`validate-dsl4`で検証しています。生成後のYAMLは手修正していません。

```bash
node ../tmpose-kamishibai/bin/tmpose-kamishibai.mjs convert-dsl4 \
  --input stories/my-urashima/my-urashima.txt \
  --output stories/my-urashima/my-urashima.k4.yml
node ../tmpose-kamishibai/bin/tmpose-kamishibai.mjs validate-dsl4 \
  --input stories/my-urashima/my-urashima.k4.yml \
  --max-source-bytes 262144 \
  --format pretty
```

変換時のwarningとして、`startSceneIndex`のnumber型推論、costumeのlogical actorへの付け替え、Stage音声名の一意性確認、秒数指定のないtransitionの0秒化、app shell用`text`の省略を確認しています。変換停止errorはなく、検証結果は`my-urashima.k4.yml: valid`です。DSL 3.2の作業用SB3と外部台本は変更せず、従来どおり利用できます。

ライセンスと素材の来歴は、親作品の[`LICENSES.md`](../urashima/LICENSES.md)を参照してください。
